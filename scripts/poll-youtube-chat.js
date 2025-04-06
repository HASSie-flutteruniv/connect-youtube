// YouTubeライブチャットのコメントを定期的にポーリングするスクリプト

// dotenvを使用して環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

const { getLiveChatMessages, getLiveChatId } = require('../lib/youtube');

// 検出したコマンドを処理する関数
function processCommand(author, command, roomNumber) {
  console.log(`[コマンド処理] ユーザー「${author}」を部屋「${roomNumber}」に割り当てます。`);
  // ここで座席管理システムなどと連携する処理を追加
  // 例: データベースの更新、通知の送信など
}

// ポーリング処理を行う関数
async function pollYouTubeChat() {
  try {
    // 環境変数から動画IDを取得
    const videoId = process.env.YOUTUBE_VIDEO_ID;
    
    if (!videoId) {
      console.error('YOUTUBE_VIDEO_IDが設定されていません。');
      return;
    }
    
    console.log('YouTubeライブチャットのポーリングを開始します...');
    console.log(`動画ID: ${videoId}`);
    
    // 動画IDからライブチャットIDを取得
    const liveChatId = await getLiveChatId(videoId);
    
    if (!liveChatId) {
      console.error('ライブチャットIDが取得できませんでした。ライブ配信が終了しているか確認してください。');
      return;
    }
    
    console.log(`ライブチャットID: ${liveChatId}`);
    
    // ポーリングループを開始
    await pollChatLoop(liveChatId);
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// 継続的なポーリングを行うループ関数
async function pollChatLoop(liveChatId, pageToken = null) {
  try {
    // コメントデータを取得
    const chatData = await getLiveChatMessages(liveChatId, pageToken);
    
    // 次回のポーリング間隔
    const nextPollTime = chatData.pollingIntervalMillis || 5000; // デフォルトは5秒
    
    // 次のページトークン
    const nextPageToken = chatData.nextPageToken;
    
    // ステータス表示
    const timestamp = new Date().toLocaleString('ja-JP');
    console.log(`\n[${timestamp}] コメント取得成功 (${chatData.items?.length || 0}件)`);
    
    // 取得したコメントを処理
    if (chatData.items && chatData.items.length > 0) {
      chatData.items.forEach(item => {
        const author = item.authorDetails?.displayName || '不明なユーザー';
        const text = item.snippet?.displayMessage || '';
        const publishTime = new Date(item.snippet?.publishedAt || '').toLocaleString('ja-JP');
        
        console.log(`[${publishTime}] ${author}: ${text}`);
        
        // コマンド検出 (例: /30)
        const commandMatch = text.match(/\/(\d+)/);
        if (commandMatch) {
          const roomNumber = commandMatch[1];
          console.log(`    → コマンド「/${roomNumber}」を検出しました！`);
          
          // 検出したコマンドを処理
          processCommand(author, text, roomNumber);
        }
      });
    }
    
    // 次回のポーリング時間を表示
    console.log(`次回のポーリングまで ${nextPollTime}ms 待機します...`);
    
    // 指定された間隔後に再帰的に呼び出し
    setTimeout(() => {
      pollChatLoop(liveChatId, nextPageToken);
    }, nextPollTime);
    
  } catch (error) {
    console.error('ポーリング中にエラーが発生しました:', error);
    
    // エラー発生時は少し待ってから再試行
    console.log('10秒後に再試行します...');
    setTimeout(() => {
      pollChatLoop(liveChatId, pageToken);
    }, 10000);
  }
}

// メイン処理を実行
pollYouTubeChat().catch(error => {
  console.error('予期せぬエラーが発生しました:', error);
}); 