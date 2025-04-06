import { NextResponse } from 'next/server';
// CommonJS形式のライブラリをインポート
import { getLiveChatMessages, getLiveChatId } from '@/lib/youtube';
import { detectCommand } from '@/lib/utils';

// インメモリキャッシュ（サーバー再起動時にリセットされます）
const liveChatIdCache: Record<string, string> = {};
// 処理済みコメントIDを保存するSet
const processedCommentIds = new Set<string>();

// コメントアイテムの型定義
interface ChatItem {
  id: string;
  snippet?: {
    displayMessage?: string;
    publishedAt?: string;
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
export async function GET() {
  try {
    // 環境変数から動画IDを取得
    console.log('[Comments API] コメント取得開始');
    const videoId = process.env.YOUTUBE_VIDEO_ID;
    // BOTのチャンネルID（環境変数から取得または直接指定）
    const botChannelId = process.env.YOUTUBE_BOT_CHANNEL_ID || '';
    
    if (!videoId) {
      return NextResponse.json({ error: 'YOUTUBE_VIDEO_IDが設定されていません' }, { status: 400 });
    }
    
    // キャッシュからliveChatIdを取得
    let liveChatId = liveChatIdCache[videoId];
    
    // キャッシュにない場合のみAPIを呼び出し
    if (!liveChatId) {
      console.log(`[Comments API] liveChatIdのキャッシュがないため、API経由で取得します (videoId: ${videoId})`);
      const fetchedLiveChatId = await getLiveChatId(videoId);
      
      if (fetchedLiveChatId) {
        // キャッシュに保存
        liveChatId = fetchedLiveChatId;
        console.log(`[Comments API] liveChatIdをキャッシュに保存します (videoId: ${videoId}, liveChatId: ${liveChatId})`);
        liveChatIdCache[videoId] = liveChatId;
      } else {
        return NextResponse.json({ error: 'ライブチャットIDが取得できませんでした' }, { status: 404 });
      }
    } else {
      console.log(`[Comments API] キャッシュからliveChatIdを取得しました (videoId: ${videoId}, liveChatId: ${liveChatId})`);
    }
    
    // ページトークンをクエリから取得（初回は null）
    const pageToken = null; // 注: 実装を簡単にするため固定
    
    // コメントデータを取得
    const chatData = await getLiveChatMessages(liveChatId, pageToken);
    
    // 検出済みコマンドの配列を準備
    const detectedCommands = [];
    
    // コメントごとにコマンド検出を行う
    for (const item of chatData.items || []) {
      const commentId = item.id;
      const commentText = item.snippet?.displayMessage || '';
      const authorName = item.authorDetails?.displayName;
      const authorId = item.authorDetails?.channelId;
      
      // 以下の条件でコメント処理をスキップ
      // 1. 投稿者情報がない
      // 2. 既に処理済みのコメント
      // 3. BOT自身の投稿
      if (!authorName || !authorId) continue; // 投稿者情報がない場合はスキップ
      if (processedCommentIds.has(commentId)) {
        console.log(`[Comments API] スキップ: 既に処理済みのコメント (ID: ${commentId})`);
        continue;
      }
      if (botChannelId && authorId === botChannelId) {
        console.log(`[Comments API] スキップ: BOT自身の投稿 (ID: ${commentId})`);
        // BOT自身の投稿はセットに追加して今後処理しないようにする
        processedCommentIds.add(commentId);
        continue;
      }
      
      console.log(`[Comments API] コメント検出: ${authorName} - ${commentText}`);
      
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
          commentText
        });
        
        console.log(`[Comments API] コマンド検出: ${command} by ${authorName} (${taskName || 'タスクなし'})`);
        
        // 処理済みとしてマーク
        processedCommentIds.add(commentId);
      }
    }
    
    // 処理済みID数が多くなりすぎないように、最新の1000件だけを保持
    if (processedCommentIds.size > 1000) {
      const idsToKeep = Array.from(processedCommentIds).slice(-1000);
      processedCommentIds.clear();
      idsToKeep.forEach(id => processedCommentIds.add(id));
      console.log(`[Comments API] 処理済みIDキャッシュをクリーンアップしました (残り: ${processedCommentIds.size}件)`);
    }
    
    // コメントデータを整形 (UI表示用)
    const comments = chatData.items?.map((item: ChatItem) => ({
      id: item.id,
      author: item.authorDetails?.displayName || '不明なユーザー',
      profileImageUrl: item.authorDetails?.profileImageUrl,
      text: item.snippet?.displayMessage || '',
      publishedAt: item.snippet?.publishedAt
    })) || [];
    
    return NextResponse.json({
      comments,
      commands: detectedCommands,
      nextPageToken: chatData.nextPageToken,
      pollingIntervalMillis: chatData.pollingIntervalMillis || 5000
    });
    
  } catch (error) {
    console.error('[Comments API] YouTube API エラー:', error);
    return NextResponse.json({ error: 'コメントの取得に失敗しました' }, { status: 500 });
  }
} 