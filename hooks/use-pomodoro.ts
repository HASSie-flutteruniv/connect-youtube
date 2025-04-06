import { useEffect, useCallback } from 'react';
import { formatTime, usePomodoroStore, POMODORO_MODES, TimerMode } from '@/lib/store';

/**
 * ポモドーロタイマーを使用するためのカスタムフック
 * コンポーネントでタイマー状態を簡単に使えるようにラップ
 */
export const usePomodoro = () => {
  // Zustandストアから状態と操作を取得
  const {
    mode,
    timeLeft,
    isActive,
    progress,
    workSessionsCompleted,
    startTimer,
    pauseTimer,
    resetTimer,
    switchMode,
    updateFromCurrentTime,
    tickTimer
  } = usePomodoroStore();

  // タイマーのティック処理（1秒ごとに実行）
  useEffect(() => {
    // サーバーサイドレンダリングではタイマーを実行しない
    if (typeof window === 'undefined') return;

    // ブラウザ環境でのみタイマーを設定
    const timerInterval = setInterval(() => {
      // 2秒に1回、現在時刻ベースの更新も確認
      if (Date.now() % 4000 < 2000) {
        updateFromCurrentTime();
      }
      
      // 毎秒タイマーをティック
      tickTimer();
    }, 1000);

    // コンポーネントのクリーンアップ時にタイマーを解除
    return () => clearInterval(timerInterval);
  }, [tickTimer, updateFromCurrentTime]);

  // フォーマット済みの残り時間
  const formattedTimeLeft = formatTime(timeLeft);

  // 現在のモード設定
  const currentMode = {
    WORK: {
      name: '作業',
      color: 'bg-green-500', 
      bgColor: 'bg-green-500', // UIコンポーネント用
      textColor: 'text-green-500'
    },
    BREAK: {
      name: '休憩',
      color: 'bg-blue-500',
      bgColor: 'bg-blue-500', // UIコンポーネント用
      textColor: 'text-blue-500'
    },
    LONG_BREAK: {
      name: '長い休憩',
      color: 'bg-indigo-500',
      bgColor: 'bg-indigo-500', // UIコンポーネント用
      textColor: 'text-indigo-500'
    }
  }[mode];

  // モード切り替えのハンドラー（メモ化して再レンダリングを減らす）
  const handleSwitchMode = useCallback((newMode: TimerMode) => {
    switchMode(newMode);
  }, [switchMode]);

  // 公開するインターフェース
  return {
    // 状態
    mode,
    timeLeft,
    formattedTimeLeft,
    isActive,
    progress,
    workSessionsCompleted,
    currentMode,
    
    // アクション
    startTimer,
    pauseTimer,
    resetTimer,
    switchMode: handleSwitchMode
  };
}; 