"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Room from "@/components/Room";
import { Card } from "@/components/ui/card";
import FocusRoom from "@/components/FocusRoom";
import Header from "@/components/Header";
import BGMPlayer from "@/components/BGMPlayer";
import NotificationTicker, { Notification } from "@/components/NotificationTicker";
import { toast } from "@/hooks/use-toast";
import { useSeatData, RoomData, Seat } from "@/hooks/use-seat-data";
import { useSSE, SSEConnectionState } from "@/hooks/use-sse";
import { AlertCircle, WifiOff, Loader2 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command } from "@/lib/types";

// 通知の最大保持数
const MAX_NOTIFICATIONS = 20;

// SSEデータの型
interface SSEData {
  rooms: RoomData[];
  error?: string;
}

// システムメッセージの型
interface SystemMessagePayload {
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: string; // ISO String
  id?: string; // バックエンドでユニークIDを付与するのが望ましい
}

export default function Home() {
  // 元のSSEから座席データを取得コードを無効化
  // const { rooms, isLoading, connectionState, refreshData } = useSeatData();
  
  // 独自のSSE接続を使用
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  // コマンド処理の状態管理
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const processingCommandsRef = useRef<Set<string>>(new Set());

  // お知らせメッセージ処理
  const handleSystemMessage = useCallback((messagePayload: SystemMessagePayload) => {
    console.log('[Page] System Message Received:', messagePayload);
    const newNotification: Notification = {
      // バックエンドでIDが付与されていない場合、クライアントで生成
      id: messagePayload.id || `${Date.now()}-${Math.random()}`,
      message: messagePayload.message,
      timestamp: new Date(messagePayload.timestamp).getTime(),
      type: messagePayload.type,
    };

    setNotifications(prev => {
      // 重複チェック（同じメッセージが短時間で複数来ないように）
      // if (prev.length > 0 && prev[0].message === newNotification.message && (Date.now() - prev[0].timestamp < 2000)) {
      //   return prev;
      // }
      const updated = [newNotification, ...prev];
      return updated.slice(0, MAX_NOTIFICATIONS); // 最大件数制限
    });

    // トースト通知も表示
    toast({
      title: messagePayload.type === 'error' ? 'エラー' : 
             messagePayload.type === 'warning' ? '警告' : 'お知らせ',
      description: messagePayload.message,
      variant: messagePayload.type === 'error' ? 'destructive' : 'default',
    });
  }, []);

  // 座席データメッセージ処理
  const handleSeatDataMessage = useCallback((data: SSEData) => {
    if (data.rooms && Array.isArray(data.rooms)) {
      console.log(`[Page] Received ${data.rooms.length} rooms from SSE`);
      setRooms(data.rooms);
    } else if (data.error) {
      console.error('[Page] Error in SSE data:', data.error);
      // エラー通知はお知らせティッカーかトーストで表示
      handleSystemMessage({ 
        message: data.error, 
        type: 'error', 
        timestamp: new Date().toISOString()
      });
    }
  }, [handleSystemMessage]);

  // SSE接続フック
  const {
    connectionState,
    connect: refreshData,
  } = useSSE<SSEData>({
    endpoint: '/api/sse',
    onMessage: handleSeatDataMessage, // 座席データ用ハンドラ
    onSystemMessage: handleSystemMessage, // お知らせ用ハンドラ
    onConnect: () => {
      console.log('[Page] SSE connection established');
    },
    onDisconnect: () => {
      console.log('[Page] SSE connection closed');
    },
    onError: (error) => {
      console.error('[Page] SSE connection error:', error);
    },
    maxRetries: 5, // 最大再試行回数
  });

  // isLoading状態の計算
  const isLoading = connectionState === 'connecting' || connectionState === 'reconnecting';
  
  useEffect(() => {
    // YouTubeコメント取得のポーリング
    const fetchYoutubeComments = async () => {
      try {
        console.log('YouTubeコメントの取得を開始');
        const response = await fetch('/api/youtube-comments');
        
        if (!response.ok) {
          throw new Error(`YouTube API responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // コマンドを処理（あれば）
        if (data.commands && Array.isArray(data.commands) && data.commands.length > 0) {
          console.log(`${data.commands.length}件のコマンドを検出しました:`, data.commands);
          setIsProcessingCommand(true);
          
          // 各コマンドを処理
          for (const cmd of data.commands) {
            await processCommand(cmd);
          }
          
          setIsProcessingCommand(false);
        }
      } catch (error) {
        console.error('YouTubeコメント取得エラー:', error);
        toast({
          title: 'YouTubeコメント取得エラー',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
    };
    
    // コマンドをAPI経由で処理する関数
    const processCommand = async (command: Command) => {
      // 既に処理中のコマンドかチェック（二重実行防止）
      if (processingCommandsRef.current.has(command.commentId)) {
        console.log(`コマンドID ${command.commentId} は既に処理中のためスキップします`);
        return;
      }
      
      // 処理中としてマーク
      processingCommandsRef.current.add(command.commentId);
      
      try {
        console.log(`コマンド処理: ${command.command} by ${command.authorName}`);
        
        // プロフィール画像URLがあるかログ出力
        if (command.profileImageUrl) {
          console.log(`[Page] Command has profile image URL: ${command.profileImageUrl}`);
        } else {
          console.log(`[Page] Command has no profile image URL`);
        }
        
        // コマンド実行APIをコール
        const response = await fetch('/api/commands', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: command.command,
            username: command.authorName,
            authorId: command.authorId,
            videoId: command.commentId.split('_')[0], // コメントIDからビデオID部分を抽出
            taskName: command.taskName,
            profileImageUrl: command.profileImageUrl // プロフィール画像URLを追加
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Command API responded with status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
          console.log(`コマンド ${command.command} の処理成功:`, result);
          
          // デバッグ: データベース更新の確認
          try {
            console.log(`[Page] Checking database for updates after command ${command.command}...`);
            const dbCheckResponse = await fetch('/api/debug/check-db?command=' + command.command + 
              '&username=' + encodeURIComponent(command.authorName) + 
              (command.profileImageUrl ? '&profileImageUrl=' + encodeURIComponent(command.profileImageUrl) : ''));
            
            if (dbCheckResponse.ok) {
              const dbCheckResult = await dbCheckResponse.json();
              console.log(`[Page] Database check result:`, dbCheckResult);
            }
          } catch (checkError) {
            console.warn(`[Page] Error checking database:`, checkError);
          }
          
          // 成功時に通知表示
          if (command.command === 'work') {
            toast({
              title: `${command.authorName} が入室しました`,
              description: `タスク: ${command.taskName || '未設定'}`,
              variant: 'default',
            });
          } else if (command.command === 'finish') {
            toast({
              title: `${command.authorName} が退室しました`,
              variant: 'default',
            });
          }
        } else {
          console.error(`コマンド ${command.command} の処理に失敗:`, result.error);
          toast({
            title: 'コマンド処理エラー',
            description: result.error || '不明なエラーが発生しました',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('コマンド処理中にエラーが発生:', error);
        toast({
          title: 'コマンド処理エラー',
          description: (error as Error).message || 'サーバーとの通信中にエラーが発生しました',
          variant: 'destructive',
        });
      } finally {
        // 処理が完了したらセットから削除（一定時間後）
        setTimeout(() => {
          processingCommandsRef.current.delete(command.commentId);
        }, 10000); // 10秒後に削除
      }
    };
    
    // 初回実行
    fetchYoutubeComments();
    
    // 定期的に実行 (10秒ごと)
    const commentInterval = setInterval(fetchYoutubeComments, 10000);

    return () => {
      clearInterval(commentInterval);
    };
  }, []);

  // フォーカスルームとチャットルームを分離
  const focusRooms = rooms.filter(room => room.type === 'focus');
  const chatRooms = rooms.filter(room => room.type === 'chat' || !room.type);

  // 接続状態に応じたメッセージを表示
  const renderConnectionStatus = () => {
    switch (connectionState) {
      case 'connecting':
        return (
          <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <AlertTitle>接続中...</AlertTitle>
            <AlertDescription>サーバーに接続しています。しばらくお待ちください。</AlertDescription>
          </Alert>
        );
      case 'reconnecting':
        return (
          <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <AlertTitle>再接続中...</AlertTitle>
            <AlertDescription>
              サーバーとの接続が切断されました。再接続を試みています。
              <Button variant="outline" size="sm" className="ml-2 mt-2" onClick={refreshData}>
                今すぐ再接続
              </Button>
            </AlertDescription>
          </Alert>
        );
      case 'error':
        return (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>接続エラー</AlertTitle>
            <AlertDescription>
              サーバーとの接続中にエラーが発生しました。
              <Button variant="outline" size="sm" className="ml-2 mt-2" onClick={refreshData}>
                再接続する
              </Button>
            </AlertDescription>
          </Alert>
        );
      case 'disconnected':
        return (
          <Alert className="mb-4 bg-gray-100 border-gray-200">
            <WifiOff className="h-4 w-4 text-gray-500" />
            <AlertTitle>切断されました</AlertTitle>
            <AlertDescription>
              サーバーとの接続が終了しました。
              <Button variant="outline" size="sm" className="ml-2 mt-2" onClick={refreshData}>
                再接続する
              </Button>
            </AlertDescription>
          </Alert>
        );
      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen bg-[#505762] pt-16"> {/* pt-16 はヘッダー分 */}
      {/* ヘッダー */}
      <Header />

      {/* お知らせティッカー */}
      <NotificationTicker notifications={notifications} />

      {/* メインコンテンツ (pt をお知らせティッカーの高さ分追加) */}
      <div className="container mx-auto px-4 py-4 pt-10"> {/* pt-10 = ticker height */}
        {/* 接続状態表示 */}
        {renderConnectionStatus()}

        {/* 参加者情報 */}
        <Card className="mb-4 bg-[#f2f2f2]/95 shadow-md">
          <div className="p-4">
            <h2 className="font-medium text-lg mb-2">現在の参加者</h2>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>オンライン: {rooms.flatMap(room => room.seats?.filter(seat => seat.username) || []).length}人</span>
              {isProcessingCommand && (
                <span className="flex items-center text-sm text-blue-500">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  コマンド処理中...
                </span>
              )}
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
          {!isLoading && rooms.length > 0 && rooms.some(room => room.seats && room.seats.length > 0) ? (
            <FocusRoom
              seats={rooms.flatMap(room => room.seats || [])}
              roomId="focus-room"
            />
          ) : (
            <div className="bg-[#f2f2f2]/95 rounded-lg p-8 text-center text-gray-600">
              <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-gray-400" />
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