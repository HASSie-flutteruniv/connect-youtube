import clientPromise from '../lib/mongodb';

async function testMongoDBConnection() {
  try {
    console.log('MongoDB接続テストを開始します...');
    
    // クライアント接続を取得
    const client = await clientPromise;
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
    console.log('最初の座席データ例:', seats[0] || 'データなし');
    
    console.log('\nMongoDBテスト完了');
  } catch (error) {
    console.error('MongoDB接続エラー:', error);
  }
}

testMongoDBConnection();
