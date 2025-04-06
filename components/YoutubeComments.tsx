import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Comment {
  id: string;
  author: string;
  profileImageUrl: string;
  text: string;
  publishedAt: string;
}

export default function YoutubeComments() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ポーリング間隔（ミリ秒）
  const [pollingInterval, setPollingInterval] = useState(10000);

  useEffect(() => {
    // コメントをポーリングする関数
    const fetchComments = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/youtube-comments');
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'コメントの取得に失敗しました');
        }
        
        const data = await response.json();
        setComments(data.comments);
        setPollingInterval(data.pollingIntervalMillis || 5000);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知のエラーが発生しました');
        console.error('コメント取得エラー:', err);
      } finally {
        setLoading(false);
      }
    };

    // 初回の取得
    fetchComments();

    // ポーリングの設定
    const intervalId = setInterval(fetchComments, pollingInterval);

    // クリーンアップ
    return () => {
      clearInterval(intervalId);
    };
  }, [pollingInterval]); // ポーリング間隔が変わったら再設定

  // 日付をフォーマットする関数
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ja-JP');
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold mb-4">YouTube ライブコメント</h2>
      
      {loading && comments.length === 0 && (
        <p className="text-muted-foreground">コメントを読み込み中...</p>
      )}
      
      {error && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          <p>{error}</p>
        </div>
      )}
      
      <div className="space-y-2">
        {comments.map(comment => (
          <Card key={comment.id} className="p-4">
            <div className="flex items-start gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={comment.profileImageUrl} alt={comment.author} />
                <AvatarFallback>{comment.author.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{comment.author}</h3>
                  <span className="text-xs text-muted-foreground">
                    {comment.publishedAt && formatDate(comment.publishedAt)}
                  </span>
                </div>
                <p className="mt-1">{comment.text}</p>
              </div>
            </div>
          </Card>
        ))}
        
        {comments.length === 0 && !loading && !error && (
          <p className="text-muted-foreground">コメントはまだありません</p>
        )}
      </div>
    </div>
  );
} 