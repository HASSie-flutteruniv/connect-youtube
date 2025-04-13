import { useState, useEffect, useRef, useCallback } from 'react';
import { SSEClient, SSEClientOptions } from '@/lib/api/sse/sseClient';
import { SSEConnectionState, SystemMessage } from '@/lib/api/sse/sseTypes';

interface UseSSEResult<T> {
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
export function useSSE<T = any>(options: SSEClientOptions): UseSSEResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [connectionState, setConnectionState] = useState<SSEConnectionState>('connecting');
  const [lastSystemMessage, setLastSystemMessage] = useState<SystemMessage | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const clientRef = useRef<SSEClient | null>(null);
  // オプションへの安定参照
  const optionsRef = useRef<SSEClientOptions>(options);
  const isFirstRenderRef = useRef(true);
  
  // オプションの更新
  useEffect(() => {
    // 初回レンダリング時はスキップ（マウント時に接続するためのuseEffectに任せる）
    if (isFirstRenderRef.current) {
      console.log('[SSE:Hook] First render, skipping options update');
      isFirstRenderRef.current = false;
      return;
    }
    
    // オプションの変更が本質的でない場合はスキップ
    const isSignificantChange = (
      options.endpoint !== optionsRef.current.endpoint ||
      options.maxRetries !== optionsRef.current.maxRetries ||
      options.initialBackoffDelay !== optionsRef.current.initialBackoffDelay ||
      options.maxBackoffDelay !== optionsRef.current.maxBackoffDelay
    );
    
    if (!isSignificantChange) {
      console.log('[SSE:Hook] Options update is not significant, keeping current connection');
      // 参照だけ更新
      optionsRef.current = options;
      return;
    }
    
    console.log('[SSE:Hook] Significant options update detected, updating connection');
    optionsRef.current = options;
    
    // オプションが変更された場合は再接続
    if (clientRef.current && 
        clientRef.current.state === 'connected' && 
        isSignificantChange) {
      console.log('[SSE:Hook] Options changed while connected, reconnecting');
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      
      // 少し遅延させて再接続
      setTimeout(() => {
        if (!clientRef.current) {
          connect();
        }
      }, 100);
    }
  }, [options]); // options変更時のみ実行
  
  // データメッセージハンドラ
  const handleMessage = useCallback((newData: T) => {
    setData(newData);
    console.log('[SSE:Hook] Received data:', newData);
    optionsRef.current.onMessage?.(newData);
  }, []);
  
  // システムメッセージハンドラ
  const handleSystemMessage = useCallback((message: SystemMessage) => {
    setLastSystemMessage(message);
    optionsRef.current.onSystemMessage?.(message);
  }, []);
  
  // 接続状態の監視と更新
  const updateConnectionState = useCallback((state: SSEConnectionState) => {
    setConnectionState(state);
    if (state === 'reconnecting') {
      setIsReconnecting(true);
    } else if (state === 'connected') {
      setIsReconnecting(false);
    }
  }, []);
  
  // 切断メソッド - 先に定義して connect 内で使用できるようにする
  const disconnect = useCallback(() => {
    console.log('[SSE:Hook] Disconnecting from SSE endpoint');
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null; // 確実に参照をクリアする
    }
  }, []);
  
  // 接続メソッド
  const connect = useCallback(() => {
    console.log('[SSE:Hook] Connecting to SSE endpoint');
    
    // 既存の接続がある場合は状態を確認
    if (clientRef.current) {
      // 既に接続中または接続処理中の場合は何もしない
      if (clientRef.current.state === 'connected' || 
          clientRef.current.state === 'connecting' || 
          clientRef.current.state === 'reconnecting') {
        console.log(`[SSE:Hook] Already in state ${clientRef.current.state}, skipping connect`);
        return;
      }
      
      console.log('[SSE:Hook] Existing connection found, disconnecting first');
      disconnect();
    }
    
    // 新しい接続を作成
    clientRef.current = new SSEClient({
      ...optionsRef.current,
      onMessage: handleMessage,
      onSystemMessage: handleSystemMessage,
      onConnect: () => {
        updateConnectionState('connected');
        setRetryCount(0);
        optionsRef.current.onConnect?.();
      },
      onDisconnect: () => {
        updateConnectionState('disconnected');
        optionsRef.current.onDisconnect?.();
      },
      onError: (error) => {
        // クライアントのエラー状態を確認
        if (clientRef.current?.state === 'error') {
          updateConnectionState('error');
        } else if (clientRef.current?.currentRetryCount) {
          setRetryCount(clientRef.current.currentRetryCount);
        }
        optionsRef.current.onError?.(error);
      }
    });
    
    clientRef.current.connect();
  }, [handleMessage, handleSystemMessage, updateConnectionState, disconnect]);
  
  // マウント時に接続、アンマウント時に切断
  useEffect(() => {
    console.log('[SSE:Hook] Connection effect triggered');
    let isComponentMounted = true;
    
    // 接続を開始
    if (isComponentMounted) {
      console.log('[SSE:Hook] Component is mounted, connecting...');
      connect();
    }
    
    // クリーンアップ関数
    return () => {
      console.log('[SSE:Hook] Component unmounting, disconnecting...');
      isComponentMounted = false;
      disconnect();
    };
  }, []); // 空の依存配列 - マウント時のみ実行
  
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

export { type SSEConnectionState, type SystemMessage }; 