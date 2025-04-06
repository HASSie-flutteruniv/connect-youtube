import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { sendChatMessage } from '@/lib/youtube';
import { messageTemplates } from '@/lib/messages';

/**
 * 期限切れの座席を検索して自動退室処理を行うAPIエンドポイント
 * このエンドポイントは定期的に呼び出される（外部クーロンジョブまたはクライアントからのポーリング）
 */
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('coworking');
    const seatsCollection = db.collection('seats');
    
    const currentTime = new Date();
    console.log(`[AutoExit] ${currentTime}に自動退室チェックを実行します`);
    
    // 期限切れの座席を検索（入室中かつ自動退室時間が現在時刻より前）
    const expiredSeats = await seatsCollection.find({
      username: { $ne: null },
      autoExitScheduled: { $lt: currentTime }
    }).toArray();
    
    console.log(`[AutoExit] ${expiredSeats.length}件の期限切れ座席が見つかりました`);
    
    // 自動退室通知を送信するためのYouTube動画ID
    const videoId = process.env.YOUTUBE_VIDEO_ID;
    let liveChatId: string | null = null;
    
    if (videoId && expiredSeats.length > 0) {
      try {
        const { getLiveChatId } = await import('@/lib/youtube');
        liveChatId = await getLiveChatId(videoId);
      } catch (error) {
        console.error('[AutoExit] YouTubeのliveChatID取得中にエラーが発生しました:', error);
      }
    }
    
    // 各座席を処理
    for (const seat of expiredSeats) {
      try {
        // 自動退室前の情報を保存
        const username = seat.username;
        const roomId = seat.room_id;
        const position = seat.position;
        
        // 座席を空席に設定
        await seatsCollection.updateOne(
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
        
        console.log(`[AutoExit] ${username}を自動退室しました (部屋: ${roomId}, 座席: ${position})`);
        
        // 自動退室メッセージをYouTubeチャットに送信（オプション）
        if (liveChatId && username) {
          await sendChatMessage(
            liveChatId, 
            messageTemplates.autoExited(username, roomId, position)
          );
        }
      } catch (error) {
        console.error(`[AutoExit] 座席${seat._id}の自動退室処理中にエラーが発生しました:`, error);
      }
    }
    
    return NextResponse.json({
      processed: expiredSeats.length,
      timestamp: currentTime.toISOString()
    });
    
  } catch (error) {
    console.error('[AutoExit] 自動退室チェック中にエラーが発生しました:', error);
    return NextResponse.json(
      { error: '自動退室処理に失敗しました' },
      { status: 500 }
    );
  }
} 