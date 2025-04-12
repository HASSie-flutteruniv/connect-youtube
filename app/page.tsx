"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Room from "@/components/Room";
import { Card } from "@/components/ui/card";
import FocusRoom from "@/components/FocusRoom";
import Header from "@/components/Header";
import BGMPlayer from "@/components/BGMPlayer";
import NotificationTicker, { Notification } from "@/components/NotificationTicker";
import AnnouncementsTicker from "@/components/AnnouncementsTicker";
import { toast } from "@/hooks/use-toast";
import { useSeatData, RoomData, Seat } from "@/hooks/use-seat-data";
import { useSSE, SystemMessage } from "@/hooks/use-sse";
import { useYouTubeComments } from "@/hooks/use-youtube-comments";
import { youtubeService } from "@/lib/api/services/youtubeService";
import { SSEData } from "@/lib/api/sse/sseTypes";
import { AlertCircle, WifiOff, Loader2 } from "lucide-react";
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

// 通知の最大保持数
const MAX_NOTIFICATIONS = 20;

// SSEデータの型
// interface SSEData {
//   rooms: RoomData[];
//   error?: string;
// }

// システムメッセージの型
// interface SystemMessagePayload {
//   message: string;
//   type: 'info' | 'warning' | 'error';
//   timestamp: string; // ISO String
//   id?: string; // バックエンドでユニークIDを付与するのが望ましい
// }

export default function Home() {

  
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
  const { isProcessingCommand } = useYouTubeComments({
    enabled: isMounted,
    onCommandsDetected: handleCommands
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
  const focusRooms = rooms.filter(room => room.type === 'focus');
  const chatRooms = rooms.filter(room => room.type === 'chat' || !room.type);

  // 接続状態に応じたメッセージを表示
  const renderConnectionStatus = () => {
    console.log(`[Page] Rendering connection status for state: ${connectionState}`); // ログ追加

    // 接続ステータスごとの表示を実装
    switch (connectionState) {
      case 'connecting':
        return (
          <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <AlertTitle>接続中...</AlertTitle>
            <AlertDescription>
              サーバーに接続しています。しばらくお待ちください。
              <div className="text-xs mt-1 text-gray-500">
                接続状態: {connectionState}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
              </div>
            </AlertDescription>
          </Alert>
        );
      case 'reconnecting':
        return (
          <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <AlertTitle>再接続中...</AlertTitle>
            <AlertDescription>
              サーバーとの接続が切断されました。再接続を試みています。
              <div className="text-xs mt-1 text-gray-500">
                接続状態: {connectionState}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
              </div>
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
              <div className="text-xs mt-1 text-gray-500">
                接続状態: {connectionState}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
              </div>
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
              <div className="text-xs mt-1 text-gray-500">
                接続状態: {connectionState}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
              </div>
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
            <Alert className="mb-4 bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <AlertTitle>接続済み（データなし）</AlertTitle>
              <AlertDescription>
                サーバーに接続しましたが、部屋データが見つかりません。
                <div className="text-xs mt-1 text-gray-500">
                  接続状態: {connectionState}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
                </div>
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      default:
        // デフォルトケースも追加して、万が一の場合に対応
        console.warn(`[Page] Unknown connection state: ${connectionState}`);
        return (
          <Alert className="mb-4 bg-gray-100 border-gray-200">
            <AlertCircle className="h-4 w-4 text-gray-500" />
            <AlertTitle>不明な接続状態</AlertTitle>
            <AlertDescription>
              接続状態: {connectionState || 'undefined'}, ロード中: {String(isLoading)}, 部屋数: {rooms.length}
            </AlertDescription>
          </Alert>
        );
    }
  };

  return (
    <main className="min-h-screen bg-[#505762] pt-16"> {/* pt-16 はヘッダー分 */}
      {/* ヘッダー */}
      <Header />

      {/* メインコンテンツ (pt を削除) */}
      <div className="container mx-auto px-4 py-4"> {/* pt-10 を削除 */}
        {/* 接続状態表示 - 常に表示 */}
        <div className="connection-status-area">
          {renderConnectionStatus()}
        </div>

        {/* ★★★ お知らせティッカー (運営) ★★★ */}
        <div className="mb-2"> {/* マージン調整 */}
          <AnnouncementsTicker />
        </div>

        {/* 通常通知ティッカー */}
        <div className="mb-4"> {/* マージン調整 */}
          <NotificationTicker notifications={notifications} />
        </div>

        {/* 参加者情報 */}
        <Card className="mb-4 bg-[#f2f2f2]/95 shadow-md">
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
            <div className="mt-4 flex flex-wrap gap-2"> {/* grid を flex flex-wrap に変更し、gapを調整 */}
              <TooltipProvider> {/* TooltipProviderで囲む */}
                {(() => {
                    // profileImageUrl が存在する参加者のみをフィルタリング
                    const participants = rooms.flatMap(room => room.seats?.filter(seat => seat.username && seat.profileImageUrl) || []);
                    // ★★★ デバッグログ: フィルタリング後の参加者データ ★★★
                    console.log('[Page] Participants data for Avatars (filtered):', participants);
                    
                    // フィルタリングされた参加者のみをマップ
                    return participants.map((seat) => (
                      <Tooltip key={seat.id}>
                        <TooltipTrigger asChild>
                           {/* サイズ、カーソル、ホバー効果、境界線を追加 */}
                          <Avatar className="h-10 w-10 cursor-pointer hover:opacity-80 transition-opacity border-2 border-transparent hover:border-blue-300">
                            {/* nullish coalescing operator を使用して null の場合に undefined を渡す */}
                            <AvatarImage src={seat.profileImageUrl ?? undefined} alt={seat.username || '参加者'} />
                            {/* フォールバック表示を調整 */}
                            <AvatarFallback className="text-xs"> 
                              {seat.username ? seat.username.slice(0, 2) : '?'} 
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-semibold">{seat.username || '不明'}</p>
                          {seat.task && <p className="text-xs text-muted-foreground">タスク: {seat.task}</p>}
                           {/* ★ デバッグ用: enterTime を表示してみる */}
                           {seat.enterTime && <p className="text-xs text-gray-500">入室: {new Date(seat.enterTime).toLocaleTimeString()}</p>}
                        </TooltipContent>
                      </Tooltip>
                    ));
                })()}
              </TooltipProvider>
            </div>
          </div>
        </Card>
        
        {/* フォーカスルーム */}
        <div className="mb-4">
          {/* ★★★ デバッグログ追加 ★★★ */}
          {(() => {
              // 部屋データが存在すれば表示する (isLoadingに依存しない)
              const focusRoomCondition = rooms.length > 0;
              const focusSeatsData = rooms.flatMap(room => room.seats || []);
              console.log('[Page] FocusRoom rendering condition:', focusRoomCondition);
              console.log('[Page] FocusRoom isLoading:', isLoading);
              console.log('[Page] FocusRoom rooms.length:', rooms.length);
              console.log('[Page] FocusRoom seats data:', focusSeatsData);

              if (focusRoomCondition) {
                  return (
                      <FocusRoom
                          seats={focusSeatsData}
                          roomId="focus-room"
                      />
                  );
              } else {
                  return (
                      <div className="bg-[#f2f2f2]/95 rounded-lg p-8 text-center text-gray-600">
                          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-gray-400" />
                          座席情報を読み込み中... または表示できる座席がありません。 (isLoading: {String(isLoading)}, rooms: {rooms.length})
                      </div>
                  );
              }
          })()}
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