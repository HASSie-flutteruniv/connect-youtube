import Image from "next/image";
import { calculateElapsedTime, getElapsedTimeStyle } from "@/lib/utils";
import { useState, useEffect } from "react";

interface UserCardProps {
  user: {
    id: string;
    name: string;
    avatar?: string;
    task?: string | null;
    autoExitTime?: Date | string | null;
    enterTime?: Date | string | null;
  }
}

export default function UserCard({ user }: UserCardProps) {
  // Hydration Errorを防ぐためにクライアントサイドでのみ計算する
  const [mounted, setMounted] = useState(false);
  const [displayTime, setDisplayTime] = useState<string>("0分");
  const [timeStyle, setTimeStyle] = useState<string>("text-blue-400");
  
  useEffect(() => {
    setMounted(true);
    
    // 経過時間を更新する関数
    const updateElapsedTime = () => {
      if (user.enterTime) {
        const elapsedTime = calculateElapsedTime(user.enterTime);
        const style = getElapsedTimeStyle(user.enterTime);
        setDisplayTime(elapsedTime || "0分");
        setTimeStyle(style || "text-blue-400");
      }
    };
    
    // 初回計算
    updateElapsedTime();
    
    // 1分ごとに経過時間を更新するタイマーを設定
    const intervalId = setInterval(updateElapsedTime, 60000); // 60秒 = 1分
    
    // コンポーネントのアンマウント時にタイマーをクリア
    return () => clearInterval(intervalId);
  }, [user.enterTime]); // user.enterTimeが変更されたときに再実行
  
  return (
    <div className="bg-white rounded-lg p-3 flex flex-col shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-medium text-gray-800 truncate">{user.name}</h4>
        <span className={`text-xs font-semibold ${mounted ? timeStyle : "text-blue-400"}`}>
          経過: {displayTime}
        </span>
      </div>
      <p className="text-xs text-gray-600 truncate">{user.task || '作業中'}</p>
    </div>
  );
} 