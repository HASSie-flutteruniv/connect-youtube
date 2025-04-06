import { useState, useEffect, useCallback } from 'react';
import { AutoExitStatus } from '@/lib/types';
import { getAutoExitStatus, formatRemainingTime } from '@/lib/client-utils';

/**
 * 自動退室ステータスをリアルタイムで管理するカスタムフック
 * @param scheduledTimeISOString ISO8601形式の自動退室予定時間 (nullの場合は退室予定なし)
 * @param refreshInterval 更新間隔（ミリ秒）
 * @returns 自動退室状態と更新関数
 */
export function useAutoExit(
  scheduledTimeISOString: string | null | undefined,
  refreshInterval: number = 1000
): {
  status: AutoExitStatus;
  updateScheduledTime: (newTime: Date | string | null) => void;
} {
  // 自動退室状態を管理するステート
  const [status, setStatus] = useState<AutoExitStatus>(() => 
    getAutoExitStatus(scheduledTimeISOString || null)
  );
  
  // 自動退室時間を更新する関数
  const updateScheduledTime = useCallback((newTime: Date | string | null) => {
    setStatus(getAutoExitStatus(newTime));
  }, []);
  
  // propsが変更された場合にステータスを更新
  useEffect(() => {
    updateScheduledTime(scheduledTimeISOString || null);
  }, [scheduledTimeISOString, updateScheduledTime]);
  
  // 定期的に残り時間を更新
  useEffect(() => {
    // 自動退室予定がない場合はタイマーを設定しない
    if (!status.isScheduled || !status.scheduledTime) {
      return;
    }
    
    const updateRemainingTime = () => {
      setStatus(prevStatus => {
        if (!prevStatus.scheduledTime) return prevStatus;
        
        const now = new Date();
        const scheduledTime = prevStatus.scheduledTime;
        const remainingMs = scheduledTime.getTime() - now.getTime();
        
        // 残り時間がない場合 (期限切れ)
        if (remainingMs <= 0) {
          return {
            ...prevStatus,
            remainingTime: 0,
            formattedTime: '時間切れ'
          };
        }
        
        // 残り時間を更新
        return {
          ...prevStatus,
          remainingTime: remainingMs,
          formattedTime: formatRemainingTime(remainingMs)
        };
      });
    };
    
    // 初回更新
    updateRemainingTime();
    
    // 定期的に更新するタイマーを設定
    const intervalId = setInterval(updateRemainingTime, refreshInterval);
    
    // クリーンアップ
    return () => clearInterval(intervalId);
  }, [status.isScheduled, status.scheduledTime, refreshInterval]);
  
  return {
    status,
    updateScheduledTime
  };
} 