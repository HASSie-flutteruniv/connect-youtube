"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Room from "@/components/Room";
import { Card } from "@/components/ui/card";
import FocusRoom from "@/components/FocusRoom";
import Header from "@/components/Header";
import NotificationTicker, { Notification } from "@/components/NotificationTicker";
import AnnouncementsTicker from "@/components/AnnouncementsTicker";
import { toast } from "@/hooks/use-toast";
import { RoomData } from "@/hooks/use-seat-data";
import { useSSE, SystemMessage } from "@/hooks/use-sse";
import { useYouTubeComments } from "@/hooks/use-youtube-comments";
import { youtubeService } from "@/lib/api/services/youtubeService";
import { SSEData } from "@/lib/api/sse/sseTypes";
import { AlertCircle, WifiOff, Loader2, Youtube, Video } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import VideoBackground from "@/components/VideoBackground";
import LargeLogo from "@/components/LargeLogo";

const MAX_NOTIFICATIONS = 20;


export default function Home() {
  // YouTubeの動画ID
  const [videoId, setVideoId] = useState<string>("");
  
  // 独自のSSE接続を使用
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  // コマンド処理の状態管理を提供するuseYouTubeCommentsフックを使用
  const processingCommandsRef = useRef<Set<string>>(new Set());

  // お知らせメッセージ処理
  const handleSystemMessage = useCallback((messagePayload: SystemMessage) => {
    console.log('[Page] System Message Received:', messagePayload);
    const newNotification: Notification = {
      // バックエンドでIDが付与されていない場合、クライアントで生成
      id: messagePayload.id || `${Date.now()}-${Math.random()}`,
      message: messagePayload.message,
      timestamp: new Date(messagePayload.timestamp).getTime(),
      type: messagePayload.type,
    };

    setNotifications(prev => {
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
    console.log('[Page] handleSeatDataMessage called. Received data:', JSON.stringify(data, null, 2));

    if (data.rooms && Array.isArray(data.rooms)) {
      console.log('[Page] Received data:', data);
      console.log(`[Page] Received ${data.rooms.length} rooms from SSE. Updating state...`);
      setRooms(data.rooms);
    } else if (data.error) {
      console.error('[Page] Error in SSE data:', data.error);
      // エラー通知はお知らせティッカーかトーストで表示
      handleSystemMessage({ 
        message: data.error, 
        type: 'error', 
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn('[Page] Received unexpected SSE data format:', data);
    }
  }, [handleSystemMessage]);

  // SSE接続フック
  const {
    connectionState,
    connect: refreshData,
    disconnect,
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
  console.log('[Page] Current connection state:', connectionState); // 常に最新の接続状態をログ出力

  // コマンド処理ハンドラ
  const handleCommands = useCallback(async (commands: Command[]) => {
    console.log(`${commands.length}件のコマンドを処理します:`, commands);
    
    // 各コマンドを処理
    for (const cmd of commands) {
      await processCommand(cmd);
    }
  }, []);

  // YouTubeコメント取得とコマンド処理フック
  const { 
    isProcessingCommand, 
    error: ytError, 
    startPolling, 
    stopPolling, 
    isInitialized 
  } = useYouTubeComments({
    enabled: isMounted && !!videoId,
    onCommandsDetected: handleCommands,
    videoId,
    onError: (error) => {
      console.error('[Page] YouTube error:', error);
      
      // 重要なエラーはトーストで通知
      if (error.includes('ライブチャットID') || error.includes('動画ID')) {
        toast({
          title: 'YouTubeエラー',
          description: error,
          variant: 'destructive',
        });
      }
    }
  });

  // 個々のコマンドを処理する関数
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
      
      // コマンド実行APIをコール（サービスクラス経由）
      const result = await youtubeService.executeCommand({
        command: command.command,
        username: command.authorName,
        authorId: command.authorId,
        videoId: command.commentId.split('_')[0], // コメントIDからビデオID部分を抽出
        taskName: command.taskName,
        profileImageUrl: command.profileImageUrl // プロフィール画像URLを追加
      });
      
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
          handleSystemMessage({
            id: `work-${command.commentId}`,
            message: `${command.authorName} が入室しました (タスク: ${command.taskName || '未設定'})`,
            type: 'info',
            timestamp: new Date().toISOString(),
          });
        } else if (command.command === 'finish') {
          handleSystemMessage({
            id: `finish-${command.commentId}`,
            message: `${command.authorName} が退室しました`,
            type: 'info',
            timestamp: new Date().toISOString(),
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

  // isLoading状態の計算 - 修正：部屋データが存在する場合はロード中とみなさない
  const isLoading = (connectionState === 'connecting' || connectionState === 'reconnecting') && rooms.length === 0;
  
  // デバッグログ追加
  useEffect(() => {
    console.log(`[Page] SSE connection state changed to: ${connectionState}, isLoading: ${isLoading}, rooms: ${rooms.length}`);
    // 接続状態が変更されたら強制的に再レンダリングをトリガーする
    if (connectionState === 'connected' && rooms.length === 0) {
      // 接続済みだがデータがない場合は、データ更新を試みる
      refreshData();
    }
  }, [isLoading, rooms.length, refreshData]);

  // マウント状態を設定する useEffect
  useEffect(() => {
    console.log('[Page] Component mounted. Setting isMounted to true');
    setIsMounted(true);
  }, []);

  // ★ SSE接続用の useEffect (isMounted で制御)
  useEffect(() => {
    if (isMounted) {
      console.log("[Page] Attempting to connect SSE after mount. Current state:", {
        connectionState,
        isLoading,
        roomsLength: rooms.length
      });
      
      // 接続用リクエストを一度だけ行う
      const connectSSE = () => {
        console.log("[Page] Executing SSE connect request");
        refreshData();
      };
      
      connectSSE();
      
      // コンポーネントのアンマウント時に切断
      return () => {
        console.log("[Page] Disconnecting SSE on cleanup...");
        disconnect();
      };
    }
  }, [isMounted]); // isMounted のみに依存

  // フォーカスルームとチャットルームを分離
  const chatRooms = rooms.filter(room => room.type === 'chat' || !room.type);

  // 接続状態に応じたメッセージを表示
  const renderConnectionStatus = () => {
    // YouTube動画IDが設定されていない場合は表示しない
    if (!videoId) return null;
    
    console.log(`[Page] Rendering connection status for state: ${connectionState}`); // ログ追加

    // 接続ステータスごとの表示を実装
    switch (connectionState) {
      case 'connecting':
        return (
          <Alert className="mb-4 bg-yellow-50/70 backdrop-blur-sm border-yellow-200/50">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <AlertTitle>接続中...</AlertTitle>
            <AlertDescription>
              サーバーに接続しています。しばらくお待ちください。
            </AlertDescription>
          </Alert>
        );
      case 'reconnecting':
        return (
          <Alert className="mb-4 bg-yellow-50/70 backdrop-blur-sm border-yellow-200/50">
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
          <Alert variant="destructive" className="mb-4 bg-red-50/70 backdrop-blur-sm border-red-200/50">
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
          <Alert className="mb-4 bg-gray-100/70 backdrop-blur-sm border-gray-200/50">
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
      case 'connected':
        // 接続済みなら何も表示しない、もしくは小さな成功メッセージを表示
        if (rooms.length === 0) {
          return (
            <Alert className="mb-4 bg-blue-50/70 backdrop-blur-sm border-blue-200/50">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <AlertTitle>接続済み（データなし）</AlertTitle>
              <AlertDescription>
                サーバーに接続しましたが、部屋データが見つかりません。
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      default:
        // デフォルトケースも追加して、万が一の場合に対応
        console.warn(`[Page] Unknown connection state: ${connectionState}`);
        return (
          <Alert className="mb-4 bg-gray-100/70 backdrop-blur-sm border-gray-200/50">
            <AlertCircle className="h-4 w-4 text-gray-500" />
            <AlertTitle>不明な接続状態</AlertTitle>
            <AlertDescription>
              接続状態: {connectionState || 'undefined'}
            </AlertDescription>
          </Alert>
        );
    }
  };

  // YouTube動画IDが設定されていない場合の歓迎画面
  const renderWelcomeScreen = () => {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 bg-white/80 backdrop-blur-md rounded-xl shadow-lg">
        <Video className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">YouTubeライブコワーキングスペースへようこそ</h1>
        <p className="text-center text-gray-600 mb-6 max-w-md">
          YouTube動画IDを入力して、ライブ配信のコメントとコワーキングスペースを接続しましょう。
        </p>
        <div className="flex items-center gap-2 p-4 bg-gray-100 rounded-lg text-sm text-gray-700">
          <AlertCircle className="w-4 h-4 text-blue-500" />
          <p>
            ヘッダーの入力欄にYouTube動画IDを入力し「設定」ボタンをクリックしてください。
          </p>
        </div>
      </div>
    );
  };

  // YouTubeエラー表示
  const renderYouTubeError = () => {
    if (!ytError || !videoId) return null;
    
    return (
      <Alert variant="destructive" className="mb-4 bg-red-50/70 backdrop-blur-sm border-red-200/50">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>YouTubeコメント取得エラー</AlertTitle>
        <AlertDescription>
          {ytError}
          <Button 
            variant="outline" 
            size="sm" 
            className="ml-2 mt-2" 
            onClick={() => {
              startPolling();
            }}
          >
            再接続する
          </Button>
        </AlertDescription>
      </Alert>
    );
  };

  return (
    <main className="min-h-screen relative">
      {/* 動画背景を追加 */}
      <VideoBackground videoUrl="/mv_video.mp4" />
      
      {/* 大きなロゴを背景に追加 */}
      <div className="z-0">
        <LargeLogo />
      </div>
      
      {/* ヘッダー */}
      <Header videoId={videoId} onVideoIdChange={setVideoId} />

      {/* メインコンテンツ - z-indexを追加して動画の上に表示 */}
      <div className="container mx-auto px-4 py-4 relative z-10 pt-16 pt-20">
        {/* YouTubeコメント取得エラー表示 */}
        {renderYouTubeError()}
        
        {/* 接続状態表示 */}
        {renderConnectionStatus()}

        {/* YouTube動画IDが設定されていない場合は歓迎画面を表示 */}
        {!videoId ? (
          renderWelcomeScreen()
        ) : (
          <>
            {/* ★★★ お知らせティッカー (運営) ★★★ */}
            <div className="mb-2">
              <AnnouncementsTicker />
            </div>

            {/* 通常通知ティッカー */}
            <div className="mb-4">
              <NotificationTicker notifications={notifications} />
            </div>

            {/* 参加者情報 - 半透明に変更 */}
            <Card className="mb-4 bg-[#f2f2f2]/70 backdrop-blur-sm shadow-md border border-white/20">
              <div className="p-4">
                <h2 className="font-medium text-lg mb-2">現在の参加者</h2>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>オンライン: {rooms.flatMap(room => room.seats?.filter(seat => seat.username) || []).length} 人</span>
                  {isProcessingCommand && (
                    <span className="flex items-center text-sm text-blue-500">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      コマンド処理中...
                    </span>
                  )}
                </div>

                {/* プロフィール画像を表示するエリア */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <TooltipProvider>
                    {(() => {
                      // profileImageUrl が存在する参加者のみをフィルタリング
                      const participants = rooms.flatMap(room => room.seats?.filter(seat => seat.username && seat.profileImageUrl) || []);
                      
                      // フィルタリングされた参加者のみをマップ
                      return participants.map((seat) => (
                        <Tooltip key={seat.id}>
                          <TooltipTrigger asChild>
                            <Avatar className="h-10 w-10 cursor-pointer hover:opacity-80 transition-opacity border-2 border-transparent hover:border-blue-300">
                              <AvatarImage src={seat.profileImageUrl ?? undefined} alt={seat.username || '参加者'} />
                              <AvatarFallback className="text-xs"> 
                                {seat.username ? seat.username.slice(0, 2) : '?'} 
                              </AvatarFallback>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-semibold">{seat.username || '不明'}</p>
                            {seat.task && <p className="text-xs text-muted-foreground">タスク: {seat.task}</p>}
                            {seat.enterTime && <p className="text-xs text-gray-500">入室: {new Date(seat.enterTime).toLocaleTimeString()}</p>}
                          </TooltipContent>
                        </Tooltip>
                      ));
                    })()}
                  </TooltipProvider>
                </div>
              </div>
            </Card>
            
            <div className="mb-4">
              {(() => {
                // ローディング中または初期化されていない場合
                if (isLoading || !isInitialized) {
                  return (
                    <div className="bg-[#f2f2f2]/95 rounded-lg p-8 text-center text-gray-600">
                      <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-gray-400" />
                      座席情報を読み込み中...
                    </div>
                  );
                }
                
                // フォーカスルーム情報があれば表示
                if (rooms.length > 0) {
                  const focusSeatsData = rooms.flatMap(room => room.seats || []);
                  return (
                    <FocusRoom
                      seats={focusSeatsData}
                      roomId="focus-room"
                    />
                  );
                } else {
                  // ルーム情報がない場合
                  return (
                    <div className="bg-[#f2f2f2]/95 rounded-lg p-8 text-center text-gray-600">
                      座席情報が見つかりません。しばらく待つか、YouTube動画IDを確認してください。
                    </div>
                  );
                }
              })()}
            </div>

            {/* チャットルーム（非表示） */}
            <div className="hidden">
              {chatRooms.map(room => (
                <Room key={room.id} room={room} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}