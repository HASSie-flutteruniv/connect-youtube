import { google, youtube_v3 } from 'googleapis';
import { Db } from 'mongodb';
import { messageTemplates } from './messages';
import { scheduleAutoExit } from './autoExit';

if (!process.env.YOUTUBE_API_KEY) {
  throw new Error('Missing YOUTUBE_API_KEY environment variable');
}

// YouTube API の型定義
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

// API リクエストエラーの型
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

// API Keyを使ったYouTube APIの初期化
const youtubeWithApiKey = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// OAuth2クライアントの設定（OAuth認証が設定されている場合のみ使用）
let oauth2Client: any;
let youtubeWithOAuth: youtube_v3.Youtube | null = null;

if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URL) {
  oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URL
  );

  // リフレッシュトークンの設定（存在する場合）
  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
    });
  }

  // OAuth2認証を使用したYouTube APIの初期化
  youtubeWithOAuth = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });
}

/**
 * ライブチャットIDを取得する（API Keyのみで実行可能）
 * @param videoId 動画ID
 * @returns ライブチャットID
 */
export async function getLiveChatId(videoId: string): Promise<string> {
  try {
    const response = await youtubeWithApiKey.videos.list({
      part: ['liveStreamingDetails'],
      id: [videoId]
    });

    const video = response.data.items && response.data.items[0];
    if (!video || !video.liveStreamingDetails || !video.liveStreamingDetails.activeLiveChatId) {
      throw new Error('ライブチャットIDが見つかりませんでした');
    }

    return video.liveStreamingDetails.activeLiveChatId;
  } catch (error) {
    console.error('ライブチャットID取得エラー:', error);
    throw new Error('ライブチャットIDの取得に失敗しました');
  }
}

/**
 * YouTubeのライブチャットにメッセージを送信する（OAuth2認証が必要）
 * @param liveChatId ライブチャットID
 * @param message 送信するメッセージ
 * @returns 送信結果
 */
