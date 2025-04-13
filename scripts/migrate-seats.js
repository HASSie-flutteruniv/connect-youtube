/**
 * 座席データに is_active フラグを追加するマイグレーションスクリプト
 * 
 * 使用方法:
 * 1. .env.local に MONGODB_URI を設定する
 * 2. node scripts/migrate-seats.js を実行する
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI environment variable is not set');
  process.exit(1);
}

async function main() {
  console.log('座席データマイグレーションを開始します...');
  
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('MongoDBに接続しました');
    
    const db = client.db('coworking');
    const seatsCollection = db.collection('seats');
    
    // 全座席データを取得
    const totalSeats = await seatsCollection.countDocuments();
    console.log(`合計座席数: ${totalSeats}`);
    
    // is_activeフラグが未設定の座席にフラグを追加
    // 既存の座席はすべてアクティブとみなす
    const updateResult = await seatsCollection.updateMany(
      { is_active: { $exists: false } },
      { 
        $set: { 
          is_active: true,
          exitTime: null
        } 
      }
    );
    
    console.log(`${updateResult.modifiedCount}件の座席を更新しました`);
    
    // 空席はis_active=trueとする
    const emptySeatsResult = await seatsCollection.updateMany(
      { username: null, is_active: { $exists: true } },
      { $set: { is_active: true } }
    );
    
    console.log(`${emptySeatsResult.modifiedCount}件の空席のフラグを設定しました`);
    
    // 検証
    const activeSeats = await seatsCollection.countDocuments({ is_active: true });
    const inactiveSeats = await seatsCollection.countDocuments({ is_active: false });
    
    console.log(`マイグレーション後のデータ状態:`);
    console.log(`- アクティブな座席: ${activeSeats}件`);
    console.log(`- 非アクティブな座席: ${inactiveSeats}件`);
    console.log(`- 合計: ${activeSeats + inactiveSeats}件`);
    
    console.log('マイグレーションが完了しました');
  } catch (error) {
    console.error('マイグレーション中にエラーが発生しました:', error);
  } finally {
    await client.close();
    console.log('データベース接続を閉じました');
  }
}

main().catch(console.error); 