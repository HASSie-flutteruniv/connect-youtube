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
    setupChangeStreams: () => Promise<void> // Function to retry setting up both streams
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
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\\n\\n`));
            }
          } catch (error) {
            console.error('[SSE Helper] Error processing change stream update:', error);
            if (!isControllerClosed()) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: 'Update failed' })}\\n\\n`));
              controller.enqueue(new TextEncoder().encode(
                createSystemMessage('データ更新中にエラーが発生しました', 'error')
              ));
            }
          }
        });

        newStream.on('error', async (error: Error) => {
          console.error('[SSE Helper] Seats change stream error:', error);
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


          const MAX_RETRIES = 10;
          if (getChangeStreamRetryCount() < MAX_RETRIES && !isControllerClosed()) {
            const newRetryCount = incrementChangeStreamRetryCount();
            const delayMs = calculateBackoff(newRetryCount);
            console.log(`[SSE Helper] Will attempt to reconnect change streams in ${delayMs}ms (retry ${newRetryCount}/${MAX_RETRIES})`);

            setTimeout(async () => {
              if (!isControllerClosed()) {
                console.log(`[SSE Helper] Attempting to reconnect to change streams (retry ${newRetryCount}/${MAX_RETRIES})`);
                try {
                  // ★ Retry setting up *both* streams
                  await setupChangeStreams();
                  // 再接続成功したらリトライカウントをリセット
                  setChangeStreamRetryCount(0); // リセット！
                  console.log('[SSE Helper] Successfully reconnected change streams');

                  if (!isControllerClosed()) {
                    controller.enqueue(new TextEncoder().encode(
                      createSystemMessage('サーバーとの接続が回復しました', 'info')
                    ));
                    const refreshedData = await fetchRoomData(db); // db is non-null
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(refreshedData)}\\n\\n`));
                  }
                } catch (reconnectError) {
                  console.error('[SSE Helper] Failed to reconnect change streams:', reconnectError);
                  // 再接続失敗した場合、さらに待機するか、エラー処理を継続 (次のエラーイベントで再度試行される)
                }
              }
            }, delayMs);
          } else if (!isControllerClosed()) {
            console.error(`[SSE Helper] Maximum reconnection attempts (${MAX_RETRIES}) reached or controller closed`);
            controller.enqueue(new TextEncoder().encode(
              createSystemMessage('サーバーとの接続が失われました。ページを再読み込みしてください。', 'error')
            ));
            // Consider closing the controller here if max retries are reached
            // controller.close(); isControllerClosed = true; // Needs careful handling
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
        const newStream = db.collection('notifications').watch([{ $match: { operationType: 'insert' } }]);
        setNotificationsChangeStream(newStream);
        console.log('[SSE Helper] Notifications change stream initialized');

        newStream.on('change', async (changeEvent: ChangeStreamDocument<any>) => { // Add type <any> or specific notification type
          if (isControllerClosed()) {
            console.log('[SSE Helper] Controller is already closed, ignoring notifications change event');
            return;
          }

          // 挿入操作のみを処理 (pipeline で $match してるが念のため)
          if (changeEvent.operationType === 'insert') {
            try {
              const notification = changeEvent.fullDocument;
              if (notification) {
                console.log('[SSE Helper] New notification detected:', notification.message);

                // システムメッセージとして送信
                if (!isControllerClosed()) {
                  controller.enqueue(new TextEncoder().encode(
                    createSystemMessage(
                      notification.message,
                      notification.type || 'info',
                      notification._id?.toString() // Use MongoDB _id as message ID if available
                    )
                  ));
                }
              }
            } catch (error) {
              console.error('[SSE Helper] Error processing notification change:', error);
            }
          }
        });

        newStream.on('error', async (error: Error) => {
          console.error('[SSE Helper] Notifications change stream error:', error);

           const currentStreamOnError = getNotificationsChangeStream();
          if (currentStreamOnError) {
            await currentStreamOnError.close().catch((err: Error) =>
              console.error('[SSE Helper] Error closing notifications change stream on error:', err));
            setNotificationsChangeStream(null);
          }

          // エラー発生時は一定時間後に再接続を試みる (Seats streamのエラーハンドリングに統合してもよい)
          if (!isControllerClosed()) {
             console.warn('[SSE Helper] Notifications stream encountered an error. Relying on seats stream error handling for reconnection.');
             // Optionally, trigger the main reconnection logic if needed, but often seats stream errors handle this
             // Example: Trigger a general reconnect attempt
             // setTimeout(async () => {
             //   if (!isControllerClosed()) {
             //     try {
             //       await setupStreamsFn(); // Retry setting up both streams
             //       console.log('[SSE Helper] Attempted reconnection after notification stream error.');
             //     } catch (reconnectError) {
             //        console.error('[SSE Helper] Failed to reconnect after notification stream error:', reconnectError);
             //     }
             //   }
             // }, 5000); // Wait 5 seconds before retry
          }
        });
      } catch (setupError) {
        console.error('[SSE Helper] Error setting up notifications change stream:', setupError);
         if (!isControllerClosed()) {
            controller.enqueue(new TextEncoder().encode(
                createSystemMessage('通知データのストリーム監視設定に失敗しました。', 'error')
            ));
        }
        throw setupError; // エラーを上に伝播させる
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
  let manager: ChangeStreamManager | null = null;
  let isControllerClosed = false;
  let changeStreamRetryCount = 0;
  // --- End Variables ---

  // --- Accessor and Mutator functions for helper functions ---
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
  // --- End Accessors/Mutators ---


  try {
    // ReadableStream is created within the try block
    const stream = new ReadableStream({
      async start(controller) {
        console.log('[SSE] Stream initialization started');

        // --- Function to setup both change streams ---
        // Defined inside start to have access to controller and scoped variables easily
        const setupStreams = async () => {
            if (!db || !manager) {
                 console.error('[SSE Setup] Cannot setup change stream: DB or Manager not initialized.');
                 throw new Error('DB or Manager not initialized.');
             }
            await setupSeatsChangeStream(
                db, manager, controller, checkAutoExit,
                getSeatsChangeStream, setSeatsChangeStream,
                getAutoExitIntervalId, setAutoExitIntervalId,
                getChangeStreamRetryCount, setChangeStreamRetryCount, incrementChangeStreamRetryCount,
                isControllerClosedFn, setupStreams // Pass self for retry
            );
            await setupNotificationsChangeStream(
                db, controller,
                getNotificationsChangeStream, setNotificationsChangeStream,
                isControllerClosedFn, setupStreams // Pass self for retry
            );
             // Send initial data after streams are set up
             console.log('[SSE Setup] Fetching initial data...');
             const initialData = await fetchRoomData(db);
             if (!isControllerClosedFn()) {
                 controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\\n\\n`));
                 console.log('[SSE Setup] Initial data sent.');
             }
        };
        // --- End setupStreams function ---


        // --- Auto Exit Check function (defined inside start) ---
        const checkAutoExit = async () => {
            if (isControllerClosedFn() || !db) { // Use function accessor
              console.log('[SSE AutoExit] Check skipped: Controller closed or DB not available.');
               const currentIntervalId = getAutoExitIntervalId();
               if (currentIntervalId) {
                 clearInterval(currentIntervalId);
                 setAutoExitIntervalId(null);
                 console.log('[SSE AutoExit] Interval cleared due to closed controller/DB issue during check.');
               }
              return;
            }
            try {
                console.log('[SSE AutoExit] Running auto-exit check...');
                const results = await checkAndProcessAutoExit(db, false); // db is non-null here

                if (results.processedCount > 0) {
                  console.log(`[SSE AutoExit] ${results.processedCount} seats processed.`);
                  if (!isControllerClosedFn()) {
                    const updatedData = await fetchRoomData(db);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\\n\\n`));
                    controller.enqueue(encoder.encode(
                      createSystemMessage(`${results.processedCount}人のユーザーが自動退室しました`, 'info')
                    ));
                    console.log('[SSE AutoExit] Update sent after auto-exit.');
                  }
                } else {
                  // console.log('[SSE AutoExit] No expired seats found.'); // Reduce verbosity
                }
              } catch (error) {
                console.error('[SSE AutoExit] Error during check:', error);
                 if (!isControllerClosedFn()) {
                    controller.enqueue(encoder.encode(
                      createSystemMessage(`自動退室チェック中にエラー発生: ${(error as Error).message}`, 'error')
                    ));
                }
              }
          };
        // --- End Auto Exit Check function ---


        try {
          // --- Initialization moved inside start ---
          console.log('[SSE Start] Connecting to MongoDB...');
          client = await clientPromise; // Assign to scoped variable
          db = client.db('coworking'); // Assign to scoped variable
          console.log('[SSE Start] MongoDB connection established.');

          manager = ChangeStreamManager.getInstance(); // Assign to scoped variable
          manager.registerConnection();
          console.log('[SSE Start] ChangeStreamManager instance obtained and connection registered.');
          // --- End Initialization ---

          // --- Setup Change Streams ---
          await setupStreams();
          console.log('[SSE Start] Initial change stream setup complete.');

        } catch (startError) {
          console.error('[SSE Start] Error during stream start initialization:', startError);
          try {
            if (!isControllerClosedFn()) {
                controller.enqueue(encoder.encode(
                  createSystemMessage(`サーバー初期化エラー: ${(startError as Error).message}`, 'error')
                ));
            }
          } catch (enqueueError) {
            console.error('[SSE Start] Failed to enqueue start error message:', enqueueError);
          }
          // Close stream and cleanup resources on initialization failure
          if (!isControllerClosedFn()) {
              controller.close();
          }
          isControllerClosed = true; // Set flag
          cleanupResources(); // Call cleanup
        }
      },

      cancel(reason) {
        console.log('[SSE Cancel] Stream cancelled by client.', reason);
        if (!isControllerClosed) {
            isControllerClosed = true;
            cleanupResources(); // Call cleanup
        }
      },
    });

     // --- Cleanup function ---
     const cleanupResources = () => {
         console.log('[SSE Cleanup] Cleaning up resources...');
         if (manager) {
             manager.unregisterConnection();
             console.log('[SSE Cleanup] Connection unregistered from manager.');
             manager = null; // Clear reference
         }
         const currentIntervalId = getAutoExitIntervalId();
         if (currentIntervalId) {
           clearInterval(currentIntervalId);
           setAutoExitIntervalId(null);
           console.log('[SSE Cleanup] Auto-exit interval cleared.');
         }
         const currentSeatsStream = getSeatsChangeStream();
         if (currentSeatsStream) {
           currentSeatsStream.close().catch(err => console.error('[SSE Cleanup] Error closing seats stream:', err));
           setSeatsChangeStream(null);
           console.log('[SSE Cleanup] Seats change stream closed.');
         }
         const currentNotificationsStream = getNotificationsChangeStream();
          if (currentNotificationsStream) {
           currentNotificationsStream.close().catch(err => console.error('[SSE Cleanup] Error closing notifications stream:', err));
           setNotificationsChangeStream(null);
           console.log('[SSE Cleanup] Notifications change stream closed.');
         }
         // Note: MongoDB client connection is managed by clientPromise singleton,
         // typically not closed here per request unless specifically required.
         console.log('[SSE Cleanup] Resource cleanup finished.');
     };
     // --- End Cleanup function ---

    // Return the response with the stream
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    // Critical error in GET handler (e.g., ReadableStream creation failed)
    console.error('[SSE Critical] Error in GET handler:', error);
    return new NextResponse(JSON.stringify({ error: 'Internal Server Error in SSE handler' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}