import { SSEConnectionState, SystemMessage } from './sseTypes';

/**
 * SSEクライアントの設定オプション
 */
export interface SSEClientOptions {
  endpoint: string;
  onMessage?: (data: any) => void;
  onSystemMessage?: (message: SystemMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  maxRetries?: number;
  initialBackoffDelay?: number;
  maxBackoffDelay?: number;
}

/**
 * Server-Sent Events (SSE)のクライアントクラス
 * 接続管理、再接続ロジック、エラーハンドリングを提供
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private connecting = false;
  private connectionState: SSEConnectionState = 'disconnected';
  private options: SSEClientOptions;
  
  /**
   * SSEクライアントを初期化
   * @param options 設定オプション
   */
  constructor(options: SSEClientOptions) {
    this.options = {
      maxRetries: 10,
      initialBackoffDelay: 1000,
      maxBackoffDelay: 60000,
      ...options
    };
  }
  
  /**
   * 現在の接続状態を取得
   */
  get state(): SSEConnectionState {
    return this.connectionState;
  }
  
  /**
   * 現在の再試行回数を取得
   */
  get currentRetryCount(): number {
    return this.retryCount;
  }
  
  /**
   * SSE接続を開始
   */
  connect(): void {
    // 既に接続中または接続処理中なら再接続しない
    if (this.eventSource && 
        (this.eventSource.readyState === EventSource.OPEN || 
         this.eventSource.readyState === EventSource.CONNECTING)) {
      console.log('[SSEClient] Already connecting or connected, ignoring connect() call');
      return;
    }
    
    // 接続中フラグが設定されている場合も接続を開始しない
    if (this.connecting) {
      console.log('[SSEClient] Connection already in progress, ignoring connect() call');
      return;
    }
    
    this.cleanup();
    this.connecting = true;
    this.setConnectionState(this.retryCount > 0 ? 'reconnecting' : 'connecting');
    
    try {
      console.log(`[SSEClient] Connecting to ${this.options.endpoint}`);
      this.eventSource = new EventSource(this.options.endpoint);
      
      this.eventSource.onopen = this.handleOpen.bind(this);
      this.eventSource.onmessage = this.handleMessage.bind(this);
      this.eventSource.onerror = this.handleError.bind(this);
      
      // システムメッセージイベントのハンドラを設定
      this.eventSource.addEventListener('system-message', this.handleSystemMessage.bind(this));
      
      // エラーイベントのハンドラを設定
      this.eventSource.addEventListener('error', this.handleErrorEvent.bind(this));
    } catch (error) {
      console.error('[SSEClient] Failed to create EventSource:', error);
      this.connecting = false;
      this.setConnectionState('error');
    }
  }
  
  /**
   * SSE接続を切断
   */
  disconnect(): void {
    console.log('[SSEClient] Disconnecting');
    this.cleanup();
    this.setConnectionState('disconnected');
    this.options.onDisconnect?.();
  }
  
