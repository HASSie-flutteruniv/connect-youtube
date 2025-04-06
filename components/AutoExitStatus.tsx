import { useState } from 'react';
import { useAutoExit } from '@/hooks/use-auto-exit';
import { Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrentDateTime } from '@/lib/client-utils';

interface AutoExitStatusProps {
  scheduledTime: string | null | undefined;
  seatId?: string;
  roomId?: string;
  position?: number;
  isCompact?: boolean;
  className?: string;
}

/**
 * 自動退室状態を表示するコンポーネント
 */
export default function AutoExitStatus({
  scheduledTime,
  seatId,
  roomId,
  position,
  isCompact = false,
  className = '',
}: AutoExitStatusProps) {
  const { status } = useAutoExit(scheduledTime);
  const [isUpdating, setIsUpdating] = useState(false);

  // 自動退室時間を延長する関数
  const extendAutoExit = async () => {
    if (!roomId || position === undefined) {
      toast({
        title: 'エラー',
        description: '座席情報が不完全です',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsUpdating(true);
      const response = await fetch('/api/extend-auto-exit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          position,
          hours: 2, // 追加で2時間延長
        }),
      });

      if (!response.ok) {
        throw new Error('自動退室時間の延長に失敗しました');
      }

      const data = await response.json();
      
      if (data.success) {
        toast({
          title: '自動退室時間を延長しました',
          description: `新しい退室時間: ${formatCurrentDateTime()}`,
        });
      } else {
        throw new Error(data.error || '自動退室時間の延長に失敗しました');
      }
    } catch (error) {
      console.error('自動退室延長エラー:', error);
      toast({
        title: 'エラー',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // 自動退室が設定されていない場合
  if (!status.isScheduled) {
    return null;
  }

  // コンパクト表示モード（アイコンと時間のみ）
  if (isCompact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex items-center text-xs text-gray-500 ${className}`}>
              <Clock className="h-3 w-3 mr-1" />
              <span>{status.formattedTime}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>自動退室まで: {status.formattedTime}</p>
            {status.scheduledTime && (
              <p className="text-xs">
                退室予定時刻: {status.scheduledTime.toLocaleString()}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // 残り時間が少ない場合の警告表示
  const isWarning = status.remainingTime !== null && status.remainingTime <= 10 * 60 * 1000; // 10分以下
  const isDanger = status.remainingTime !== null && status.remainingTime <= 5 * 60 * 1000;   // 5分以下
  
  return (
    <div className={`bg-gray-50 p-3 rounded-md border ${isWarning ? 'border-amber-300' : 'border-gray-200'} ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center">
          {isDanger ? (
            <AlertCircle className="h-4 w-4 text-red-500 mr-2" />
          ) : isWarning ? (
            <AlertCircle className="h-4 w-4 text-amber-500 mr-2" />
          ) : (
            <Clock className="h-4 w-4 text-blue-500 mr-2" />
          )}
          <div>
            <h4 className={`text-sm font-medium ${isDanger ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-gray-700'}`}>
              自動退室まで
            </h4>
            <p className={`text-lg font-bold ${isDanger ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-blue-600'}`}>
              {status.formattedTime}
            </p>
            {status.scheduledTime && (
              <p className="text-xs text-gray-500 mt-1">
                退室予定時刻: {status.scheduledTime.toLocaleString()}
              </p>
            )}
          </div>
        </div>
        
        {roomId && position !== undefined && (
          <Button
            size="sm"
            variant="outline"
            onClick={extendAutoExit}
            disabled={isUpdating}
            className="ml-2"
          >
            {isUpdating ? '更新中...' : '時間延長'}
          </Button>
        )}
      </div>
    </div>
  );
} 