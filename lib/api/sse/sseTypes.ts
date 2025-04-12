/**
 * SSE関連の型定義を集約したファイル
 */
import { RoomData } from '@/hooks/use-seat-data';

/**
 * SSE接続の状態を表す型
 */
export type SSEConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

/**
 * システムメッセージの型
 */
export interface SystemMessage {
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: string;
  id?: string;
}

/**
 * SSEを通じて送信される座席データの型
 */
export interface SSEData {
  rooms: RoomData[];
  error?: string;
} 