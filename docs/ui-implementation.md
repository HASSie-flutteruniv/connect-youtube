# UI実装要件

## 概要

提供されたデザインサンプルに基づいて、オンラインコワーキングスペースのUIを刷新します。現在のシンプルなレイアウトから、よりモダンで視覚的に魅力的なデザインへとアップグレードします。

## デザイン要素

### 全体的なレイアウト

1. **背景**
   - 動画背景（`mv_video.mp4`）またはプレースホルダー画像
   - 半透明のオーバーレイ（暗色）

2. **ヘッダー**
   - ロゴ/タイトル "CONNECT"
   - 現在の日時表示
   - ポモドーロタイマー（作業中/休憩中表示、残り時間、プログレスバー）

3. **メインコンテンツ**
   - 現在の参加者セクション
   - フォーカスルーム（サイレントルーム）
   - 現在のBGM情報

4. **フッター**
   - コピーライト情報

## コンポーネント詳細

### ヘッダーコンポーネント

1. **タイトルバー**
   - `text-3xl font-extrabold tracking-widest text-amber-400` のスタイル
   - 白色のボーダーライン

2. **情報バー**
   - 現在日時表示セクション
     - 日付（年月日と曜日）
     - 時刻（時:分:秒）
   - ポモドーロタイマーセクション
     - モード表示（作業中/休憩中バッジ）
     - 残り時間表示
     - プログレスバー

### 参加者セクション

1. **情報カード**
   - 半透明の背景
   - 「現在の参加者」見出し
   - ライブ配信中バッジ
   - オンライン人数表示
   - 参加者リスト（バッジ表示）

### フォーカスルームコンポーネント

1. **ヘッダー**
   - アイコン（VolumeX）
   - 「フォーカスルーム」タイトル
   - 「会話不可」バッジ
   - 参加者数表示

2. **ユーザーカードグリッド**
   - 2x4または2x2のグリッドレイアウト（レスポンシブ）
   - ユーザーカードのページネーション
   - ページインジケーター

3. **ユーザーカード**
   - アバター画像
   - ユーザー名
   - タスク名
   - 経過時間/残り時間

### BGM情報セクション

- 音楽アイコン
- 現在再生中のBGMタイトル
- 再生状態表示

## アニメーションと遷移効果

1. **ユーザーカードスライダー**
   - カードがスライドアウト/スライドインするアニメーション
   - 5秒ごとに自動ページング

2. **状態変更アニメーション**
   - ポモドーロタイマーの状態変更時のアニメーション
   - プログレスバーのスムーズな更新

## レスポンシブデザイン要件

1. **モバイル向け**
   - 単一カラムレイアウト
   - 縮小されたカードサイズ
   - フォントサイズ調整

2. **タブレット向け**
   - 2x2グリッドレイアウト

3. **デスクトップ向け**
   - 2x4グリッドレイアウト（ユーザーカード）
   - 豊富な余白と大きめの要素

## カラーパレット

1. **主要色**
   - 背景: 動画背景 + 半透明黒オーバーレイ
   - アクセント: `text-amber-400`（黄金色）
   - 作業中状態: `bg-green-500`
   - 休憩中状態: `bg-blue-500`

2. **セカンダリカラー**
   - カード背景: `bg-white/20`（20%不透明度の白）
   - 境界線: `border-white/10`（10%不透明度の白）
   - テキスト: 白色と半透明白色のバリエーション

## フォント設定

- デフォルトフォント: システムフォント
- 見出し: `font-bold` または `font-extrabold`
- タイマー表示: `text-2xl font-bold`
- 通常テキスト: `text-sm` または `text-md`

## 実装優先順位

1. 背景と全体レイアウト構造
2. ヘッダーコンポーネント（日時表示とタイマー）
3. フォーカスルームとユーザーカード表示
4. アニメーションとページング機能
5. レスポンシブデザインの微調整 