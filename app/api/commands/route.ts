import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { processCommand } from '@/lib/commandProcessor';

interface CommandRequest {
  command: string;
  username: string;
  taskName?: string;
  authorId?: string;
  videoId?: string;
  profileImageUrl?: string;
}

export const dynamic = 'force-dynamic'; 

/**
 * YouTube コマンド実行APIエンドポイント
 * コメント取得ロジックから分離され、コマンド処理のみを担当
 */
export async function POST(request: Request) {
  console.log('[Command API] Command request received');
  
  try {
    const body: CommandRequest = await request.json();
    const { command, username, taskName, authorId, videoId, profileImageUrl } = body;
    
    if (!command || !username) {
      console.error('[Command API] Invalid request: missing required fields');
      return NextResponse.json(
        { error: 'Command and username are required' },
        { status: 400 }
      );
    }
    
    console.log(`[Command API] Processing command: ${command} from ${username}`);
    
    // デバッグ用: リクエストの全内容を表示
    console.log('[Command API] Request details:', JSON.stringify({
      command,
      username,
      taskName,
      authorId,
      videoId,
      hasProfileImage: !!profileImageUrl
    }, null, 2));
    
    if (profileImageUrl) {
      console.log(`[Command API] Profile image URL provided for ${username}: ${profileImageUrl}`);
    }
    
    const client = await clientPromise;
    const db = client.db('coworking');
    
    const result = await processCommand(command, username, db, videoId, undefined, authorId, taskName, profileImageUrl);
    
    return NextResponse.json({
      success: true,
      result,
      message: `${command} command executed successfully`
    });
  } catch (error) {
    console.error('[Command API] Error processing command:', error);
    
    return NextResponse.json(
      { error: 'Failed to execute command', details: (error as Error).message },
      { status: 500 }
    );
  }
} 