# 自動退室機能の実装

## 概要

ユーザーが入室してから2時間経過すると、自動的に退室処理を行う機能を実装します。この機能により、ユーザーが明示的に退室コマンドを実行し忘れた場合でも、座席が永久に占有されることを防ぎます。

## 技術的アプローチ

自動退室機能を実装するには、以下の2つの主要なアプローチがあります：

### 1. サーバーサイドでのクロンジョブ的アプローチ

サーバーレス環境（Netlify Functions）では永続的なバックグラウンドプロセスを実行できないため、定期的なAPIコールを利用します。

#### 実装方法

1. **定期的なAPIエンドポイントの呼び出し**
   - 外部サービス（例：UptimeRobot）を使用して、数分おきに特定のエンドポイントを呼び出す
   - または、フロントエンドからの定期的な呼び出しをスケジュールする

2. **専用の退室チェックAPIエンドポイント**
   ```typescript
   // app/api/check-auto-exit/route.ts
   export async function GET() {
     const client = await clientPromise;
     const db = client.db('coworking');
     
     // 現在時刻を取得
     const currentTime = new Date();
     
     // 自動退室時間を過ぎた座席を検索
     const expiredSeats = await db.collection('seats').find({
       username: { $ne: null },  // ユーザーが着席している
       autoExitScheduled: { $lt: currentTime }  // 自動退室時間が現在時刻より前
     }).toArray();
     
     // 各座席を処理
     for (const seat of expiredSeats) {
       // 座席を空席に設定
       await db.collection('seats').updateOne(
         { _id: seat._id },
         { 
           $set: { 
             username: null,
             task: null,
             enterTime: null,
             autoExitScheduled: null
           } 
         }
       );
       
       // オプション: 退室メッセージをYouTubeチャットに投稿
       // await sendAutoExitMessage(seat.username, seat.room_id, seat.position);
     }
     
     return NextResponse.json({
       processed: expiredSeats.length,
       timestamp: currentTime
     });
   }
   ```

### 2. データベースの変更ストリームとSSEを活用するアプローチ

MongoDB Change Streamsを利用して、期限切れの座席を監視し、SSE接続を通じてリアルタイムで状態を更新します。

#### 実装方法

1. **SSEハンドラ内でのチェック**
   ```typescript
   // app/api/sse/route.ts の拡張
   export async function GET() {
     // 既存のSSE実装に追加
     const stream = new ReadableStream({
       async start(controller) {
         // ... 既存のコード ...
         
         // 定期的に自動退室チェックを実行
         const checkAutoExit = async () => {
           const currentTime = new Date();
           const expiredSeats = await db.collection('seats').find({
             username: { $ne: null },
             autoExitScheduled: { $lt: currentTime }
           }).toArray();
           
           if (expiredSeats.length > 0) {
             // 期限切れの座席を更新
             for (const seat of expiredSeats) {
               await db.collection('seats').updateOne(
                 { _id: seat._id },
                 { 
                   $set: { 
                     username: null,
                     task: null,
                     enterTime: null,
                     autoExitScheduled: null
                   } 
                 }
               );
             }
             
             // 更新データをクライアントに送信（既存のフローを活用）
             const updatedData = await fetchRoomData();
             controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedData)}\n\n`));
           }
         };
         
         // 1分ごとに自動退室チェックを実行
         const autoExitInterval = setInterval(checkAutoExit, 60000);
         
         return () => {
           clearInterval(autoExitInterval);
           // ... 既存のクリーンアップコード ...
         };
       }
     });
     
     // ... 既存のコード ...
   }
   ```

## 実装上の注意点

### 1. タイムゾーン考慮

- 日本時間（JST）を基準にして退室時間を計算
- サーバー時間とクライアント時間の差異に注意

```typescript
// 日本時間で2時間後を計算
const twoHoursLater = new Date();
twoHoursLater.setHours(twoHoursLater.getHours() + 2);
```

### 2. エラーハンドリング

- データベース接続エラーへの対応
- 処理中の例外キャッチと適切なログ記録

```typescript
try {
  // 自動退室処理
} catch (error) {
  console.error('自動退室処理中にエラーが発生しました:', error);
  // エラーメトリクスの記録やアラート通知
}
```

### 3. パフォーマンス最適化

- インデックス作成で検索を高速化

```javascript
// MongoDBインデックスの作成
db.seats.createIndex({ "username": 1, "autoExitScheduled": 1 });
```

- バッチ処理での効率化

```typescript
// 複数の座席を一括で更新
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
```

## フロントエンド表示の連携

### 1. 残り時間表示

ユーザーカードに残り時間を表示することで、自動退室までの時間をユーザーに知らせます。

```tsx
// 残り時間を計算する関数
function calculateRemainingTime(autoExitTime: Date): string {
  const now = new Date();
  const diffMs = autoExitTime.getTime() - now.getTime();
  
  if (diffMs <= 0) return "間もなく退室";
  
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return `残り ${diffHours}時間${diffMinutes}分`;
  } else {
    return `残り ${diffMinutes}分`;
  }
}

// コンポーネント内での使用例
const remainingTime = calculateRemainingTime(new Date(seat.autoExitScheduled));
```

### 2. 視覚的フィードバック

残り時間に応じて視覚的なフィードバックを提供します：

```tsx
// 残り時間に基づくスタイルの適用
function getRemainingTimeStyle(autoExitTime: Date) {
  const now = new Date();
  const diffMs = autoExitTime.getTime() - now.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  
  if (diffMinutes < 10) {
    return "text-red-500"; // 残り10分未満は赤色
  } else if (diffMinutes < 30) {
    return "text-orange-400"; // 残り30分未満はオレンジ色
  } else {
    return "text-amber-400"; // 通常は金色
  }
}
```

## テスト計画

1. **単体テスト**
   - 自動退室時間の計算ロジックのテスト
   - データベース更新処理のテスト

2. **統合テスト**
   - 実際にタイマーを進めた場合の動作確認
   - フロントエンドの表示更新確認

3. **エッジケース**
   - サーバー再起動時の挙動
   - 大量のユーザーが同時に期限切れになる場合の挙動 