import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { checkAndProcessAutoExit } from '@/lib/autoExit';
import { fetchRoomData, calculateBackoff, createSystemMessage, ChangeStreamManager } from '@/lib/sseUtils';
import { ChangeStream, ChangeStreamDocument, Db, MongoClient } from 'mongodb';

export const dynamic = 'force-dynamic';

// --- Helper functions moved outside GET handler ---

// seats Change Stream 設定ヘルパー関数
async function setupSeatsChangeStream(
    db: Db,
    manager: ChangeStreamManager,
    controller: ReadableStreamDefaultController<any>,
    checkAutoExit: () => Promise<void>,
    // Variables from GET handler scope passed by reference or as callbacks
    getSeatsChangeStream: () => ChangeStream | null,
    setSeatsChangeStream: (stream: ChangeStream | null) => void,
    getAutoExitIntervalId: () => NodeJS.Timeout | null,
    setAutoExitIntervalId: (id: NodeJS.Timeout | null) => void,
    getChangeStreamRetryCount: () => number,
    setChangeStreamRetryCount: (count: number) => void,
    incrementChangeStreamRetryCount: () => number,
    isControllerClosed: () => boolean,
    setupChangeStreams: () => Promise<void>, // Function to retry setting up both streams
    updateActivityTimeFn?: () => void // アクティビティ更新関数を追加
) {
    try {
        const currentStream = getSeatsChangeStream();
        if (currentStream) {
           await currentStream.close().catch((err: Error) => console.error('[SSE Helper] Error closing previous seats change stream:', err));
           setSeatsChangeStream(null); // Clear reference
        }

        console.log('[SSE Helper] Setting up MongoDB seats change stream');
        const newStream = db.collection('seats').watch([
          // Optionally add pipeline stages here if needed
          // e.g., { $match: { 'operationType': { $in: ['insert', 'update', 'replace', 'delete'] } } }
        ]);
        setSeatsChangeStream(newStream); // Store the new stream reference
        console.log('[SSE Helper] Seats change stream initialized');

        // --- 自動退室チェックの開始ロジック ---
        // このインスタンスで、かつ最初の接続の場合のみインターバルを開始する
        if (manager.shouldStartAutoExitCheckOnRegister() && !getAutoExitIntervalId()) {
          console.log('[SSE Helper] Starting auto-exit check interval for this instance.');
          const newIntervalId = setInterval(checkAutoExit, 60000); // 1分ごと
          setAutoExitIntervalId(newIntervalId);
        } else if (getAutoExitIntervalId()) {
           console.log('[SSE Helper] Auto-exit check interval is already running for this connection.');
        } else {
          console.log('[SSE Helper] Auto-exit check interval not started (not the first connection for this instance or already running).');
        }
        // --- ここまで ---

        newStream.on('change', async (changeEvent: ChangeStreamDocument) => {
          if (isControllerClosed()) {
            console.log('[SSE Helper] Controller is already closed, ignoring change event');
            return;
          }
          console.log('[SSE Helper] Change detected in seats collection:', JSON.stringify(changeEvent.operationType));
          try {
            console.log('[SSE Helper] Fetching updated data after change');
            const data = await fetchRoomData(db); // db is guaranteed non-null here
            console.log('[SSE Helper] Sending updated data to client');
            if (!isControllerClosed()) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
                // データ送信時にアクティビティタイムを更新
                if (typeof updateActivityTimeFn === 'function') {
                  updateActivityTimeFn();
                  console.log('[SSE Helper] Activity time updated after data change');
                }
            }
          } catch (error) {
            console.error('[SSE Helper] Error processing change stream update:', error);
            if (!isControllerClosed()) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Update failed' })}\n\n`));
              controller.enqueue(new TextEncoder().encode(
                createSystemMessage('データ更新中にエラーが発生しました', 'error')
              ));
            }
          }
        });

        newStream.on('error', async (error: Error) => {
          console.error('[SSE Helper] Seats change stream error:', error.message, error.stack);
          if (!isControllerClosed()) {
            controller.enqueue(new TextEncoder().encode(
              createSystemMessage('サーバーとの接続に問題が発生しました。再接続を試みています...', 'warning')
            ));
          }

          console.log('[SSE Helper] Closing seats change stream due to error');
          const currentStreamOnError = getSeatsChangeStream();
          if (currentStreamOnError) {
            await currentStreamOnError.close().catch((err: Error) => console.error('[SSE Helper] Error closing seats change stream on error:', err));
            setSeatsChangeStream(null); // Clear reference after closing
          }
          const currentIntervalOnError = getAutoExitIntervalId();
          if (currentIntervalOnError) {
              clearInterval(currentIntervalOnError);
              setAutoExitIntervalId(null);
              console.log('[SSE Helper] Cleared auto-exit interval due to seats stream error.');
          }

          // 深刻なエラーのみストリームを終了する（例：MongoDB接続の完全切断など）
          if (error.message.includes('no longer connected to server') ||
              error.message.includes('connection closed') ||
              error.message.includes('topology closed')) {
            if (!isControllerClosed()) {
              console.error('[SSE Helper] Critical connection error detected. Closing stream.');
              controller.enqueue(new TextEncoder().encode(
                createSystemMessage('サーバーとの接続が失われました。ページを再読み込みしてください。', 'error')
              ));
              
              // エラーフラグを送信
              controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ 
                code: 'CONNECTION_LOST',
                message: 'Server connection lost' 
              })}\n\n`));
              
              // 少し遅延させてからストリームを閉じる（クライアントがメッセージを受け取れるようにするため）
              setTimeout(() => {
                try {
                  if (!isControllerClosed()) {
                    controller.close();
                    console.log('[SSE Helper] Controller closed due to critical error.');
                  }
                } catch (e) {
                  console.error('[SSE Helper] Error closing controller after critical error:', e);
                }
              }, 500);
            }
          } else {
            console.log('[SSE Helper] Non-critical error detected. Allowing automatic reconnection.');
          }
        });
      } catch (setupError) {
        console.error('[SSE Helper] Error setting up seats change stream:', setupError);
        if (!isControllerClosed()) {
            controller.enqueue(new TextEncoder().encode(
                createSystemMessage('座席データのストリーム監視設定に失敗しました。', 'error')
            ));
        }
        throw setupError; // エラーを上に伝播させる
      }
}

// notifications Change Stream 設定ヘルパー関数
async function setupNotificationsChangeStream(
    db: Db,
    controller: ReadableStreamDefaultController<any>,
    // Variables from GET handler scope
    getNotificationsChangeStream: () => ChangeStream | null,
    setNotificationsChangeStream: (stream: ChangeStream | null) => void,
    isControllerClosed: () => boolean,
    setupStreamsFn: () => Promise<void> // Function to re-setup *both* streams
) {
    try {
        const currentStream = getNotificationsChangeStream();
        if (currentStream) {
          await currentStream.close().catch((err: Error) =>
            console.error('[SSE Helper] Error closing previous notifications change stream:', err));
          setNotificationsChangeStream(null);
        }

        console.log('[SSE Helper] Setting up MongoDB notifications change stream');
        const newStream = db.collection('announcements').watch([{ $match: { operationType: 'insert' } }]);
        setNotificationsChangeStream(newStream);
        console.log('[SSE Helper] Announcements change stream initialized');

        newStream.on('change', async (changeEvent: ChangeStreamDocument<any>) => {
          if (isControllerClosed()) {
            console.log('[SSE Helper] Controller is already closed, ignoring announcement change event');
            return;
          }

          if (changeEvent.operationType === 'insert') {
            try {
              const announcement = changeEvent.fullDocument;
              if (announcement) {
                console.log('[SSE Helper] New announcement detected:', announcement.message);
                if (!isControllerClosed()) {
                  controller.enqueue(new TextEncoder().encode(
                    createSystemMessage(
                      `[お知らせ] ${announcement.message}`,
                      'info',
                      announcement._id?.toString()
                    )
                  ));
                   console.log('[SSE Helper] Sent announcement system message.');
                }
              }
            } catch (error) {
              console.error('[SSE Helper] Error processing announcement change:', error);
            }
          }
        });

        newStream.on('error', async (error: Error) => {
          console.error('[SSE Helper] Announcements change stream error:', error.message, error.stack);

           const currentStreamOnError = getNotificationsChangeStream();
          if (currentStreamOnError) {
            await currentStreamOnError.close().catch((err: Error) =>
              console.error('[SSE Helper] Error closing announcements change stream on error:', err));
            setNotificationsChangeStream(null);
          }

          if (!isControllerClosed()) {
             console.warn('[SSE Helper] Announcements stream encountered an error. Relying on seats stream error handling for reconnection.');
          }
        });
      } catch (setupError) {
        console.error('[SSE Helper] Error setting up announcements change stream:', setupError);
         if (!isControllerClosed()) {
            controller.enqueue(new TextEncoder().encode(
                createSystemMessage('お知らせデータのストリーム監視設定に失敗しました。', 'error')
            ));
        }
        throw setupError;
      }
}


export async function GET() {
  console.log('[SSE] GET handler entered');

  const encoder = new TextEncoder();
  // --- Variables scoped to the GET handler ---
  let client: MongoClient | null = null; // Use MongoClient type
  let db: Db | null = null;
  let seatsChangeStream: ChangeStream | null = null;
  let notificationsChangeStream: ChangeStream | null = null;
  let autoExitIntervalId: NodeJS.Timeout | null = null;
  let keepAliveIntervalId: NodeJS.Timeout | null = null; // Added for keep-alive
  let connectionStatusIntervalId: NodeJS.Timeout | null = null; // 追加: 接続状態の定期チェック用
  let inactivityTimeoutId: NodeJS.Timeout | null = null; // 追加: 非アクティブ検出用
  let lastActivityTime = Date.now(); // 追加: 最後のアクティビティ時間
  let changeStreamRetryCount = 0;
  const manager = ChangeStreamManager.getInstance();
  let isControllerClosed = false; // Add flag
  const abortController = new AbortController(); // 追加: AbortControllerを使用して接続終了を検出
  let connectionId: string = ''; // 追加: この接続の固有ID
  const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 追加: 5分間の非アクティブでタイムアウト

  // --- 活動時間の更新関数 ---
  const updateActivityTime = () => {
    lastActivityTime = Date.now();
  };

  // --- Accessor/Mutator functions for scoped variables ---
  const getSeatsChangeStream = () => seatsChangeStream;
  const setSeatsChangeStream = (stream: ChangeStream | null) => { seatsChangeStream = stream; };
  const getNotificationsChangeStream = () => notificationsChangeStream;
  const setNotificationsChangeStream = (stream: ChangeStream | null) => { notificationsChangeStream = stream; };
  const getAutoExitIntervalId = () => autoExitIntervalId;
  const setAutoExitIntervalId = (id: NodeJS.Timeout | null) => { autoExitIntervalId = id; };
  const getChangeStreamRetryCount = () => changeStreamRetryCount;
  const setChangeStreamRetryCount = (count: number) => { changeStreamRetryCount = count; };
  const incrementChangeStreamRetryCount = () => { return ++changeStreamRetryCount; };
  const isControllerClosedFn = () => isControllerClosed;

  // --- Cleanup function --- (defined before stream to be accessible)
  const cleanupResources = () => {
    console.log('[SSE Cleanup] Cleaning up resources...'); // ★ Log cleanup start
    
    // 既にクリーンアップされている場合は何もしない
    if (isControllerClosed) {
      console.log('[SSE Cleanup] Resources already cleaned up, skipping');
      return;
    }
    
    isControllerClosed = true; // Set flag immediately
    
    // 各種インターバルタイマーの解除
    if (keepAliveIntervalId) {
      clearInterval(keepAliveIntervalId);
      keepAliveIntervalId = null;
      console.log('[SSE Cleanup] Cleared keep-alive interval.');
    }
    
    if (autoExitIntervalId) {
      clearInterval(autoExitIntervalId);
      setAutoExitIntervalId(null); // Use the setter
      console.log('[SSE Cleanup] Cleared auto-exit interval.');
    }
    
    if (connectionStatusIntervalId) {
      clearInterval(connectionStatusIntervalId);
      connectionStatusIntervalId = null;
      console.log('[SSE Cleanup] Cleared connection status interval.');
    }
    
    // タイムアウト検出のクリア
    if (inactivityTimeoutId) {
      clearTimeout(inactivityTimeoutId);
      inactivityTimeoutId = null;
      console.log('[SSE Cleanup] Cleared inactivity timeout.');
    }
    
    // Close change streams safely
    const closePromises = [];
    const currentSeatsStream = getSeatsChangeStream();
    if (currentSeatsStream) {
        console.log('[SSE Cleanup] Closing seats change stream...');
        closePromises.push(currentSeatsStream.close().catch((err: Error) => console.error('[SSE Cleanup] Error closing seats stream:', err)));
        setSeatsChangeStream(null); // Clear reference
    }
    const currentNotificationsStream = getNotificationsChangeStream();
     if (currentNotificationsStream) {
        console.log('[SSE Cleanup] Closing notifications change stream...');
        closePromises.push(currentNotificationsStream.close().catch((err: Error) => console.error('[SSE Cleanup] Error closing notifications stream:', err)));
        setNotificationsChangeStream(null); // Clear reference
    }

    // 重要な修正: MongoDB clientは閉じない
    // デベロップモードでは共有クライアントを使用しているため
    // ここでクライアントを閉じると他のSSE接続で問題が発生する
    Promise.all(closePromises).then(() => {
        console.log('[SSE Cleanup] All change streams closed.');
        
        // 代わりに参照のみをクリア
        client = null;
        db = null;
        console.log('[SSE Cleanup] MongoDB client references cleared (connection maintained for other streams).');
        
        // 接続管理から削除
        if (connectionId) {
          manager.unregisterConnection(connectionId);
          console.log(`[SSE Cleanup] Connection ${connectionId} unregistered from manager.`);
          
          // 全体の接続状態をログ出力
          manager.logConnectionStatus();
        } else {
          console.warn('[SSE Cleanup] No connectionId found when cleaning up');
          manager.unregisterConnection();
        }
    });

    console.log('[SSE Cleanup] Resources cleaned up.'); // ★ Log cleanup end
  };


  const stream = new ReadableStream({
    async start(controller) {
      console.log('[SSE] Stream started'); // ★ Log stream start
      connectionId = manager.registerConnection();
      console.log(`[SSE] New connection registered with ID: ${connectionId}`);
      
      // 初期アクティビティタイム設定
      updateActivityTime();
      
      // 非アクティブ検出タイマーの設定
      const setupInactivityTimeout = () => {
        // 既存のタイマーをクリア
        if (inactivityTimeoutId) {
          clearTimeout(inactivityTimeoutId);
        }
        
        // 新しいタイマーを設定
        inactivityTimeoutId = setTimeout(() => {
          const currentTime = Date.now();
          const inactiveTime = currentTime - lastActivityTime;
          
          if (inactiveTime >= INACTIVITY_TIMEOUT) {
            console.log(`[SSE] Connection ${connectionId} inactive for ${inactiveTime}ms, closing`);
            if (!isControllerClosed) {
              // 非アクティブなコネクションを閉じる
              controller.enqueue(encoder.encode(
                createSystemMessage('長時間アクティビティがないためサーバー接続を終了します。', 'warning')
              ));
              
              // タイムアウトメッセージを送信
              controller.enqueue(encoder.encode(`event: timeout\ndata: ${JSON.stringify({ 
                code: 'INACTIVITY_TIMEOUT',
                message: 'Connection closed due to inactivity',
                inactiveTime
              })}\n\n`));
              
              // 少し遅延させてからリソースをクリーンアップ
              setTimeout(() => {
                cleanupResources();
              }, 500);
            }
          } else {
            // まだタイムアウトしていない場合は再度チェックをスケジュール
            setupInactivityTimeout();
          }
        }, INACTIVITY_TIMEOUT);
      };
      
      // 初回タイムアウト検出を設定
      setupInactivityTimeout();
      
      // 定期的な接続状態チェックを開始
      connectionStatusIntervalId = setInterval(() => {
        if (!isControllerClosed) {
          // 全体の接続状態をログ出力
          manager.logConnectionStatus();
        } else if (connectionStatusIntervalId) {
          clearInterval(connectionStatusIntervalId);
          connectionStatusIntervalId = null;
        }
      }, 60000); // 1分ごとに状態をログ出力

      // リーダー切断検出の改善
      // クライアントのリクエスト終了を検出する
      const { signal } = abortController;
      signal.addEventListener('abort', () => {
        console.log('[SSE] AbortController signal triggered - client disconnected');
        if (!isControllerClosed) {
          cleanupResources();
        }
      });

      const setupStreams = async () => {
        // Reset retry count when attempting setup
        // setChangeStreamRetryCount(0); // <--- この行もコメントアウト
        console.log('[SSE Setup] Attempting to setup change streams...');
        try {
          client = await clientPromise;
          
          // 接続状態を確認（修正版）
          try {
            // サーバーに軽量なpingコマンドを送信して接続状態を確認
            await client.db('admin').command({ ping: 1 });
            console.log('[SSE Setup] MongoDB connection verified by ping');
          } catch (pingError) {
            console.log('[SSE Setup] MongoDB client not responding to ping. Attempting to reconnect...');
            // clientPromiseを再取得して接続を確保
            try {
              client = await clientPromise;
              await client.db('admin').command({ ping: 1 });
            } catch (reconnectError) {
              console.error('[SSE Setup] Failed to reconnect to MongoDB:', reconnectError);
              throw new Error('Failed to establish MongoDB connection after retry');
            }
          }
          
          db = client.db('coworking');
          console.log('[SSE Setup] MongoDB connected');

          // Setup both streams concurrently (or sequentially if needed)
          await Promise.all([
            setupSeatsChangeStream(db, manager, controller, checkAutoExit, getSeatsChangeStream, setSeatsChangeStream, getAutoExitIntervalId, setAutoExitIntervalId, getChangeStreamRetryCount, setChangeStreamRetryCount, incrementChangeStreamRetryCount, isControllerClosedFn, setupStreams, updateActivityTime),
            setupNotificationsChangeStream(db, controller, getNotificationsChangeStream, setNotificationsChangeStream, isControllerClosedFn, setupStreams)
          ]);
          console.log('[SSE Setup] Both change streams setup successfully');

          // --- Initial Data Fetch and Send ---
          console.log('[SSE Setup] Fetching initial room data...'); // ★ Log initial fetch
          try {
            const initialData = await fetchRoomData(db);
            const initialDataString = `data: ${JSON.stringify(initialData)}\n\n`;
            console.log('[SSE Setup] Sending initial data to client:', JSON.stringify(initialData).substring(0, 100) + '...'); // ★ Log initial send (limit length)
            if (!isControllerClosed) { // Check flag before enqueue
                controller.enqueue(encoder.encode(initialDataString));
                console.log('[SSE Setup] Initial data enqueued.'); // ★ Log enqueue success
            } else {
                console.warn('[SSE Setup] Controller closed before initial data could be sent.'); // ★ Log if closed
            }
          } catch (fetchError) {
              console.error('[SSE Setup] Error fetching or sending initial data:', fetchError);
              if (!isControllerClosed) {
                  controller.enqueue(encoder.encode(createSystemMessage('初期データの取得に失敗しました。', 'error')));
                  // ★ 初期データ取得失敗時もストリームを閉じる
                  try {
                     controller.close();
                     console.log('[SSE Setup] Controller closed due to initial data fetch error.');
                  } catch (e) {
                     console.error('[SSE Setup] Error closing controller after initial data fetch error:', e);
                  }
              }
          }
          // --- End Initial Data ---

        } catch (error) {
          console.error('[SSE Setup] Error setting up streams:', error);
          if (!isControllerClosed) { // Check flag before enqueue
            controller.enqueue(encoder.encode(createSystemMessage('サーバー接続中にエラーが発生しました。', 'error')));
            // ★ ストリーム設定失敗時もストリームを閉じる
            try {
               controller.close();
               console.log('[SSE Setup] Controller closed due to stream setup error.');
            } catch (e) {
               console.error('[SSE Setup] Error closing controller after stream setup error:', e);
            }
          }
        }
      };

      const checkAutoExit = async () => {
         if (isControllerClosed) return; // Don't run if closed
         console.log('[SSE AutoExit] Starting auto-exit check...');
         try {
           if (!db) {
             console.warn('[SSE AutoExit] DB not available, attempting to connect');
             try {
               client = await clientPromise;
               db = client.db('coworking');
             } catch (connectError) {
               console.error('[SSE AutoExit] Failed to reconnect DB for auto-exit check:', connectError);
               return; // Skip check if DB connection fails
             }
           }
           const result = await checkAndProcessAutoExit(db);
           if (result && result.processedCount > 0) {
             console.log(`[SSE AutoExit] Processed ${result.processedCount} auto-exits. Fetching updated data...`);
             // Auto-exitが発生したらデータを再取得して送信
             const updatedData = await fetchRoomData(db);
             if (!isControllerClosed) { // Check flag
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\n\n`));
                console.log('[SSE AutoExit] Sent updated data after auto-exit.');
             }
           } else {
               // console.log('[SSE AutoExit] No users processed for auto-exit.');
           }
         } catch (error) {
           console.error('[SSE AutoExit] Error during auto-exit check:', error);
           if (!isControllerClosed) { // Check flag
               controller.enqueue(encoder.encode(createSystemMessage('自動退室処理中にエラーが発生しました。', 'warning')));
           }
         }
       };

      // Initial setup
      await setupStreams();

      // キープアライブメッセージの送信間隔を短く設定
      keepAliveIntervalId = setInterval(() => {
        if (!isControllerClosed) {
          try {
            console.log('[SSE] Sending keep-alive ping');
            controller.enqueue(encoder.encode(`: ping ${new Date().toISOString()}\n\n`));
            updateActivityTime(); // キープアライブを送信するたびにアクティビティ時間を更新
          } catch (error) {
            console.error('[SSE] Error sending keep-alive:', error);
            // エラーが発生した場合はインターバルをクリア
            if (keepAliveIntervalId) {
              clearInterval(keepAliveIntervalId);
              keepAliveIntervalId = null;
            }
          }
        } else if (keepAliveIntervalId) {
          clearInterval(keepAliveIntervalId);
          keepAliveIntervalId = null;
        }
      }, 20000); // 20秒ごとに送信（ブラウザやプロキシのタイムアウト対策）

    },
    cancel(reason) {
      console.log(`[SSE] Stream cancelled for connection ${connectionId}. Reason:`, reason); // ★ Log cancellation
      cleanupResources();
    }
  });

  const { readable, writable } = new TransformStream();
  const responseStream = readable;

  // リクエストが終了したらabortControllerを発火させる
  const requestCleanup = () => {
    console.log('[SSE] Request cleanup triggered');
    abortController.abort();
  };

  // クライアント切断時にクリーンアップを実行
  try {
    stream.pipeTo(writable).catch((error) => {
      console.error('[SSE] Stream pipe error:', error);
      requestCleanup();
    });
  } catch (error) {
    console.error('[SSE] Error setting up stream pipe:', error);
    requestCleanup();
  }

  return new NextResponse(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}