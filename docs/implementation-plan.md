# 実装計画

## 概要

YouTubeコメントで入退室コマンドを処理し、自動退室機能と新しいUIを実装するための計画を詳細に記述します。実装は段階的に行い、各フェーズでテストとレビューを行います。

## フェーズ1: データモデル拡張

### 目標
MongoDBのデータモデルを拡張し、タスク情報と時間管理に必要なフィールドを追加します。

### タスク

1. **座席（Seat）モデルの拡張**
   - `task` フィールドの追加
   - `enterTime` フィールドの追加 
   - `autoExitScheduled` フィールドの追加

2. **データベースインデックスの最適化**
   - ユーザー名検索用のインデックス作成
   - 自動退室チェック用のインデックス作成

### コード変更
- `lib/mongodb.ts`: 型定義の更新
- 必要に応じたデータベース初期化スクリプトの修正

## フェーズ2: コマンド処理機能の実装

### 目標
YouTubeコメントから新しいコマンド（`/work` と `/finish`）を検出し処理する機能を実装します。

### タスク

1. **コマンド検出ロジックの実装**
   - `detectCommand` 関数の実装
   - パターンマッチングとタスク名抽出

2. **コマンドハンドラの実装**
   - `handleWorkCommand` 関数の実装
   - `handleFinishCommand` 関数の実装

3. **コメント処理の拡張**
   - 既存のYouTubeコメント処理部分の拡張

### コード変更
- `app/api/youtube-comments/route.ts`: コマンド検出と処理追加
- `lib/utils.ts`: コマンド解析ユーティリティ追加
- `lib/messages.ts`: 新しいメッセージテンプレートの追加

## フェーズ3: 自動退室機能の実装

### 目標
入室から2時間後に自動的にユーザーを退室させる機能を実装します。

### タスク

1. **自動退室チェックAPIエンドポイントの作成**
   - `app/api/check-auto-exit/route.ts` 作成
   - 期限切れ座席の検索と更新処理

2. **SSEハンドラ内での自動退室チェック実装**
   - `app/api/sse/route.ts` の拡張
   - 定期的なチェックとクライアント通知

3. **フロントエンドからの定期呼び出し設定**
   - 安全なバックアップ手段として

### コード変更
- `app/api/check-auto-exit/route.ts`: 新規作成
- `app/api/sse/route.ts`: 自動退室チェック機能追加
- `app/page.tsx`: 必要に応じたポーリング実装

## フェーズ4: フロントエンドUI実装

### 目標
提供されたデザインに基づいてUI全体を刷新し、新機能に対応したコンポーネントを実装します。

### タスク

1. **新しいレイアウトの実装**
   - 動画背景と半透明オーバーレイ
   - ヘッダーとフッターの実装
   - レスポンシブデザイン対応

2. **ポモドーロタイマーの実装**
   - 現在時刻に基づくタイマー計算
   - モード切替と視覚的表示

3. **フォーカスルーム（ユーザーカード）の実装**
   - ユーザーカードコンポーネント作成
   - ページネーションとアニメーション実装
   - 残り時間表示実装

4. **スタイルの適用**
   - Tailwind CSSクラスの適用
   - アニメーションとトランジション定義

### コード変更
- `app/page.tsx`: 全体的なUI構造更新
- `app/globals.css`: 追加スタイルの定義
- `components/`: 新しいUIコンポーネントの作成または更新

## フェーズ5: 統合とテスト

### 目標
すべての機能を統合し、正常に動作することを確認します。

### タスク

1. **機能統合テスト**
   - コマンド処理の確認
   - 自動退室機能の確認
   - UIの動作確認

2. **エッジケース検証**
   - 同一ユーザーの複数回入室
   - 無効なコマンド処理
   - 自動退室タイミングの検証

3. **パフォーマンステスト**
   - 多数のユーザー同時接続時の挙動
   - MongoDB負荷テスト

### コード変更
- 必要に応じたバグ修正
- パフォーマンス最適化

## 具体的な実装手順

### 1. データモデルの準備

