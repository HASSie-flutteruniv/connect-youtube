import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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

class YouTubeApiClient {
  private youtubeWithApiKey: youtube_v3.Youtube;
  private youtubeWithOAuth: youtube_v3.Youtube | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private liveChatIdCache: Record<string, { id: string; timestamp: number }> = {};
  private negativeCache: Record<string, { timestamp: number }> = {}; // Negative Cache用
  private cacheDurationMs: number = 60 * 60 * 1000; // 成功キャッシュ: 1時間
  private negativeCacheDurationMs: number = 30 * 60 * 1000; // 失敗キャッシュ: 30分

  constructor() {
    if (!process.env.YOUTUBE_API_KEY) {
      throw new Error('Missing YOUTUBE_API_KEY environment variable');
    }
    this.youtubeWithApiKey = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY
    });
    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URL) {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        process.env.YOUTUBE_REDIRECT_URL
      );
      if (process.env.YOUTUBE_REFRESH_TOKEN) {
        this.oauth2Client.setCredentials({
          refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });
      }
      this.youtubeWithOAuth = google.youtube({
        version: 'v3',
        auth: this.oauth2Client
      });
    }
  }

  async getLiveChatId(videoId: string, forceRefresh: boolean = false): Promise<string> {
    const now = Date.now();

    // 1. Negative Cache チェック (強制リフレッシュでない場合)
    const negativeCached = this.negativeCache[videoId];
    if (!forceRefresh && negativeCached && (now - negativeCached.timestamp < this.negativeCacheDurationMs)) {
      console.log(`[YouTubeApiClient] Negative cache hit for videoId: ${videoId}. Skipping API call.`);
      // Negative Cache ヒット時はエラーを再スローする（見つからないことを示す）
      throw new YouTubeAPIError(`ライブチャットIDが見つかりません (Negative Cache)`, 404, 'NOT_FOUND_NEGATIVE_CACHE');
    }

    // 2. Success Cache チェック (強制リフレッシュでない場合)
    const cached = this.liveChatIdCache[videoId];
    if (!forceRefresh && cached && (now - cached.timestamp < this.cacheDurationMs)) {
      console.log(`[YouTubeApiClient] Cache hit for liveChatId (videoId: ${videoId})`);
      return cached.id;
    }

    console.log(`[YouTubeApiClient] Cache miss or expired/forced refresh for liveChatId (videoId: ${videoId}). Fetching from API...`);

    try {
      const response = await this.youtubeWithApiKey.videos.list({
        part: ['liveStreamingDetails'],
        id: [videoId]
      });

      const video = response.data.items?.[0];
      const liveChatId = video?.liveStreamingDetails?.activeLiveChatId;

      if (!liveChatId) {
        console.warn(`[YouTubeApiClient] Live chat ID not found for video ${videoId}. Adding to negative cache.`);
        // 見つからなかった場合は Negative Cache に記録
        this.negativeCache[videoId] = { timestamp: now };
        // エラーをスローして、見つからなかったことを明確にする
        throw new YouTubeAPIError(`ライブチャットIDが見つかりませんでした。動画IDが正しいか、ライブ配信がアクティブか確認してください (videoId: ${videoId})`, 404, 'NOT_FOUND');
      }

      // 成功した場合は Success Cache を更新し、Negative Cache があれば削除
      this.liveChatIdCache[videoId] = { id: liveChatId, timestamp: now };
      if (this.negativeCache[videoId]) {
        delete this.negativeCache[videoId]; // 成功したので Negative Cache は不要
        console.log(`[YouTubeApiClient] Removed negative cache for videoId: ${videoId} after successful fetch.`);
      }
      console.log(`[YouTubeApiClient] Fetched and cached liveChatId: ${liveChatId} (videoId: ${videoId})`);

      return liveChatId;
    } catch (error: any) {
      console.error(`[YouTubeApiClient] Error fetching live chat ID for video ${videoId}:`, error?.response?.data || error?.message || error);
      const status = error?.response?.status || (error instanceof YouTubeAPIError ? error.status : 500);
      const code = error?.code || (error instanceof YouTubeAPIError ? error.code : undefined);
      let message = error instanceof YouTubeAPIError ? error.message : `ライブチャットIDの取得中にエラーが発生しました: ${error?.message || 'Unknown error'}`;

      // 404 Not Found の場合は Negative Cache に記録
      if (status === 404 && code !== 'NOT_FOUND_NEGATIVE_CACHE') { // Negative Cache 起因のエラーは再キャッシュしない
        console.warn(`[YouTubeApiClient] API returned 404 for videoId: ${videoId}. Adding/updating negative cache.`);
        this.negativeCache[videoId] = { timestamp: now };
        message = `ライブチャットIDが見つかりませんでした (API 404)。動画IDを確認してください。`; // メッセージを具体的に
      }
      // クォータ超過などは Negative Cache には入れない（一時的な問題の可能性があるため）

      throw new YouTubeAPIError(message, status, code);
    }
  }

  /**
   * 指定された videoId の Negative Cache をクリアする
   * @param videoId クリア対象の動画ID
   */
  clearNegativeCache(videoId: string): void {
    if (this.negativeCache[videoId]) {
      delete this.negativeCache[videoId];
      console.log(`[YouTubeApiClient] Cleared negative cache for videoId: ${videoId}`);
    } else {
      console.log(`[YouTubeApiClient] No negative cache found for videoId: ${videoId}`);
    }
  }

  async getLiveChatMessages(liveChatId: string, pageToken?: string): Promise<ChatResponse> {
    try {
      const response = await this.youtubeWithApiKey.liveChatMessages.list({
        part: ['snippet', 'authorDetails'],
        liveChatId,
        pageToken: pageToken || undefined,
        maxResults: 100
      });
      if (!response.data || !Array.isArray(response.data.items)) {
        throw new YouTubeAPIError('YouTube APIから無効なレスポンスが返されました', 500);
      }
      return response.data as ChatResponse;
    } catch (error: any) {
      throw new YouTubeAPIError(error?.message || 'ライブチャットメッセージの取得に失敗しました', error?.response?.status);
    }
  }

  async sendChatMessage(liveChatId: string, message: string) {
    if (!this.youtubeWithOAuth) {
      throw new YouTubeAPIError('メッセージ送信機能は設定されていません (OAuth設定不足)', 501, 'OAUTH_NOT_CONFIGURED');
    }
    await this.refreshAccessTokenIfNeeded();
    try {
      const response = await this.youtubeWithOAuth.liveChatMessages.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: message
            }
          }
        }
      });
      return response.data;
    } catch (error: any) {
      throw new YouTubeAPIError(error?.message || 'メッセージ送信に失敗しました', error?.response?.status);
    }
  }

  private async refreshAccessTokenIfNeeded(): Promise<void> {
    if (!this.oauth2Client || !this.oauth2Client.credentials.refresh_token) return;
    const expiryDate = this.oauth2Client.credentials.expiry_date;
    const now = Date.now();
    const bufferSeconds = 60;
    if (!expiryDate || expiryDate <= (now + bufferSeconds * 1000)) {
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
      } catch (error: any) {
        throw new YouTubeAPIError('アクセストークンのリフレッシュに失敗しました: ' + error.message, 401, 'TOKEN_REFRESH_FAILED');
      }
    }
  }

  isOAuthConfigured(): boolean {
    return !!this.youtubeWithOAuth;
  }
}

export const youtubeApiClient = new YouTubeApiClient(); 