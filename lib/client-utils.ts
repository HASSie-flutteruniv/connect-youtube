import { AutoExitStatus } from './types';

/**
 * 自動退室のステータスを取得する（クライアント側で安全に使用できる）
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

/**
 * 経過時間を計算する
 * @param startTime 開始時間
 * @returns フォーマットされた経過時間 (例: "1時間23分")
 */
export function calculateElapsedTime(startTime: Date | string | null): string {
  if (!startTime) return "0分";
  
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const now = new Date();
  const elapsedMs = now.getTime() - start.getTime();
  
  if (elapsedMs <= 0) return "0分";
  
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}時間${minutes % 60}分`;
  } else {
    return `${minutes}分`;
  }
}

/**
 * 経過時間に応じたスタイルを取得する
 * @param startTime 開始時間
 * @returns CSSクラス名
 */
export function getElapsedTimeStyle(startTime: Date | string | null): string {
  if (!startTime) return "text-blue-400";
  
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const now = new Date();
  const elapsedMs = now.getTime() - start.getTime();
  const minutes = Math.floor(elapsedMs / (1000 * 60));
  
  if (minutes >= 120) { // 2時間以上
    return "text-red-500";
  } else if (minutes >= 60) { // 1時間以上
    return "text-orange-500";
  } else if (minutes >= 30) { // 30分以上
    return "text-amber-500";
  } else {
    return "text-blue-400";
  }
} 