"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePomodoro } from "@/hooks/use-pomodoro";

export default function Console() {
  const [mounted, setMounted] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // ポモドーロタイマーの状態とアクション
  const {
    mode,
    formattedTimeLeft,
    isActive,
    progress,
    currentMode,
    workSessionsCompleted,
    startTimer,
    pauseTimer,
    resetTimer,
    switchMode
  } = usePomodoro();

  // コンソールメッセージ
  const [messages, setMessages] = useState<Array<{ 
    type: string; 
    content: string; 
    timestamp: string;
  }>>([
    { 
      type: 'system', 
      content: 'システムを初期化中...',
      timestamp: new Date().toISOString()
    }
  ]);

  useEffect(() => {
    // マウント状態を設定
    setMounted(true);
    
    // 初期化メッセージを追加
    setTimeout(() => {
      addMessage('system', 'CONNECTシステムへようこそ。');
      setInitialized(true);
      
      // ポモドーロの状態に応じたメッセージを表示
      if (isActive) {
        addMessage('timer', `ポモドーロタイマー実行中：${currentMode.name}モード（${formattedTimeLeft}）`);
      } else {
        addMessage('timer', `ポモドーロタイマー待機中：${currentMode.name}モードで開始する準備ができています。`);
      }
    }, 1500);
  }, []);

  // タイマーの状態が変わったときのメッセージ
  useEffect(() => {
    if (!mounted || !initialized) return;
    
    if (mode === 'WORK') {
      addMessage('timer', '作業モードに切り替わりました。集中して取り組みましょう。');
    } else if (mode === 'BREAK') {
      addMessage('timer', '休憩モードに切り替わりました。短い休憩で気分転換しましょう。');
    } else if (mode === 'LONG_BREAK') {
      addMessage('timer', '長い休憩モードに切り替わりました。十分に休息をとりましょう。');
    }
  }, [mode, mounted, initialized]);

  // メッセージ追加関数
  const addMessage = (type: string, content: string) => {
    setMessages(prev => [
      ...prev, 
      { 
        type, 
        content, 
        timestamp: new Date().toISOString() 
      }
    ]);
    
    // 自動スクロール
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // タイマーコントロール関数
  const handleTimerControl = () => {
    if (isActive) {
      pauseTimer();
      addMessage('timer', 'ポモドーロタイマーを一時停止しました。');
    } else {
      startTimer();
      addMessage('timer', `ポモドーロタイマーを開始しました：${currentMode.name}モード（${formattedTimeLeft}）`);
    }
  };

  // タイマーリセット関数
  const handleTimerReset = () => {
    resetTimer();
    addMessage('timer', 'ポモドーロタイマーをリセットしました。');
  };

  // モード切替関数
  const handleModeSwitch = (newMode: 'WORK' | 'BREAK' | 'LONG_BREAK') => {
    switchMode(newMode);
    addMessage('timer', `タイマーモードを${newMode === 'WORK' ? '作業' : newMode === 'BREAK' ? '休憩' : '長い休憩'}に切り替えました。`);
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* タイマーコントロール */}
      <div className="border-b p-4 flex items-center justify-between bg-background/80 backdrop-blur-sm">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className={`${currentMode.bgColor} w-3 h-3 rounded-full`}></div>
            <h3 className="font-medium">
              {currentMode.name}モード：{formattedTimeLeft}
            </h3>
            {workSessionsCompleted > 0 && (
              <span className="text-xs text-muted-foreground">
                完了セッション：{workSessionsCompleted}
              </span>
            )}
          </div>
          <Progress
            value={progress}
            className={`h-1.5 mt-2 ${currentMode.bgColor}`}
          />
        </div>
        <div className="flex gap-2 ml-4">
          <Button
            variant="outline"
            size="icon"
            onClick={handleTimerControl}
            title={isActive ? "一時停止" : "開始"}
          >
            {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleTimerReset}
            title="リセット"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* コンソール出力エリア */}
      <div className="flex-1 overflow-y-auto p-4 bg-background/40 font-mono text-sm">
        {!mounted ? (
          <>
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2 mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </>
        ) : (
          <>
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`mb-2 ${
                  msg.type === 'error' ? 'text-red-500' : 
                  msg.type === 'system' ? 'text-blue-500' : 
                  msg.type === 'timer' ? 'text-green-500' : 
                  'text-foreground'
                }`}
              >
                <span className="opacity-70">
                  [{new Date(msg.timestamp).toLocaleTimeString()}]
                </span>{' '}
                {msg.content}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  );
} 