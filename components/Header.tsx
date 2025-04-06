"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePomodoro } from "@/hooks/use-pomodoro";

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
  
  // ポモドーロタイマーの状態を取得
  const {
    mode,
    formattedTimeLeft,
    isActive,
    progress,
    currentMode
  } = usePomodoro();

  // マウント状態を設定
  useEffect(() => {
    setMounted(true);
    
    // 現在時刻を更新するタイマー
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    return () => {
      clearInterval(timer);
    };
  }, []);

  // 曜日と日付のフォーマット
  const dateString = format(currentTime, "yyyy年MM月dd日(E)", { locale: ja });
  
  // 時間のフォーマット - サーバー側とクライアント側で一致させるため、mounted状態に応じて出し分け
  const timeString = mounted ? format(currentTime, "HH:mm:ss") : "--:--:--";

  return (
    <header className="fixed top-0 w-full h-16 border-b bg-background/70 backdrop-blur-md z-10">
      <div className="container h-full flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-bold text-xl">CONNECT</h1>
          <div className="hidden md:flex gap-6 text-sm text-muted-foreground">
            <a href="/" className="hover:text-foreground transition">メイン</a>
            <a href="#about" className="hover:text-foreground transition">About</a>
            <a href="#guide" className="hover:text-foreground transition">ガイド</a>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* ポモドーロタイマー情報 */}
          <div className="hidden md:flex items-center gap-2">
            <Badge 
              variant="outline" 
              className={`${currentMode.color} text-white`}
            >
              {currentMode.name}
            </Badge>
            <span className="text-sm font-medium">{mounted ? formattedTimeLeft : "--:--"}</span>
          </div>
          
          {/* 現在時刻表示 */}
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{timeString}</span>
            <span className="hidden md:inline text-xs text-muted-foreground">
              {mounted ? dateString : "--/--/--"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
} 