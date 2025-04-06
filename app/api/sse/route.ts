import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  console.log('[SSE] Handler started');
  try {
    console.log('[SSE] Connecting to MongoDB...');
    const client = await clientPromise;
    const db = client.db('coworking');
    console.log('[SSE] MongoDB connection established');
    const encoder = new TextEncoder();

    // コントローラーがクローズされたかを追跡するフラグ
    let isControllerClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        console.log('[SSE] Stream initialization started');
        // Function to fetch and format room data
        const fetchRoomData = async () => {
          console.log('[SSE] Fetching room data from MongoDB');
          try {
            const rooms = await db.collection('rooms').find().toArray();
            console.log(`[SSE] Retrieved ${rooms.length} rooms`);
            const seats = await db.collection('seats').find().toArray();
            console.log(`[SSE] Retrieved ${seats.length} seats`);

            // roomsが空の場合は、シートを直接配列の最初の要素として使用する
            if (rooms.length === 0) {
              console.log('[SSE] No rooms found, creating a default room with all seats');
              const defaultRoom = {
                id: 'focus-room',
                type: 'focus',
                seats: seats.map(seat => ({
                  id: seat._id.toString(),
                  username: seat.username,
                  task: seat.task,
                  enterTime: seat.enterTime,
                  autoExitScheduled: seat.autoExitScheduled,
                  timestamp: seat.timestamp
                }))
              };
              return { rooms: [defaultRoom] };
            }

            const roomsWithSeats = rooms.map(room => ({
              id: room._id,
              seats: seats
                .filter(seat => seat.room_id === room._id)
                .sort((a, b) => a.position - b.position)
                .map(seat => ({
                  id: seat._id.toString(),
                  username: seat.username,
                  task: seat.task,
                  enterTime: seat.enterTime,
                  autoExitScheduled: seat.autoExitScheduled,
                  timestamp: seat.timestamp
                }))
            }));

            console.log('[SSE] Room data formatted successfully');
            return { rooms: roomsWithSeats };
          } catch (error) {
            console.error('[SSE] Error fetching room data:', error);
            return { rooms: [], error: 'Failed to fetch data' };
          }
        };

        // 自動退室チェック関数を定義
        const checkAutoExit = async () => {
          try {
            console.log('[SSE] 自動退室チェックを実行します');
            const currentTime = new Date();
            
            // 期限切れの座席を検索
            const expiredSeats = await db.collection('seats').find({
              username: { $ne: null },
              autoExitScheduled: { $lt: currentTime }
            }).toArray();
            
            if (expiredSeats.length > 0) {
              console.log(`[SSE] ${expiredSeats.length}件の期限切れ座席が見つかりました`);
              
              // 期限切れの座席を更新
              for (const seat of expiredSeats) {
                try {
                  // 座席を空席に設定
                  await db.collection('seats').updateOne(
                    { _id: seat._id },
                    { 
                      $set: { 
                        username: null, 
                        authorId: null, 
                        task: null, 
                        enterTime: null, 
                        autoExitScheduled: null,
                        timestamp: new Date()
                      } 
                    }
                  );
                  console.log(`[SSE] ${seat.username}を自動退室しました (部屋: ${seat.room_id}, 座席: ${seat.position})`);
                } catch (error) {
                  console.error(`[SSE] 座席${seat._id}の自動退室処理中にエラーが発生しました:`, error);
                }
              }
              
              // 更新後のデータをクライアントに送信（コントローラーがクローズされていないことを確認）
              if (!isControllerClosed) {
                const updatedData = await fetchRoomData();
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\n\n`));
                console.log('[SSE] 自動退室後のデータをクライアントに送信しました');
              }
            } else {
              console.log('[SSE] 期限切れの座席はありませんでした');
            }
          } catch (error) {
            console.error('[SSE] 自動退室チェック中にエラーが発生しました:', error);
          }
        };

        try {
          // Send initial data
          console.log('[SSE] Preparing to send initial data');
          const initialData = await fetchRoomData();
          console.log('[SSE] Sending initial data to client');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

          // Set up change stream
          console.log('[SSE] Setting up MongoDB change stream');
          const changeStream = db.collection('seats').watch();
          console.log('[SSE] Change stream initialized');
          
          // 自動退室チェックを定期的に実行（1分ごと）
          const autoExitInterval = setInterval(checkAutoExit, 60000);
          console.log('[SSE] 自動退室チェックを1分ごとに実行するよう設定しました');
          
          changeStream.on('change', async (changeEvent) => {
            // コントローラーがクローズされていないことを確認
            if (isControllerClosed) {
              console.log('[SSE] Controller is already closed, ignoring change event');
              return;
            }

            console.log('[SSE] Change detected in seats collection:', JSON.stringify(changeEvent.operationType));
            try {
              console.log('[SSE] Fetching updated data after change');
              const data = await fetchRoomData();
              console.log('[SSE] Sending updated data to client');
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch (error) {
              console.error('[SSE] Error processing change stream update:', error);
              // エラーメッセージをクライアントに送信（コントローラーがクローズされていないことを確認）
              if (!isControllerClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Update failed' })}\n\n`));
              }
            }
          });

          // Handle errors in the change stream
          changeStream.on('error', (error) => {
            console.error('[SSE] Change stream error:', error);
            if (!isControllerClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Connection error' })}\n\n`));
            }
            console.log('[SSE] Closing change stream due to error');
            changeStream.close();
          });

          return () => {
            console.log('[SSE] Stream cleanup - closing change stream');
            isControllerClosed = true; // コントローラーがクローズされたことをマーク
            changeStream.close();
            // 自動退室チェックのインターバルをクリア
            clearInterval(autoExitInterval);
            console.log('[SSE] 自動退室チェックのインターバルをクリアしました');
          };
        } catch (error) {
          console.error('[SSE] Error in stream start:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream initialization failed' })}\n\n`));
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