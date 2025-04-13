"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import useSWR from 'swr'; // データ取得にSWRを使用 (なければインストール必要: npm install swr)
import { formatDistanceToNow } from 'date-fns'; // 日付表示用 (なければインストール: npm install date-fns)
import { ja } from 'date-fns/locale'; // 日本語ロケール

// APIから返されるお知らせデータの型
interface Announcement {
  _id: string;
  message: string;
  authorName?: string;
  profileImageUrl?: string;
  createdAt: string; // APIからは文字列で来る想定
  publishedAt: string; // APIからは文字列で来る想定
}

// データ取得用のfetcher関数
const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function AnnouncementsTicker() {
  const { data: announcements, error } = useSWR<Announcement[]>('/api/announcements', fetcher, {
    refreshInterval: 60000 // 60秒ごとに再取得 (適宜調整)
  });
  const [currentIndex, setCurrentIndex] = useState(0);

  // 5秒ごとにお知らせを切り替え
  useEffect(() => {
    if (!announcements || announcements.length === 0) return;

    const intervalId = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % announcements.length);
    }, 5000); // 切り替え間隔（ミリ秒）

    return () => clearInterval(intervalId);
  }, [announcements]);

  if (error) {
    console.error("Error fetching announcements:", error);
    // エラー時の表示を半透明に変更
    return (
        <div className="bg-red-100/70 backdrop-blur-sm border-l-4 border-red-500/70 text-red-700 p-3 text-sm flex items-center space-x-2 h-10 overflow-hidden rounded-md shadow-sm">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span>運営からのお知らせ取得エラー</span>
        </div>
    );
  }

  if (!announcements) {
    // ローディング表示を半透明に変更
    return (
      <div className="bg-blue-50/70 backdrop-blur-sm border-l-4 border-blue-400/70 text-blue-700 p-3 text-sm flex items-center space-x-2 h-10 overflow-hidden rounded-md shadow-sm">
          <Info className="h-5 w-5 flex-shrink-0 animate-pulse" />
          <span>お知らせを読み込み中...</span>
      </div>
    );
  }

  if (announcements.length === 0) {
    // お知らせがない場合の表示を半透明に変更
    return (
      <div className="bg-gray-100/70 backdrop-blur-sm border-l-4 border-gray-400/70 text-gray-600 p-3 text-sm flex items-center space-x-2 h-10 overflow-hidden rounded-md shadow-sm">
          <Info className="h-5 w-5 flex-shrink-0" />
          <span>現在、運営からのお知らせはありません。</span>
      </div>
    );
  }

  const currentAnnouncement = announcements[currentIndex];

  // フォールバック表示を半透明に変更
  if (!currentAnnouncement) {
    return (
        <div className="bg-gray-100/70 backdrop-blur-sm border-l-4 border-gray-400/70 text-gray-600 p-3 text-sm flex items-center space-x-2 h-10 overflow-hidden rounded-md shadow-sm">
            <Info className="h-5 w-5 flex-shrink-0" />
            <span>お知らせの読み込みに問題があります。</span>
        </div>
    );
  }

  // createdAt を Date オブジェクトに変換（エラーハンドリング付き）
  let timeAgo = '不明';
  try {
      const createdAtDate = new Date(currentAnnouncement.createdAt);
      if (!isNaN(createdAtDate.getTime())) {
          timeAgo = formatDistanceToNow(createdAtDate, { addSuffix: true, locale: ja });
      }
  } catch (e) {
      console.error("Error parsing announcement date:", e);
  }


  return (
    // メインのお知らせ表示を半透明に変更
    <div className="bg-yellow-50/70 backdrop-blur-sm border-l-4 border-yellow-400/70 text-yellow-800 p-3 text-sm flex items-center space-x-2 h-10 overflow-hidden rounded-md shadow-sm">
      <Info className="h-5 w-5 flex-shrink-0 text-yellow-500" />
      {currentAnnouncement.profileImageUrl && (
          <img src={currentAnnouncement.profileImageUrl} alt={currentAnnouncement.authorName || '運営者'} className="h-6 w-6 rounded-full flex-shrink-0" />
      )}
      <span className="font-semibold mr-1">{currentAnnouncement.authorName || '運営'}より ({timeAgo}):</span>
      <span className="flex-grow truncate">{currentAnnouncement.message}</span>
    </div>
  );
} 