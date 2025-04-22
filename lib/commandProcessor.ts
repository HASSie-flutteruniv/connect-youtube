import { Db } from 'mongodb';
import { messageTemplates } from './messages';
import { scheduleAutoExit } from './autoExit';
import { youtubeApiClient } from './youtubeApiClient';

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
      liveChatId = await youtubeApiClient.getLiveChatId(videoId);
    } catch (error) {
      console.warn('[Command] Failed to get liveChatId, notifications will be disabled:', error);
      // 通知は送れなくても処理は続行
    }
  }
  
  // OAuth認証が設定されているかをチェック
  const isOAuthConfigured = youtubeApiClient.isOAuthConfigured();
  
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
    
    // まず、同じユーザーのアクティブなセッションがあるか確認
    const existingSeat = await seatsCollection.findOne({
      ...userQuery,
      is_active: true
    });

    // タスク名が変わっているか確認
    console.log(`[Command] Existing seat task: ${existingSeat?.task}`);
    console.log(`[Command] Task name: ${taskName}`);
    if (existingSeat && existingSeat.task === taskName) {
      console.log(`[Command] Task has not changed: ${taskName}`);
      return {
        success: true,
        action: 'update',
        seat: {
          roomId: 'focus-room',
          position: existingSeat.position,
          username: username,
          task: taskName,
          id: existingSeat._id.toString()
        }
      };
    }
    
    if (existingSeat) {
      // 既存のアクティブセッションが見つかった場合、タスク名だけを更新
      console.log(`[Command] Found existing active session for ${username}, updating task name only`);
      
      const updateResult = await seatsCollection.findOneAndUpdate(
        { _id: existingSeat._id },
        { 
          $set: { 
            task: taskName,
            timestamp: new Date()
          } 
        },
        { returnDocument: 'after' }
      );
      
      // システムメッセージを保存（SSEで検知される）
      await saveSystemMessage(`${username}さんがタスクを「${taskName}」に更新しました`, 'info');
      
      return {
        success: true,
        action: 'update',
        seat: {
          roomId: 'focus-room',
          position: existingSeat.position,
          username: username,
          task: taskName,
          id: existingSeat._id.toString()
        }
      };
    }
    
    // 以下は既存のセッションが見つからない場合の処理（新規入室）
    // 同じユーザーの既存のアクティブセッションがない場合のみ新しく作成
    if (authorId) {
      const deactivateResult = await seatsCollection.updateMany(
        { ...userQuery, is_active: true },
        { 
          $set: { 
            is_active: false,
            exitTime: new Date(),
            timestamp: new Date()
          } 
        }
      );
      
      console.log(`[Command] Deactivated ${deactivateResult.modifiedCount} existing sessions for ${username}`);
    }
    
    const enterTime = new Date();
    
    // 新しい座席を作成する
    // 最大の座席番号を取得して次の番号を割り当て
    const lastSeat = await seatsCollection.find().sort({ position: -1 }).limit(1).toArray();
    const newPosition = lastSeat.length > 0 ? lastSeat[0].position + 1 : 1;
    
    // 新しい座席を作成
    const newSeat: Record<string, any> = {
      position: newPosition,
      username: username,
      authorId: authorId,
      task: taskName,
      enterTime: enterTime,
      is_active: true,
      exitTime: null,
      timestamp: new Date(),
      created_at: new Date()
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
    await scheduleAutoExit(db, newPosition, 2);
    
    console.log(`[Command] Created new seat: Room focus-room, Position ${newPosition} for ${username} (Task: ${taskName})`);
    
    // 入室メッセージを送信（OAuth認証が設定されている場合のみ）
    if (liveChatId && isOAuthConfigured) {
      try {
        await youtubeApiClient.sendChatMessage(
          liveChatId, 
          messageTemplates.seatTaken(username, 'focus-room', newPosition, taskName)
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
      action: 'create',
      seat: {
        roomId: 'focus-room',
        position: newPosition,
        username: username,
        task: taskName,
        id: insertResult.insertedId.toString()
      }
    };
  } else if (command === 'finish') {
    console.log(`[Command] /finish command execution: ${username}`);
    
    // ユーザーIDかユーザー名でアクティブな座席を検索
    const userQuery = authorId 
      ? { authorId, is_active: true } 
      : { username, is_active: true };
    
    try {
      // ユーザーの座席を検索し、非アクティブに設定
      const result = await seatsCollection.findOneAndUpdate(
        userQuery,
        { 
          $set: { 
            is_active: false,
            exitTime: new Date(),
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
            await youtubeApiClient.sendChatMessage(
              liveChatId, 
              messageTemplates.seatVacated(username, 'focus-room', result.value.position)
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
            roomId: 'focus-room',
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