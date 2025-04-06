// MongoDB接続テスト用スクリプト（CommonJS版）
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

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
    
    console.log('\nMongoDBテスト完了');
  } catch (error) {
    console.error('MongoDB接続エラー:', error);
  } finally {
    await client.close();
  }
}

testMongoDBConnection(); 