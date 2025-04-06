# オンラインコワーキングスペース 機能追加 タスクリスト

## フェーズ1: データモデル拡張

-   [x] `lib/mongodb.ts` の `Seat` 型定義に `task`, `enterTime`, `autoExitScheduled` フィールドを追加する
-   [x] MongoDB の `seats` コレクションに `username` フィールド用のインデックスを作成する (`{ "username": 1 }`)
-   [x] MongoDB の `seats` コレクションに自動退室チェック用の複合インデックスを作成する (`{ "autoExitScheduled": 1, "username": 1 }`)
-   [x] MongoDB の `seats` コレクションにユーザー識別用の `authorId` フィールドを追加し、インデックスを作成する (`{ "authorId": 1 }`)

## フェーズ2: コマンド処理機能の実装

-   [x] `lib/utils.ts` を作成（または更新）し、`detectCommand` 関数を実装する
-   [x] `lib/utils.ts` に残り時間計算用の `calculateRemainingTime` 関数を実装する
-   [x] `lib/utils.ts` に残り時間スタイル用の `getRemainingTimeStyle` 関数を実装する
-   [x] `lib/messages.ts` に `/work` (入室/更新)、`/finish` (退室)、満席時のメッセージテンプレートを追加する
-   [x] `app/api/youtube-comments/route.ts` に `detectCommand` をインポートし、コメントごとに実行するロジックを追加する
-   [x] `app/api/youtube-comments/route.ts` 内で、`/work` コマンド検出時に `authorId` で既存座席を確認する処理を実装する
-   [x] `app/api/youtube-comments/route.ts` 内で、`/work` コマンド検出時に新規入室処理（空席検索とDB更新: `username`, `authorId`, `task`, `enterTime`, `autoExitScheduled` 設定）を実装する
-   [x] `app/api/youtube-comments/route.ts` 内で、`/work` コマンド検出時に既存席更新処理（DB更新: `task`, `enterTime`, `autoExitScheduled` 更新）を実装する
-   [x] `app/api/youtube-comments/route.ts` 内で、`/finish` コマンド検出時に `authorId` で座席を検索し、DB更新（関連フィールドを `null` 化）する処理を実装する
-   [x] `app/api/youtube-comments/route.ts` 内で、コマンド処理成功時に `sendChatMessage` を使用してYouTubeチャットに応答メッセージを送信する処理を実装する
-   [x] コマンド処理におけるエラーハンドリングを実装する（例: 満席時、DBエラー時）

## フェーズ3: 自動退室機能の実装

-   [x] `app/api/check-auto-exit/route.ts` APIエンドポイントを作成し、期限切れ座席を検索して更新するロジックを実装する
-   [x] `app/api/sse/route.ts` の `start` メソッド内で、自動退室チェック関数 (`checkAutoExit`) を定義する
-   [x] `app/api/sse/route.ts` の `start` メソッド内で、`setInterval` を使用して `checkAutoExit` を定期実行する（例: 1分ごと）
-   [x] `app/api/sse/route.ts` の `checkAutoExit` 関数内で、座席が更新された場合に最新の座席情報を取得し、SSEでクライアントに送信する処理を実装する
-   [x] `app/api/sse/route.ts` のストリームクリーンアップ時に `clearInterval` を呼び出す処理を追加する
-   [ ] (代替/補助) 必要に応じて、外部Cronジョブから `/api/check-auto-exit` を呼び出す設定を行う

## フェーズ4: フロントエンドUI実装

-   [x] `app/page.tsx` の全体レイアウトを更新し、背景ビデオ/画像、ヘッダー、フッター構造を適用する
-   [x] ヘッダーコンポーネント (`components/Header.tsx` または `app/page.tsx` 内) に現在日時表示機能を実装し、1秒ごとに更新する
-   [x] ポモドーロタイマーコンポーネント (`components/PomodoroTimer.tsx` または `app/page.tsx` 内) を実装し、モード、残り時間、プログレスバーを表示・更新する
-   [x] `app/page.tsx` でSSEから受信した座席データ (`rooms` または `seats`) を管理するステートを実装する
-   [x] フォーカスルームコンポーネント (`components/FocusRoom.tsx`) を作成し、ルームヘッダーとユーザーカードグリッドを表示する
-   [x] `components/FocusRoom.tsx` にユーザーカードのページネーション機能（ステート、表示ロジック、インジケーター）を実装する
-   [x] `components/FocusRoom.tsx` にページ切り替え時のスライドアニメーション（ステート管理、CSSクラス適用）を実装する
-   [x] ユーザーカードコンポーネント (`components/UserCard.tsx`) を作成し、アバター、名前、タスクを表示する
-   [x] `components/UserCard.tsx` に `calculateRemainingTime` と `getRemainingTimeStyle` を使用して残り時間とそのスタイルを表示する機能を実装する
-   [x] `app/globals.css` にカードスライドアニメーション用のCSSクラス (`card-slide-out`, `card-slide-in`) を定義する
-   [x] UI全体のレスポンシブデザイン対応を行う（Tailwindのブレークポイント活用）

## フェーズ5: 統合とテスト

-   [ ] `/work` コマンドによる入室、タスク表示、残り時間表示のテスト
-   [ ] `/finish` コマンドによる退室とUI反映のテスト
-   [ ] 既存ユーザーによる `/work` コマンドでのタスク更新テスト
-   [ ] 無効なコマンドや引数なしコマンドの処理テスト
-   [ ] 自動退室機能が指定時間後に動作し、UIに反映されるかのテスト
-   [ ] SSEによる他のユーザーの入退室や自動退室がリアルタイムで反映されるかのテスト
-   [ ] ポモドーロタイマーのモード切替、時間更新、プログレスバー表示のテスト
-   [ ] 異なる画面サイズ（モバイル、タブレット、デスクトップ）での表示崩れがないかのテスト
-   [ ] 長いタスク名や特殊文字を含むタスク名の処理テスト
-   [ ] 満席時の `/work` コマンド処理テスト
-   [ ] APIエラー（YouTube, DB）発生時のフォールバックやエラー表示のテスト
-   [ ] (任意) 複数ユーザーでの同時操作テスト
-   [ ] (任意) パフォーマンステスト（高負荷時のレスポンス確認） 