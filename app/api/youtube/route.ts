import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { processYouTubeComment } from '@/lib/youtube';

interface YouTubeCommentRequest {
  comment: string;
  authorName: string;
  authorId: string;
  commentId: string;
  videoId?: string;
}

export async function POST(request: Request) {
  console.log('[YouTube API] コメントリクエスト受信');
  
  try {
    // リクエストボディを解析
    const body: YouTubeCommentRequest = await request.json();
    const { comment, authorName, authorId, commentId, videoId } = body;
    
    if (!comment || !authorName || !authorId || !commentId) {
      console.error('[YouTube API] 無効なリクエスト: 必須フィールドが不足');
      return NextResponse.json(
        { error: '必須フィールドが不足しています: comment, authorName, authorId, commentId が必要です' },
        { status: 400 }
      );
    }
    
    console.log(`[YouTube API] コメント処理: "${comment}" from ${authorName} (ID: ${authorId})`);
    
    // MongoDBに接続
    const client = await clientPromise;
    const db = client.db('coworking');
    
    // コメントからコマンドを抽出して処理
    const result = await processYouTubeComment(comment, authorName, authorId, db, videoId);
    
    // コマンドでない場合は処理不要
    if (!result.success && result.message === 'コメントはコマンドではありません') {
      console.log('[YouTube API] コメントはコマンドではないため、処理をスキップします');
      return NextResponse.json({ 
        success: false, 
        ignored: true,
        message: 'コメントはコマンドではないため、処理されませんでした' 
      });
    }
    
    // エラーが発生した場合
    if (!result.success) {
      console.error('[YouTube API] コマンド処理エラー:', result.error);
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'コマンド処理に失敗しました' 
        },
        { status: 500 }
      );
    }
    
    // 成功レスポンス
    return NextResponse.json({ 
      success: true, 
      result: result.result,
      message: `コメント: "${comment}" からのコマンドを正常に処理しました` 
    });
    
  } catch (error) {
    console.error('[YouTube API] リクエスト処理エラー:', error);
    
    return NextResponse.json(
      { error: 'コメント処理に失敗しました', details: (error as Error).message },
      { status: 500 }
    );
  }
} 