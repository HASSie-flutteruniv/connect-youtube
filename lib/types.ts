// クライアント・サーバー共通の型定義

/**
 * YouTube API の型定義
 */
export interface Author {
  displayName: string;
  profileImageUrl: string;
  channelId: string;
}

export interface MessageSnippet {
  displayMessage: string;
  publishedAt: string;
  authorDisplayName?: string;
  authorPhotoUrl?: string;
  authorChannelId?: {
    value?: string;
  };
}

export interface ChatItem {
  id: string;
  snippet: MessageSnippet;
  authorDetails: Author;
}

export interface ChatResponse {
  items: ChatItem[];
  nextPageToken: string;
  pollingIntervalMillis: number;
}

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
 * 座席の型定義
 */
export interface Seat {
  id: string;
  room_id: string;
  position: number;
  username: string | null;
  authorId?: string | null;
  task?: string | null;
  enterTime?: Date | string | null;
  autoExitScheduled?: Date | string | null;
  profileImageUrl?: string | null;
  timestamp: Date | string;
}

/**
 * ユーザーカード用の型定義（クライアント側で使用）
 */
export interface UserCardData {
  id: string;
  name: string;
  avatar?: string;
  task?: string | null;
  autoExitScheduled?: Date | string | null;
  enterTime?: Date | string | null;
}

/**
 * コマンド実行結果の型定義
 */
export interface CommandResult {
  success: boolean;
  action?: 'enter' | 'exit' | 'update' | 'none' | 'create';
  seat?: {
    roomId: string;
    position: number;
    username?: string | null;
    previousUsername?: string;
    task?: string | null;
    id?: string;
  };
  message?: string;
  error?: string;
}

/**
 * YouTube API エラーの型定義
 */
export class YouTubeAPIError extends Error {
  status?: number;
  code?: string;
  
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'YouTubeAPIError';
    this.status = status;
    this.code = code;
  }
}

/**
 * コマンドの型定義
 */
export interface Command {
  command: string;
  taskName?: string;
  authorName: string;
  authorId: string;
  commentId: string;
  commentText: string;
  profileImageUrl?: string;
}

/**
 * 自動退室機能の処理結果
 */
export interface AutoExitProcessResult {
  processedCount: number;
  details: Array<{
    username: string | null;
    roomId: string;
    position: number;
    success: boolean;
    error?: string;
  }>;
} 