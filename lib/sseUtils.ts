import { Db } from 'mongodb';

/**
 * MongoDB から座席データを取得し、クライアント用にフォーマットする
 * @param db MongoDB データベース接続
 * @returns フォーマットされた座席のデータ
 */
export async function fetchRoomData(db: Db) {
  console.log('[SSE:Utils] Fetching seat data from MongoDB');
  try {
    // 接続チェック - pingコマンドで接続状態を確認
    try {
      await db.command({ ping: 1 });
    } catch (pingError) {
      console.warn('[SSE:Utils] MongoDB connection check failed:', pingError);
      throw new Error('MongoDB connection not available');
    }

    // アクティブな座席のみを取得
    const allSeats = await db.collection('seats').find({ is_active: true }).toArray();
    console.log(`[SSE:Utils] Retrieved ${allSeats.length} active seats from database`);
    
    // プロフィール画像URLがある座席を探す（デバッグ用）
    const seatsWithProfileImage = allSeats.filter(seat => seat.profileImageUrl);
    if (seatsWithProfileImage.length > 0) {
      console.log(`[SSE:Utils] Found ${seatsWithProfileImage.length} seats with profile images in database:`);
      seatsWithProfileImage.forEach(seat => {
        console.log(`[SSE:Utils] Seat with profile image in DB: ${seat.username}, URL: ${seat.profileImageUrl}`);
      });
    } else {
      console.log(`[SSE:Utils] No seats with profile images found in database`);
    }
    
    // 最初の数件の生のシートデータをログに出力（デバッグ用）
    if (allSeats.length > 0) {
      console.log('[SSE:Utils] DEBUG - Raw seats data sample:');
      allSeats.slice(0, 3).forEach((seat, index) => {
        console.log(`Seat ${index}:`, JSON.stringify({
          _id: seat._id.toString(),
          username: seat.username,
          profileImageUrl: seat.profileImageUrl,
          position: seat.position,
          is_active: seat.is_active
        }, null, 2));
      });
    }

    // シートをフォーカスルームに集約する
    const focusRoom = {
      id: 'focus-room',
      type: 'focus',
      seats: allSeats.filter(seat => seat.username).map(seat => ({
        id: seat._id.toString(),
        username: seat.username,
        task: seat.task,
        enterTime: seat.enterTime,
        autoExitScheduled: seat.autoExitScheduled,
        profileImageUrl: seat.profileImageUrl,
        timestamp: seat.timestamp
      }))
    };
    
    // 変換後のシートデータサンプルをログに出力
    console.log(`[SSE:Utils] Created focus room with ${focusRoom.seats.length} occupied seats`);
    console.log('[SSE:Utils] DEBUG - Transformed seats sample:');
    if (focusRoom.seats.length > 0) {
      focusRoom.seats.slice(0, 3).forEach((seat, index) => {
        console.log(`Transformed Seat ${index}:`, JSON.stringify(seat, null, 2));
      });
    }
    
    // プロフィール画像URLがある座席をログ出力
    const transformedSeatsWithImage = focusRoom.seats.filter(seat => seat.profileImageUrl);
    if (transformedSeatsWithImage.length > 0) {
      console.log(`[SSE:Utils] Found ${transformedSeatsWithImage.length} transformed seats with profile images:`);
      transformedSeatsWithImage.forEach(seat => {
        console.log(`[SSE:Utils] Transformed seat with profile image: ${seat.username}, URL: ${seat.profileImageUrl}`);
      });
    }

    console.log('[SSE:Utils] Seat data formatted successfully');
    return { rooms: [focusRoom] };
  } catch (error) {
    console.error('[SSE:Utils] Error fetching seat data:', error);
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
 * @param id オプションのメッセージID
 * @returns フォーマットされたSSEメッセージ
 */
export function createSystemMessage(message: string, type: 'info' | 'warning' | 'error' = 'info', id?: string): string {
  const payload: { message: string; type: string; timestamp: string; id?: string } = {
    message,
    type,
    timestamp: new Date().toISOString(),
  };
  if (id) {
    payload.id = id;
  }
  return `event: system-message\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * MongoDB Change Streamの接続状態を追跡するためのクラス
 * グローバルな状態を管理し、複数のSSE接続間で自動退室チェックの重複を防ぐ
 */
export class ChangeStreamManager {
  private static instance: ChangeStreamManager;
  private activeConnections: number = 0;
  private connectionIds: Set<string> = new Set(); // 接続IDを追跡するためのセット

  private constructor() {}

  public static getInstance(): ChangeStreamManager {
    if (!ChangeStreamManager.instance) {
      ChangeStreamManager.instance = new ChangeStreamManager();
    }
    return ChangeStreamManager.instance;
  }

  /**
   * 新しいSSE接続を登録する
   * @returns 登録後の接続ID
   */
  public registerConnection(): string {
    this.activeConnections++;
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    this.connectionIds.add(connectionId);
    console.log(`[SSE:Manager] New connection registered. ID: ${connectionId}, Active connections: ${this.activeConnections}, Total tracked: ${this.connectionIds.size}`);
    return connectionId;
  }

  /**
   * 特定のSSE接続の終了を登録する
   * @param connectionId 接続ID
   * @returns 残りのアクティブ接続数
   */
  public unregisterConnection(connectionId?: string): number {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    
    if (connectionId && this.connectionIds.has(connectionId)) {
      this.connectionIds.delete(connectionId);
      console.log(`[SSE:Manager] Connection ${connectionId} unregistered. Active connections: ${this.activeConnections}, Total tracked: ${this.connectionIds.size}`);
    } else {
      console.log(`[SSE:Manager] Unknown connection unregistered. Active connections: ${this.activeConnections}, Total tracked: ${this.connectionIds.size}`);
    }
    
    return this.activeConnections;
  }

  /**
   * すべての接続情報をログに出力
   */
  public logConnectionStatus(): void {
    console.log(`[SSE:Manager] Current connection status - Active count: ${this.activeConnections}, Tracked connections: ${this.connectionIds.size}`);
    console.log(`[SSE:Manager] Connection IDs: ${Array.from(this.connectionIds).join(', ')}`);
  }

  /**
   * 現在のアクティブな接続数を取得する
   * @returns アクティブな接続数
   */
  public getActiveConnections(): number {
    return this.activeConnections;
  }

  /**
   * 追跡中の接続数を取得する
   * @returns 追跡中の接続数
   */
  public getTrackedConnectionsCount(): number {
    return this.connectionIds.size;
  }

  /**
   * このインスタンスで自動退室チェックを開始すべきか判断する
   * (通常、最初の接続時にtrueを返す)
   * @returns 開始すべきならtrue
   */
  public shouldStartAutoExitCheckOnRegister(): boolean {
    // activeConnectionsがインクリメントされた直後に呼ばれる想定
    return this.activeConnections === 1;
  }
} 