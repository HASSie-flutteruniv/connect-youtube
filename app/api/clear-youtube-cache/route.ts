import { NextResponse } from 'next/server';
import { youtubeApiClient } from '@/lib/youtubeApiClient';

export async function POST(request: Request) {
  console.log('[API ClearCache] YouTube Negative Cacheクリアリクエストを受信');
  
  try {
    const body = await request.json();
    const videoId = body?.videoId;

    if (typeof videoId !== 'string' || !videoId.trim()) {
      console.warn('[API ClearCache] リクエストボディにvideoIdがないか無効です');
      return NextResponse.json({ error: 'videoIdが必要です' }, { status: 400 });
    }

    // YouTubeApiClient のメソッドを呼び出してキャッシュをクリア
    youtubeApiClient.clearNegativeCache(videoId.trim());

    console.log(`[API ClearCache] videoId: ${videoId.trim()} のNegative Cacheを正常にクリアしました`);
    return NextResponse.json({ 
      success: true, 
      message: `${videoId.trim()} のNegative Cacheをクリアしました` 
    });

  } catch (error) {
    console.error('[API ClearCache] リクエスト処理中にエラーが発生:', error);
    
    if (error instanceof SyntaxError) { // JSONパースエラーの場合
      return NextResponse.json({ 
        error: '無効なリクエストボディです' 
      }, { status: 400 });
    }
    
    return NextResponse.json({ 
      error: 'キャッシュクリア中にエラーが発生しました' 
    }, { status: 500 });
  }
} 