```typescript
// lib/mongodb.ts に追加
export type Seat = {
  _id: string;
  room_id: string;
  position: number;
  username: string | null;
  task: string | null;        // 新規追加
  enterTime: Date | null;     // 新規追加
  autoExitScheduled: Date | null;  // 新規追加
  timestamp: Date;
  created_at: Date;
};
```

### 2. コマンド処理機能

```typescript
// lib/utils.ts に追加
export function detectCommand(commentText: string): {
  command: 'work' | 'finish' | null;
  taskName?: string;
} {
  if (commentText.startsWith('/work')) {
    const taskName = commentText.substring(6).trim() || '作業中';
    return { command: 'work', taskName };
  }
  
  if (commentText.startsWith('/finish')) {
    return { command: 'finish' };
  }
  
  return { command: null };
}
```

### 3. 座席更新処理

```typescript
// app/api/seats/route.ts の更新
export async function POST(request: Request) {
  try {
    const { roomId, position, username, task } = await request.json();
    const client = await clientPromise;
    const db = client.db('coworking');

    // 入室時間と自動退室時間を計算
    const enterTime = new Date();
    const autoExitTime = new Date(enterTime);
    autoExitTime.setHours(autoExitTime.getHours() + 2); // 2時間後

    const result = await db.collection('seats').findOneAndUpdate(
      { room_id: roomId, position: position },
      {
        $set: {
          username: username,
          task: task || null,
          enterTime: username ? enterTime : null,
          autoExitScheduled: username ? autoExitTime : null,
          timestamp: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 4. 自動退室チェックエンドポイント

```typescript
// app/api/check-auto-exit/route.ts
import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('coworking');
    
    const currentTime = new Date();
    console.log(`[AutoExit] Checking for seats to auto-exit at ${currentTime}`);
    
    const result = await db.collection('seats').updateMany(
      { 
        username: { $ne: null },
        autoExitScheduled: { $lt: currentTime }
      },
      { 
        $set: { 
          username: null,
          task: null,
          enterTime: null,
          autoExitScheduled: null
        } 
      }
    );
    
    console.log(`[AutoExit] ${result.modifiedCount} seats were auto-exited`);
    
    return NextResponse.json({
      processed: result.modifiedCount,
      timestamp: currentTime
    });
  } catch (error) {
    console.error('[AutoExit] Error processing auto-exit:', error);
    return NextResponse.json(
      { error: 'Auto-exit processing failed' },
      { status: 500 }
    );
  }
}
```

### 5. UIコンポーネント例

```tsx
// components/UserCard.tsx
import Image from "next/image"
import { calculateRemainingTime, getRemainingTimeStyle } from "@/lib/utils";

interface UserCardProps {
  user: {
    id: string;
    name: string;
    avatar: string;
    task: string;
    autoExitTime: Date;
  }
}

export default function UserCard({ user }: UserCardProps) {
  const remainingTime = calculateRemainingTime(user.autoExitTime);
  const timeStyle = getRemainingTimeStyle(user.autoExitTime);
  
  return (
    <div className="bg-white/20 rounded-lg p-3 flex items-center gap-3 hover:bg-white/30 transition-all duration-300 shadow-md">
      <div className="w-12 h-12 bg-white/10 rounded-full overflow-hidden flex-shrink-0">
        <Image
          src={user.avatar || "/placeholder.svg"}
          alt={user.name}
          width={48}
          height={48}
          className="object-cover w-full h-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-white text-lg font-bold truncate">{user.name}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">{user.task}</span>
          <span className={`text-md font-semibold ${timeStyle}`}>{remainingTime}</span>
        </div>
      </div>
    </div>
  );
}
```

## スケジュール

1. **フェーズ1: データモデル拡張** - 1日
2. **フェーズ2: コマンド処理機能** - 2日
3. **フェーズ3: 自動退室機能** - 2日
4. **フェーズ4: フロントエンドUI** - 3日
5. **フェーズ5: 統合とテスト** - 2日

**合計期間**: 約10日（各フェーズの間にバッファを含む） 