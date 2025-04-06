import { NextResponse } from 'next/server';
// CommonJS形式のライブラリをインポート
import { getLiveChatMessages, getLiveChatId, sendChatMessage } from '@/lib/youtube';
import clientPromise from '@/lib/mongodb';
import { detectCommand } from '@/lib/utils';
import { messageTemplates } from '@/lib/messages';

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

export async function GET() {
  try {
    // 環境変数から動画IDを取得
    console.log('コメント取得開始')
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
      console.log(`[API] liveChatIdのキャッシュがないため、API経由で取得します (videoId: ${videoId})`);
      const fetchedLiveChatId = await getLiveChatId(videoId);
      
      if (fetchedLiveChatId) {
        // キャッシュに保存
        liveChatId = fetchedLiveChatId;
        console.log(`[API] liveChatIdをキャッシュに保存します (videoId: ${videoId}, liveChatId: ${liveChatId})`);
        liveChatIdCache[videoId] = liveChatId;
      } else {
        return NextResponse.json({ error: 'ライブチャットIDが取得できませんでした' }, { status: 404 });
      }
    } else {
      console.log(`[API] キャッシュからliveChatIdを取得しました (videoId: ${videoId}, liveChatId: ${liveChatId})`);
    }
    
    // ページトークンをクエリから取得（初回は null）
    const pageToken = null; // 注: 実装を簡単にするため固定
    
    // コメントデータを取得
    const chatData = await getLiveChatMessages(liveChatId, pageToken);
    
    // MongoDB接続
    const client = await clientPromise;
    const db = client.db('coworking');
    const seatsCollection = db.collection('seats');
    
    // コメントごとにコマンド処理を行う
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
        console.log(`[Command] スキップ: 既に処理済みのコメント (ID: ${commentId})`);
        continue;
      }
      if (botChannelId && authorId === botChannelId) {
        console.log(`[Command] スキップ: BOT自身の投稿 (ID: ${commentId})`);
        // BOT自身の投稿はセットに追加して今後処理しないようにする
        processedCommentIds.add(commentId);
        continue;
      }
      
      console.log(`[Command] コメント検出: ${authorName} - ${commentText}`);
      
      // コマンド検出
      const { command, taskName } = detectCommand(commentText);
      
      if (command === 'work' && taskName) {
        console.log(`[Command] /work コマンド検出: ${authorName} - タスク: ${taskName}`);
        
        try {
          // ユーザーが既に入室済みか確認
          const existingSeat = await seatsCollection.findOne({ authorId });
          
          const enterTime = new Date();
          const autoExitTime = new Date(enterTime);
          autoExitTime.setHours(autoExitTime.getHours() + 2); // 2時間後
          
          if (existingSeat) {
            // 既に入室済みの場合：タスクと時間を更新
            await seatsCollection.updateOne(
              { _id: existingSeat._id },
              { 
                $set: { 
                  task: taskName, 
                  enterTime: enterTime, 
                  autoExitScheduled: autoExitTime,
                  username: authorName, // 名前が変わっている可能性も考慮
                  timestamp: new Date()
                } 
              }
            );
            console.log(`[Command] ${authorName} のタスクを ${taskName} に更新しました`);
            
            // タスク更新メッセージを送信
            // await sendChatMessage(liveChatId, messageTemplates.taskUpdated(authorName, taskName));
          } else {
            // 新規入室の場合：空いている座席を探す
            const availableSeat = await seatsCollection.findOneAndUpdate(
              { username: null }, // 空席を探す
              { 
                $set: {
                  username: authorName,
                  authorId: authorId, // チャンネルIDも保存
                  task: taskName,
                  enterTime: enterTime,
                  autoExitScheduled: autoExitTime,
                  timestamp: new Date()
                }
              },
              { sort: { position: 1 }, returnDocument: 'after' } // position昇順で最初の空席を取得
            );
            
            if (availableSeat.value) {
              console.log(`[Command] ${authorName} が座席 ${availableSeat.value.position} に入室しました (タスク: ${taskName})`);
              
              // 入室メッセージを送信
              // await sendChatMessage(
              //   liveChatId, 
              //   messageTemplates.seatTaken(authorName, availableSeat.value.room_id, availableSeat.value.position, taskName)
              // );
            } else {
              // 空席がない場合は新しい座席を作成する
              // 最大の座席番号と部屋番号を取得
              const lastSeat = await seatsCollection.find().sort({ position: -1 }).limit(1).toArray();
              const lastRoomSeat = await seatsCollection.find().sort({ room_id: -1 }).limit(1).toArray();
              
              const newPosition = lastSeat.length > 0 ? lastSeat[0].position + 1 : 1;
              const newRoomId = lastRoomSeat.length > 0 ? lastRoomSeat[0].room_id : 1;
              
              // 新しい座席を作成
              const newSeat = {
                position: newPosition,
                room_id: newRoomId,
                username: authorName,
                authorId: authorId,
                task: taskName,
                enterTime: enterTime,
                autoExitScheduled: autoExitTime,
                timestamp: new Date()
              };
              
              const insertResult = await seatsCollection.insertOne(newSeat);
              console.log(`[Command] 新しい座席を作成しました: 部屋 ${newRoomId}, 座席 ${newPosition} に ${authorName} が入室しました (タスク: ${taskName})`);
              
              // 入室メッセージを送信
              // await sendChatMessage(
              //   liveChatId, 
              //   messageTemplates.seatTaken(authorName, newRoomId, newPosition, taskName)
              // );
            }
          }
        } catch (error) {
          console.error(`[Command] ${authorName} の入室処理中にエラーが発生しました:`, error);
          // エラーが発生した場合は処理済みとマークしない
          continue;
        }
      } else if (command === 'finish') {
        console.log(`[Command] /finish コマンド検出: ${authorName}`);
        
        try {
          // ユーザーの座席を検索
          const result = await seatsCollection.findOneAndUpdate(
            { authorId },
            { 
              $set: { 
                username: null, 
                authorId: null, 
                task: null, 
                enterTime: null, 
                autoExitScheduled: null,
                timestamp: new Date()
              } 
            },
            { returnDocument: 'before' } // 更新前の情報を取得
          );
          
          if (result.value && result.value.username) {
            console.log(`[Command] ${authorName} が退室しました`);
            
            // 退室メッセージを送信
            // await sendChatMessage(
            //   liveChatId, 
            //   messageTemplates.seatVacated(authorName, result.value.room_id, result.value.position)
            // );
          } else {
            console.log(`[Command] ${authorName} は入室していません`);
            // 入室していない場合は特に何もしない
          }
        } catch (error) {
          console.error(`[Command] ${authorName} の退室処理中にエラーが発生しました:`, error);
          // エラーが発生した場合は処理済みとマークしない
          continue;
        }
      } else {
        // コマンドがないコメントの場合
        console.log(`[Command] コマンドなし: ${commentText}`);
      }
      
      // コマンド処理が完了したら、処理済みリストに追加
      processedCommentIds.add(commentId);
      console.log(`[Command] コメントを処理済みとしてマーク (ID: ${commentId})`);
    }
    
    // 処理済みID数が多くなりすぎないように、最新の1000件だけを保持
    if (processedCommentIds.size > 1000) {
      const idsToKeep = Array.from(processedCommentIds).slice(-1000);
      processedCommentIds.clear();
      idsToKeep.forEach(id => processedCommentIds.add(id));
      console.log(`[Command] 処理済みIDキャッシュをクリーンアップしました (残り: ${processedCommentIds.size}件)`);
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
      nextPageToken: chatData.nextPageToken,
      pollingIntervalMillis: chatData.pollingIntervalMillis || 5000
    });
    
  } catch (error) {
    console.error('YouTube API エラー:', error);
    return NextResponse.json({ error: 'コメントの取得に失敗しました' }, { status: 500 });
  }
} 