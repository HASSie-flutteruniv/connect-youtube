import { apiClient } from '../clients/apiClient';
import type { Command, CommandResult } from '@/lib/types';

/**
 * YouTubeコメント取得APIからのレスポンス型
 */
export interface YouTubeCommentsResponse {
  commands: Command[];
  pollingIntervalMillis?: number;
  error?: string;
  backoff?: boolean;
  remainingSeconds?: number;
}

/**
 * コマンド実行のリクエスト型
 */
export interface CommandRequest {
  command: string;
  username: string;
  authorId?: string;
  videoId?: string;
  taskName?: string;
  profileImageUrl?: string;
}

/**
 * コマンド実行APIのレスポンス型
 */
export interface CommandResponse {
  success: boolean;
  result?: CommandResult;
  message?: string;
  error?: string;
}

/**
 * YouTube関連のAPI呼び出しを担当するサービスクラス
 */
export class YouTubeService {
  /**
   * YouTubeのコメントとコマンドを取得
   * @returns コマンドとポーリング情報
   */
  async getComments(videoId?: string): Promise<YouTubeCommentsResponse> {
    const url = videoId ? `/api/youtube-comments?videoId=${encodeURIComponent(videoId)}` : '/api/youtube-comments';
    const response = await apiClient.get<YouTubeCommentsResponse>(url);
    
    if (response.error) {
      console.error('[YouTubeService] Comments fetch error:', response.error);
      return { 
        commands: [], 
        error: response.error,
        backoff: response.status === 429  // レート制限時は429
      };
    }
    
    return response.data || { commands: [] };
  }
  
  /**
   * コマンドを実行
   * @param commandData コマンド実行に必要なデータ
   * @returns コマンド実行結果
   */
  async executeCommand(commandData: CommandRequest): Promise<CommandResponse> {
    const response = await apiClient.post<CommandRequest, CommandResponse>('/api/commands', commandData);
    
    if (response.error) {
      console.error('[YouTubeService] Command execution error:', response.error);
      return { 
        success: false, 
        error: response.error 
      };
    }
    
    return response.data || { success: false, error: 'No response data' };
  }
}

// デフォルトのYouTubeサービスインスタンス
export const youtubeService = new YouTubeService(); 