"use client";

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
import { usePomodoro } from "@/hooks/use-pomodoro";
import { POMODORO_MODES, TimerMode } from "@/lib/store";

export default function PomodoroTimer() {
  const {
    mode,
    formattedTimeLeft,
    isActive,
    progress,
    workSessionsCompleted,
    currentMode,
    startTimer,
    pauseTimer,
    resetTimer,
    switchMode
  } = usePomodoro();

  return (
    <Card className="w-full max-w-sm mx-auto">
      <CardContent className="pt-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <TimerIcon className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-medium">ポモドーロタイマー</h3>
          </div>
          
          <Badge 
            variant="outline" 
            className={`${currentMode.color} text-white`}
          >
            {currentMode.name}
          </Badge>
        </div>
        
        <div className="text-center my-8">
          <div className="text-4xl font-bold tracking-tighter">
            {formattedTimeLeft}
          </div>
        </div>
        
        <Progress 
          value={progress} 
          className={`h-2 ${currentMode.color}`} 
        />
        
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>0:00</span>
          <span>
            {mode === 'WORK' ? '25:00' : mode === 'BREAK' ? '5:00' : '15:00'}
          </span>
        </div>

        <div className="flex justify-center gap-2 mt-6">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => switchMode('WORK')}
                  className={`rounded-full ${mode === 'WORK' ? 'border-amber-500 border-2' : ''}`}
                >
                  <Brain className="h-4 w-4 text-amber-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>作業モード (25分)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => switchMode('BREAK')}
                  className={`rounded-full ${mode === 'BREAK' ? 'border-green-500 border-2' : ''}`}
                >
                  <Coffee className="h-4 w-4 text-green-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>休憩モード (5分)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
      
      <CardFooter className="flex justify-between pt-0">
        <div className="text-sm text-muted-foreground">
          作業完了: <span className="font-medium">{workSessionsCompleted}回</span>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={resetTimer}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {isActive ? (
            <Button
              variant="outline"
              size="icon"
              onClick={pauseTimer}
            >
              <Pause className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={startTimer}
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
} 