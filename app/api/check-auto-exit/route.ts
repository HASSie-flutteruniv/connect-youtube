import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { checkAndProcessAutoExit } from '@/lib/autoExit';
import { Db } from 'mongodb';

/**
 * POST /api/check-auto-exit
 * 自動退室チェックを実行するAPIエンドポイント
 */
export async function POST(request: Request) {
  console.log('[API CheckAutoExit] 自動退室チェックリクエスト(POST)を受信');
  
  try {
    let sendNotification = false;
    try {
        const body = await request.json();
        sendNotification = body?.sendNotification === true;
    } catch (parseError) {
        console.log('[API CheckAutoExit] POSTリクエストボディの解析に失敗、またはボディなし。sendNotification=false で実行します。');
    }

    const client = await clientPromise;
    const db = client.db('coworking'); // DB接続 (Db型を使用)
    
    // インポートした checkAndProcessAutoExit を使用
    const result = await checkAndProcessAutoExit(db, sendNotification);
    
    console.log(`[API CheckAutoExit] 自動退室チェック完了 (POST)。処理件数: ${result.processedCount}`);
    
    return NextResponse.json({
      success: true, 
      processedCount: result.processedCount,
      details: result.details
    });
    
  } catch (error) {
    console.error('[API CheckAutoExit] 自動退室チェック中にエラーが発生 (POST):', error);
    
    return NextResponse.json(
      { 
          error: '自動退室チェックに失敗しました', 
          details: error instanceof Error ? error.message : '不明なエラー' 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/check-auto-exit
 * システムからの定期実行用エンドポイント (例: Cron Job)
 */
export async function GET() {
  console.log('[API CheckAutoExit] 自動退室チェックリクエスト(GET)を受信 (システム実行)');
  
  try {
    const client = await clientPromise;
    const db = client.db('coworking'); // DB接続 (Db型を使用)
    
    // インポートした checkAndProcessAutoExit を使用 (通知は true で固定)
    const result = await checkAndProcessAutoExit(db, true); 
    
    console.log(`[API CheckAutoExit] 自動退室チェック完了 (GET)。処理件数: ${result.processedCount}`);

    return NextResponse.json({
      success: true, 
      processedCount: result.processedCount,
      details: result.details
    });
    
  } catch (error) {
    console.error('[API CheckAutoExit] 自動退室チェック中にエラーが発生 (GET):', error);
    
     return NextResponse.json(
      { 
          error: '自動退室チェックに失敗しました', 
          details: error instanceof Error ? error.message : '不明なエラー' 
      },
      { status: 500 }
    );
  }
} 