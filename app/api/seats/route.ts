import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

// このAPIルートを動的に処理するための設定
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { roomId, position, username } = await request.json();
    const client = await clientPromise;
    const db = client.db('coworking');

    const result = await db.collection('seats').findOneAndUpdate(
      { room_id: roomId, position: position },
      {
        $set: {
          username: username,
          timestamp: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}