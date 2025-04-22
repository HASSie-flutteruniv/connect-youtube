import { NextResponse } from 'next/server';
// CommonJS形式のライブラリをインポート
import { detectCommand } from '@/lib/utils';
import clientPromise from '@/lib/mongodb'; // MongoDBクライアントをインポート
import { youtubeApiClient, YouTubeAPIError } from '@/lib/youtubeApiClient'; // エラークラスもインポート

// このAPIルートを動的に処理するための設定
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// キャッシュの有効期間 (例: 30日)
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30日 * 24時間 * 60分 * 60秒 * 1000ミリ秒

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

// ChatResponse の型定義（youtubeApiClient から取得するデータの型に合わせる）
interface ChatResponse {
  items: ChatItem[];
  nextPageToken?: string; // オプショナルに変更
  pollingIntervalMillis?: number; // オプショナルに変更
  error?: string; // エラー情報
  backoff?: boolean; // バックオフ指示
  remainingSeconds?: number; // バックオフ秒数
  commands?: any[]; // コマンド情報 (今回はここで生成)
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

    // ページトークンは現在使用していない
    const pageToken = undefined; // 型エラー回避のため

    let liveChatId: string;
    let chatData: ChatResponse | null = null; // 初期値をnullに

    try {
      // youtubeApiClientからliveChatIdを取得 (キャッシュ処理はApiClient内部で行われる)
      console.log(`[Comments API] youtubeApiClientから liveChatId を取得します (videoId: ${videoId})`);
      liveChatId = await youtubeApiClient.getLiveChatId(videoId);

      // liveChatId を使ってメッセージを取得
      chatData = await youtubeApiClient.getLiveChatMessages(liveChatId, pageToken);

      // 成功したらエラーカウントをリセット
      errorState.consecutiveErrors = 0;
      // 成功したらクォータ超過状態もリセット
      if(errorState.quotaExceeded) {
          errorState.quotaExceeded = false;
          console.log("[Comments API] クォータ超過状態をリセットしました。");
      }

    } catch (error: any) {
      console.error('[Comments API] コメントまたはliveChatId取得エラー:', error);

      // liveChatId が見つからないエラー (404 Not Found またはカスタムエラー)
      if (error instanceof YouTubeAPIError && (error.status === 404 || error.code === 'NOT_FOUND' || error.code === 'NOT_FOUND_NEGATIVE_CACHE')) {
         // youtubeApiClient側でNegative Cacheされるため、ここでは404を返すのみ
         return NextResponse.json({ error: error.message || 'ライブチャットが見つかりません。動画IDや配信状況を確認してください。', commands: [] }, { status: 404 });
      }

      // クォータ超過エラー
      if (error?.message?.includes('quota') || error?.response?.status === 403 ||
          error?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded' ||
          (error instanceof YouTubeAPIError && error.status === 403)) { // APIクライアントからのエラーも考慮

        errorState.quotaExceeded = true;
        errorState.lastErrorTime = now;

        // 最初のクォータエラーなら10分、2回目以降なら30分のバックオフ
        const backoffTime = errorState.consecutiveErrors > 0 ? 30 * 60 * 1000 : 10 * 60 * 1000;
        errorState.backoffUntil = now + backoffTime;
        errorState.consecutiveErrors++; // エラーカウント増加

        const remainingSeconds = Math.ceil(backoffTime / 1000);
        console.log(`[Comments API] APIクォータ超過を検出しました。${backoffTime / 60000}分間APIリクエストを抑制します`);

        return NextResponse.json({
          error: `YouTube APIのクォータ制限を超過しました。${backoffTime / 60000}分後に再試行してください。`,
          commands: [],
          backoff: true,
          remainingSeconds
        }, { status: 429 });
      }

      // その他のエラーの場合
      errorState.consecutiveErrors++;

      // 連続エラーが続く場合はバックオフを設定
      if (errorState.consecutiveErrors > 3) {
        // 指数バックオフ（最大5分）
        const backoffTime = Math.min(Math.pow(2, errorState.consecutiveErrors) * 1000, 5 * 60 * 1000);
        errorState.backoffUntil = now + backoffTime;
        const remainingSeconds = Math.ceil(backoffTime / 1000);

        console.log(`[Comments API] ${errorState.consecutiveErrors}回連続エラー。${backoffTime / 60000}分間バックオフします`);

        return NextResponse.json({
          error: `YouTube APIに接続できません。${backoffTime / 60000}分後に再試行してください。`,
          commands: [],
          backoff: true,
          remainingSeconds
        }, { status: 503 }); // Service Unavailable
      }

      // 上記以外の予期せぬエラー
      const errorMessage = error instanceof Error ? error.message : 'コメントの取得中に不明なエラーが発生しました';
      return NextResponse.json({ error: errorMessage, commands: [] }, { status: 500 });
    }

    // chatData が null または items がない場合はエラーレスポンス（取得失敗）
    if (!chatData || !chatData.items) {
        console.warn('[Comments API] chatData または chatData.items が存在しませんでした。');
        return NextResponse.json({ error: 'コメントデータの取得に失敗しました。', commands: [] }, { status: 500 });
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
      // console.log('[Comments API] コメントID:', commentId); // 必要なら有効化
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
        // console.log(`[Comments API] スキップ: 既に処理済みのコメント (ID: ${commentId})`); // 必要なら有効化
        continue;
      }

      if (botChannelId && authorId === botChannelId) {
        console.log(`[Comments API] スキップ: BOT自身の投稿 (ID: ${commentId})`);
        // BOT自身の投稿はDBに追加して今後処理しないようにする
        try {
            await processedCommentsCollection.insertOne({
              commentId,
              authorId,
              isBot: true,
              processedAt: new Date()
            });
        } catch (dbError) {
            console.error('[Comments API] BOTコメントのDB保存エラー:', dbError);
        }
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
            console.log(`[Comments API] 重複お知らせコメント: ${commentText}`);
            // 重複は処理済みDBには入れない（再投稿の可能性があるため）
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

          // お知らせも処理済みとしてDBに保存 (将来的な重複処理を防ぐ)
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

      // --- 運営者コメントでない場合の処理 ---\
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
        try {
            await processedCommentsCollection.insertOne({
              commentId,
              authorId,
              commandDetected: command,
              processedAt: new Date()
            });
        } catch (dbError) {
            console.error('[Comments API] 処理済みコマンドのDB保存エラー:', dbError);
        }
      } else {
        // コマンドが含まれないコメントも処理済みとして記録（ただしDB負荷を考慮しオプション）
         try {
             await processedCommentsCollection.insertOne({
               commentId,
               authorId,
               processedAt: new Date()
             });
         } catch (dbError) {
             console.error('[Comments API] 処理済みコメント(コマンドなし)のDB保存エラー:', dbError);
         }
      }
    } // end of for loop

    // レスポンスを返す
    return NextResponse.json({
      commands: detectedCommands,
      pollingIntervalMillis: chatData.pollingIntervalMillis || 10000, // デフォルト10秒
      nextPageToken: chatData.nextPageToken, // ページネーショントークンも返す
      backoff: false // 成功時は backoff: false
    });

  } catch (error) {
      console.error('[Comments API] 予期せぬエラー:', error);
      // 想定外のエラーが発生した場合
      return NextResponse.json({
          error: 'サーバー内部で予期せぬエラーが発生しました',
          commands: [],
          backoff: true, // 念のためバックオフを推奨
          remainingSeconds: 60 // 1分
      }, { status: 500 });
  }
} 