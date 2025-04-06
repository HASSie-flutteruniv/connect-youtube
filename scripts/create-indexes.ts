import clientPromise from '../lib/mongodb';

async function createIndexes() {
  try {
    console.log("Connecting to MongoDB...");
    const client = await clientPromise;
    const db = client.db();
    
    console.log("Creating indexes for 'seats' collection...");
    
    // username フィールドのインデックス作成
    await db.collection('seats').createIndex(
      { username: 1 },
      { background: true, name: "idx_username" }
    );
    console.log("Created index for 'username'");
    
    // 自動退室チェック用の複合インデックス作成
    await db.collection('seats').createIndex(
      { autoExitScheduled: 1, username: 1 },
      { background: true, name: "idx_auto_exit" }
    );
    console.log("Created composite index for 'autoExitScheduled' and 'username'");
    
    // authorId フィールドのインデックス作成
    await db.collection('seats').createIndex(
      { authorId: 1 },
      { background: true, name: "idx_author_id" }
    );
    console.log("Created index for 'authorId'");
    
    // room_id と position の複合インデックス作成
    await db.collection('seats').createIndex(
      { room_id: 1, position: 1 },
      { background: true, unique: true, name: "idx_room_position" }
    );
    console.log("Created composite unique index for 'room_id' and 'position'");
    
    console.log("All indexes created successfully!");
    
    // 既存のインデックス一覧を表示
    const indexes = await db.collection('seats').indexes();
    console.log("Current indexes:");
    console.log(indexes);
    
    process.exit(0);
  } catch (error) {
    console.error("Error creating indexes:", error);
    process.exit(1);
  }
}

createIndexes(); 