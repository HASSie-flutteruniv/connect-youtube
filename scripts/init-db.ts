import clientPromise from '@/lib/mongodb';

async function initializeDatabase() {
  try {
    const client = await clientPromise;
    const db = client.db('coworking');

    // Create rooms
    const rooms = ['30', '31'];
    await Promise.all(rooms.map(async (roomId) => {
      await db.collection('rooms').updateOne(
        { _id: roomId },
        {
          $setOnInsert: {
            created_at: new Date()
          }
        },
        { upsert: true }
      );
    }));

    // Create seats
    for (const roomId of rooms) {
      for (let position = 1; position <= 4; position++) {
        await db.collection('seats').updateOne(
          { room_id: roomId, position },
          {
            $setOnInsert: {
              username: null,
              timestamp: new Date(),
              created_at: new Date()
            }
          },
          { upsert: true }
        );
      }
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

initializeDatabase();