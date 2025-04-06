import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { Db, ObjectId } from 'mongodb';
import { getLiveChatId, sendChatMessage } from '@/lib/youtube';
import { messageTemplates } from '@/lib/messages';
import { AutoExitProcessResult } from '@/lib/types';

/**
 * 自動退室が必要なユーザーをチェックして退室処理を行う
 * @param db MongoDB データベース接続
 * @param sendNotification YouTube通知メッセージを送信するかどうか
 * @returns 処理された座席の数と詳細情報
 */
async function checkAndProcessAutoExit(
  db: Db,
  sendNotification: boolean = false
): Promise<AutoExitProcessResult> {
  const results: AutoExitProcessResult = {
    processedCount: 0,
    details: [] 
  };

  try {
    const seatsCollection = db.collection('seats');
    const currentTime = new Date();
    
    console.log(`[AutoExit] ${currentTime.toISOString()}に自動退室チェックを実行`);
    
    // 期限切れの座席を検索（入室中かつ自動退室時間が現在時刻より前）
    const expiredSeats = await seatsCollection.find({
      username: { $ne: null },
      autoExitScheduled: { $lt: currentTime }
    }).toArray();
    
    if (expiredSeats.length === 0) {
      console.log('[AutoExit] 期限切れの座席はありませんでした');
      return results;
    }
    
    console.log(`[AutoExit] ${expiredSeats.length}件の期限切れ座席を処理します`);
    
    // YouTube通知のための準備
    let liveChatId: string | null = null;
    if (sendNotification) {
      const videoId = process.env.YOUTUBE_VIDEO_ID;
      if (videoId) {
        try {
          liveChatId = await getLiveChatId(videoId);
        } catch (error) {
          console.error('[AutoExit] YouTubeのliveChatID取得中にエラーが発生しました:', error);
        }
      }
    }
    
    // 各座席を処理
    for (const seat of expiredSeats) {
      const username = seat.username;
      const roomId = seat.room_id;
      const position = seat.position;
      
      try {
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
        
        // 自動退室メッセージをYouTubeチャットに送信（設定されている場合）
        if (sendNotification && liveChatId && username) {
          await sendChatMessage(
            liveChatId, 
            messageTemplates.autoExited(username, roomId, position)
          );
        }
        
        results.processedCount++;
        results.details.push({
          username,
          roomId,
          position,
          success: true
        });
      } catch (error) {
        console.error(`[AutoExit] 座席(${roomId}-${position})の自動退室処理中にエラーが発生:`, error);
        results.details.push({
          username,
          roomId,
          position,
          success: false,
          error: error instanceof Error ? error.message : '不明なエラー'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('[AutoExit] 自動退室処理全体でエラーが発生しました:', error);
    throw error;
  }
}

/**
 * POST /api/check-auto-exit
 * 自動退室チェックを実行するAPIエンドポイント
 */
export async function POST(request: Request) {
  console.log('[API] 自動退室チェックリクエストを受信');
  
  try {
    // リクエストボディを解析
    const { sendNotification = false } = await request.json();
    
    // MongoDBに接続
    const client = await clientPromise;
    const db = client.db('coworking');
    
    // 自動退室チェックを実行
    const result = await checkAndProcessAutoExit(db, sendNotification);
    
    return NextResponse.json({
      success: true, 
      processedCount: result.processedCount,
      details: result.details
    });
    
  } catch (error) {
    console.error('[API] 自動退室チェック中にエラーが発生:', error);
    
    return NextResponse.json(
      { error: '自動退室チェックに失敗しました', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/check-auto-exit
 * システムからの定期実行用エンドポイント
 */
export async function GET() {
  console.log('[API] 自動退室チェックのGETリクエストを受信 (システム実行)');
  
  try {
    // MongoDBに接続
    const client = await clientPromise;
    const db = client.db('coworking');
    
    // 自動退室チェックを実行（通知送信は有効）
    const result = await checkAndProcessAutoExit(db, true);
    
    return NextResponse.json({
      success: true, 
      processedCount: result.processedCount,
      details: result.details
    });
    
  } catch (error) {
    console.error('[API] 自動退室チェック中にエラーが発生:', error);
    
    return NextResponse.json(
      { error: '自動退室チェックに失敗しました', details: (error as Error).message },
      { status: 500 }
    );
  }
} 