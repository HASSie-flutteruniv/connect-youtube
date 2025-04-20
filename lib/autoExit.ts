import { Db } from 'mongodb';
import { youtubeApiClient } from '@/lib/youtubeApiClient';
import { messageTemplates } from '@/lib/messages';

/**
 * 自動退室状態の型定義
 */
export interface AutoExitStatus {
  isScheduled: boolean;
  scheduledTime: Date | null;
  remainingTime: number | null; // ミリ秒単位
  formattedTime: string | null; // 表示用フォーマット
}

/**
 * 自動退室が必要なユーザーをチェックして退室処理を行う
 * @param db MongoDB データベース接続
 * @param sendNotification YouTube通知メッセージを送信するかどうか
 * @returns 処理された座席の数と詳細情報
 */
export async function checkAndProcessAutoExit(
  db: Db,
  sendNotification: boolean = false
): Promise<{
  processedCount: number;
  details: Array<{
    username: string | null;
    position: number;
    success: boolean;
    error?: string;
  }>;
}> {
  const results = {
    processedCount: 0,
    details: [] as Array<{
      username: string | null;
      position: number;
      success: boolean;
      error?: string;
    }>
  };

  try {
    const seatsCollection = db.collection('seats');
    const currentTime = new Date();
    
    console.log(`[AutoExit] ${currentTime.toISOString()}に自動退室チェックを実行`);
    
    const expiredSeats = await seatsCollection.find({
      username: { $ne: null },
      is_active: true, // アクティブな座席のみを対象とする
      autoExitScheduled: { $lt: currentTime }
    }).toArray();
    
    if (expiredSeats.length === 0) {
      console.log('[AutoExit] 期限切れの座席はありませんでした');
      return results;
    }
    
    console.log(`[AutoExit] ${expiredSeats.length}件の期限切れ座席を処理します`);
    
    // YouTube通知のための準備
    let liveChatId: string | null = null;
    const videoId = process.env.YOUTUBE_VIDEO_ID;
    const isOAuthConfigured = youtubeApiClient.isOAuthConfigured();
    if (sendNotification && videoId && isOAuthConfigured) {
      try {
        liveChatId = await youtubeApiClient.getLiveChatId(videoId);
      } catch (error) {
        console.error('[AutoExit] YouTubeのliveChatID取得中にエラーが発生しました (ApiClient):', error);
      }
    }
    
    for (const seat of expiredSeats) {
      const username = seat.username;
      const position = seat.position;
      const roomId = 'focus-room';
      
      try {
        await seatsCollection.updateOne(
          { _id: seat._id },
          { 
            $set: { 
              is_active: false,
              exitTime: new Date(),
              autoExitScheduled: null,
              timestamp: new Date()
            } 
          }
        );
        
        console.log(`[AutoExit] ${username}を自動退室しました (部屋: ${roomId}, 座席: ${position})`);
        
        if (liveChatId && username) {
          try {
            await youtubeApiClient.sendChatMessage(
              liveChatId, 
              messageTemplates.autoExited(username, roomId, position)
            );
          } catch(sendError) {
            console.error(`[AutoExit] 座席(${position})の自動退室メッセージ送信中にエラーが発生:`, sendError);
          }
        } else if (sendNotification && isOAuthConfigured && !liveChatId) {
          console.warn(`[AutoExit] liveChatIdが取得できなかったため、座席(${position})の自動退室通知をスキップしました。`);
        }
        
        results.processedCount++;
        results.details.push({
          username,
          position,
          success: true
        });
      } catch (error) {
        console.error(`[AutoExit] 座席(${position})の自動退室処理中にエラーが発生:`, error);
        results.details.push({
          username,
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
 * 指定された位置のユーザーの自動退室時間を更新/設定する
 * @param db MongoDB データベース接続
 * @param position 座席位置
 * @param hours 入室時間から何時間後に自動退室するか (デフォルト: 2時間)
 * @returns 更新結果
 */
export async function scheduleAutoExit(
  db: Db,
  position: number,
  hours: number = 2
): Promise<{ success: boolean; error?: string }> {
  try {
    const seatsCollection = db.collection('seats');
    
    // 座席情報を取得（アクティブな座席のみ）
    const seat = await seatsCollection.findOne({
      position: position,
      is_active: true
    });
    
    if (!seat || !seat.username) {
      return { 
        success: false, 
        error: '指定された座席が見つからないか、ユーザーが着席していません' 
      };
    }
    
    // 入室時間から自動退室時間を計算
    const enterTime = seat.enterTime ? new Date(seat.enterTime) : new Date();
    const autoExitTime = new Date(enterTime);
    autoExitTime.setHours(autoExitTime.getHours() + hours);
    
    // 自動退室時間を更新
    await seatsCollection.updateOne(
      { _id: seat._id },
      { $set: { autoExitScheduled: autoExitTime } }
    );
    
    console.log(`[AutoExit] ${seat.username}の自動退室を${autoExitTime.toISOString()}に設定しました`);
    
    return { success: true };
  } catch (error) {
    console.error('[AutoExit] 自動退室スケジュール設定中にエラーが発生しました:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '不明なエラー' 
    };
  }
}

/**
 * 自動退室のステータスを取得する
 * @param scheduledTime 自動退室時間
 * @returns 自動退室状態の情報
 */
export function getAutoExitStatus(scheduledTime: Date | string | null): AutoExitStatus {
  if (!scheduledTime) {
    return {
      isScheduled: false,
      scheduledTime: null,
      remainingTime: null,
      formattedTime: null
    };
  }

  const autoExitTime = typeof scheduledTime === 'string' 
    ? new Date(scheduledTime) 
    : scheduledTime;
  
  const now = new Date();
  const remainingMs = autoExitTime.getTime() - now.getTime();

  // 既に期限切れの場合
  if (remainingMs <= 0) {
    return {
      isScheduled: true,
      scheduledTime: autoExitTime,
      remainingTime: 0,
      formattedTime: '時間切れ'
    };
  }

  return {
    isScheduled: true,
    scheduledTime: autoExitTime,
    remainingTime: remainingMs,
    formattedTime: formatRemainingTime(remainingMs)
  };
}

/**
 * 残り時間をフォーマットする
 * @param milliseconds 残りミリ秒
 * @returns フォーマットされた時間文字列 (例: "1時間23分")
 */
export function formatRemainingTime(milliseconds: number): string {
  if (milliseconds <= 0) {
    return '時間切れ';
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}時間${remainingMinutes}分`;
    }
    return `${hours}時間`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds > 0 && minutes < 10) {
      // 10分未満なら秒も表示
      return `${minutes}分${remainingSeconds}秒`;
    }
    return `${minutes}分`;
  } else {
    return `${seconds}秒`;
  }
}

/**
 * 現在の日付と時刻をフォーマットする
 * @returns フォーマットされた日時文字列 (例: "2023/04/06 15:30")
 */
export function formatCurrentDateTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  return `${year}/${month}/${day} ${hours}:${minutes}`;
} 