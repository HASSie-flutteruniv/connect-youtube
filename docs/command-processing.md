# コマンド処理機能設計

## 概要

YouTubeライブチャットからコメントを取得し、特定のコマンドパターンを検出して適切なアクションを実行する機能の設計について説明します。基本的なコマンド構文は以下の通りです：

1. 入室: `/work タスク名`
2. 退室: `/finish`

## コマンド構文と処理ロジック

### 入室コマンド

```
/work タスク名
```

- **処理手順**:
  1. `/work` で始まるコメントを検出
  2. コマンド後のテキストをタスク名として抽出
  3. コメント投稿者の情報を取得
  4. 既に入室している場合は更新、そうでない場合は新規入室として処理
  5. 座席データを保存（ユーザー名、タスク名、入室時刻、自動退室時刻）
  6. 確認メッセージをYouTubeチャットに投稿

- **バリデーション**:
  - タスク名が空の場合はエラー
  - タスク名が長すぎる場合は切り詰め処理（50文字まで）
  - 同一ユーザーが再度入室コマンドを使用した場合はタスク更新として扱う

### 退室コマンド

```
/finish
```

- **処理手順**:
  1. `/finish` コマンドを検出
  2. コメント投稿者の情報を取得
  3. ユーザーが入室済みかを確認
  4. 入室済みの場合、座席を空席に設定
  5. 退室メッセージをYouTubeチャットに投稿

- **バリデーション**:
  - 入室していないユーザーが `/finish` を使用した場合は無視

## 自動退室処理

- **処理ロジック**:
  1. 入室時に現在時刻から2時間後の時刻を自動退室時刻として記録
  2. 定期的に（1分ごとなど）データベースをチェックし、自動退室時刻を過ぎた座席を検索
  3. 該当する座席を空席に設定
  4. 自動退室メッセージをYouTubeチャットに投稿（オプション）

## 実装方針

### コマンド検出

```typescript
// コメントからコマンドを検出する関数
function detectCommand(commentText: string): {
  command: 'work' | 'finish' | null;
  taskName?: string;
} {
  if (commentText.startsWith('/work')) {
    // タスク名抽出（/work の後のスペースを1つ削除）
    const taskName = commentText.substring(6).trim();
    return { command: 'work', taskName };
  }
  
  if (commentText.startsWith('/finish')) {
    return { command: 'finish' };
  }
  
  return { command: null };
}
```

### コマンド処理の流れ

1. YouTube APIからコメントを取得
2. 各コメントに対してコマンド検出を実行
3. 検出されたコマンドに基づき適切な処理を実行
4. 処理結果に応じてYouTubeチャットに応答

```typescript
// コマンド処理の擬似コード
async function processComments(comments: Comment[]) {
  for (const comment of comments) {
    const { command, taskName } = detectCommand(comment.text);
    
    if (command === 'work') {
      await handleWorkCommand(comment.author, taskName);
    } else if (command === 'finish') {
      await handleFinishCommand(comment.author);
    }
  }
}
```

### データベースインタラクション

1. 入室時にデータベースを更新

```typescript
// 入室処理の擬似コード
async function handleWorkCommand(username: string, taskName: string) {
  // 既存の座席を検索
  const existingSeat = await findSeatByUsername(username);
  
  if (existingSeat) {
    // 既存の座席を更新
    await updateSeat(existingSeat.id, {
      task: taskName,
      enterTime: new Date(),
      autoExitScheduled: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2時間後
    });
  } else {
    // 新しい座席を割り当て
    const availableSeat = await findAvailableSeat();
    if (availableSeat) {
      await assignSeat(availableSeat.id, {
        username,
        task: taskName,
        enterTime: new Date(),
        autoExitScheduled: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2時間後
      });
    }
  }
  
  // YouTube チャットに確認メッセージを送信
  await sendChatMessage(`${username}さんが「${taskName}」に取り組むため入室しました！`);
}
```

## エラーハンドリング

1. **不正なコマンド形式**:
   - 無効なコマンド形式は無視
   - タスク名がない場合はデフォルト値「作業中」を使用

2. **座席割り当て失敗**:
   - 利用可能な座席がない場合はエラーメッセージを返す
   - データベース接続エラーの場合は再試行ロジックを実装

3. **YouTube API エラー**:
   - API レート制限に達した場合のバックオフ戦略
   - 接続エラー時の再接続ロジック

## 留意点

1. **パフォーマンス最適化**:
   - 頻繁なデータベースクエリを最小限に抑える
   - YouTube API コールの回数を制限する

2. **セキュリティ**:
   - ユーザー入力のサニタイズ（XSS対策）
   - データベースクエリの安全な構築（インジェクション対策）

3. **テスト計画**:
   - コマンド検出のユニットテスト
   - 自動退室機能のテスト
   - エッジケースの処理検証 