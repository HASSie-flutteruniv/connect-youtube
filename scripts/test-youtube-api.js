// テスト用スクリプト: YouTube APIを利用してライブチャットのコメントを取得する

// dotenvを使用して環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

const { getLiveChatMessages, getLiveChatId } = require('../lib/youtube');

// メインの非同期関数
async function testYouTubeApi() {
  try {
    console.log('YouTube API接続テストを開始します...');
    
    // 環境変数から動画IDを取得
    const videoId = process.env.YOUTUBE_VIDEO_ID;
    
    if (!videoId) {
      console.log('YOUTUBE_VIDEO_IDが設定されていません。');
      return;
    }
    
    console.log(`動画ID: ${videoId}`);
    
    // 動画IDからライブチャットIDを取得
    console.log('ライブチャットIDを取得しています...');
    const liveChatId = await getLiveChatId(videoId);
    
    if (!liveChatId) {
      console.log('ライブチャットIDが取得できませんでした。');
      console.log('この動画はライブ配信ではないか、ライブ配信が終了している可能性があります。');
      return;
    }
    
    console.log(`ライブチャットID: ${liveChatId}`);
    
    // ライブチャットのコメントを取得
    console.log('ライブチャットコメントを取得しています...');
    const chatData = await getLiveChatMessages(liveChatId);
    
    // 取得したデータを表示
    console.log('ライブチャット情報:');
    console.log(`ポーリング間隔: ${chatData.pollingIntervalMillis}ms`);
    console.log(`次のページトークン: ${chatData.nextPageToken}`);
    console.log(`コメント数: ${chatData.items?.length || 0}`);
    
    // 各コメントの内容を表示
    if (chatData.items && chatData.items.length > 0) {
      console.log('\n=== 最新のコメント ===');
      chatData.items.forEach((item, index) => {
        const author = item.authorDetails?.displayName || '不明なユーザー';
        const text = item.snippet?.displayMessage || '';
        const timestamp = new Date(item.snippet?.publishedAt).toLocaleString('ja-JP');
        
        console.log(`\n#${index + 1} [${timestamp}] ${author}:`);
        console.log(`    "${text}"`);
        
        // コマンド検出 (例: /30) のテスト
        const commandMatch = text.match(/\/(\d+)/);
        if (commandMatch) {
          const roomNumber = commandMatch[1];
          console.log(`    ※ コマンド検出: /「${roomNumber}」の部屋に割り当て`);
        }
      });
    } else {
      console.log('\nコメントはありません。');
    }
    
    console.log('\nYouTube API接続テスト完了');
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// スクリプト実行
testYouTubeApi(); 