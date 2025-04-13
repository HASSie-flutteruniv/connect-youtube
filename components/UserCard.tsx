import Image from "next/image";
import { calculateElapsedTime, getElapsedTimeStyle } from "@/lib/client-utils";
import { useState, useEffect } from "react";
import AutoExitStatus from "./AutoExitStatus";
import { User } from "lucide-react";

interface UserCardProps {
  user: {
    id: string;
    name: string;
    avatar?: string;
    task?: string | null;
    autoExitScheduled?: Date | string | null;
    enterTime?: Date | string | null;
    profileImageUrl?: string | null;
  };
  roomId?: string;
  position?: number;
}

export default function UserCard({ user, roomId, position }: UserCardProps) {
  // デバッグ用ログ出力
  console.log(`[UserCard] Rendering user: ${user.name}, profileImageUrl:`, user.profileImageUrl);
  
  // Hydration Errorを防ぐためにクライアントサイドでのみ計算する
  const [mounted, setMounted] = useState(false);
  const [displayTime, setDisplayTime] = useState<string>("0分");
  const [timeStyle, setTimeStyle] = useState<string>("text-blue-400");
  const [imageError, setImageError] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    setImageError(false);
    
    // デバッグ: コンポーネントマウント時のプロパティを出力
    console.log(`[UserCard] useEffect - User ${user.name}:`, {
      profileImageUrl: user.profileImageUrl,
      validUrl: user.profileImageUrl && typeof user.profileImageUrl === 'string' && user.profileImageUrl.startsWith('http')
    });
    
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
  }, [user.enterTime, user.profileImageUrl, user.name]); // profileImageUrlが変更されたときもリセット
  
  // プロフィール画像URLが有効かチェック (必ずhttpで始まるURLであることを確認)
  const validProfileUrl = user.profileImageUrl && 
    typeof user.profileImageUrl === 'string' && 
    user.profileImageUrl.startsWith('http');
  
  // 有効なプロフィール画像URLかつエラーが発生していない場合
  const hasValidProfileImage = validProfileUrl && !imageError;
  
  const handleImageError = () => {
    console.log('[UserCard] プロフィール画像の読み込みに失敗:', user.profileImageUrl);
    setImageError(true);
  };
  
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 flex flex-col shadow-sm border border-white/30">
      <div className="flex items-center gap-2 mb-1">
        {hasValidProfileImage ? (
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-100">
            <Image 
              src={user.profileImageUrl as string} 
              alt={user.name} 
              width={32} 
              height={32}
              className="w-full h-full object-cover"
              onError={handleImageError}
              unoptimized // 画像最適化を無効化
            />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200/80 flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-gray-500" />
          </div>
        )}
        <div className="flex flex-col flex-grow min-w-0">
          <h4 className="font-medium text-gray-800 truncate">{user.name}</h4>
          <span className={`text-xs font-semibold ${mounted ? timeStyle : "text-blue-400"}`}>
            経過: {displayTime}
          </span>
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-1 pl-10">
        <p className="text-xs text-gray-600 truncate">{user.task || '作業中'}</p>
        
        {/* 自動退室時間が設定されている場合、コンパクトモードで表示 */}
        {user.autoExitScheduled && (
          <AutoExitStatus 
            scheduledTime={typeof user.autoExitScheduled === 'string' 
              ? user.autoExitScheduled 
              : user.autoExitScheduled instanceof Date 
                ? user.autoExitScheduled.toISOString() 
                : null}
            seatId={user.id}
            roomId={roomId}
            position={position}
            isCompact={true}
          />
        )}
      </div>
    </div>
  );
} 