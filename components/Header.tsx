"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock } from "lucide-react";

// ヘッダー用に簡略化したタイマー情報
const POMODORO_MODES = {
  WORK: {
    name: "作業中",
    duration: 25 * 60, // 25分（秒単位）
    color: "bg-amber-500",
    bgColor: "bg-amber-500",
    textColor: "text-amber-600",
    badgeColor: "bg-amber-500"
  },
  BREAK: {
    name: "休憩中",
    duration: 5 * 60, // 5分（秒単位）
    color: "bg-green-500",
    bgColor: "bg-green-500",
    textColor: "text-green-600",
    badgeColor: "bg-green-500"
  },
  LONG_BREAK: {
    name: "長休憩",
    duration: 15 * 60, // 15分（秒単位）
    color: "bg-blue-500",
    bgColor: "bg-blue-500",
    textColor: "text-blue-600",
    badgeColor: "bg-blue-500"
  }
};

// フォーマット関数（PomodoroTimerと同じ実装）
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// 現在時刻に基づいてモードを判定する関数
const determineTimeModeFromCurrentTime = (now: Date): {mode: string, timeLeft: number} => {
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  
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

export default function Header() {
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // ポモドーロの状態を取得
  const [pomodoroState, setPomodoroState] = useState({
    mode: "WORK",
    timeLeft: formatTime(POMODORO_MODES.WORK.duration), // 初期値を計算
    progress: 0
  });

  // マウント状態を設定
  useEffect(() => {
    setMounted(true);
    console.log("ヘッダーコンポーネントがマウントされました");
    
    // マウント時に初期値を設定（ページ読み込み時の初期表示用）
    if (typeof window !== "undefined") {
      try {
        // 現在時刻から適切なモードと残り時間を取得
        const now = new Date();
        const { mode, timeLeft } = determineTimeModeFromCurrentTime(now);
        
        console.log("時刻ベースのモード計算:", { mode, timeLeft, 現在時刻: now });
        
        // localStorage更新
        localStorage.setItem("pomodoroMode", mode);
        localStorage.setItem("pomodoroTimeLeft", timeLeft.toString());
        localStorage.setItem("pomodoroActive", "true");
        
        // 進捗状況の計算
        const modeObj = POMODORO_MODES[mode as keyof typeof POMODORO_MODES];
        const totalDuration = modeObj.duration;
        const maxTimeLeft = mode === "WORK" ? 25 * 60 : 5 * 60; // モードに応じた最大時間
        const progress = 100 - (timeLeft / maxTimeLeft) * 100;
        
        console.log("ヘッダー初期設定:", {
          mode,
          timeLeft,
          formattedTime: formatTime(timeLeft),
          progress: Math.min(Math.max(progress, 0), 100)
        });
        
        setPomodoroState({
          mode: mode as keyof typeof POMODORO_MODES,
          timeLeft: formatTime(timeLeft),
          progress: Math.min(Math.max(progress, 0), 100)
        });
      } catch (error) {
        console.error("ヘッダー初期設定エラー:", error);
      }
    }
  }, []);

  useEffect(() => {
    // クライアントサイドでのみ実行されるタイマー
    if (!mounted) return;
    
    console.log("ヘッダータイマー監視が開始されました");
    
    // 500msごとに時間を更新（更新頻度を下げて競合を減らす）
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      
      // 現在時刻から適切なモードと残り時間を取得
      const { mode, timeLeft } = determineTimeModeFromCurrentTime(now);
      
      // localStorage更新（現在時刻ベースのモードを優先）
      localStorage.setItem("pomodoroMode", mode);
      localStorage.setItem("pomodoroTimeLeft", timeLeft.toString());
      localStorage.setItem("pomodoroActive", "true");
      
      // 進捗状況の計算
      const modeObj = POMODORO_MODES[mode as keyof typeof POMODORO_MODES];
      const maxTimeLeft = mode === "WORK" ? 25 * 60 : 5 * 60; // モードに応じた最大時間
      const progress = 100 - (timeLeft / maxTimeLeft) * 100;
      
      const formattedTime = formatTime(timeLeft);
      
      // 状態が変わった場合のみ更新とログ出力（パフォーマンス向上）
      if (pomodoroState.timeLeft !== formattedTime || pomodoroState.mode !== mode) {
        // 10秒に1回だけ詳細ログを出力（頻度を減らす）
        if (Math.floor(Date.now() / 10000) % 1 === 0) {
          console.log("ヘッダータイマー更新:", {
            mode,
            timeLeft,
            formattedTime,
            progress: Math.min(Math.max(progress, 0), 100)
          });
        }
        
        setPomodoroState({
          mode: mode as keyof typeof POMODORO_MODES,
          timeLeft: formattedTime,
          progress: Math.min(Math.max(progress, 0), 100) // 0-100の範囲に制限
        });
      }
    }, 500); // 更新頻度を500msに設定

    return () => {
      clearInterval(timer);
    };
  }, [mounted]); // pomodoroState.mode, pomodoroState.timeLeftを依存配列から削除

  // 曜日と日付のフォーマット
  const dateString = format(currentTime, "yyyy年MM月dd日(E)", { locale: ja });
  
  // 時間のフォーマット - サーバー側とクライアント側で一致させるため、mounted状態に応じて出し分け
  const timeString = mounted ? format(currentTime, "HH:mm:ss") : "--:--:--";
  
  // 使用するモードの色情報
  const modeColors = POMODORO_MODES[pomodoroState.mode as keyof typeof POMODORO_MODES];

  return (
    <header className="w-full py-4 bg-[#505762] border-b border-[#404550] fixed top-0 z-10">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center">
          {/* サイトタイトルを中央に配置 */}
          <div className="flex-1"></div>
          <div className="flex-1 flex justify-center">
            <h1 className="text-3xl font-bold text-amber-400">CONNECT</h1>
          </div>
          
          {/* 現在時刻 */}
          <div className="flex-1 flex justify-end">
            <div className="flex items-center gap-4 text-white">
              <div className="flex gap-2 items-center">
                <Clock className="h-5 w-5" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{mounted ? dateString : "--"}</span>
                  <span className="text-xl font-mono">{timeString}</span>
                </div>
              </div>
              
              {/* ポモドーロタイマー表示 */}
              <div className="flex flex-col items-end border-l border-white/20 pl-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">ポモドーロタイマー</span>
                  <span className={`${modeColors.badgeColor} text-white px-2 py-0.5 text-xs rounded`}>
                    {modeColors.name}
                  </span>
                </div>
                <div className="text-xl font-mono">{pomodoroState.timeLeft}</div>
                <div className="w-full h-1 bg-gray-500/30 rounded-full mt-1">
                  <div className={`h-full ${modeColors.bgColor} rounded-full`} style={{ width: `${pomodoroState.progress}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
} 