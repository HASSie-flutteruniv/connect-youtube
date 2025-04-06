import { useState, useCallback } from 'react';
import { useSSE, SSEConnectionState } from './use-sse';
import { toast } from './use-toast';

export interface Seat {
  id: string;
  username: string | null;
  task?: string | null;
  enterTime?: Date | string | null;
  autoExitScheduled?: Date | string | null;
  timestamp: Date | string;
}

export interface RoomData {
  id: string;
  seats: Seat[];
  type?: 'focus' | 'chat';
}

interface SSEData {
  rooms: RoomData[];
  error?: string;
}

interface UseSeatDataResult {
  rooms: RoomData[];
  isLoading: boolean;
  connectionState: SSEConnectionState;
  refreshData: () => void;
}

/**
 * 座席データ管理のためのカスタムフック
 * SSE接続とデータ処理を行う
 */
export function useSeatData(): UseSeatDataResult {
  const [rooms, setRooms] = useState<RoomData[]>([]);

  // システムメッセージを処理するコールバック
  const handleSystemMessage = useCallback((message: { message: string; type: 'info' | 'warning' | 'error' }) => {
    // トースト通知を表示
    toast({
      title: message.type === 'error' ? 'エラー' : 
             message.type === 'warning' ? '警告' : 'お知らせ',
      description: message.message,
      variant: message.type === 'error' ? 'destructive' : 'default',
    });
  }, []);

  // SSEデータを処理するコールバック
  const handleMessage = useCallback((data: SSEData) => {
    if (data.rooms && Array.isArray(data.rooms)) {
      console.log(`[SeatData] Received ${data.rooms.length} rooms from SSE`);
      setRooms(data.rooms);
    } else if (data.error) {
      console.error('[SeatData] Error in SSE data:', data.error);
      toast({
        title: 'データ取得エラー',
        description: data.error,
        variant: 'destructive',
      });
    }
  }, []);

  // SSE接続を使用してデータを取得
  const { 
    data,
    connectionState,
    connect: refreshData
  } = useSSE<SSEData>({
    endpoint: '/api/sse',
    onMessage: handleMessage,
    onSystemMessage: handleSystemMessage,
    onConnect: () => {
      console.log('[SeatData] SSE connection established');
    },
    onDisconnect: () => {
      console.log('[SeatData] SSE connection closed');
    },
    onError: (error) => {
      console.error('[SeatData] SSE connection error:', error);
    },
    maxRetries: 5, // 最大再試行回数
    initialBackoffDelay: 2000, // 初期バックオフ（2秒）
    maxBackoffDelay: 30000, // 最大バックオフ（30秒）
  });

  // 接続状態からローディング状態を判断
  const isLoading = 
    connectionState === 'connecting' || 
    connectionState === 'reconnecting' || 
    (connectionState === 'connected' && !data);

  return {
    rooms,
    isLoading,
    connectionState,
    refreshData
  };
} 