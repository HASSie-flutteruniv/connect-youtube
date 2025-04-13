import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { formatCurrentDateTime } from '@/lib/autoExit';

export const dynamic = 'force-dynamic';

/**
 * 座席利用履歴を取得するAPIエンドポイント
 * ?username=名前 または ?authorId=ID のクエリパラメーターで指定されたユーザーの履歴を取得する
 * 
 * @param request リクエストオブジェクト
 * @returns 座席利用履歴のJSON
 */
export async function GET(request: Request) {
  try {
    // URLからクエリパラメータを取得
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const authorId = searchParams.get('authorId');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    
    // usernameかauthorIdのいずれかが必要
    if (!username && !authorId) {
      return NextResponse.json(
        { error: 'username または authorId パラメータが必要です' },
        { status: 400 }
      );
    }
    
    const client = await clientPromise;
    const db = client.db('coworking');
    
    // 検索条件を構築
    const query: Record<string, any> = {};
    if (username) {
      query.username = username;
    }
    if (authorId) {
      query.authorId = authorId;
    }
    
    console.log(`[SeatHistory] 検索条件: ${JSON.stringify(query)}`);
    
    // 履歴を取得（最新順）
    const history = await db.collection('seats')
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    console.log(`[SeatHistory] ${history.length}件の履歴を取得しました`);
    
    // 変換後のデータ形式
    const formattedHistory = history.map(seat => ({
      id: seat._id.toString(),
      position: seat.position,
      username: seat.username,
      task: seat.task,
      isActive: seat.is_active,
      enterTime: seat.enterTime ? new Date(seat.enterTime).toISOString() : null,
      exitTime: seat.exitTime ? new Date(seat.exitTime).toISOString() : null,
      duration: calculateDuration(seat.enterTime, seat.exitTime),
      timestamp: seat.timestamp ? new Date(seat.timestamp).toISOString() : null
    }));
    
    return NextResponse.json({ 
      success: true,
      history: formattedHistory,
      totalCount: formattedHistory.length
    });
  } catch (error) {
    console.error('[SeatHistory] エラー:', error);
    return NextResponse.json(
      { error: '履歴の取得に失敗しました', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 入室時間と退室時間から利用時間を計算する
 * @param enterTime 入室時間
 * @param exitTime 退室時間
 * @returns フォーマットされた利用時間の文字列、または null
 */
function calculateDuration(enterTime: Date | null, exitTime: Date | null): string | null {
  if (!enterTime) return null;
  
  // 退室時間が未設定の場合は現在時刻を使用
  const end = exitTime ? new Date(exitTime) : new Date();
  const start = new Date(enterTime);
  
  // ミリ秒単位での差分を計算
  const diffMs = end.getTime() - start.getTime();
  
  // 負の値の場合はnullを返す（データ不整合）
  if (diffMs < 0) return null;
  
  // 時間、分、秒に変換
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}時間${minutes > 0 ? ` ${minutes}分` : ''}`;
  } else {
    return `${minutes}分`;
  }
} 