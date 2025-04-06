"use client";

import { useState, useEffect } from "react";
import { Play, Pause, RefreshCw, Coffee, TimerIcon, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Card, 
  CardContent,
  CardFooter
} from "@/components/ui/card";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

// ポモドーロタイマーの設定
const MODES = {
  WORK: {
    name: "作業中",
    duration: 25 * 60, // 25分（秒単位）
    color: "bg-amber-500",
    nextMode: "BREAK",
    nextName: "休憩"
  },
  BREAK: {
    name: "休憩中",
    duration: 5 * 60, // 5分（秒単位）
    color: "bg-green-500",
    nextMode: "WORK",
    nextName: "作業"
  },
  LONG_BREAK: {
    name: "長休憩",
    duration: 15 * 60, // 15分（秒単位）
    color: "bg-blue-500",
    nextMode: "WORK",
    nextName: "作業"
  }
};

// 現在時刻に基づいてモードを判定する関数
const determineTimeModeFromCurrentTime = (now: Date): {mode: TimerMode, timeLeft: number} => {
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

// デバッグ: モード設定の確認
console.log("ポモドーロモード設定:", {
  WORK: MODES.WORK,
  BREAK: MODES.BREAK,
  LONG_BREAK: MODES.LONG_BREAK
});

type TimerMode = "WORK" | "BREAK" | "LONG_BREAK";

export default function PomodoroTimer() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<TimerMode>("WORK");
  const [timeLeft, setTimeLeft] = useState<number>(MODES.WORK.duration);
  const [isActive, setIsActive] = useState<boolean>(true); // デフォルトで自動実行に変更
  const [workSessionsCompleted, setWorkSessionsCompleted] = useState<number>(0);
  // 最後に時刻ベースの更新を行った時間を記録
  const [lastTimeBasedUpdate, setLastTimeBasedUpdate] = useState<number>(Date.now());

  // クライアントサイドのマウント完了後に状態を初期化
  useEffect(() => {
    console.log("ポモドーロタイマー:マウント処理開始");
    
    // ブラウザ環境でのみ実行される処理
    if (typeof window !== "undefined") {
      // マウント状態を設定
      setMounted(true);
      
      try {
        // 現在時刻から適切なモードと残り時間を取得
        const now = new Date();
        const { mode: timeBasedMode, timeLeft: timeBasedTimeLeft } = determineTimeModeFromCurrentTime(now);
        
        console.log("初期読み込み - 時刻ベースのモード計算:", {
          mode: timeBasedMode,
          timeLeft: timeBasedTimeLeft,
          現在時刻: now.toLocaleTimeString()
        });
        
        // 現在時刻ベースの値で初期化
        setMode(timeBasedMode);
        setTimeLeft(timeBasedTimeLeft);
        setIsActive(true);
        
        // ローカルストレージを更新
        localStorage.setItem("pomodoroMode", timeBasedMode);
        localStorage.setItem("pomodoroTimeLeft", timeBasedTimeLeft.toString());
        localStorage.setItem("pomodoroActive", "true");
        localStorage.setItem("pomodoroSessions", "0");
        
        // タイトルを更新
        document.title = `▶ ${formatTime(timeBasedTimeLeft)} - ${MODES[timeBasedMode].name}`;
        
        // 最後の更新時間を記録
        setLastTimeBasedUpdate(Date.now());
      } catch (error) {
        // エラーが発生した場合はデフォルト値を使用
        console.error("時刻ベースモード計算エラー:", error);
        clearStorage(); // 既存の完全リセット関数を使用
      }
    }
  }, []); // 空の依存配列で初回マウント時のみ実行

  // 時刻ベースのモード自動更新
  useEffect(() => {
    if (!mounted) return;
    
    console.log("時刻ベースのモード自動更新の監視を開始");
    
    const timeUpdateInterval = setInterval(() => {
      const now = Date.now();
      // 2秒以上経過している場合のみ時刻ベースの更新を行う（頻繁な更新を避ける）
      if (now - lastTimeBasedUpdate >= 2000) {
        const currentDate = new Date();
        const { mode: newMode, timeLeft: newTimeLeft } = determineTimeModeFromCurrentTime(currentDate);
        
        // モードが変わった場合、または同じモードでも残り時間に15秒以上の差がある場合に更新
        const shouldUpdate = 
          newMode !== mode || 
          Math.abs(newTimeLeft - timeLeft) > 15;
        
        if (shouldUpdate) {
          console.log("時刻ベースのモード/時間を更新:", {
            前回のモード: mode,
            新しいモード: newMode,
            前回の残り時間: timeLeft,
            新しい残り時間: newTimeLeft,
            現在時刻: currentDate.toLocaleTimeString()
          });
          
          setMode(newMode);
          setTimeLeft(newTimeLeft);
          setIsActive(true);
          
          // localStorage更新
          localStorage.setItem("pomodoroMode", newMode);
          localStorage.setItem("pomodoroTimeLeft", newTimeLeft.toString());
          localStorage.setItem("pomodoroActive", "true");
          
          // タイトルも更新
          document.title = `▶ ${formatTime(newTimeLeft)} - ${MODES[newMode].name}`;
          
          // 最後の更新時間を記録
          setLastTimeBasedUpdate(now);
        }
      }
    }, 1000); // 1秒ごとにチェック
    
    return () => {
      clearInterval(timeUpdateInterval);
    };
  }, [mounted, mode, timeLeft, lastTimeBasedUpdate]);

  // デバッグ用: 状態変更のログ出力
  useEffect(() => {
    if (mounted) {
      console.log("タイマー状態が更新されました:", {
        mode,
        timeLeft,
        formattedTimeLeft: formatTime(timeLeft),
        isActive,
        workSessionsCompleted,
        localStorage: {
          mode: localStorage.getItem("pomodoroMode"),
          timeLeft: localStorage.getItem("pomodoroTimeLeft"),
          active: localStorage.getItem("pomodoroActive"),
          sessions: localStorage.getItem("pomodoroSessions")
        }
      });
    }
  }, [mounted, mode, timeLeft, isActive, workSessionsCompleted]);

  // タイマーの進行（従来の手動操作時用）
  useEffect(() => {
    if (!mounted) return;
    
    console.log("タイマー進行の条件チェック:", { isActive, timeLeft, mode });
    
    let intervalId: NodeJS.Timeout | null = null;
    
    if (isActive && timeLeft > 0) {
      console.log("タイマー開始", new Date().toISOString(), "残り時間:", formatTime(timeLeft));
      
      // 前回の時間記録
      let lastUpdateTime = Date.now();
      
      // 100msごとに更新 - スムーズなカウントダウンと正確さのために短い間隔を使用
      intervalId = setInterval(() => {
        const now = Date.now();
        
        // 時刻ベースの更新からの経過時間をチェック
        // 3秒以内に時刻ベースの更新があった場合はこのカウントダウンをスキップ
        if (now - lastTimeBasedUpdate < 3000) {
          return;
        }
        
        const delta = Math.floor((now - lastUpdateTime) / 1000); // 経過秒数を計算
        
        if (delta >= 1) {
          // 1秒以上経過した場合のみ更新
          lastUpdateTime = now - ((now - lastUpdateTime) % 1000); // 余りを考慮して調整
          
          setTimeLeft((prevTime) => {
            const newTime = Math.max(prevTime - delta, 0);
            console.log(`カウントダウン実行: ${formatTime(prevTime)} -> ${formatTime(newTime)} (${delta}秒減少)`);
            
            // localStorageに保存
            localStorage.setItem("pomodoroTimeLeft", newTime.toString());
            
            // タイトル更新
            if (isActive) {
              document.title = `▶ ${formatTime(newTime)} - ${MODES[mode].name}`;
            } else {
              document.title = `CONNECT - ${formatTime(newTime)}`;
            }
            
            // 終了判定
            if (newTime === 0) {
              console.log("タイマー終了");
              clearInterval(intervalId!);
              
              // 次のモードを現在時刻から判定
              const { mode: nextTimeBasedMode, timeLeft: nextTimeBasedTimeLeft } = determineTimeModeFromCurrentTime(new Date());
              console.log("タイマー終了後の次のモード (時刻ベース):", {
                mode: nextTimeBasedMode,
                timeLeft: nextTimeBasedTimeLeft
              });
              
              setMode(nextTimeBasedMode);
              setTimeLeft(nextTimeBasedTimeLeft);
              setIsActive(true);
              
              localStorage.setItem("pomodoroMode", nextTimeBasedMode);
              localStorage.setItem("pomodoroTimeLeft", nextTimeBasedTimeLeft.toString());
              localStorage.setItem("pomodoroActive", "true");
              
              // 最後の更新時間を記録
              setLastTimeBasedUpdate(Date.now());
              
              // タイトル更新
              document.title = `▶ ${formatTime(nextTimeBasedTimeLeft)} - ${MODES[nextTimeBasedMode].name}`;
            }
            
            return newTime;
          });
        }
      }, 100);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isActive, timeLeft, mode, mounted, lastTimeBasedUpdate]);

  // 通知音再生
  const playNotificationSound = () => {
    try {
      const audio = new Audio("/sounds/notification.mp3");
      audio.play().catch(err => {
        console.warn("通知音の再生に失敗しました:", err);
      });
    } catch (error) {
      console.error("通知音の再生中にエラーが発生しました:", error);
    }
  };

  // タイマー開始/一時停止
  const toggleTimer = () => {
    // 一時停止/再開の切り替え
    console.log("タイマー状態を切り替えます: 現在=", isActive ? "実行中" : "停止中");
    
    // 現在の動作状態を反転
    const newActiveState = !isActive;
    
    // 一時停止→再開時は現在時刻からモードを再計算
    if (!isActive && newActiveState) {
      const now = new Date();
      const { mode: timeBasedMode, timeLeft: timeBasedTimeLeft } = determineTimeModeFromCurrentTime(now);
      
      console.log("タイマー再開時に時刻ベースで再計算:", {
        mode: timeBasedMode,
        timeLeft: timeBasedTimeLeft,
        現在時刻: now.toLocaleTimeString()
      });
      
      setMode(timeBasedMode);
      setTimeLeft(timeBasedTimeLeft);
      
      // ローカルストレージとタイトルを更新
      localStorage.setItem("pomodoroMode", timeBasedMode);
      localStorage.setItem("pomodoroTimeLeft", timeBasedTimeLeft.toString());
      localStorage.setItem("pomodoroActive", "true");
      
      document.title = `▶ ${formatTime(timeBasedTimeLeft)} - ${MODES[timeBasedMode].name}`;
      
      // 最後の更新時間を記録
      setLastTimeBasedUpdate(Date.now());
    } else {
      setIsActive(newActiveState);
      
      // ローカルストレージとタイトルを更新
      localStorage.setItem("pomodoroActive", newActiveState.toString());
      localStorage.setItem("pomodoroTimeLeft", timeLeft.toString());
      localStorage.setItem("pomodoroMode", mode);
      
      if (newActiveState) {
        document.title = `▶ ${formatTime(timeLeft)} - ${MODES[mode].name}`;
      } else {
        document.title = `CONNECT - ${formatTime(timeLeft)}`;
      }
    }
  };

  // タイマーリセット
  const resetTimer = () => {
    // 現在時刻からモードと残り時間を再計算
    const now = new Date();
    const { mode: timeBasedMode, timeLeft: timeBasedTimeLeft } = determineTimeModeFromCurrentTime(now);
    
    console.log("タイマーリセット - 時刻ベースで再計算:", {
      mode: timeBasedMode,
      timeLeft: timeBasedTimeLeft,
      現在時刻: now.toLocaleTimeString()
    });
    
    // タイマーをリセット
    setMode(timeBasedMode);
    setTimeLeft(timeBasedTimeLeft);
    setIsActive(true);
    
    // ローカルストレージとタイトルを更新
    localStorage.setItem("pomodoroMode", timeBasedMode);
    localStorage.setItem("pomodoroTimeLeft", timeBasedTimeLeft.toString());
    localStorage.setItem("pomodoroActive", "true");
    
    document.title = `▶ ${formatTime(timeBasedTimeLeft)} - ${MODES[timeBasedMode].name}`;
    
    // 最後の更新時間を記録
    setLastTimeBasedUpdate(Date.now());
  };

  // 完全リセット（すべての状態を初期化）
  const clearStorage = () => {
    console.log("ポモドーロタイマーの状態を完全リセットします");
    
    // 現在時刻からモードと残り時間を再計算
    const now = new Date();
    const { mode: timeBasedMode, timeLeft: timeBasedTimeLeft } = determineTimeModeFromCurrentTime(now);
    
    // ローカルストレージをクリア
    localStorage.removeItem("pomodoroMode");
    localStorage.removeItem("pomodoroTimeLeft");
    localStorage.removeItem("pomodoroActive");
    localStorage.removeItem("pomodoroSessions");
    
    // 時刻ベースの値で初期化
    setMode(timeBasedMode);
    setTimeLeft(timeBasedTimeLeft);
    setWorkSessionsCompleted(0);
    setIsActive(true);
    
    // 新しい値をローカルストレージに設定
    localStorage.setItem("pomodoroMode", timeBasedMode);
    localStorage.setItem("pomodoroTimeLeft", timeBasedTimeLeft.toString());
    localStorage.setItem("pomodoroActive", "true");
    localStorage.setItem("pomodoroSessions", "0");
    
    // タイトルを更新
    document.title = `▶ ${formatTime(timeBasedTimeLeft)} - ${MODES[timeBasedMode].name}`;
    
    // 最後の更新時間を記録
    setLastTimeBasedUpdate(Date.now());
  };

  // モード切り替え
  const changeMode = (newMode: TimerMode) => {
    console.log(`モードを手動で切り替えます: ${mode} → ${newMode}`);
    
    // 現在時刻からモードと残り時間を再計算
    const now = new Date();
    const { mode: timeBasedMode, timeLeft: timeBasedTimeLeft } = determineTimeModeFromCurrentTime(now);
    
    // 手動で設定したいモードがある場合はそれを優先
    if (newMode) {
      console.log("手動モード切替 - ユーザー指定の動作:", {
        指定モード: newMode,
        時刻ベースのモード提案: timeBasedMode,
        現在時刻: now.toLocaleTimeString()
      });
      
      setMode(newMode);
      setTimeLeft(MODES[newMode].duration);
      setIsActive(false); // 手動切替時は一旦停止
      
      // ローカルストレージを更新
      localStorage.setItem("pomodoroTimeLeft", MODES[newMode].duration.toString());
      localStorage.setItem("pomodoroMode", newMode);
      localStorage.setItem("pomodoroActive", "false");
      
      // タイトル更新
      document.title = `CONNECT - ${formatTime(MODES[newMode].duration)}`;
    } else {
      // 現在時刻ベースのモードを使用
      setMode(timeBasedMode);
      setTimeLeft(timeBasedTimeLeft);
      setIsActive(true);
      
      // ローカルストレージを更新
      localStorage.setItem("pomodoroTimeLeft", timeBasedTimeLeft.toString());
      localStorage.setItem("pomodoroMode", timeBasedMode);
      localStorage.setItem("pomodoroActive", "true");
      
      // タイトル更新
      document.title = `▶ ${formatTime(timeBasedTimeLeft)} - ${MODES[timeBasedMode].name}`;
      
      // 最後の更新時間を記録
      setLastTimeBasedUpdate(Date.now());
    }
  };

  // 残り時間のフォーマット
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 進捗率の計算
  const calculateProgress = (): number => {
    // モードごとのデフォルト時間に対する進捗率を計算
    // ただし、時刻ベースの場合は次の区切りまでの時間ベースの計算にする
    const maxTime = mode === "WORK" ? 25 * 60 : 5 * 60; // 近似値で計算
    // 0-100の範囲に収める
    return Math.min(100, Math.max(0, 100 - (timeLeft / maxTime) * 100));
  };

  // 次のモードの名前を取得
  const getNextModeName = (): string => {
    return MODES[mode].nextName;
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-[200px]">
        <div className="animate-pulse text-gray-400">タイマーを読み込み中...</div>
      </div>
    );
  }

  return (
    <Card className="shadow-lg bg-white/10 backdrop-blur-sm border-0">
      <CardContent className="pt-6">
        <div className="flex flex-col space-y-4">
          {/* タイマー情報 */}
          <div className="flex flex-col items-center space-y-1">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Badge 
                className={`${MODES[mode].color} text-white px-3 py-1`} 
                variant="default"
              >
                {MODES[mode].name}
              </Badge>
              {workSessionsCompleted > 0 && (
                <Badge 
                  className="bg-gray-600 text-white px-2 py-0.5 text-xs" 
                  variant="default"
                >
                  セッション: {workSessionsCompleted}
                </Badge>
              )}
            </h2>
            
            {/* カウントダウン表示 */}
            <div className="text-5xl font-bold font-mono tracking-wider">
              {formatTime(timeLeft)}
            </div>
            
            {/* プログレスバー */}
            <div className="w-full mt-2">
              <Progress 
                value={calculateProgress()} 
                className={`h-2 ${MODES[mode].color}`} 
              />
            </div>
          </div>
          
          {/* コントロールボタン */}
          <div className="flex justify-center space-x-2 pt-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-[#404550] text-white hover:text-white hover:bg-[#404550]"
                    onClick={toggleTimer}
                  >
                    {isActive ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-[#404550] text-white">
                  <p>{isActive ? "一時停止" : "開始"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-[#404550] text-white hover:text-white hover:bg-[#404550]"
                    onClick={resetTimer}
                  >
                    <RefreshCw className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-[#404550] text-white">
                  <p>リセット</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            {mode === "WORK" ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="border-[#404550] text-white hover:text-white hover:bg-[#404550]"
                      onClick={() => changeMode("BREAK")}
                    >
                      <Coffee className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-[#404550] text-white">
                    <p>休憩モードに切り替え</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="border-[#404550] text-white hover:text-white hover:bg-[#404550]"
                      onClick={() => changeMode("WORK")}
                    >
                      <Brain className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-[#404550] text-white">
                    <p>作業モードに切り替え</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </CardContent>
      
      {/* フッター部分 */}
      <CardFooter className="justify-between pt-2 pb-4 px-6 text-xs text-gray-300">
        <div className="flex items-center gap-1">
          <TimerIcon className="h-3.5 w-3.5 opacity-70" />
          <span>次: {getNextModeName()}</span>
        </div>
      </CardFooter>
    </Card>
  );
} 