import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import clientPromise from '@/lib/mongodb'; // MongoDBクライアントをインポート

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
  private cacheDurationMs: number = 60 * 60 * 1000; // 成功メモリキャッシュ: 1時間
  private negativeCacheDurationMs: number = 30 * 60 * 1000; // 失敗メモリキャッシュ: 30分
  private dbCacheDurationMs: number = 6 * 60 * 60 * 1000; // DBキャッシュ: 6時間 (APIルート側のTTLインデックス設定に合わせる)

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

  /**
   * MongoDBから liveChatId を取得するヘルパー関数
   */
  private async getCachedLiveChatIdFromDb(videoId: string): Promise<string | null> {
    try {
      const client = await clientPromise;
      const db = client.db('coworking');
      const cacheCollection = db.collection('liveChatIdCache');
      // TTLインデックスが存在するか確認し、なければ作成 (DB側で expiresAt を見て削除)
      const indexes = await cacheCollection.indexInformation();
      if (!indexes.expiresAt_1) {
          try {
              await cacheCollection.createIndex({ expiresAt: 1 }, {
                  expireAfterSeconds: 0, // ドキュメントの expiresAt フィールドの値で制御
                  name: 'expiresAt_1'
              });
              console.log('[YouTubeApiClient] liveChatIdCache のTTLインデックスを作成しました');
          } catch (indexError: any) {
              // インデックス作成中の競合エラーは無視しても問題ない場合が多い
              if (indexError.codeName === 'IndexOptionsConflict' || indexError.codeName === 'IndexKeySpecsConflict') {
                  console.warn('[YouTubeApiClient] TTLインデックスは既に存在するようです:', indexError.codeName);
              } else {
                  throw indexError; // その他のエラーは再スロー
              }
          }
      }

      const cacheEntry = await cacheCollection.findOne({ videoId });

      if (cacheEntry && cacheEntry.liveChatId && cacheEntry.expiresAt && new Date(cacheEntry.expiresAt) > new Date()) {
        console.log(`[YouTubeApiClient] DB Cache hit for liveChatId (videoId: ${videoId})`);
        // DBキャッシュヒット時、メモリキャッシュも更新（有効期限はDBに合わせる）
        this.liveChatIdCache[videoId] = { id: cacheEntry.liveChatId, timestamp: new Date(cacheEntry.expiresAt).getTime() - this.dbCacheDurationMs };
        return cacheEntry.liveChatId;
      }
      console.log(`[YouTubeApiClient] DB Cache miss or expired (videoId: ${videoId})`);
      return null;
    } catch (error) {
      console.error('[YouTubeApiClient] liveChatId DBキャッシュ取得/インデックス作成エラー:', error);
      return null; // DBエラー時はAPIから取得を試みる
    }
  }

  /**
   * MongoDBに liveChatId をキャッシュするヘルパー関数
   */
  private async cacheLiveChatIdToDb(videoId: string, liveChatId: string): Promise<void> {
    try {
      const client = await clientPromise;
      const db = client.db('coworking');
      const cacheCollection = db.collection('liveChatIdCache');
      const expiresAt = new Date(Date.now() + this.dbCacheDurationMs); // DBキャッシュの有効期限

      await cacheCollection.updateOne(
        { videoId },
        { $set: { liveChatId, expiresAt, updatedAt: new Date() } },
        { upsert: true } // なければ挿入、あれば更新
      );
      console.log(`[YouTubeApiClient] liveChatId をDBにキャッシュしました (videoId: ${videoId}, expiresAt: ${expiresAt.toISOString()})`);
    } catch (error) {
      console.error('[YouTubeApiClient] liveChatId DBキャッシュ保存エラー:', error);
    }
  }

  async getLiveChatId(videoId: string, forceRefresh: boolean = false): Promise<string> {
    const now = Date.now();

    // --- キャッシュ確認フェーズ ---
    if (!forceRefresh) {
      // 1. MongoDBキャッシュを確認
      const dbCachedId = await this.getCachedLiveChatIdFromDb(videoId);
      if (dbCachedId) {
        return dbCachedId;
      }

      // 2. Negative Cache (メモリ) を確認
      const negativeCached = this.negativeCache[videoId];
      if (negativeCached && (now - negativeCached.timestamp < this.negativeCacheDurationMs)) {
        console.log(`[YouTubeApiClient] Negative cache hit (memory) for videoId: ${videoId}. Skipping API call.`);
        throw new YouTubeAPIError(`ライブチャットIDが見つかりません (Negative Cache)`, 404, 'NOT_FOUND_NEGATIVE_CACHE');
      }

      // 3. Success Cache (メモリ) を確認
      const cached = this.liveChatIdCache[videoId];
      // メモリキャッシュの有効期限もチェック (DBキャッシュより短い可能性があるため)
      if (cached && (now - cached.timestamp < this.cacheDurationMs)) {
        console.log(`[YouTubeApiClient] Cache hit (memory) for liveChatId (videoId: ${videoId})`);
        return cached.id;
      }
    }

    // --- API取得フェーズ ---
    console.log(`[YouTubeApiClient] All caches miss or expired/forced refresh for liveChatId (videoId: ${videoId}). Fetching from API...`);

    try {
      const response = await this.youtubeWithApiKey.videos.list({
        part: ['liveStreamingDetails'],
        id: [videoId]
      });

      const video = response.data.items?.[0];
      const liveChatId = video?.liveStreamingDetails?.activeLiveChatId;

      if (!liveChatId) {
        console.warn(`[YouTubeApiClient] Live chat ID not found via API for video ${videoId}. Adding to negative cache (memory).`);
        // 見つからなかった場合は Negative Cache (メモリ) に記録 (DBには記録しない)
        this.negativeCache[videoId] = { timestamp: now };
        // メモリのSuccess Cacheがあれば削除
        if (this.liveChatIdCache[videoId]) {
            delete this.liveChatIdCache[videoId];
        }
        throw new YouTubeAPIError(`ライブチャットIDが見つかりませんでした。動画IDが正しいか、ライブ配信がアクティブか確認してください (videoId: ${videoId})`, 404, 'NOT_FOUND');
      }

      // --- 成功時のキャッシュ更新 ---
      console.log(`[YouTubeApiClient] Fetched liveChatId via API: ${liveChatId} (videoId: ${videoId}). Caching...`);
      // 1. DBにキャッシュ
      await this.cacheLiveChatIdToDb(videoId, liveChatId);
      // 2. メモリキャッシュを更新 (DBキャッシュと同じタイミングで作成)
      this.liveChatIdCache[videoId] = { id: liveChatId, timestamp: now };
      // 3. Negative Cache があれば削除
      if (this.negativeCache[videoId]) {
        delete this.negativeCache[videoId];
        console.log(`[YouTubeApiClient] Removed negative cache (memory) for videoId: ${videoId} after successful fetch.`);
      }

      return liveChatId;
    } catch (error: any) {
      console.error(`[YouTubeApiClient] Error fetching live chat ID for video ${videoId}:`, error?.response?.data || error?.message || error);
      const status = error?.response?.status || (error instanceof YouTubeAPIError ? error.status : 500);
      const code = error?.code || (error instanceof YouTubeAPIError ? error.code : undefined);
      let message = error instanceof YouTubeAPIError ? error.message : `ライブチャットIDの取得中にエラーが発生しました: ${error?.message || 'Unknown error'}`;

      // 404 Not Found の場合は Negative Cache に記録 (メモリのみ)
      if (status === 404 && code !== 'NOT_FOUND_NEGATIVE_CACHE') {
        console.warn(`[YouTubeApiClient] API returned 404 for videoId: ${videoId}. Adding/updating negative cache (memory).`);
        this.negativeCache[videoId] = { timestamp: now };
         // メモリのSuccess Cacheがあれば削除
        if (this.liveChatIdCache[videoId]) {
            delete this.liveChatIdCache[videoId];
        }
        message = `ライブチャットIDが見つかりませんでした (API 404)。動画IDを確認してください。`;
      }
      // クォータ超過などは Negative Cache には入れない

      // エラーをスローして呼び出し元で処理
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