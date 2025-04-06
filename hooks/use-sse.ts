import { useState, useEffect, useRef, useCallback } from 'react';

export type SSEConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

interface SystemMessage {
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: string;
}

interface SSEHookOptions {
  endpoint: string;
  onSystemMessage?: (message: SystemMessage) => void;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  maxRetries?: number;
  initialBackoffDelay?: number;
  maxBackoffDelay?: number;
}

interface SSEHookResult<T> {
  data: T | null;
  connectionState: SSEConnectionState;
  lastSystemMessage: SystemMessage | null;
  connect: () => void;
  disconnect: () => void;
  isReconnecting: boolean;
  retryCount: number;
}

/**
 * Server-Sent Events (SSE) のカスタムフック
 * 指数バックオフによる再接続ロジックとエラーハンドリングを実装
 */
export function useSSE<T = any>(options: SSEHookOptions): SSEHookResult<T> {
  const {
    endpoint,
    onSystemMessage,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    maxRetries = 10,
    initialBackoffDelay = 1000,
    maxBackoffDelay = 60000,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [connectionState, setConnectionState] = useState<SSEConnectionState>('connecting');
  const [lastSystemMessage, setLastSystemMessage] = useState<SystemMessage | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 指数バックオフの待機時間を計算
   */
  const calculateBackoff = useCallback((retry: number) => {
    // 2のべき乗で待機時間を増やし、最大値でキャップ
    const exponentialDelay = Math.min(
      maxBackoffDelay,
      initialBackoffDelay * Math.pow(2, retry) * (1 + Math.random() * 0.2) // ジッターを加える
    );
    return Math.round(exponentialDelay);
  }, [initialBackoffDelay, maxBackoffDelay]);

  /**
   * SSE接続を開始
   */
  const connect = useCallback(() => {
    // 既存の接続があれば閉じる
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // 接続中の状態に更新
    setConnectionState(isReconnecting ? 'reconnecting' : 'connecting');

    try {
      const eventSource = new EventSource(endpoint);
      eventSourceRef.current = eventSource;

      // 接続時のハンドラ
      eventSource.onopen = () => {
        console.log('[SSE:Hook] Connection established');
        setConnectionState('connected');
        setIsReconnecting(false);
        setRetryCount(0);
        onConnect?.();
      };

      // 通常メッセージのハンドラ
      eventSource.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data);
          setData(parsedData);
          onMessage?.(parsedData);
        } catch (err) {
          console.error('[SSE:Hook] Error parsing SSE data:', err, event.data);
        }
      };

      // システムメッセージのハンドラ
      eventSource.addEventListener('system-message', (event: MessageEvent) => {
        try {
          const systemMessage = JSON.parse(event.data) as SystemMessage;
          setLastSystemMessage(systemMessage);
          onSystemMessage?.(systemMessage);
          
          console.log(`[SSE:Hook] System message received: ${systemMessage.message} (${systemMessage.type})`);
        } catch (err) {
          console.error('[SSE:Hook] Error parsing system message:', err, event.data);
        }
      });

      // エラーハンドラ
      eventSource.onerror = (error) => {
        console.error('[SSE:Hook] Connection error:', error);
        
        // 接続が切れた場合
        if (eventSource.readyState === EventSource.CLOSED) {
          setConnectionState('disconnected');
          onDisconnect?.();
          
          // 最大再試行回数を超えていない場合は再接続を試みる
          if (retryCount < maxRetries) {
            const nextRetryCount = retryCount + 1;
            setRetryCount(nextRetryCount);
            setIsReconnecting(true);
            
            const delayMs = calculateBackoff(nextRetryCount);
            console.log(`[SSE:Hook] Will attempt to reconnect in ${delayMs}ms (retry ${nextRetryCount}/${maxRetries})`);
            
            // 指定時間後に再接続
            reconnectTimeoutRef.current = setTimeout(() => {
              if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
                console.log(`[SSE:Hook] Attempting to reconnect (retry ${nextRetryCount}/${maxRetries})`);
                connect();
              }
            }, delayMs);
          } else {
            console.error(`[SSE:Hook] Maximum reconnection attempts (${maxRetries}) reached`);
            setConnectionState('error');
          }
        }
        
        onError?.(error);
      };
    } catch (err) {
      console.error('[SSE:Hook] Failed to create EventSource:', err);
      setConnectionState('error');
    }
  }, [
    endpoint, 
    isReconnecting, 
    retryCount, 
    maxRetries, 
    calculateBackoff, 
    onConnect, 
    onMessage, 
    onSystemMessage,
    onDisconnect,
    onError
  ]);

  /**
   * SSE接続を閉じる
   */
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      console.log('[SSE:Hook] Closing connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState('disconnected');
    onDisconnect?.();
  }, [onDisconnect]);

  // コンポーネントマウント時にSSE接続を開始
  useEffect(() => {
    connect();

    // クリーンアップ時に接続を閉じる
    return () => {
      disconnect();
    };
  }, [endpoint]);

  return {
    data,
    connectionState,
    lastSystemMessage,
    connect,
    disconnect,
    isReconnecting,
    retryCount
  };
} 