  /**
   * リソースの解放とタイマーのクリーンアップ
   */
  private cleanup(): void {
    if (this.eventSource) {
      try {
        console.log('[SSEClient] Closing EventSource');
        this.eventSource.close();
      } catch (error) {
        console.error('[SSEClient] Error closing EventSource:', error);
      } finally {
        this.eventSource = null;
      }
    }
    
    if (this.reconnectTimeoutId) {
      console.log('[SSEClient] Clearing reconnect timeout');
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    
    // 接続中フラグをリセット
    this.connecting = false;
  }
  
  /**
   * 接続成功時のハンドラ
   */
  private handleOpen(): void {
    console.log('[SSEClient] Connection established');
    this.setConnectionState('connected');
    this.connecting = false;
    this.retryCount = 0;
    this.options.onConnect?.();
  }
  
  /**
   * メッセージ受信時のハンドラ
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      this.options.onMessage?.(data);
    } catch (err) {
      console.error('[SSEClient] Error parsing SSE data:', err, event.data);
    }
  }
  
  /**
   * システムメッセージ受信時のハンドラ
   */
  private handleSystemMessage(event: MessageEvent): void {
    try {
      const systemMessage = JSON.parse(event.data) as SystemMessage;
      this.options.onSystemMessage?.(systemMessage);
      console.log(`[SSEClient] System message received: ${systemMessage.type} - ${systemMessage.message}`);
    } catch (err) {
      console.error('[SSEClient] Error parsing system message:', err, event.data);
    }
  }
  
  /**
   * エラー発生時のハンドラ
   */
  private handleError(event: Event): void {
    console.error('[SSEClient] Connection error:', event);
    
    // 接続が閉じられた場合
    if (this.eventSource?.readyState === EventSource.CLOSED) {
      this.setConnectionState('disconnected');
      this.options.onDisconnect?.();
      
      // 最大再試行回数を超えていない場合は再接続を試みる
      if (this.retryCount < (this.options.maxRetries || 10)) {
        this.retryCount++;
        this.connecting = true;
        
        const delayMs = this.calculateBackoff(this.retryCount);
        console.log(`[SSEClient] Will attempt to reconnect in ${delayMs}ms (retry ${this.retryCount}/${this.options.maxRetries})`);
        
        this.reconnectTimeoutId = setTimeout(() => {
          // 再接続前に追加のチェックを実行
          // 1. 既にコネクションが再確立されていないか
          // 2. 明示的に切断されていないか
          if (this.eventSource?.readyState === EventSource.CLOSED && 
              this.connectionState !== 'connected' && 
              this.connectionState !== 'error') {
            console.log(`[SSEClient] Attempting reconnection (retry ${this.retryCount})`);
            this.connect();
          } else {
            console.log('[SSEClient] Skipping reconnection - connection state changed or already connected');
          }
        }, delayMs);
      } else {
        console.error(`[SSEClient] Maximum reconnection attempts (${this.options.maxRetries}) reached`);
        this.setConnectionState('error');
      }
    } else if (this.eventSource?.readyState === EventSource.OPEN) {
      // 接続がオープンなのにエラーイベントが発生した場合 (一部のブラウザで発生する可能性がある)
      console.warn('[SSEClient] Received error event but connection is still open, ignoring');
      return;
    }
    
    this.options.onError?.(event);
  }
  
  /**
   * エラーイベント受信時のハンドラ（サーバーからのカスタムエラーイベント）
   */
  private handleErrorEvent(event: MessageEvent): void {
    try {
      const errorData = JSON.parse(event.data);
      console.error(`[SSEClient] Server error event received: ${errorData.code} - ${errorData.message}`);
      
      // 接続切断エラーの場合は、再接続を停止し、エラー状態に設定
      if (errorData.code === 'CONNECTION_LOST') {
        console.error('[SSEClient] Server reported connection lost, stopping reconnect attempts');
        this.retryCount = this.options.maxRetries || 0; // 再接続試行を停止するため
        this.setConnectionState('error');
        
        // 既存の再接続タイマーをクリア
        if (this.reconnectTimeoutId) {
          clearTimeout(this.reconnectTimeoutId);
          this.reconnectTimeoutId = null;
        }
        
        // イベントソースを閉じる
        this.cleanup();
      }
    } catch (err) {
      console.error('[SSEClient] Error parsing error event:', err, event.data);
    }
  }
  
  /**
   * 指数バックオフ待機時間を計算
   * @param retry 再試行回数
   * @returns 待機時間（ミリ秒）
   */
  private calculateBackoff(retry: number): number {
    const { initialBackoffDelay = 1000, maxBackoffDelay = 60000 } = this.options;
    
    // 指数バックオフ + ジッター（ランダム要素）
    const exponentialDelay = Math.min(
      maxBackoffDelay,
      initialBackoffDelay * Math.pow(2, retry) * (1 + Math.random() * 0.2)
    );
    
    return Math.round(exponentialDelay);
  }
  
  /**
   * 接続状態を更新
   * @param state 新しい接続状態
   */
  private setConnectionState(state: SSEConnectionState): void {
    if (this.connectionState !== state) {
      console.log(`[SSEClient] Connection state changed: ${this.connectionState} -> ${state}`);
      this.connectionState = state;
    }
  }
} 