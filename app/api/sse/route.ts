import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { checkAndProcessAutoExit } from '@/lib/autoExit';
import { fetchRoomData, calculateBackoff, createSystemMessage, ChangeStreamManager } from '@/lib/sseUtils';
import { ChangeStream, ChangeStreamDocument } from 'mongodb';

export async function GET() {
  console.log('[SSE] Handler started');
  try {
    console.log('[SSE] Connecting to MongoDB...');
    const client = await clientPromise;
    const db = client.db('coworking');
    console.log('[SSE] MongoDB connection established');
    const encoder = new TextEncoder();

    // シングルトンのChangeStreamManagerを取得
    const manager = ChangeStreamManager.getInstance();
    // このSSE接続を登録
    manager.registerConnection();

    // コントローラーがクローズされたかを追跡するフラグ
    let isControllerClosed = false;
    // 再接続の試行回数
    let changeStreamRetryCount = 0;
    // アクティブなChangeStream
    let changeStream: ChangeStream | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        console.log('[SSE] Stream initialization started');

        // 自動退室チェック関数
        const checkAutoExit = async () => {
          try {
            console.log('[SSE] 自動退室チェックを実行します');
            
            // 共通モジュールを使用して自動退室処理を実行（YouTube通知は無効）
            const results = await checkAndProcessAutoExit(db, false);
            
            // 処理結果をログ出力
            if (results.processedCount > 0) {
              console.log(`[SSE] ${results.processedCount}件の座席を自動退室処理しました`);
              
              // 更新後のデータをクライアントに送信（コントローラーがクローズされていないことを確認）
              if (!isControllerClosed) {
                const updatedData = await fetchRoomData(db);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\n\n`));
                
                // システムメッセージも送信
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
          }
        };

        // Change Streamを設定する関数（再接続にも使用）
        const setupChangeStream = async () => {
          try {
            // 既存のストリームがあれば閉じる
            if (changeStream) {
              await changeStream.close().catch((err: Error) => console.error('[SSE] Error closing previous change stream:', err));
            }
            
            // 新しいストリームを作成
            console.log('[SSE] Setting up MongoDB change stream');
            changeStream = db.collection('seats').watch();
            console.log('[SSE] Change stream initialized');
            
            // ChangeStreamマネージャーに自動退室チェック処理を登録
            const startedNewCheck = manager.startAutoExitCheck(db, checkAutoExit);
            if (startedNewCheck) {
              console.log('[SSE] 自動退室チェックの実行を開始しました');
            } else {
              console.log('[SSE] 自動退室チェックは他の接続で実行中のため、新規には開始しません');
            }
            
            // 変更検出イベントハンドラ
            changeStream.on('change', async (changeEvent: ChangeStreamDocument) => {
              // コントローラーがクローズされていないことを確認
              if (isControllerClosed) {
                console.log('[SSE] Controller is already closed, ignoring change event');
                return;
              }

              console.log('[SSE] Change detected in seats collection:', JSON.stringify(changeEvent.operationType));
              try {
                console.log('[SSE] Fetching updated data after change');
                const data = await fetchRoomData(db);
                console.log('[SSE] Sending updated data to client');
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch (error) {
                console.error('[SSE] Error processing change stream update:', error);
                // エラーメッセージをクライアントに送信
                if (!isControllerClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Update failed' })}\n\n`));
                  controller.enqueue(encoder.encode(
                    createSystemMessage('データ更新中にエラーが発生しました', 'error')
                  ));
                }
              }
            });

            // エラーイベントハンドラ（再接続ロジックを含む）
            changeStream.on('error', async (error: Error) => {
              console.error('[SSE] Change stream error:', error);
              
              // エラーメッセージをクライアントに送信
              if (!isControllerClosed) {
                controller.enqueue(encoder.encode(
                  createSystemMessage('サーバーとの接続に問題が発生しました。再接続を試みています...', 'warning')
                ));
              }
              
              // ストリームを閉じる
              console.log('[SSE] Closing change stream due to error');
              if (changeStream) {
                await changeStream.close().catch((err: Error) => console.error('[SSE] Error closing change stream:', err));
              }
              
              // 最大再試行回数を超えていない場合は再接続
              const MAX_RETRIES = 10;
              if (changeStreamRetryCount < MAX_RETRIES && !isControllerClosed) {
                changeStreamRetryCount++;
                const delayMs = calculateBackoff(changeStreamRetryCount);
                console.log(`[SSE] Will attempt to reconnect in ${delayMs}ms (retry ${changeStreamRetryCount}/${MAX_RETRIES})`);
                
                // 指数バックオフを使用して再接続
                setTimeout(async () => {
                  if (!isControllerClosed) {
                    console.log(`[SSE] Attempting to reconnect to change stream (retry ${changeStreamRetryCount}/${MAX_RETRIES})`);
                    try {
                      await setupChangeStream();
                      // 再接続成功したらリトライカウントをリセット
                      changeStreamRetryCount = 0;
                      console.log('[SSE] Successfully reconnected to change stream');
                      
                      // 接続回復メッセージ
                      if (!isControllerClosed) {
                        controller.enqueue(encoder.encode(
                          createSystemMessage('サーバーとの接続が回復しました', 'info')
                        ));
                        
                        // 最新データを送信
                        const refreshedData = await fetchRoomData(db);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(refreshedData)}\n\n`));
                      }
                    } catch (reconnectError) {
                      console.error('[SSE] Failed to reconnect to change stream:', reconnectError);
                    }
                  }
                }, delayMs);
              } else if (!isControllerClosed) {
                console.error(`[SSE] Maximum reconnection attempts (${MAX_RETRIES}) reached or controller closed`);
                // 最終エラーメッセージ
                controller.enqueue(encoder.encode(
                  createSystemMessage('サーバーとの接続が失われました。ページを再読み込みしてください。', 'error')
                ));
              }
            });
            
            // 正常に初期化されたらクローズカウントをリセット
            changeStreamRetryCount = 0;
          } catch (setupError) {
            console.error('[SSE] Error setting up change stream:', setupError);
            throw setupError;
          }
        };

        try {
          // 初期データを送信
          console.log('[SSE] Preparing to send initial data');
          const initialData = await fetchRoomData(db);
          console.log('[SSE] Sending initial data to client');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));
          
          // Change Streamを設定
          await setupChangeStream();
          
          // クリーンアップ関数を返す
          return () => {
            console.log('[SSE] Stream cleanup - closing change stream');
            isControllerClosed = true;
            
            if (changeStream) {
              changeStream.close().catch((err: Error) => console.error('[SSE] Error closing change stream during cleanup:', err));
            }
            
            // 接続の登録を解除して、必要に応じて自動退室チェックも停止
            manager.unregisterConnection();
            manager.stopAutoExitCheck();
            
            console.log('[SSE] Stream cleanup completed');
          };
        } catch (error) {
          console.error('[SSE] Error in stream start:', error);
          // エラーメッセージを送信
          controller.enqueue(encoder.encode(
            createSystemMessage('ストリームの初期化に失敗しました。ページを再読み込みしてください。', 'error')
          ));
          throw error;
        }
      }
    });

    console.log('[SSE] Returning stream response');
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[SSE] MongoDB connection error:', error);
    return new NextResponse(JSON.stringify({ error: 'Database connection failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}