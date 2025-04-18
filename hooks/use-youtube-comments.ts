import { useState, useEffect, useCallback, useRef } from 'react';
import { youtubeService } from '@/lib/api/services/youtubeService';
import { toast } from '@/hooks/use-toast';
import type { Command } from '@/lib/types';

interface UseYouTubeCommentsOptions {
  enabled?: boolean;
  onCommandsDetected?: (commands: Command[]) => Promise<void>;
  videoId?: string;
  onError?: (error: string) => void;
}

interface UseYouTubeCommentsResult {
  isProcessingCommand: boolean;
  startPolling: () => void;
  stopPolling: () => void;
  isPolling: boolean;
  error: string | null;
  isInitialized: boolean;
}

/**
 * YouTubeコメント取得とコマンド処理のためのカスタムフック
 */
export function useYouTubeComments(options: UseYouTubeCommentsOptions = {}): UseYouTubeCommentsResult {
  const { enabled = true, onCommandsDetected, videoId, onError } = options;
  
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const processingCommandsRef = useRef<Set<string>>(new Set());
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);
  
  // バックオフ状態の管理
  const backoffStateRef = useRef({
    isActive: false,
    endTime: 0,
    pollingInterval: 10000 // 初期値10秒
  });
  
  /**
   * YouTubeコメントを取得し、コマンドを処理する
   */
  const fetchComments = useCallback(async () => {
    // videoIdが設定されていない場合は処理しない
    if (!videoId) {
      setError('YouTube動画IDが設定されていません');
      if (onError) onError('YouTube動画IDが設定されていません');
      return;
    }

    // バックオフ中であればスキップ
    const now = Date.now();
    if (backoffStateRef.current.isActive && now < backoffStateRef.current.endTime) {
      console.log(`[YouTubeComments] バックオフ中 (残り ${Math.ceil((backoffStateRef.current.endTime - now) / 1000)} 秒)`);
      return;
    }
    
    try {
      console.log('[YouTubeComments] コメント取得開始');
      const response = await youtubeService.getComments(videoId);
      console.log('[YouTubeComments] コメント取得完了');
      console.log(response);
      
      // 初期化完了フラグを設定
      if (!isInitialized) {
        setIsInitialized(true);
      }

      // エラーレスポンスの場合
      if (response.error) {
        setError(response.error);
        if (onError) onError(response.error);
        
        // バックオフ状態の更新
        if (response.backoff && response.remainingSeconds) {
          backoffStateRef.current.isActive = true;
          backoffStateRef.current.endTime = now + (response.remainingSeconds * 1000);
          console.log(`[YouTubeComments] API制限により${response.remainingSeconds}秒間バックオフ設定`);
        }
        return;
      }
      
      // バックオフ状態の更新（APIからのレスポンスに基づく）
      if (response.backoff && response.remainingSeconds) {
        backoffStateRef.current.isActive = true;
        backoffStateRef.current.endTime = now + (response.remainingSeconds * 1000);
        console.log(`[YouTubeComments] API制限により${response.remainingSeconds}秒間バックオフ設定`);
        
        setError(`YouTube API制限のため、コメント取得を一時停止します (${Math.ceil(response.remainingSeconds / 60)}分間)`);
        if (onError) onError(`YouTube API制限のため、コメント取得を一時停止します (${Math.ceil(response.remainingSeconds / 60)}分間)`);
        
        return;
      }
      
      // APIからの推奨ポーリング間隔があれば使用
      if (response.pollingIntervalMillis && response.pollingIntervalMillis > 0) {
        backoffStateRef.current.pollingInterval = Math.max(5000, response.pollingIntervalMillis);
        console.log(`[YouTubeComments] ポーリング間隔を ${backoffStateRef.current.pollingInterval / 1000} 秒に調整`);
      }
      
      // バックオフ状態をリセット（成功したため）
      if (backoffStateRef.current.isActive) {
        backoffStateRef.current.isActive = false;
        backoffStateRef.current.endTime = 0;
        console.log('[YouTubeComments] バックオフ状態を解除');
      }
      
      // エラー状態をクリア
      if (error) {
        setError(null);
      }
      
      // コマンドを処理（あれば）
      if (response.commands && Array.isArray(response.commands) && response.commands.length > 0) {
        console.log(`[YouTubeComments] ${response.commands.length}件のコマンドを検出`);
        setIsProcessingCommand(true);
        
        if (onCommandsDetected) {
          await onCommandsDetected(response.commands);
        }
        
        setIsProcessingCommand(false);
      }
    } catch (error) {
      console.error('[YouTubeComments] 取得エラー:', error);
      
      const errorMessage = error instanceof Error ? error.message : '不明なエラーが発生しました';
      setError(errorMessage);
      if (onError) onError(errorMessage);
      
      toast({
        title: 'YouTubeコメント取得エラー',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [onCommandsDetected, videoId, onError, error, isInitialized]);
  
  /**
   * 次回のポーリングをスケジュール
   */
  const scheduleNextFetch = useCallback(() => {
    if (!isPollingRef.current) return;
    
    timeoutIdRef.current = setTimeout(() => {
      fetchComments().finally(() => {
        if (isPollingRef.current) {
          scheduleNextFetch();
        }
      });
    }, backoffStateRef.current.pollingInterval);
  }, [fetchComments]);
  
  /**
   * ポーリングを開始
   */
  const startPolling = useCallback(() => {
    if (isPollingRef.current) return;
    
    console.log('[YouTubeComments] ポーリング開始');
    isPollingRef.current = true;
    setIsPolling(true);
    
    fetchComments().finally(() => {
      if (isPollingRef.current) {
        scheduleNextFetch();
      }
    });
  }, [fetchComments, scheduleNextFetch]);
  
  /**
   * ポーリングを停止
   */
  const stopPolling = useCallback(() => {
    console.log('[YouTubeComments] ポーリング停止');
    isPollingRef.current = false;
    setIsPolling(false);
    
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);
  
  // enabledフラグとvideoIdの有無に基づいてポーリングを制御
  useEffect(() => {
    if (enabled && videoId) {
      startPolling();
    } else {
      stopPolling();
      if (!videoId && enabled) {
        setError('YouTube動画IDが設定されていません');
      }
    }
    
    return () => {
      stopPolling();
    };
  }, [enabled, videoId, startPolling, stopPolling]);
  
  return { 
    isProcessingCommand,
    startPolling, 
    stopPolling,
    isPolling,
    error,
    isInitialized
  };
} 