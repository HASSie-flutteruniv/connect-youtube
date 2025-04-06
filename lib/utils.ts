import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * コメントからコマンドを検出する関数
 * @param commentText コメントテキスト
 * @returns コマンド情報（種類とタスク名）
 */
export function detectCommand(commentText: string): {
  command: 'work' | 'finish' | null;
  taskName?: string;
} {
  if (commentText.startsWith('/work')) {
    // /work コマンドの処理
    // /work の後のスペースを削除してタスク名を抽出
    const taskName = commentText.substring(5).trim();
    return { command: 'work', taskName: taskName || '作業中' }; // タスク名がない場合はデフォルト値
  }
  
  if (commentText.trim() === '/finish') {
    // /finish コマンドの処理 (完全一致で判定)
    return { command: 'finish' };
  }
  
  return { command: null }; // コマンドなし
}

/**
 * 自動退室までの残り時間を計算する関数
 * @param autoExitTime 自動退室予定時刻
 * @returns フォーマットされた残り時間文字列
 */
export function calculateRemainingTime(autoExitTime: Date | string | null): string {
  if (!autoExitTime) return "";
  
  const exitTime = typeof autoExitTime === 'string' ? new Date(autoExitTime) : autoExitTime;
  const now = new Date();
  const diffMs = exitTime.getTime() - now.getTime();
  
  if (diffMs <= 0) return "間もなく";
  
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return diffMinutes > 0 ? `${diffHours}時間${diffMinutes}分` : `${diffHours}時間`;
  } else {
    return `${diffMinutes}分`;
  }
}

/**
 * 残り時間に応じたスタイルクラス名を取得する関数
 * @param autoExitTime 自動退室予定時刻
 * @returns テキストカラークラス名
 */
export function getRemainingTimeStyle(autoExitTime: Date | string | null): string {
  if (!autoExitTime) return "";
  
  const exitTime = typeof autoExitTime === 'string' ? new Date(autoExitTime) : autoExitTime;
  const now = new Date();
  const diffMs = exitTime.getTime() - now.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  
  if (diffMinutes < 10) {
    return "text-red-500"; // 残り10分未満は赤色
  } else if (diffMinutes < 30) {
    return "text-orange-400"; // 残り30分未満はオレンジ色
  } else {
    return "text-amber-400"; // 通常は金色
  }
}

/**
 * 入室してからの経過時間を計算する関数
 * @param enterTime 入室時刻
 * @returns フォーマットされた経過時間文字列
 */
export function calculateElapsedTime(enterTime: Date | string | null): string {
  if (!enterTime) return "";
  
  const startTime = typeof enterTime === 'string' ? new Date(enterTime) : enterTime;
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();
  
  if (diffMs <= 0) return "0分";
  
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return diffMinutes > 0 ? `${diffHours}時間${diffMinutes}分` : `${diffHours}時間`;
  } else {
    return `${diffMinutes}分`;
  }
}

/**
 * 経過時間に応じたスタイルクラス名を取得する関数
 * @param enterTime 入室時刻
 * @returns テキストカラークラス名
 */
export function getElapsedTimeStyle(enterTime: Date | string | null): string {
  if (!enterTime) return "";
  
  const startTime = typeof enterTime === 'string' ? new Date(enterTime) : enterTime;
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  
  if (diffMinutes > 120) {
    return "text-green-500"; // 2時間以上は緑色
  } else if (diffMinutes > 60) {
    return "text-amber-400"; // 1時間以上は金色
  } else {
    return "text-blue-400"; // 1時間未満は青色
  }
}
