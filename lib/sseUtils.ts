import { Db } from 'mongodb';

/**
 * MongoDB から部屋と座席のデータを取得し、クライアント用にフォーマットする
 * @param db MongoDB データベース接続
 * @returns フォーマットされた部屋と座席のデータ
 */
export async function fetchRoomData(db: Db) {
  console.log('[SSE:Utils] Fetching room data from MongoDB');
  try {
    const rooms = await db.collection('rooms').find().toArray();
    console.log(`[SSE:Utils] Retrieved ${rooms.length} rooms`);
    const seats = await db.collection('seats').find().toArray();
    console.log(`[SSE:Utils] Retrieved ${seats.length} seats`);

    // roomsが空の場合は、シートを直接配列の最初の要素として使用する
    if (rooms.length === 0) {
      console.log('[SSE:Utils] No rooms found, creating a default room with all seats');
      const defaultRoom = {
        id: 'focus-room',
        type: 'focus',
        seats: seats.map(seat => ({
          id: seat._id.toString(),
          username: seat.username,
          task: seat.task,
          enterTime: seat.enterTime,
          autoExitScheduled: seat.autoExitScheduled,
          timestamp: seat.timestamp
        }))
      };
      return { rooms: [defaultRoom] };
    }

    const roomsWithSeats = rooms.map(room => ({
      id: room._id,
      seats: seats
        .filter(seat => seat.room_id === room._id)
        .sort((a, b) => a.position - b.position)
        .map(seat => ({
          id: seat._id.toString(),
          username: seat.username,
          task: seat.task,
          enterTime: seat.enterTime,
          autoExitScheduled: seat.autoExitScheduled,
          timestamp: seat.timestamp
        }))
    }));

    console.log('[SSE:Utils] Room data formatted successfully');
    return { rooms: roomsWithSeats };
  } catch (error) {
    console.error('[SSE:Utils] Error fetching room data:', error);
    return { rooms: [], error: 'Failed to fetch data' };
  }
}

/**
 * 指数バックオフ付きの再接続試行回数とタイムアウトを計算する
 * @param retryCount 現在の試行回数
 * @param baseDelay 基本の待機時間（ミリ秒）
 * @param maxDelay 最大待機時間（ミリ秒）
 * @returns 次回待機時間（ミリ秒）
 */
export function calculateBackoff(retryCount: number, baseDelay: number = 1000, maxDelay: number = 30000): number {
  // 指数バックオフ（2のべき乗）とランダム要素（ジッター）を加える
  const exponentialDelay = Math.min(
    maxDelay,
    baseDelay * Math.pow(2, retryCount) * (1 + Math.random() * 0.2)
  );
  return Math.round(exponentialDelay);
}

/**
 * システムメッセージをクライアントに送信するためのSSEメッセージを生成する
 * @param message メッセージ内容
 * @param type メッセージタイプ（info, warning, error など）
 * @returns フォーマットされたSSEメッセージ
 */
export function createSystemMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): string {
  return `event: system-message\ndata: ${JSON.stringify({ message, type, timestamp: new Date().toISOString() })}\n\n`;
}

/**
 * MongoDB Change Streamの接続状態を追跡するためのクラス
 * グローバルな状態を管理し、複数のSSE接続間で自動退室チェックの重複を防ぐ
 */
export class ChangeStreamManager {
  private static instance: ChangeStreamManager;
  private activeConnections: number = 0;
  private isAutoExitRunning: boolean = false;
  private autoExitInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): ChangeStreamManager {
    if (!ChangeStreamManager.instance) {
      ChangeStreamManager.instance = new ChangeStreamManager();
    }
    return ChangeStreamManager.instance;
  }

  /**
   * 新しいSSE接続を登録する
   * @returns 現在のアクティブ接続数
   */
  public registerConnection(): number {
    this.activeConnections++;
    console.log(`[SSE:Manager] New connection registered. Active connections: ${this.activeConnections}`);
    return this.activeConnections;
  }

  /**
   * SSE接続の終了を登録する
   * @returns 残りのアクティブ接続数
   */
  public unregisterConnection(): number {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    console.log(`[SSE:Manager] Connection unregistered. Active connections: ${this.activeConnections}`);
    return this.activeConnections;
  }

  /**
   * 自動退室チェックの開始を試みる
   * @param db MongoDB データベース接続
   * @param checkFn 自動退室チェック関数
   * @returns すでに別の接続で実行中の場合はfalse、新規に開始した場合はtrue
   */
  public startAutoExitCheck(db: Db, checkFn: () => Promise<void>): boolean {
    // すでに自動退室チェックが実行中の場合は重複して開始しない
    if (this.isAutoExitRunning && this.autoExitInterval) {
      console.log('[SSE:Manager] Auto-exit check is already running in another connection');
      return false;
    }

    // 自動退室チェックを開始
    this.isAutoExitRunning = true;
    this.autoExitInterval = setInterval(async () => {
      try {
        if (this.isAutoExitRunning) {
          await checkFn();
        }
      } catch (error) {
        console.error('[SSE:Manager] Error in auto-exit check interval:', error);
      }
    }, 60000); // 1分ごと

    console.log('[SSE:Manager] Started auto-exit check interval');
    return true;
  }

  /**
   * 自動退室チェックを停止する
   * 最後の接続が終了した場合のみ実際に停止する
   */
  public stopAutoExitCheck(): void {
    if (this.activeConnections <= 0 && this.autoExitInterval) {
      clearInterval(this.autoExitInterval);
      this.autoExitInterval = null;
      this.isAutoExitRunning = false;
      console.log('[SSE:Manager] Stopped auto-exit check interval (no active connections)');
    } else {
      console.log(`[SSE:Manager] Not stopping auto-exit check - ${this.activeConnections} connections still active`);
    }
  }

  /**
   * 自動退室チェックが実行中かどうかを返す
   */
  public isAutoExitCheckRunning(): boolean {
    return this.isAutoExitRunning;
  }
} 