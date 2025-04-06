import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

interface ExtendRequest {
  roomId: string;
  position: number;
  hours?: number;
}

/**
 * 指定された部屋・位置のユーザーの自動退室時間を延長する
 */
export async function POST(request: Request) {
  try {
    // リクエストボディを解析
    const body: ExtendRequest = await request.json();
    const { roomId, position, hours = 2 } = body;
    
    if (!roomId || position === undefined) {
      return NextResponse.json(
        { success: false, error: '部屋IDと座席位置が必要です' },
        { status: 400 }
      );
    }
    
    console.log(`[API] 自動退室時間延長: 部屋${roomId}、座席${position}を${hours}時間延長`);
    
    // MongoDBに接続
    const client = await clientPromise;
    const db = client.db('coworking');
    const seatsCollection = db.collection('seats');
    
    // 座席情報を取得
    const seat = await seatsCollection.findOne({
      room_id: roomId,
      position: position
    });
    
    if (!seat || !seat.username) {
      return NextResponse.json(
        { success: false, error: '指定された座席が見つからないか、ユーザーが着席していません' },
        { status: 404 }
      );
    }
    
    // 入室時間から自動退室時間を計算
    const now = new Date();
    const autoExitTime = new Date(now);
    autoExitTime.setHours(autoExitTime.getHours() + hours);
    
    // 自動退室時間を更新
    await seatsCollection.updateOne(
      { _id: seat._id },
      { $set: { autoExitScheduled: autoExitTime } }
    );
    
    console.log(`[API] ${seat.username}の自動退室を${autoExitTime.toISOString()}に延長しました`);
    
    return NextResponse.json({
      success: true,
      message: '自動退室時間を延長しました',
      username: seat.username,
      newTime: autoExitTime.toISOString(),
      formattedTime: autoExitTime.toLocaleString()
    });
    
  } catch (error) {
    console.error('[API] 自動退室時間延長中にエラーが発生:', error);
    
    return NextResponse.json(
      { success: false, error: '自動退室時間の延長に失敗しました', details: (error as Error).message },
      { status: 500 }
    );
  }
} 