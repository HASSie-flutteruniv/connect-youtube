import { NextResponse } from 'next/server';
// CommonJS形式のライブラリをインポート
import { getLiveChatMessages, getLiveChatId } from '@/lib/youtube';
import { detectCommand } from '@/lib/utils';
import clientPromise from '@/lib/mongodb'; // MongoDBクライアントをインポート

// このAPIルートを動的に処理するための設定
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// インメモリキャッシュ（サーバー再起動時にリセットされます）
const liveChatIdCache: Record<string, string> = {};

// エラーバックオフのための状態管理
const errorState = {
  lastErrorTime: 0,
  quotaExceeded: false,
  backoffUntil: 0,
  consecutiveErrors: 0
};

// コメントアイテムの型定義
interface ChatItem {
  id: string;
  snippet?: {
    displayMessage?: string;
    publishedAt?: string;
    authorDisplayName?: string;
    authorPhotoUrl?: string;
    authorChannelId?: {
      value?: string;
    };
  };
  authorDetails?: {
    displayName?: string;
    profileImageUrl?: string;
    channelId?: string;  // チャンネルID（ユーザー識別用）
  };
}

/**
 * YouTubeライブコメント取得API
 * コメント取得のみを担当し、コマンド実行（DB更新）は行わない
 */
export async function GET(request: Request) {
  try {
    // 現在時刻が backoffUntil を下回る場合はエラーを返す（APIリクエスト抑制）
    const now = Date.now();
    if (now < errorState.backoffUntil) {
      const remainingSeconds = Math.ceil((errorState.backoffUntil - now) / 1000);
      console.log(`[Comments API] APIリクエスト抑制中 (残り${remainingSeconds}秒)`);
      return NextResponse.json({ 
        error: `APIクォータ超過のため一時的に利用できません。(残り${remainingSeconds}秒)`,
        commands: [],
        backoff: true,
        remainingSeconds
      }, { status: 429 });
    }

    // クエリパラメータからvideoIdを取得
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId') || process.env.YOUTUBE_VIDEO_ID;
    
    // BOTのチャンネルID（環境変数から取得または直接指定）
    const botChannelId = process.env.YOUTUBE_BOT_CHANNEL_ID || '';
    const adminChannelId = process.env.ADMIN_YOUTUBE_CHANNEL_ID; // 運営者IDを取得
    
    // videoIdチェック
    if (!videoId) {
      console.log('[Comments API] videoIdが指定されていません');
      return NextResponse.json({ 
        error: 'YouTube動画IDを入力してください', 
        commands: [] 
      }, { status: 400 });
    }
    
    // キャッシュからliveChatIdを取得
    let liveChatId = liveChatIdCache[videoId];
    let usedCache = false;
    
    // キャッシュにない場合のみAPIを呼び出し
    if (!liveChatId) {
      try {
        console.log(`[Comments API] liveChatIdのキャッシュがないため、API経由で取得します (videoId: ${videoId})`);
        const fetchedLiveChatId = await getLiveChatId(videoId);
        
        if (fetchedLiveChatId) {
          // キャッシュに保存
          liveChatId = fetchedLiveChatId;
          console.log(`[Comments API] liveChatIdをキャッシュに保存します (videoId: ${videoId}, liveChatId: ${liveChatId})`);
          liveChatIdCache[videoId] = liveChatId;
          
          // エラー状態をリセット
          errorState.consecutiveErrors = 0;
          errorState.quotaExceeded = false;
        } else {
          return NextResponse.json({ 
            error: 'ライブチャットIDが取得できませんでした。動画IDが正しいか、ライブ配信中か確認してください。',
            commands: []
          }, { status: 404 });
        }
      } catch (error: any) {
        // API呼び出しに失敗した場合のエラーハンドリング
        console.error('[Comments API] ライブチャットID取得エラー:', error);
        
        // クォータ超過エラーの場合、長めのバックオフを設定
        if (error?.message?.includes('quota') || error?.response?.status === 403 || 
            error?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded') {
          
          errorState.quotaExceeded = true;
          errorState.lastErrorTime = now;
          
          // 最初のクォータエラーなら10分、2回目以降なら30分のバックオフ
          const backoffTime = errorState.consecutiveErrors > 0 ? 30 * 60 * 1000 : 10 * 60 * 1000;
          errorState.backoffUntil = now + backoffTime;
          errorState.consecutiveErrors++;
          
          console.log(`[Comments API] APIクォータ超過を検出しました。${backoffTime / 60000}分間APIリクエストを抑制します`);
          
          return NextResponse.json({ 
            error: `YouTube APIのクォータ制限を超過しました。${backoffTime / 60000}分後に再試行してください。`,
            commands: [],
            backoff: true
          }, { status: 429 });
        }
        
        // その他のエラーの場合
        errorState.consecutiveErrors++;
        
        if (errorState.consecutiveErrors > 3) {
          // 連続エラー回数が多い場合は一時的にバックオフ
          const backoffTime = Math.min(errorState.consecutiveErrors * 60 * 1000, 5 * 60 * 1000); // 最大5分
          errorState.backoffUntil = now + backoffTime;
          
          console.log(`[Comments API] 連続エラーを検出しました。${backoffTime / 60000}分間APIリクエストを抑制します`);
          
          return NextResponse.json({ 
            error: `YouTube APIに接続できません。${backoffTime / 60000}分後に再試行してください。`,
            commands: [],
            backoff: true
          }, { status: 503 });
        }
        
        return NextResponse.json({ error: 'ライブチャットIDの取得に失敗しました' }, { status: 500 });
      }
    } else {
      console.log(`[Comments API] キャッシュからliveChatIdを取得しました (videoId: ${videoId}, liveChatId: ${liveChatId})`);
      usedCache = true;
    }
    
    // ページトークンをクエリから取得（初回は null）
    const pageToken = null; // 注: 実装を簡単にするため固定
    
    // コメントデータを取得
    let chatData;
    try {
      chatData = await getLiveChatMessages(liveChatId, pageToken);
      
      // 成功したらエラーカウントをリセット
      errorState.consecutiveErrors = 0;
    } catch (error: any) {
      console.error('[Comments API] コメント取得エラー:', error);
      
      // クォータ超過エラーの場合
      if (error?.message?.includes('quota') || error?.response?.status === 403 || 
          error?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded') {
        
        errorState.quotaExceeded = true;
        errorState.lastErrorTime = now;
        
        // 最初のクォータエラーなら10分、2回目以降なら30分のバックオフ
        const backoffTime = errorState.consecutiveErrors > 0 ? 30 * 60 * 1000 : 10 * 60 * 1000;
        errorState.backoffUntil = now + backoffTime;
        errorState.consecutiveErrors++;
        
        console.log(`[Comments API] APIクォータ超過を検出しました。${backoffTime / 60000}分間APIリクエストを抑制します`);
        
        return NextResponse.json({ 
          error: `YouTube APIのクォータ制限を超過しました。${backoffTime / 60000}分後に再試行してください。`,
          commands: [],
          backoff: true
        }, { status: 429 });
      }
      
      // その他のエラーの場合
      errorState.consecutiveErrors++;
      
      // 連続エラーが続く場合はバックオフを設定
      if (errorState.consecutiveErrors > 3) {
        const backoffTime = Math.min(errorState.consecutiveErrors * 60 * 1000, 5 * 60 * 1000); // 最大5分
        errorState.backoffUntil = now + backoffTime;
        
        return NextResponse.json({ 
          error: `コメントの取得に失敗しました。${backoffTime / 60000}分後に再試行してください。`,
          commands: [],
          backoff: true
        }, { status: 503 });
      }
      
      return NextResponse.json({ error: 'コメントの取得に失敗しました' }, { status: 500 });
    }
    
    // 検出済みコマンドの配列を準備
    const detectedCommands = [];
    const client = await clientPromise; // MongoDBクライアントを取得
    const db = client.db('coworking'); // データベースを選択
    const announcementsCollection = db.collection('announcements'); // コレクションを選択
    const processedCommentsCollection = db.collection('processedComments'); // 処理済みコメント用コレクション

    // TTLインデックスが存在するか確認し、なければ作成（処理済みコメントを1週間後に自動削除）
    try {
      const indexes = await processedCommentsCollection.indexInformation();
      if (!indexes.processedAt_1) {
        await processedCommentsCollection.createIndex({ processedAt: 1 }, { 
          expireAfterSeconds: 604800, // 1週間
          name: 'processedAt_1'
        });
        console.log('[Comments API] 処理済みコメントのTTLインデックスを作成しました');
      }
    } catch (indexError) {
      console.error('[Comments API] インデックス確認・作成エラー:', indexError);
      // エラーが発生しても処理を続行
    }

    // コメントごとにコマンド検出を行う
    for (const item of chatData.items || []) {
      const commentId = item.id;
      console.log('[Comments API] コメントID:', commentId);
      const commentText = item.snippet?.displayMessage || '';
      const publishedAt = item.snippet?.publishedAt; // YouTube上の公開日時
      
      // API構造に応じて投稿者情報を取得（snippetとauthorDetailsの両方をチェック）
      const authorName = item.snippet?.authorDisplayName || item.authorDetails?.displayName;
      const authorId = (item.snippet?.authorChannelId?.value) || item.authorDetails?.channelId;
      const profileImageUrl = item.snippet?.authorPhotoUrl || item.authorDetails?.profileImageUrl;
      
      // 以下の条件でコメント処理をスキップ
      // 1. 投稿者情報がない
      // 2. 既に処理済みのコメント
      // 3. BOT自身の投稿
      if (!authorName || !authorId) continue; // 投稿者情報がない場合はスキップ
      
      // MongoDB で処理済みコメントをチェック
      const processedComment = await processedCommentsCollection.findOne({ commentId });
      if (processedComment) {
        console.log(`[Comments API] スキップ: 既に処理済みのコメント (ID: ${commentId})`);
        continue;
      }
      
      if (botChannelId && authorId === botChannelId) {
        console.log(`[Comments API] スキップ: BOT自身の投稿 (ID: ${commentId})`);
        // BOT自身の投稿はDBに追加して今後処理しないようにする
        await processedCommentsCollection.insertOne({
          commentId,
          authorId,
          isBot: true,
          processedAt: new Date()
        });
        continue;
      }
      
      console.log(`[Comments API] コメント検出: ${authorName} - ${commentText}`);
      // console.log(`[Comments API] プロフィール画像URL: ${profileImageUrl}`); // 必要ならログ出力
      
      // ★★★ 運営者コメントか判定 ★★★
      if (adminChannelId && authorId === adminChannelId) {
        console.log(`[Comments API] お知らせコメント検出: ${authorName} - ${commentText}`);
        try {
          // コメントの重複チェック
          const existingAnnouncement = await announcementsCollection.findOne({
            message: commentText,
            authorChannelId: authorId
          });
          if (existingAnnouncement) {
            console.log(`[Comments API] 重複コメント: ${commentText}`);
            continue; // 重複コメントはスキップ
          }
          // お知らせをDBに保存
          await announcementsCollection.insertOne({
            message: commentText,
            authorChannelId: authorId,
            authorName: authorName, // 念のため名前も保存
            profileImageUrl: profileImageUrl, // プロフィール画像も保存
            publishedAt: publishedAt ? new Date(publishedAt) : new Date(), // 日付形式に変換
            createdAt: new Date(), // サーバーでの保存日時
          });
          console.log(`[Comments API] お知らせをDBに保存しました: ${commentText}`);
          
          // 処理済みとしてDBに保存
          await processedCommentsCollection.insertOne({
            commentId,
            authorId,
            isAnnouncement: true,
            processedAt: new Date()
          });
        } catch (dbError) {
          console.error('[Comments API] お知らせのDB保存エラー:', dbError);
          // エラーが発生しても処理を続行する（他のコメントに影響を与えない）
        }
        // 運営者コメントはお知らせ専用なので、コマンド検出は行わない
        continue; // 次のコメントへ
      }

      // --- 運営者コメントでない場合の処理 ---
      // コマンド検出
      const { command, taskName } = detectCommand(commentText);
      
      if (command) {
        // コマンドを検出した場合、コマンド情報を配列に追加
        detectedCommands.push({
          command,
          taskName,
          authorName,
          authorId,
          commentId,
          commentText,
          profileImageUrl
        });
        
        console.log(`[Comments API] コマンド検出: ${command} by ${authorName} (${taskName || 'タスクなし'})`);
        
        // 処理済みとしてDBに保存
        await processedCommentsCollection.insertOne({
          commentId,
          authorId,
          command,
          taskName,
          processedAt: new Date()
        });
      }
      // コマンドがない通常のコメントは処理しない（必要に応じてここで処理を追加）
    }
    
    // コメントデータを整形 (UI表示用)
    const comments = chatData.items?.map((item: ChatItem) => ({
      id: item.id,
      author: item.snippet?.authorDisplayName || item.authorDetails?.displayName || '不明なユーザー',
      profileImageUrl: item.snippet?.authorPhotoUrl || item.authorDetails?.profileImageUrl,
      text: item.snippet?.displayMessage || '',
      publishedAt: item.snippet?.publishedAt
    })) || [];
    
    return NextResponse.json({
      comments,
      commands: detectedCommands,
      nextPageToken: chatData.nextPageToken,
      pollingIntervalMillis: chatData.pollingIntervalMillis || 5000,
      usedCache // キャッシュを使用したかどうかを返す
    });
    
  } catch (error) {
    console.error('[Comments API] YouTube API エラー:', error);
    
    // エラーカウントを増やす
    errorState.consecutiveErrors++;
    
    // 連続エラーが多い場合はバックオフを設定
    if (errorState.consecutiveErrors > 3) {
      const now = Date.now();
      const backoffTime = Math.min(errorState.consecutiveErrors * 60 * 1000, 5 * 60 * 1000); // 最大5分
      errorState.backoffUntil = now + backoffTime;
      
      console.log(`[Comments API] 連続エラーを検出しました。${backoffTime / 60000}分間APIリクエストを抑制します`);
      
      return NextResponse.json({ 
        error: `サービスが一時的に利用できません。${backoffTime / 60000}分後に再試行してください。`,
        commands: [],
        backoff: true
      }, { status: 503 });
    }
    
    return NextResponse.json({ error: 'コメントの取得に失敗しました' }, { status: 500 });
  }
} 