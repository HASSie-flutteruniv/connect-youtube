import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { processCommand } from '@/lib/youtube';

interface CommandRequest {
  command: string;
  username: string;
  videoId?: string;
  liveChatId?: string;
  authorId?: string;
  taskName?: string;
}

export const dynamic = 'force-dynamic'; 

/**
 * YouTube コマンド実行APIエンドポイント
 * コメント取得ロジックから分離され、コマンド処理のみを担当
 */
export async function POST(request: Request) {
  console.log('[API] Command execution request received');
  
  try {
    // リクエストボディを解析
    const body: CommandRequest = await request.json();
    const { command, username, videoId, liveChatId, authorId, taskName } = body;
    
    if (!command || !username) {
      console.error('[API] Invalid command request: Missing required fields');
      return NextResponse.json(
        { error: 'Missing required fields: command and username are required' },
        { status: 400 }
      );
    }
    
    console.log(`[API] Processing command: "${command}" from user: ${username}`);
    
    // MongoDBに接続
    const client = await clientPromise;
    const db = client.db('coworking');
    
    // commandを処理
    const result = await processCommand(command, username, db, videoId, liveChatId, authorId, taskName);
    
    // 結果を返却
    return NextResponse.json({ 
      success: true, 
      result,
      message: `Command '${command}' from ${username} processed successfully` 
    });
    
  } catch (error) {
    console.error('[API] Error processing command:', error);
    
    return NextResponse.json(
      { error: 'Failed to process command', details: (error as Error).message },
      { status: 500 }
    );
  }
} 