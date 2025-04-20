import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

// お知らせデータの型（必要であれば拡張）
interface Announcement {
  _id: string; // MongoDBが自動生成するID
  message: string;
  authorChannelId: string;
  authorName?: string;
  profileImageUrl?: string;
  publishedAt: Date;
  createdAt: Date;
}

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('coworking');
    const announcementsCollection = db.collection<Announcement>('announcements');

    // createdAtで降順ソートし、最新20件を取得
    const announcements = await announcementsCollection
      .find()
      .sort({ createdAt: -1 }) // 最新のものを上に
      .limit(10)
      .toArray();

    return NextResponse.json(announcements);
  } catch (error) {
    console.error('[Announcements API] お知らせ取得エラー:', error); // エラーログを改善
    return NextResponse.json({ error: 'お知らせの取得に失敗しました' }, { status: 500 });
  }
} 