export async function sendChatMessage(liveChatId: string, message: string) {
  try {
    // OAuth2認証が設定されていない場合はログのみ出力
    if (!youtubeWithOAuth) {
      console.log('OAuth2認証が設定されていないため、メッセージ送信をスキップします:', message);
      return { success: false, message: 'OAuth2認証が設定されていません' };
    }

    const response = await youtubeWithOAuth.liveChatMessages.insert({
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

    console.log('メッセージ送信成功:', message);
    return response.data;
  } catch (error) {
    console.error('メッセージ送信エラー:', error);
    throw new Error('メッセージの送信に失敗しました');
  }
}

/**
 * ライブチャットのメッセージを取得する（API Keyのみで実行可能）
 * @param liveChatId ライブチャットID
 * @param pageToken ページトークン（続きを取得する場合）
 * @returns チャットメッセージのレスポンス
 */
export async function getLiveChatMessages(liveChatId: string, pageToken: string | null): Promise<ChatResponse> {
  try {
    // API呼び出しでsnippetとauthorDetailsの両方を取得
    const response = await youtubeWithApiKey.liveChatMessages.list({
      part: ['snippet', 'authorDetails'],
      liveChatId,
      pageToken: pageToken || undefined,
      maxResults: 100
    });
    
    console.log(`[YouTube API] コメント取得: ${response.data.items?.length || 0}件`);
    
    // デバッグのため最初のコメントの構造を出力
    if (response.data.items && response.data.items.length > 0) {
      const firstItem = response.data.items[0];
      console.log('[YouTube API] コメント構造サンプル:', 
        JSON.stringify({
          id: firstItem.id,
          snippet: firstItem.snippet,
          authorDetails: firstItem.authorDetails
        }, null, 2).substring(0, 500) + '...');
    }
    
    return response.data as ChatResponse;
  } catch (error: any) {
    console.error('Error getting live chat messages:', error?.response?.data || error);
    throw new YouTubeAPIError(
      `Failed to get live chat messages: ${error?.message || 'Unknown error'}`,
      error?.response?.status,
      error?.code
    );
  }
}

/**
 * キャッシュされたライブチャットIDを保持するオブジェクト
 * メモリ内キャッシュとして機能（サーバー再起動でリセット）
 */
export const liveChatIdCache: Record<string, string> = {};

// プロフィール画像URLを検証する関数
function isValidImageUrl(url?: string | null): boolean {
  return Boolean(url && typeof url === 'string' && url.startsWith('http'));
}

/**
 * YouTubeコメントを処理してコマンドとして実行する
 * @param commentText コメントテキスト
 * @param username ユーザー名
 * @param authorId 著者ID (YouTubeチャンネルID)
 * @param db MongoDBインスタンス
 * @param videoId ビデオID
 * @param profileImageUrl プロフィール画像URL
 * @returns 処理結果
 */
export async function processYouTubeComment(
  commentText: string,
  username: string,
  authorId: string,
  db: Db,
  videoId?: string,
  profileImageUrl?: string
) {
  console.log(`[YouTube] Processing comment from ${username}: ${commentText}`);
  // コマンドとタスク名を抽出
  const trimmedComment = commentText.trim();
  let command = '';
  let taskName = '';

  if (trimmedComment.startsWith('/work ')) {
    command = 'work';
    taskName = trimmedComment.substring(6).trim();
  } else if (trimmedComment === '/finish') {
    command = 'finish';
  } else {
    // コマンドでない場合は処理しない
    return { success: false, message: 'コメントはコマンドではありません' };
  }

  // コマンド処理を実行
  try {
    const result = await processCommand(command, username, db, videoId, undefined, authorId, taskName, profileImageUrl);
    return { success: true, result };
  } catch (error) {
    console.error(`[YouTube] Error processing comment as command:`, error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * コマンドを処理する共通関数
 * YouTube APIとWeb UIの両方から使用される
 * 
 * @param command コマンド文字列（work, finishなど）
 * @param username ユーザー名
 * @param db MongoDBインスタンス
 * @param videoId オプションのYouTubeビデオID
 * @param liveChatId オプションのライブチャットID
 * @param authorId オプションのユーザーID（YouTubeチャンネルIDなど）
 * @param taskName オプションのタスク名（workコマンド用）
 * @param profileImageUrl オプションのプロフィール画像URL
 * @returns 処理結果のオブジェクト
 */
export async function processCommand(
  command: string,
  username: string,
  db: Db,
  videoId?: string,
  liveChatId?: string,
  authorId?: string,
  taskName?: string,
  profileImageUrl?: string
) {
  console.log(`[Command] Processing command: ${command} from ${username}`);
  
  // より詳細なデバッグ情報を出力
  console.log(`[Command] DEBUG - Command details:`, {
    command,
    username,
    authorId: authorId || 'not provided',
    taskName: taskName || 'not provided',
    profileImageUrl: profileImageUrl || 'not provided',
    hasValidProfileImage: isValidImageUrl(profileImageUrl)
  });
  
  // プロフィール画像URLをログに記録、検証
  if (profileImageUrl) {
    if (isValidImageUrl(profileImageUrl)) {
      console.log(`[Command] Valid profile image URL received: ${profileImageUrl}`);
    } else {
      console.warn(`[Command] Invalid profile image URL received: ${profileImageUrl}`);
      profileImageUrl = undefined; // 無効なURLはundefinedに設定
    }
  }
  
  const seatsCollection = db.collection('seats');
  const notificationsCollection = db.collection('notifications');
  
  // ライブチャットIDが指定されていない場合で、videoIdが指定されている場合、取得を試みる
  if (!liveChatId && videoId) {
    try {
      liveChatId = await getLiveChatId(videoId);
    } catch (error) {
      console.warn('[Command] Failed to get liveChatId, notifications will be disabled:', error);
      // 通知は送れなくても処理は続行
    }
  }
  
  // OAuth認証が設定されているかをチェック
  const isOAuthConfigured = !!youtubeWithOAuth;
  
  // システムメッセージをMongoDBに保存する関数（SSEで検知される）
  const saveSystemMessage = async (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    try {
      await notificationsCollection.insertOne({
        message,
        type,
        timestamp: new Date(),
        id: `${Date.now()}-${Math.random()}`, // ユニークID
        isRead: false
      });
      console.log(`[Command] System message saved: ${message}`);
    } catch (err) {
      console.error('[Command] Failed to save system message:', err);
    }
  };
  
  // コマンドタイプに応じた処理
  if (command === 'work') {
    if (!taskName) {
      throw new Error('タスク名が指定されていません');
    }
    
    console.log(`[Command] /work command execution: ${username} - Task: ${taskName}`);
    
    // ユーザーIDが指定されている場合、それを使用してユーザーを識別
    // 指定されていない場合は、ユーザー名で識別
    const userQuery = authorId ? { authorId } : { username };
    
    // ユーザーが既に入室済みか確認
    const existingSeat = await seatsCollection.findOne(userQuery);
    
    const enterTime = new Date();
    
    if (existingSeat) {
      // 既に入室済みの場合：タスクと時間を更新
      const updateData: Record<string, any> = { 
        task: taskName, 
        enterTime: enterTime, 
        username: username, // 名前が変わっている可能性も考慮
        authorId: authorId, // IDも更新（指定されている場合）
        timestamp: new Date()
      };
      
      // 有効なプロフィール画像URLが提供された場合のみ更新
      if (isValidImageUrl(profileImageUrl)) {
        updateData.profileImageUrl = profileImageUrl;
        console.log(`[Command] Adding profile image URL to update data: ${profileImageUrl}`);
      } else {
        console.log(`[Command] No valid profile image URL to add to update data`);
      }
      
      console.log(`[Command] Updating existing seat for ${username}:`, updateData);
      
      const updateResult = await seatsCollection.updateOne(
        { _id: existingSeat._id },
        { $set: updateData }
      );
      
      console.log(`[Command] Seat update result:`, {
        matchedCount: updateResult.matchedCount,
        modifiedCount: updateResult.modifiedCount,
        upsertedCount: updateResult.upsertedCount
      });
      
      // 更新後の座席データを取得して確認
      const updatedSeat = await seatsCollection.findOne({ _id: existingSeat._id });
      console.log(`[Command] Seat after update:`, {
        id: updatedSeat?._id.toString(),
        username: updatedSeat?.username,
        profileImageUrl: updatedSeat?.profileImageUrl,
        hasProfileImage: !!updatedSeat?.profileImageUrl
      });
      
      // 自動退室時間を設定
      await scheduleAutoExit(db, existingSeat.room_id, existingSeat.position, 2);
      
      console.log(`[Command] Updated task for ${username} to: ${taskName}`);
      
      // タスク更新メッセージを送信（OAuth認証が設定されている場合のみ）
      if (liveChatId && isOAuthConfigured) {
        try {
          await sendChatMessage(liveChatId, messageTemplates.taskUpdated(username, taskName));
        } catch (error) {
          console.warn('[Command] Failed to send message, continuing without notification:', error);
          // メッセージ送信に失敗しても処理は続行
        }
      }
      
      // システムメッセージを保存（SSEで検知される）
      await saveSystemMessage(`${username}さんが「${taskName}」に作業内容を変更しました`, 'info');
      
      return {
        success: true,
        action: 'update',
        seat: {
          roomId: existingSeat.room_id,
          position: existingSeat.position,
          username: username,
          task: taskName
        }
      };
    } else {
      // 新規入室の場合：空いている座席を探す
      const setData: Record<string, any> = {
        username: username,
        authorId: authorId, // IDが指定されている場合は保存
        task: taskName,
        enterTime: enterTime,
        timestamp: new Date()
      };
      
      // 有効なプロフィール画像URLが提供された場合のみ設定
      if (isValidImageUrl(profileImageUrl)) {
        setData.profileImageUrl = profileImageUrl;
        console.log(`[Command] Adding profile image URL to new seat data: ${profileImageUrl}`);
      } else {
        console.log(`[Command] No valid profile image URL to add to new seat data`);
      }
      
      console.log(`[Command] Looking for an available seat with data:`, setData);
      
      const availableSeat = await seatsCollection.findOneAndUpdate(
        { username: null }, // 空席を探す
        { $set: setData },
        { sort: { position: 1 }, returnDocument: 'after' } // position昇順で最初の空席を取得
      );
      
      if (availableSeat.value) {
        console.log(`[Command] Found and updated available seat:`, {
          id: availableSeat.value._id.toString(),
          username: availableSeat.value.username,
          profileImageUrl: availableSeat.value.profileImageUrl,
          hasProfileImage: !!availableSeat.value.profileImageUrl,
          room_id: availableSeat.value.room_id,
          position: availableSeat.value.position
        });
        
        // 自動退室時間を設定
        await scheduleAutoExit(db, availableSeat.value.room_id, availableSeat.value.position, 2);
        
        console.log(`[Command] ${username} entered seat ${availableSeat.value.position} (Task: ${taskName})`);
        
        // 入室メッセージを送信（OAuth認証が設定されている場合のみ）
        if (liveChatId && isOAuthConfigured) {
          try {
            await sendChatMessage(
              liveChatId, 
              messageTemplates.seatTaken(username, availableSeat.value.room_id, availableSeat.value.position, taskName)
            );
          } catch (error) {
            console.warn('[Command] Failed to send message, continuing without notification:', error);
            // メッセージ送信に失敗しても処理は続行
          }
        }
        
        // システムメッセージを保存（SSEで検知される）
        await saveSystemMessage(`${username}さんが「${taskName}」で入室しました`, 'info');
        
        return {
          success: true,
          action: 'enter',
          seat: {
            roomId: availableSeat.value.room_id,
            position: availableSeat.value.position,
            username: username,
            task: taskName
          }
        };
      } else {
        // 空席がない場合は新しい座席を作成する
        // 最大の座席番号と部屋番号を取得
        const lastSeat = await seatsCollection.find().sort({ position: -1 }).limit(1).toArray();
        const lastRoomSeat = await seatsCollection.find().sort({ room_id: -1 }).limit(1).toArray();
        
        const newPosition = lastSeat.length > 0 ? lastSeat[0].position + 1 : 1;
        const newRoomId = lastRoomSeat.length > 0 ? lastRoomSeat[0].room_id : 1;
        
        // 新しい座席を作成
        const newSeat: Record<string, any> = {
          position: newPosition,
          room_id: newRoomId,
          username: username,
          authorId: authorId,
          task: taskName,
          enterTime: enterTime,
          timestamp: new Date()
        };
        
        // 有効なプロフィール画像URLが提供された場合のみ設定
        if (isValidImageUrl(profileImageUrl)) {
          newSeat.profileImageUrl = profileImageUrl;
          console.log(`[Command] Adding profile image URL to new created seat: ${profileImageUrl}`);
        } else {
          console.log(`[Command] No valid profile image URL to add to newly created seat`);
        }
        
        console.log(`[Command] Creating new seat:`, newSeat);
        
        const insertResult = await seatsCollection.insertOne(newSeat);
        
        console.log(`[Command] New seat created:`, {
          insertedId: insertResult.insertedId.toString(),
          acknowledged: insertResult.acknowledged
        });
        
        // 作成した座席のデータを取得して確認
        const createdSeat = await seatsCollection.findOne({ _id: insertResult.insertedId });
        console.log(`[Command] Newly created seat data:`, {
          id: createdSeat?._id.toString(),
          username: createdSeat?.username,
          profileImageUrl: createdSeat?.profileImageUrl,
          hasProfileImage: !!createdSeat?.profileImageUrl
        });
        
        // 自動退室時間を設定
        await scheduleAutoExit(db, newRoomId, newPosition, 2);
        
        console.log(`[Command] Created new seat: Room ${newRoomId}, Position ${newPosition} for ${username} (Task: ${taskName})`);
        
        // 入室メッセージを送信（OAuth認証が設定されている場合のみ）
        if (liveChatId && isOAuthConfigured) {
          try {
            await sendChatMessage(
              liveChatId, 
              messageTemplates.seatTaken(username, newRoomId, newPosition, taskName)
            );
          } catch (error) {
            console.warn('[Command] Failed to send message, continuing without notification:', error);
            // メッセージ送信に失敗しても処理は続行
          }
        }
        
        // システムメッセージを保存（SSEで検知される）
        await saveSystemMessage(`${username}さんが「${taskName}」で新しい座席を作成しました`, 'info');
        
        return {
          success: true,
          action: 'create',
          seat: {
            roomId: newRoomId,
            position: newPosition,
            username: username,
            task: taskName,
            id: insertResult.insertedId.toString()
          }
        };
      }
    }
  } else if (command === 'finish') {
    console.log(`[Command] /finish command execution: ${username}`);
    
    // ユーザーIDかユーザー名で座席を検索
    const userQuery = authorId ? { authorId } : { username };
    
    try {
      // ユーザーの座席を検索
      const result = await seatsCollection.findOneAndUpdate(
        userQuery,
        { 
          $set: { 
            username: null, 
            authorId: null, 
            task: null, 
            enterTime: null, 
            autoExitScheduled: null,
            profileImageUrl: null, // プロフィール画像情報もクリア
            timestamp: new Date()
          } 
        },
        { returnDocument: 'before' } // 更新前の情報を取得
      );
      
      if (result.value && result.value.username) {
        console.log(`[Command] ${username} has left the seat`);
        
        // 退室メッセージを送信（OAuth認証が設定されている場合のみ）
        if (liveChatId && isOAuthConfigured) {
          try {
            await sendChatMessage(
              liveChatId, 
              messageTemplates.seatVacated(username, result.value.room_id, result.value.position)
            );
          } catch (error) {
            console.warn('[Command] Failed to send message, continuing without notification:', error);
            // メッセージ送信に失敗しても処理は続行
          }
        }
        
        // システムメッセージを保存（SSEで検知される）
        await saveSystemMessage(`${username}さんが退室しました`, 'info');
        
        return {
          success: true,
          action: 'exit',
          seat: {
            roomId: result.value.room_id,
            position: result.value.position,
            previousUsername: username
          }
        };
      } else {
        console.log(`[Command] ${username} was not seated`);
        // 入室していない場合は特に何もしない
        return {
          success: true,
          action: 'none',
          message: 'ユーザーは入室していませんでした'
        };
      }
    } catch (error) {
      console.error(`[Command] Error while processing exit for ${username}:`, error);
      throw new Error('退室処理に失敗しました: ' + (error as Error).message);
    }
  } else {
    console.log(`[Command] Unsupported command: ${command}`);
    throw new Error('対応していないコマンドです');
  }
}