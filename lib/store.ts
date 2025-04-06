import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ポモドーロモードの型
export type TimerMode = 'WORK' | 'BREAK' | 'LONG_BREAK';

// ポモドーロタイマーの設定
export const POMODORO_MODES = {
  WORK: {
    name: '作業中',
    duration: 25 * 60, // 25分（秒単位）
    color: 'bg-amber-500',
    nextMode: 'BREAK' as TimerMode,
    nextName: '休憩'
  },
  BREAK: {
    name: '休憩中',
    duration: 5 * 60, // 5分（秒単位）
    color: 'bg-green-500',
    nextMode: 'WORK' as TimerMode,
    nextName: '作業'
  },
  LONG_BREAK: {
    name: '長休憩',
    duration: 15 * 60, // 15分（秒単位）
    color: 'bg-blue-500',
    nextMode: 'WORK' as TimerMode,
    nextName: '作業'
  }
};

// 現在時刻をフォーマットする関数（再利用性のために外部化）
export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// 現在時刻に基づいてモードを判定する関数
export const determineTimeModeFromCurrentTime = (now: Date): {mode: TimerMode, timeLeft: number} => {
  const minutes = now.getMinutes();
  
  // 55-59分は休憩モード
  if (minutes >= 55 && minutes <= 59) {
    // 残り時間を計算（60分 - 現在分:秒）
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const timeLeftMs = nextHour.getTime() - now.getTime();
    const timeLeftSec = Math.ceil(timeLeftMs / 1000);
    return { mode: "BREAK", timeLeft: timeLeftSec };
  }
  
  // 25-29分は休憩モード
  if (minutes >= 25 && minutes <= 29) {
    // 残り時間を計算（30分 - 現在分:秒）
    const nextHalfHour = new Date(now);
    nextHalfHour.setMinutes(30, 0, 0);
    const timeLeftMs = nextHalfHour.getTime() - now.getTime();
    const timeLeftSec = Math.ceil(timeLeftMs / 1000);
    return { mode: "BREAK", timeLeft: timeLeftSec };
  }
  
  // それ以外はフォーカスモード
  // 残り時間の計算（次の休憩時間までの時間）
  let targetMinute = 25;
  if (minutes >= 30 && minutes < 55) {
    targetMinute = 55;
  } else if (minutes >= 0 && minutes < 25) {
    targetMinute = 25;
  }
  
  const nextTarget = new Date(now);
  nextTarget.setMinutes(targetMinute, 0, 0);
  
  // 既に目標時間を過ぎている場合は次の時間帯に調整
  if (nextTarget.getTime() <= now.getTime()) {
    nextTarget.setHours(nextTarget.getHours() + 1);
  }
  
  const timeLeftMs = nextTarget.getTime() - now.getTime();
  const timeLeftSec = Math.ceil(timeLeftMs / 1000);
  
  return { mode: "WORK", timeLeft: timeLeftSec };
};

// ポモドーロタイマーの状態
interface PomodoroState {
  mode: TimerMode;
  timeLeft: number;
  isActive: boolean;
  progress: number;
  workSessionsCompleted: number;
  lastTimeBasedUpdate: number;
  
  // アクション
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  switchMode: (mode: TimerMode) => void;
  updateRemainingTime: (seconds: number) => void;
  updateFromCurrentTime: () => void;
  tickTimer: () => void;
}

// ポモドーロタイマーのストア作成
export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => {
      // 現在時刻ベースの初期値を計算
      const { mode: initialMode, timeLeft: initialTimeLeft } = determineTimeModeFromCurrentTime(new Date());

      return {
        // 初期状態
        mode: initialMode,
        timeLeft: initialTimeLeft,
        isActive: true,
        progress: 0,
        workSessionsCompleted: 0,
        lastTimeBasedUpdate: Date.now(),

        // アクション
        startTimer: () => set({ isActive: true }),
        
        pauseTimer: () => set({ isActive: false }),
        
        resetTimer: () => {
          const currentMode = get().mode;
          set({
            timeLeft: POMODORO_MODES[currentMode].duration,
            isActive: false,
            progress: 0
          });
        },
        
        switchMode: (mode: TimerMode) => set({
          mode,
          timeLeft: POMODORO_MODES[mode].duration,
          progress: 0
        }),
        
        updateRemainingTime: (seconds: number) => {
          const currentMode = get().mode;
          const totalDuration = POMODORO_MODES[currentMode].duration;
          const progress = ((totalDuration - seconds) / totalDuration) * 100;
          
          set({
            timeLeft: seconds,
            progress: Math.min(Math.max(progress, 0), 100) // 0-100の範囲に制限
          });

          // ブラウザのタイトルを更新
          if (typeof document !== 'undefined') {
            const formattedTime = formatTime(seconds);
            const modeName = POMODORO_MODES[currentMode].name;
            const activeSymbol = get().isActive ? '▶' : '⏸';
            document.title = `${activeSymbol} ${formattedTime} - ${modeName}`;
          }
        },
        
        updateFromCurrentTime: () => {
          const now = Date.now();
          // 最小2秒の間隔をあけて更新（頻繁な更新を避ける）
          if (now - get().lastTimeBasedUpdate >= 2000) {
            const { mode, timeLeft } = determineTimeModeFromCurrentTime(new Date());
            set({
              mode,
              timeLeft,
              isActive: true,
              lastTimeBasedUpdate: now
            });
            
            // 残り時間の更新（タイトル更新などのため）
            get().updateRemainingTime(timeLeft);
          }
        },
        
        tickTimer: () => {
          if (!get().isActive) return;
          
          const currentTimeLeft = get().timeLeft;
          
          if (currentTimeLeft <= 0) {
            // タイマー終了時、次のモードに切り替え
            const currentMode = get().mode;
            const nextMode = POMODORO_MODES[currentMode].nextMode;
            
            // 作業モードが終了したらセッション数を増やす
            const newWorkSessionsCompleted = 
              currentMode === 'WORK' 
                ? get().workSessionsCompleted + 1 
                : get().workSessionsCompleted;
            
            set({
              mode: nextMode,
              timeLeft: POMODORO_MODES[nextMode].duration,
              progress: 0,
              workSessionsCompleted: newWorkSessionsCompleted
            });
          } else {
            // タイマーをカウントダウン
            get().updateRemainingTime(currentTimeLeft - 1);
          }
        }
      };
    },
    {
      name: 'pomodoro-timer-storage',
      // ブラウザ以外の環境でlocalStorageが使えない場合のフォールバック
      skipHydration: typeof window === 'undefined'
    }
  )
); 