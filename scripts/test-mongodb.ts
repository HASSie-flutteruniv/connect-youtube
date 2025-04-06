// MongoDB接続テスト用スクリプト
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env.localを読み込み
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function testMongoDBConnection() {
  if (!process.env.MONGODB_URI) {
    console.error('環境変数MONGODB_URIが設定されていません');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    console.log('MongoDB接続テストを開始します...');
    
    // データベースに接続
    await client.connect();
    console.log('MongoDB接続成功！');
    
    // データベース情報を表示
    const db = client.db('coworking');
    const collections = await db.listCollections().toArray();
    
    console.log('データベース: coworking');
    console.log('コレクション一覧:');
    collections.forEach((collection, index) => {
      console.log(`${index + 1}. ${collection.name}`);
    });
    
    // roomsコレクションのデータ取得
    const rooms = await db.collection('rooms').find().toArray();
    console.log('\nルーム数:', rooms.length);
    console.log('ルーム一覧:', rooms.map(room => room._id));
    
    // seatsコレクションのデータ取得
    const seats = await db.collection('seats').find().toArray();
    console.log('\n座席数:', seats.length);
    console.log('最初の座席データ例:', JSON.stringify(seats[0] || 'データなし', null, 2));

    // 座席数とユーザー数を確認
    const userSeats = await db.collection('seats').find({ username: { $ne: null } }).toArray();
    console.log('\n現在利用中の座席数:', userSeats.length);
    if (userSeats.length > 0) {
      console.log('入室中のユーザー一覧:');
      userSeats.forEach((seat, index) => {
        const enterTime = seat.enterTime ? new Date(seat.enterTime).toLocaleString() : '不明';
        const exitTime = seat.autoExitScheduled ? new Date(seat.autoExitScheduled).toLocaleString() : '不明';
        console.log(`${index + 1}. ${seat.username} - 部屋: ${seat.room_id}, 座席: ${seat.position}, 入室: ${enterTime}, 自動退室: ${exitTime}`);
      });
    }

    console.log('\nMongoDBテスト完了');
  } catch (error) {
    console.error('MongoDB接続エラー:', error);
  } finally {
    await client.close();
  }
}

// スクリプト実行
testMongoDBConnection();
