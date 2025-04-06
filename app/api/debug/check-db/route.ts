import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET(request: Request) {
  // セキュリティ上、本番環境ではこのAPIを無効化すべき
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This endpoint is only available in development' }, { status: 403 });
  }

  try {
    // MongoDBクライアントを取得
    const client = await clientPromise;
    const db = client.db('coworking');

    // URLからパラメータを取得
    const url = new URL(request.url);
    const command = url.searchParams.get('command');
    const username = url.searchParams.get('username');
    const profileImageUrl = url.searchParams.get('profileImageUrl');

    console.log(`[Debug API] Checking database for user: ${username}, command: ${command}`);
    console.log(`[Debug API] Profile image URL: ${profileImageUrl || 'none'}`);

    // ユーザー名に関連するレコードを取得
    const seats = await db.collection('seats')
      .find({ username: new RegExp(username || '', 'i') })
      .limit(10)
      .toArray();

    // 全ルームを取得（デバッグ用）
    const rooms = await db.collection('rooms')
      .find()
      .limit(10)
      .toArray();

    // 全ての席を取得してプロフィール画像がある席を数える
    const allSeats = await db.collection('seats')
      .find()
      .limit(100)
      .toArray();

    const seatsWithProfileImage = allSeats.filter(seat => 
      seat.profileImageUrl !== null && 
      seat.profileImageUrl !== undefined && 
      seat.profileImageUrl !== '');

    console.log(`[Debug API] Found ${seatsWithProfileImage.length} seats with profile images out of ${allSeats.length || 0} total seats`);
    
    if (seatsWithProfileImage.length > 0) {
      console.log('[Debug API] Sample seat with profile image:', {
        username: seatsWithProfileImage[0].username,
        profileImageUrl: seatsWithProfileImage[0].profileImageUrl,
        roomId: seatsWithProfileImage[0].room_id
      });
    }

    return NextResponse.json({
      message: `Database check completed for user: ${username}`,
      foundSeats: seats.length || 0,
      rooms: rooms.length || 0,
      seats: seats.map(seat => ({
        id: seat._id.toString(),
        username: seat.username,
        roomId: seat.room_id,
        authorId: seat.authorId,
        taskName: seat.task,
        profileImageUrl: seat.profileImageUrl,
        enterTime: seat.enterTime,
        timestamp: seat.timestamp
      })),
      totalSeats: allSeats.length || 0,
      seatsWithProfileImage: seatsWithProfileImage.length
    });
  } catch (error) {
    console.error('[Debug API] Unexpected error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
} 