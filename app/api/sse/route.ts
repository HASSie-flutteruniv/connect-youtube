import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { checkAndProcessAutoExit } from '@/lib/autoExit';
import { fetchRoomData, calculateBackoff, createSystemMessage, ChangeStreamManager } from '@/lib/sseUtils';
import { ChangeStream, ChangeStreamDocument, Db } from 'mongodb';

export async function GET() {
  console.log('[SSE] Handler started');
  try {
    console.log('[SSE] Connecting to MongoDB...');
    const client = await clientPromise;
    const db: Db = client.db('coworking');
    console.log('[SSE] MongoDB connection established');
    const encoder = new TextEncoder();

    // シングルトンのChangeStreamManagerを取得
    const manager = ChangeStreamManager.getInstance();

    // コントローラーがクローズされたかを追跡するフラグ
    let isControllerClosed = false;
    // 再接続の試行回数
    let changeStreamRetryCount = 0;
    // アクティブなChangeStream
    let seatsChangeStream: ChangeStream | null = null;
    let notificationsChangeStream: ChangeStream | null = null;
    // この接続が管理する自動退室チェックのインターバルID
    let autoExitIntervalId: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        console.log('[SSE] Stream initialization started');
        // このSSE接続を登録
        manager.registerConnection();

        // 自動退室チェック関数
        const checkAutoExit = async () => {
          // コントローラーがクローズされていたら何もしない
          if (isControllerClosed) {
            console.log('[SSE] Auto-exit check skipped: Controller closed.');
            // インターバルもクリアすべき
            if (autoExitIntervalId) {
               clearInterval(autoExitIntervalId);
               autoExitIntervalId = null;
               console.log('[SSE] Auto-exit interval cleared due to closed controller during check.');
            }
            return;
          }
          try {
            console.log('[SSE] 自動退室チェックを実行します');
            const results = await checkAndProcessAutoExit(db, false); // 通知は無効

            if (results.processedCount > 0) {
              console.log(`[SSE] ${results.processedCount}件の座席を自動退室処理しました`);
              if (!isControllerClosed) {
                const updatedData = await fetchRoomData(db);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\n\n`));
                controller.enqueue(encoder.encode(
                  createSystemMessage(`${results.processedCount}人のユーザーが自動退室しました`, 'info')
                ));
                console.log('[SSE] 自動退室後のデータをクライアントに送信しました');
              }
            } else {
              console.log('[SSE] 期限切れの座席はありませんでした');
            }
          } catch (error) {
            console.error('[SSE] 自動退室チェック中にエラーが発生しました:', error);
             if (!isControllerClosed) {
                controller.enqueue(encoder.encode(
                  createSystemMessage(`自動退室チェック中にエラー発生: ${(error as Error).message}`, 'error')
                ));
            }
          }
        };

        // seats コレクションの Change Stream を設定する関数
        const setupSeatsChangeStream = async () => {
          try {
            if (seatsChangeStream) {
               await seatsChangeStream.close().catch((err: Error) => console.error('[SSE] Error closing previous seats change stream:', err));
               seatsChangeStream = null; // Clear reference
            }

            console.log('[SSE] Setting up MongoDB seats change stream');
            seatsChangeStream = db.collection('seats').watch();
            console.log('[SSE] Seats change stream initialized');

            // --- 自動退室チェックの開始ロジック ---
            // このインスタンスで、かつ最初の接続の場合のみインターバルを開始する
            if (manager.shouldStartAutoExitCheckOnRegister() && !autoExitIntervalId) {
              console.log('[SSE] Starting auto-exit check interval for this instance.');
              autoExitIntervalId = setInterval(checkAutoExit, 60000); // 1分ごと
            } else if (autoExitIntervalId) {
               console.log('[SSE] Auto-exit check interval is already running for this connection.');
            }
             else {
              console.log('[SSE] Auto-exit check interval not started (not the first connection for this instance or already running).');
            }
            // --- ここまで ---

            seatsChangeStream.on('change', async (changeEvent: ChangeStreamDocument) => {
              if (isControllerClosed) {
                console.log('[SSE] Controller is already closed, ignoring change event');
                return;
              }
              console.log('[SSE] Change detected in seats collection:', JSON.stringify(changeEvent.operationType));
              try {
                console.log('[SSE] Fetching updated data after change');
                const data = await fetchRoomData(db);
                console.log('[SSE] Sending updated data to client');
                if (!isControllerClosed) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                }
              } catch (error) {
                console.error('[SSE] Error processing change stream update:', error);
                if (!isControllerClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Update failed' })}\n\n`));
                  controller.enqueue(encoder.encode(
                    createSystemMessage('データ更新中にエラーが発生しました', 'error')
                  ));
                }
              }
            });

            seatsChangeStream.on('error', async (error: Error) => {
              console.error('[SSE] Seats change stream error:', error);
              if (!isControllerClosed) {
                controller.enqueue(encoder.encode(
                  createSystemMessage('サーバーとの接続に問題が発生しました。再接続を試みています...', 'warning')
                ));
              }

              console.log('[SSE] Closing seats change stream due to error');
              if (seatsChangeStream) {
                await seatsChangeStream.close().catch((err: Error) => console.error('[SSE] Error closing seats change stream on error:', err));
                seatsChangeStream = null; // Clear reference after closing
              }

              const MAX_RETRIES = 10;
              if (changeStreamRetryCount < MAX_RETRIES && !isControllerClosed) {
                changeStreamRetryCount++;
                const delayMs = calculateBackoff(changeStreamRetryCount);
                console.log(`[SSE] Will attempt to reconnect change stream in ${delayMs}ms (retry ${changeStreamRetryCount}/${MAX_RETRIES})`);

                setTimeout(async () => {
                  if (!isControllerClosed) {
                    console.log(`[SSE] Attempting to reconnect to change stream (retry ${changeStreamRetryCount}/${MAX_RETRIES})`);
                    try {
                      await setupChangeStream();
                      // 再接続成功したらリトライカウントをリセット
                      changeStreamRetryCount = 0; // リセット！
                      console.log('[SSE] Successfully reconnected to change stream');

                      if (!isControllerClosed) {
                        controller.enqueue(encoder.encode(
                          createSystemMessage('サーバーとの接続が回復しました', 'info')
                        ));
                        const refreshedData = await fetchRoomData(db);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(refreshedData)}\n\n`));
                      }
                    } catch (reconnectError) {
                      console.error('[SSE] Failed to reconnect to change stream:', reconnectError);
                      // 再接続失敗した場合、さらに待機するか、エラー処理を継続
                    }
                  }
                }, delayMs);
              } else if (!isControllerClosed) {
                console.error(`[SSE] Maximum reconnection attempts (${MAX_RETRIES}) reached or controller closed`);
                controller.enqueue(encoder.encode(
                  createSystemMessage('サーバーとの接続が失われました。ページを再読み込みしてください。', 'error')
                ));
              }
            });
          } catch (setupError) {
            console.error('[SSE] Error setting up seats change stream:', setupError);
            if (!isControllerClosed) {
                controller.enqueue(encoder.encode(
                    createSystemMessage('座席データのストリーム監視設定に失敗しました。', 'error')
                ));
            }
            throw setupError; // エラーを上に伝播させる
          }
        };

        // notifications コレクションの Change Stream を設定する関数
        const setupNotificationsChangeStream = async () => {
          try {
            if (notificationsChangeStream) {
              await notificationsChangeStream.close().catch((err: Error) => 
                console.error('[SSE] Error closing previous notifications change stream:', err));
              notificationsChangeStream = null;
            }

            console.log('[SSE] Setting up MongoDB notifications change stream');
            notificationsChangeStream = db.collection('notifications').watch();
            console.log('[SSE] Notifications change stream initialized');

            notificationsChangeStream.on('change', async (changeEvent: ChangeStreamDocument) => {
              if (isControllerClosed) {
                console.log('[SSE] Controller is already closed, ignoring notifications change event');
                return;
              }

              // 挿入操作のみを処理
              if (changeEvent.operationType === 'insert') {
                try {
                  const notification = changeEvent.fullDocument;
                  if (notification) {
                    console.log('[SSE] New notification detected:', notification.message);
                    
                    // システムメッセージとして送信
                    if (!isControllerClosed) {
                      controller.enqueue(encoder.encode(
                        createSystemMessage(
                          notification.message,
                          notification.type || 'info'
                        )
                      ));
                    }
                  }
                } catch (error) {
                  console.error('[SSE] Error processing notification change:', error);
                }
              }
            });

            notificationsChangeStream.on('error', async (error: Error) => {
              console.error('[SSE] Notifications change stream error:', error);
              
              if (notificationsChangeStream) {
                await notificationsChangeStream.close().catch((err: Error) => 
                  console.error('[SSE] Error closing notifications change stream on error:', err));
                notificationsChangeStream = null;
              }
              
              // エラー発生時は一定時間後に再接続を試みる
              if (!isControllerClosed) {
                setTimeout(async () => {
                  if (!isControllerClosed) {
                    try {
                      await setupNotificationsChangeStream();
                      console.log('[SSE] Successfully reconnected to notifications change stream');
                    } catch (reconnectError) {
                      console.error('[SSE] Failed to reconnect to notifications change stream:', reconnectError);
                    }
                  }
                }, 5000); // 5秒後に再接続
              }
            });
          } catch (setupError) {
            console.error('[SSE] Error setting up notifications change stream:', setupError);
            // 通知ストリームのエラーは非致命的として扱い、メイン処理は継続
          }
        };

        // 両方のChangeStreamを初期化する関数
        const setupChangeStream = async () => {
          await setupSeatsChangeStream();
          await setupNotificationsChangeStream();
        };

        try {
          console.log('[SSE] Preparing to send initial data');
          const initialData = await fetchRoomData(db);
          console.log('[SSE] Sending initial data to client');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

          await setupChangeStream();

          // クリーンアップ関数
          const cleanup = () => {
            console.log('[SSE] Cleaning up resources...');
            
            // インターバルをクリア
            if (autoExitIntervalId) {
              clearInterval(autoExitIntervalId);
              autoExitIntervalId = null;
            }
            
            // ChangeStreamを閉じる
            if (seatsChangeStream) {
              seatsChangeStream.close().catch(err => console.error('[SSE] Error closing seats change stream during cleanup:', err));
              seatsChangeStream = null;
            }
            
            if (notificationsChangeStream) {
              notificationsChangeStream.close().catch(err => console.error('[SSE] Error closing notifications change stream during cleanup:', err));
              notificationsChangeStream = null;
            }
            
            // 接続を登録解除
            manager.unregisterConnection();
            console.log('[SSE] Cleanup completed');
          };
          
          // クリーンアップ関数を返す
          return cleanup;

        } catch (initError) {
          console.error('[SSE] Error during initialization:', initError);
          controller.enqueue(encoder.encode(
            createSystemMessage('初期化中にエラーが発生しました: ' + (initError as Error).message, 'error')
          ));
          controller.error(initError);
          return () => {
            manager.unregisterConnection();
            if (autoExitIntervalId) clearInterval(autoExitIntervalId);
            if (seatsChangeStream) seatsChangeStream.close().catch(console.error);
            if (notificationsChangeStream) notificationsChangeStream.close().catch(console.error);
          };
        }
      },
      
      cancel() {
        console.log('[SSE] Stream cancelled by client');
        isControllerClosed = true;
        
        // インターバルをクリア
        if (autoExitIntervalId) {
          clearInterval(autoExitIntervalId);
          autoExitIntervalId = null;
        }
        
        // ChangeStreamを閉じる
        if (seatsChangeStream) {
          seatsChangeStream.close().catch(err => console.error('[SSE] Error closing seats change stream during cancel:', err));
          seatsChangeStream = null;
        }
        
        if (notificationsChangeStream) {
          notificationsChangeStream.close().catch(err => console.error('[SSE] Error closing notifications change stream during cancel:', err));
          notificationsChangeStream = null;
        }
        
        // 接続を登録解除
        manager.unregisterConnection();
        console.log('[SSE] Stream cancellation cleanup completed');
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[SSE] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}