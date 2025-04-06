import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { VolumeX } from "lucide-react";
import UserCard from "@/components/UserCard";

interface Seat {
  id: string;
  username: string | null;
  task?: string | null;
  enterTime?: Date | string | null;
  autoExitScheduled?: Date | string | null;
  profileImageUrl?: string | null;
  timestamp: Date | string;
}

interface FocusRoomProps {
  seats: Seat[];
  roomId: string;
}

export default function FocusRoom({ seats, roomId }: FocusRoomProps) {
  // デバッグ: 受け取った座席データをログに出力
  console.log(`[FocusRoom] Received ${seats.length} seats for room ${roomId}`);
  
  // プロフィール画像URLを持つ座席をログ出力
  const seatsWithImages = seats.filter(seat => seat.profileImageUrl && seat.username);
  if (seatsWithImages.length > 0) {
    console.log(`[FocusRoom] Found ${seatsWithImages.length} seats with profile images:`);
    seatsWithImages.forEach(seat => {
      console.log(`- ${seat.username}: ${seat.profileImageUrl}`);
    });
  } else {
    console.log(`[FocusRoom] No seats with profile images found`);
  }
  
  const [currentUserPage, setCurrentUserPage] = useState(0);
  const [userAnimationState, setUserAnimationState] = useState("idle");
  const [nextUserPageToShow, setNextUserPageToShow] = useState(1);
  const userSliderRef = useRef(null);
  
  const USERS_PER_PAGE = 8; // 2x4グリッドの場合
  const activeSeats = seats.filter(seat => seat.username !== null);
  const TOTAL_USER_PAGES = Math.ceil(activeSeats.length / USERS_PER_PAGE) || 1;
  
  useEffect(() => {
    // 5秒ごとに自動でページを切り替え
    const pageInterval = setInterval(() => {
      if (TOTAL_USER_PAGES <= 1) return; // 1ページ以下の場合は切り替えない
      
      const nextPage = (currentUserPage + 1) % TOTAL_USER_PAGES;
      setNextUserPageToShow(nextPage);
      setUserAnimationState("sliding-out");
      
      // アニメーション処理
      setTimeout(() => {
        setCurrentUserPage(nextPage);
        setUserAnimationState("sliding-in");
        setTimeout(() => setUserAnimationState("idle"), 800);
      }, 800);
    }, 5000);
    
    return () => clearInterval(pageInterval);
  }, [currentUserPage, TOTAL_USER_PAGES]);
  
  // 現在のページのユーザーを取得
  const getCurrentPageUsers = () => {
    const startIndex = currentUserPage * USERS_PER_PAGE;
    return activeSeats.slice(startIndex, startIndex + USERS_PER_PAGE);
  };
  
  // 次のページのユーザーを取得
  const getNextPageUsers = () => {
    const startIndex = nextUserPageToShow * USERS_PER_PAGE;
    return activeSeats.slice(startIndex, startIndex + USERS_PER_PAGE);
  };

  // デバッグ: 最初のページのユーザーデータをログ出力
  useEffect(() => {
    const currentUsers = getCurrentPageUsers();
    if (currentUsers.length > 0) {
      console.log(`[FocusRoom] First page users (${currentUsers.length}):`);
      currentUsers.forEach((user, index) => {
        console.log(`User ${index}: ${user.username}, profileImageUrl: ${user.profileImageUrl || 'none'}`);
      });
    }
  }, [activeSeats]); // activeSeatsが変わったときだけ実行

  return (
    <div className="bg-[#f2f2f2]/95 rounded-lg shadow-md overflow-hidden mb-4">
      <div className="p-4 flex justify-between items-center border-b border-gray-200">
        <div className="flex items-center gap-2">
          <VolumeX className="h-5 w-5 text-red-500" />
          <h3 className="text-lg font-medium">フォーカスルーム</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-red-500 text-white text-xs px-2 py-0.5">会話不可</Badge>
          <Badge variant="outline" className="bg-white text-gray-600 border-gray-300">{activeSeats.length}人</Badge>
        </div>
      </div>

      <div className="relative min-h-[400px]" ref={userSliderRef}>
        <div className="p-4">
          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-4 transition-all duration-800 ease-in-out ${
              userAnimationState === "sliding-out"
                ? "card-slide-out"
                : userAnimationState === "sliding-in"
                  ? "card-slide-in"
                  : ""
            }`}
          >
            {userAnimationState === "sliding-in"
              ? getNextPageUsers().map(seat => (
                  <UserCard 
                    key={seat.id} 
                    user={{
                      id: seat.id,
                      name: seat.username || '',
                      task: seat.task,
                      enterTime: seat.enterTime,
                      profileImageUrl: seat.profileImageUrl
                    }} 
                  />
                ))
              : getCurrentPageUsers().map(seat => (
                  <UserCard 
                    key={seat.id} 
                    user={{
                      id: seat.id,
                      name: seat.username || '',
                      task: seat.task,
                      enterTime: seat.enterTime,
                      profileImageUrl: seat.profileImageUrl
                    }} 
                  />
                ))
            }
          </div>
        </div>
      </div>

      <div className="px-4 py-2 bg-gray-100 border-t border-gray-200 flex justify-center">
        <div className="flex gap-2">
          {Array.from({ length: TOTAL_USER_PAGES }).map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full ${currentUserPage === index ? "bg-amber-500" : "bg-gray-300"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
} 