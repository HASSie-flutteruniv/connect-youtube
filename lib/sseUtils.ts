import { Db } from 'mongodb';

/**
 * MongoDB から部屋と座席のデータを取得し、クライアント用にフォーマットする
 * @param db MongoDB データベース接続
 * @returns フォーマットされた部屋と座席のデータ
 */
export async function fetchRoomData(db: Db) {
  console.log('[SSE:Utils] Fetching room data from MongoDB');
  try {
    // すべての座席を取得（部屋IDに関わらず）
    const allSeats = await db.collection('seats').find().toArray();
    console.log(`[SSE:Utils] Retrieved ${allSeats.length} total seats from database`);
    
    // プロフィール画像URLがある座席を探す
    const seatsWithProfileImage = allSeats.filter(seat => seat.profileImageUrl);
    if (seatsWithProfileImage.length > 0) {
      console.log(`[SSE:Utils] Found ${seatsWithProfileImage.length} seats with profile images in database:`);
      seatsWithProfileImage.forEach(seat => {
        console.log(`[SSE:Utils] Seat with profile image in DB: ${seat.username}, URL: ${seat.profileImageUrl}, room_id: ${seat.room_id}`);
      });
    } else {
      console.log(`[SSE:Utils] No seats with profile images found in database`);
    }
    
    // すべての部屋を取得
    const rooms = await db.collection('rooms').find().toArray();
    console.log(`[SSE:Utils] Retrieved ${rooms.length} rooms`);
    
    // 部屋IDごとの座席数を集計
    const seatsByRoomId = allSeats.reduce((acc, seat) => {
      const roomId = seat.room_id || 'unassigned';
      acc[roomId] = (acc[roomId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('[SSE:Utils] Seats count by room_id:', seatsByRoomId);
    
    // 通常の処理
    const seats = rooms.length > 0 ? allSeats : allSeats;
    
    // 最初の数件の生のシートデータをログに出力（デバッグ用）
    if (seats.length > 0) {
      console.log('[SSE:Utils] DEBUG - Raw seats data sample:');
      seats.slice(0, 3).forEach((seat, index) => {
        console.log(`Seat ${index}:`, JSON.stringify({
          _id: seat._id.toString(),
          username: seat.username,
          profileImageUrl: seat.profileImageUrl,
          room_id: seat.room_id,
          position: seat.position,
        }, null, 2));
      });
    }

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
          profileImageUrl: seat.profileImageUrl,
          timestamp: seat.timestamp
        }))
      };

      // 変換後のシートデータサンプルをログに出力
      console.log('[SSE:Utils] DEBUG - Transformed default room seats sample:');
      if (defaultRoom.seats.length > 0) {
        defaultRoom.seats.slice(0, 3).forEach((seat, index) => {
          console.log(`Transformed Seat ${index}:`, JSON.stringify(seat, null, 2));
        });
      }
      
      // プロフィール画像URLがある座席をログ出力
      const transformedSeatsWithImage = defaultRoom.seats.filter(seat => seat.profileImageUrl);
      if (transformedSeatsWithImage.length > 0) {
        console.log(`[SSE:Utils] Found ${transformedSeatsWithImage.length} transformed seats with profile images in default room:`);
        transformedSeatsWithImage.forEach(seat => {
          console.log(`[SSE:Utils] Transformed seat with profile image: ${seat.username}, URL: ${seat.profileImageUrl}`);
        });
      }

      return { rooms: [defaultRoom] };
    }

    // 部屋ごとに座席をマッピングする詳細ログ
    console.log('[SSE:Utils] Mapping seats to rooms...');
    rooms.forEach(room => {
      const roomSeats = seats.filter(seat => seat.room_id === room._id);
      console.log(`[SSE:Utils] Room ${room._id}: ${roomSeats.length} seats found`);
      
      // この部屋にプロフィール画像付きの座席があるか確認
      const roomSeatsWithImages = roomSeats.filter(seat => seat.profileImageUrl);
      if (roomSeatsWithImages.length > 0) {
        console.log(`[SSE:Utils] Room ${room._id} has ${roomSeatsWithImages.length} seats with profile images`);
      }
    });

    const roomsWithSeats = rooms.map(room => {
      // この部屋の座席を取得
      const roomSeats = seats
        .filter(seat => seat.room_id === room._id)
        .sort((a, b) => a.position - b.position);
        
      console.log(`[SSE:Utils] Processing room ${room._id} with ${roomSeats.length} seats`);
      
      // プロフィール画像URLがある座席をログ出力
      const seatsWithImages = roomSeats.filter(seat => seat.profileImageUrl);
      if (seatsWithImages.length > 0) {
        console.log(`[SSE:Utils] Room ${room._id} has ${seatsWithImages.length} seats with profile images before transform`);
      }
      
      // 座席データを変換
      const transformedSeats = roomSeats.map(seat => ({
        id: seat._id.toString(),
        username: seat.username,
        task: seat.task,
        enterTime: seat.enterTime,
        autoExitScheduled: seat.autoExitScheduled,
        profileImageUrl: seat.profileImageUrl,
        timestamp: seat.timestamp
      }));
      
      // 変換後にプロフィール画像URLがある座席をログ出力
      const transformedSeatsWithImages = transformedSeats.filter(seat => seat.profileImageUrl);
      if (transformedSeatsWithImages.length > 0) {
        console.log(`[SSE:Utils] Room ${room._id} has ${transformedSeatsWithImages.length} seats with profile images after transform`);
        transformedSeatsWithImages.forEach(seat => {
          console.log(`[SSE:Utils] Transformed seat with profile image: ${seat.username}, URL: ${seat.profileImageUrl}`);
        });
      }
      
      return {
        id: room._id,
        seats: transformedSeats
      };
    });

    // 変換後のデータサンプルをログに出力
    console.log('[SSE:Utils] DEBUG - Transformed rooms data sample:');
    if (roomsWithSeats.length > 0 && roomsWithSeats[0].seats.length > 0) {
      const sampleSeats = roomsWithSeats[0].seats.slice(0, 3);
      console.log(`Room ${roomsWithSeats[0].id} sample seats:`, 
        JSON.stringify(sampleSeats, null, 2));
    }

    console.log('[SSE:Utils] Room data formatted successfully');
    // プロフィール画像URLの例をログに出力（デバッグ用）
    if (seats.length > 0 && seats.some(seat => seat.profileImageUrl)) {
      const exampleSeat = seats.find(seat => seat.profileImageUrl);
      console.log(`[SSE:Utils] DEBUG - Example profile image URL: ${exampleSeat?.profileImageUrl}`);
      
      // JSON形式でログ出力
      console.log('[SSE:Utils] DEBUG - Seat with profile image:', 
        JSON.stringify({
          _id: exampleSeat?._id.toString(),
          username: exampleSeat?.username,
          profileImageUrl: exampleSeat?.profileImageUrl,
          room_id: exampleSeat?.room_id
        }, null, 2));
    } else {
      console.log('[SSE:Utils] DEBUG - No profile image URLs found in seats data');
    }
    
    // 最終的な結果にプロフィール画像URLがある座席があるか確認
    let totalSeatsWithProfileImages = 0;
    roomsWithSeats.forEach(room => {
      const roomSeatsWithImages = room.seats.filter(seat => seat.profileImageUrl);
      totalSeatsWithProfileImages += roomSeatsWithImages.length;
    });
    
    if (totalSeatsWithProfileImages > 0) {
      console.log(`[SSE:Utils] Final data has ${totalSeatsWithProfileImages} seats with profile images`);
    } else {
      console.log(`[SSE:Utils] Final data has NO seats with profile images`);
    }
    
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

  private constructor() {}

  public static getInstance(): ChangeStreamManager {
    if (!ChangeStreamManager.instance) {
      ChangeStreamManager.instance = new ChangeStreamManager();
    }
    return ChangeStreamManager.instance;
  }

  /**
   * 新しいSSE接続を登録する
   * @returns 登録後のアクティブ接続数
   */
  public registerConnection(): number {
    this.activeConnections++;
    console.log(`[SSE:Manager] New connection registered. Active connections: ${this.activeConnections}`);
    // 最初の接続が登録されたことを示すフラグを返す
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
   * 現在のアクティブな接続数を取得する
   * @returns アクティブな接続数
   */
  public getActiveConnections(): number {
    return this.activeConnections;
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