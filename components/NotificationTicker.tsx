import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image'; // Image コンポーネントをインポート
import { User } from 'lucide-react'; // User アイコンをインポート

// お知らせデータの型
export interface Notification {
  id: string; // 一意のID
  message: string;
  timestamp: number; // ソートや識別に利用
  type?: 'info' | 'warning' | 'error'; // タイプに応じてスタイル変更も可能
  profileImageUrl?: string | null; // ユーザーアイコンURL (追加)
}

interface NotificationTickerProps {
  notifications: Notification[]; // 親コンポーネントから渡される通知リスト (最新が先頭)
  intervalDuration?: number; // 表示切り替え間隔（ミリ秒）
  className?: string;
}

const DEFAULT_INTERVAL = 5000; // デフォルト5秒

const NotificationTicker: React.FC<NotificationTickerProps> = ({
  notifications,
  intervalDuration = DEFAULT_INTERVAL,
  className = '',
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevNotificationsRef = useRef<Notification[]>([]);

  // notifications配列が更新されたらcurrentIndexを0に戻す
  useEffect(() => {
    // 最新の通知IDが変わったか、または通知が初めて追加された場合
    if (
        notifications.length > 0 &&
        prevNotificationsRef.current.length > 0 &&
        notifications[0].id !== prevNotificationsRef.current[0].id
       ) {
         console.log('[Ticker] New notification detected, resetting index.');
         setCurrentIndex(0);
         // インターバルを即座にリセットして新しい通知から開始
         startInterval();
    } else if (notifications.length === 1 && prevNotificationsRef.current.length === 0) {
        console.log('[Ticker] First notification added, setting index to 0.');
        setCurrentIndex(0);
    } else if (notifications.length > 0 && currentIndex >= notifications.length) {
        // 通知が削除されてインデックスが範囲外になった場合
        console.log('[Ticker] Index out of bounds due to notification removal, resetting index.');
        setCurrentIndex(0);
    }

    // 現在の通知リストを保存
    prevNotificationsRef.current = notifications;

  }, [notifications]); // notifications 配列自体が変更されたときのみ実行

  // 自動スクロール用のインターバル設定
  const startInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isPaused && notifications.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % notifications.length);
      }, intervalDuration);
    }
  };

  useEffect(() => {
    startInterval(); // コンポーネントマウント時、または依存関係変更時にインターバルを開始/再開

    return () => { // クリーンアップ関数
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, notifications.length, intervalDuration]); // isPaused, notifications.length, intervalDuration が変わったら再設定

  // 現在表示する通知を取得
  const currentNotification = notifications[currentIndex];

  const handleMouseEnter = () => setIsPaused(true);
  const handleMouseLeave = () => setIsPaused(false);

  // タイプに応じたスタイルを返すヘルパー関数
  const getNotificationStyle = (type?: 'info' | 'warning' | 'error') => {
    switch (type) {
      case 'error': return 'text-red-600'; // 濃い色に変更
      case 'warning': return 'text-yellow-600'; // 濃い色に変更
      default: return 'text-gray-700'; // デフォルトのテキスト色を変更
    }
  };

  return (
    <div
      className={`bg-[#f2f2f2]/70 backdrop-blur-sm text-gray-700 py-2 px-4 overflow-hidden h-10 flex items-center rounded-lg shadow-md border border-white/20 ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="region"
      aria-live="polite" // スクリーンリーダーに更新を通知
      aria-atomic="true"
    >
      {notifications.length === 0 ? (
        <span className="text-sm opacity-60 w-full text-center">お知らせはありません</span>
      ) : (
        <div className="w-full text-center relative h-full flex items-center justify-center">
          {/* AnimatePresenceで切り替えアニメーション */}
          <AnimatePresence initial={false} mode="wait">
            <motion.div // span を div に変更し、内部にアイコンとテキストを配置
              key={currentNotification?.id ?? 'empty'} // key を変更して再レンダリングをトリガー
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className={`absolute inset-0 flex items-center justify-center px-10 ${getNotificationStyle(currentNotification?.type)}`} // 中央揃え
              aria-label={`お知らせ ${currentIndex + 1}/${notifications.length}`}
            >
              {/* アイコン表示 */} 
              <div className="flex-shrink-0 w-5 h-5 mr-2">
                {currentNotification?.profileImageUrl ? (
                  <>
                    <Image
                      src={currentNotification.profileImageUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="rounded-full object-cover"
                      onError={(e) => {
                        // 画像読み込みエラー時にデフォルトアイコンを表示するためのハンドリング（オプション）
                        console.warn('Ticker Image Error:', e.currentTarget.src);
                        // 必要であれば、ここでstateを更新してデフォルトアイコンに切り替える
                        e.currentTarget.style.display = 'none'; // 画像を隠す
                        const fallback = e.currentTarget.nextElementSibling; // 次の要素（デフォルトアイコン）を取得
                        if (fallback) fallback.classList.remove('hidden'); // デフォルトアイコンを表示
                      }}
                      unoptimized
                    />
                    {/* 画像エラー時のフォールバック用 User アイコン (初期状態は隠す) */}
                    <User className="w-full h-full text-gray-400 hidden" />
                  </>
                ) : (
                  <User className="w-full h-full text-gray-400" /> // デフォルトアイコン
                )}
              </div>

              {/* メッセージ表示 (truncate) */}
              <span className={`truncate ${getNotificationStyle(currentNotification?.type)}`}>
                {currentNotification?.message}
              </span>

            </motion.div>
          </AnimatePresence>

          {/* ページネーション表示 (オプション) */}
          {notifications.length > 1 && (
             <div className="absolute bottom-1 right-2 text-xs opacity-50 select-none text-gray-500">
               {currentIndex + 1} / {notifications.length}
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationTicker; 