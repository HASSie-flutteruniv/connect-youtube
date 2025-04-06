"use client";

import { useEffect, useState, useRef } from "react";
import Room from "@/components/Room";
import { Card } from "@/components/ui/card";
import FocusRoom from "@/components/FocusRoom";
import Header from "@/components/Header";
import BGMPlayer from "@/components/BGMPlayer";

interface Seat {
  id: string;
  username: string | null;
  task?: string | null;
  enterTime?: Date | string | null;
  autoExitScheduled?: Date | string | null;
  timestamp: Date | string;
}

interface RoomData {
  id: string;
  seats: Seat[];
  type?: 'focus' | 'chat'; // フォーカスルームか会話可能なルームかを区別
}

export default function Home() {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  
  useEffect(() => {
    // Connect to SSE endpoint for real-time updates
    const connectSSE = () => {
      // 既存の接続があれば閉じる
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      
      const eventSource = new EventSource('/api/sse');
      eventSourceRef.current = eventSource;
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSEから受信したデータ:', data); 
          
          if (data.rooms && Array.isArray(data.rooms)) {
            console.log(`SSEから${data.rooms.length}部屋のデータを受信しました`);
            if (data.rooms.length > 0) {
              console.log('最初の部屋のシート数:', data.rooms[0].seats?.length || 0);
            }
            setRooms(data.rooms);
          } else {
            console.error('SSEから有効なrooms配列を受信できませんでした:', data);
          }
        } catch (err) {
          console.error('SSEデータの解析エラー:', err, event.data);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        eventSource.close();
        
        // エラー発生時には30秒後に再接続を試みる
        setTimeout(() => {
          console.log('SSE再接続を試みます...');
          setRooms([]); // 状態をリセット
          connectSSE(); // 再接続
        }, 30000);
      };
    };
    
    // 初回接続
    connectSSE();
    
    // YouTubeコメント取得のポーリング追加
    const fetchYoutubeComments = async () => {
      try {
        console.log('YouTubeコメントの取得を開始');
        const response = await fetch('/api/youtube-comments');
        const data = await response.json();
        console.log('YouTubeコメントの取得結果:', data);
      } catch (error) {
        console.error('YouTubeコメント取得エラー:', error);
      }
    };
    
    // 初回実行
    fetchYoutubeComments();
    
    // 定期的に実行 (10秒ごと)
    const commentInterval = setInterval(fetchYoutubeComments, 10000);

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      clearInterval(commentInterval);
    };
  }, []);

  // フォーカスルームとチャットルームを分離
  const focusRooms = rooms.filter(room => room.type === 'focus');
  const chatRooms = rooms.filter(room => room.type === 'chat' || !room.type);

  return (
    <main className="min-h-screen bg-[#505762] pt-20">
      {/* ヘッダー */}
      <Header />
      
      {/* メインコンテンツ */}
      <div className="container mx-auto px-4 py-4 pt-24">
        {/* 参加者情報 */}
        <Card className="mb-4 bg-[#f2f2f2]/95 shadow-md">
          <div className="p-4">
            <h2 className="font-medium text-lg mb-2">現在の参加者</h2>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>オンライン: 24人</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">すべて</button>
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">ルーム1</button>
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">ルーム2</button>
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">ルーム3</button>
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">ルーム4</button>
              <button className="px-3 py-1 bg-gray-200 rounded-full text-sm">ルーム5</button>
            </div>
          </div>
        </Card>
        
        {/* フォーカスルーム */}
        <div className="mb-4">
          {rooms.length > 0 && rooms.some(room => room.seats && room.seats.length > 0) ? (
            // SSEから受け取ったデータを使用
            // すべての座席を一つのフォーカスルームとして表示
            <FocusRoom 
              seats={rooms.flatMap(room => room.seats || [])}
              roomId="focus-room"
            />
          ) : (
            // データロード中の表示
            <div className="bg-[#f2f2f2]/95 rounded-lg p-8 text-center text-gray-600">
              座席情報を読み込み中...
            </div>
          )}
        </div>
        
        {/* BGM */}
        <BGMPlayer />
        
        {/* チャットルーム（非表示） */}
        <div className="hidden">
          {chatRooms.map(room => (
            <Room key={room.id} room={room} />
          ))}
        </div>
      </div>
      
      {/* フッター */}
      <footer className="py-6 border-t border-white/10 text-white/70">
        <div className="container mx-auto px-4 text-center text-sm">
          <p>© 2023 focuscraft - プライバシー・ポリシー・利用規約</p>
        </div>
      </footer>
    </main>
  );
}