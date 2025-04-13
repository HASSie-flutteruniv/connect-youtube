# YouTubeライブコメント取得の仕組み

## 概要

当プロジェクトでは、YouTubeのライブ配信からリアルタイムでコメントを取得し、特定のコマンド（例：`/work`）を検出して処理する機能を実装しています。この文書では、その技術的な実装と仕組みについて解説します。

## 1. 技術スタック

- **YouTube Data API v3**：ライブチャットメッセージの取得とBOT投稿に使用
- **Next.js API Routes**：サーバーサイドでYouTube APIの呼び出しを行うエンドポイント
- **MongoDB**：検出したコマンドや座席情報の保存に使用
- **React Hooks**：フロントエンドでのコメント取得とポーリング処理

## 2. コメント取得の流れ

### 2.1 サーバーサイド実装

1. **ライブチャットIDの取得**
   - 動画IDから`getLiveChatId`関数を使って、ライブチャットIDを取得
   - パフォーマンス向上のためライブチャットIDをメモリ内にキャッシュ

2. **コメントの取得**
   - `getLiveChatMessages`関数でYouTube APIを呼び出し
   - 認証にはAPI Keyを使用（環境変数から取得）
   - `snippet`と`authorDetails`の両方のパートを取得してコメント情報を完全に取得

3. **コマンド検出とフィルタリング**
   - 取得したコメントから特定のコマンドパターンを検出
   - BOT自身のコメントや既に処理済みのコメントをスキップ
   - 運営者コメントは特別に処理（お知らせとしてDBに保存）

4. **レート制限対策**
   - YouTube APIのクォータ制限に対応するためのバックオフメカニズム実装
   - エラー発生時には指数バックオフで再試行間隔を延長
   - 連続エラーやクォータ超過時は一定時間APIリクエストを抑制

### 2.2 クライアントサイド実装

1. **カスタムフック（useYouTubeComments）**
   - コメント取得とコマンド処理を統合したReact Hook
   - 定期的なポーリングでサーバーAPIを呼び出し
   - バックオフ状態の管理と動的なポーリング間隔の調整

2. **ポーリング制御**
   - `startPolling`と`stopPolling`関数でポーリングを制御
   - API推奨のポーリング間隔（pollingIntervalMillis）に従って調整
   - エラー発生時のバックオフ処理

## 3. コアコンポーネント

### 3.1 YouTube API関連（lib/youtube.ts）

```typescript
// ライブチャットIDを取得
export async function getLiveChatId(videoId: string): Promise<string> {
  const response = await youtubeWithApiKey.videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId]
  });
  // ...ライブチャットIDの抽出とエラーハンドリング...
}

// ライブチャットメッセージを取得
export async function getLiveChatMessages(liveChatId: string, pageToken: string | null): Promise<ChatResponse> {
  const response = await youtubeWithApiKey.liveChatMessages.list({
    part: ['snippet', 'authorDetails'],
    liveChatId,
    pageToken: pageToken || undefined,
    maxResults: 100
  });
  // ...レスポンス処理とエラーハンドリング...
}
```

### 3.2 APIエンドポイント（app/api/youtube-comments/route.ts）

```typescript
export async function GET() {
  // 1. バックオフ状態のチェック
  // 2. ライブチャットIDの取得（キャッシュまたはAPI）
  // 3. コメントデータの取得
  // 4. コマンド検出とフィルタリング
  // 5. レスポンス返却
}
```

### 3.3 クライアント側フック（hooks/use-youtube-comments.ts）

```typescript
export function useYouTubeComments(options: UseYouTubeCommentsOptions = {}): UseYouTubeCommentsResult {
  // 状態管理
  // コメント取得関数
  // ポーリング制御関数
  // ...
}
```

## 4. エラーハンドリングと安定性対策

1. **メモリ内キャッシュの最適化**
   - 処理済みコメントIDのキャッシュを定期的にクリーンアップ（最新1000件のみ保持）
   - ライブチャットIDをメモリ内キャッシュとして保存し、API呼び出しを削減

2. **エラー状態の管理**
   - 連続エラー発生時の指数バックオフ
   - クォータ超過時の長時間バックオフ（10分〜30分）
   - エラー種別に応じた適切なステータスコードの返却

3. **動的なポーリング間隔**
   - YouTube APIからの推奨ポーリング間隔に従って動的に調整
   - バックオフ状態に応じたポーリング頻度の調整

## 5. セキュリティと制限事項

1. **API認証**
   - コメント取得には単純なAPI Keyを使用
   - メッセージ送信（BOT投稿）にはOAuth2認証を使用

2. **環境変数**
   - YouTube API Key
   - OAuth2認証情報（クライアントID、シークレット、リダイレクトURL、リフレッシュトークン）
   - ライブ配信の動画ID

3. **API制限**
   - YouTube Data APIの日次クォータ制限を考慮した設計
   - レート制限を回避するためのバックオフメカニズム 