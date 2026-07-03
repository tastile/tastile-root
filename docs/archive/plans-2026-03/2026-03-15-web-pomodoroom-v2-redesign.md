# Web版 Pomodoroom v2 再設計プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** tastile-web の `/app/*` を汎用ポモドーロタイマーから「タイル実行制御システム」に再設計する

**現状の根本問題:**
- タイマーが固定25分ポモドーロ周期 → タイルごとの可変時間コミットメントであるべき
- タイムラインが過去ログのみ → 前方スケジュール(計画された1日)を表示すべき
- タイル作成がタイトル+メモ程度 → 実行条件(時間制約・種別・エネルギー)を定義すべき
- プロンプトがタイマー完了起点 → スケジュール+緊急度起点であるべき

**設計原則:** pomodoroom デスクトップ版の GuidanceBoard + DayTimelinePanel + TaskDialog の設計思想を Web に移植する。ただしデスクトップの全機能を移植するのではなく、Web で実用的な最小セットに絞る。

---

## 設計変更の概要

### A. タイマーモデルの変更

**Before:** 固定ポモドーロ周期 (25min focus / 5min break / long break every 4th)
**After:** タイルの `estimated_minutes` に基づく可変カウントダウン。タイル開始でタイマーが `estimated_minutes` 分で始まる。完了時に「次のタイルを開始?」「休憩を取る?」のプロンプト。ポモドーロ周期の概念を廃止。

変更対象ファイル:
- `src/lib/engine/timer.ts` — ポモドーロ周期ロジック (stepIndex, stepType, getStepType, advanceStep) を削除。代わりに `startWithDuration(minutes)` + `extend(minutes)` のシンプルなカウントダウンに変更
- `src/hooks/useTimer.ts` — stepType/stepIndex 関連の処理を削除
- `src/hooks/useExecutionEngine.ts` — `startWork(tileId)` がタイルの estimated_minutes でタイマーを開始するように変更。`startBreak` を「任意の休憩タイマー」に変更 (固定周期ではなく)
- `src/lib/engine/types.ts` — `TimerState` から stepType/stepIndex を削除、`linkedTileId` を追加

### B. タイル作成の強化

**Before:** title + next_action + done_definition + estimated_minutes + priority
**After:** 上記に加えて tile_kind + 時間制約 + energy level を追加

変更対象ファイル:
- `src/lib/engine/types.ts` — `TileKind` 型追加 (`duration_only | fixed_event | flex_window`)、`CreateTileInput` に `tile_kind`, `fixed_start_at`, `fixed_end_at`, `window_start_at`, `window_end_at`, `energy` フィールド追加
- `src/components/app/TileForm.tsx` — フォームを再設計: タイル種別セレクタ追加、種別に応じた時間入力フィールドの出し分け (fixed_event → 開始/終了日時、flex_window → ウィンドウ範囲、duration_only → 推定時間のみ)、エネルギーレベル選択 (low/medium/high) 追加
- `src/hooks/useTiles.ts` — `createTile` で新フィールドを Supabase に保存 (tiles テーブルの temporal_conditions JSONB カラムを使用 — 既存スキーマに `temporal_conditions JSONB DEFAULT '{}'` カラムが既にある)

DB マイグレーション: **不要**。tiles テーブルの `temporal_conditions` と `objective_conditions` の JSONB カラムが既に存在する。tile_kind/時間制約/energy は JSONB 内に格納。

### C. タイムラインの前方スケジュール化

**Before:** 過去のセグメント (work/break ブロック) のみ表示
**After:** READY/STARTED/DONE 全てのタイルを時間軸上に配置。計画された未来 + 実行中 + 完了済みを一画面で表示。

表示ロジック (pomodoroom の DayTimelinePanel に準拠):
- `fixed_event`: `fixed_start_at` → `fixed_end_at` の固定ブロック
- `flex_window`: ウィンドウ内で `estimated_minutes` 分の幅でセンタリング
- `duration_only` (READY): `estimated_start_at` (スケジューラが計算) or ユーザ指定がなければタイムライン下部にリスト表示
- STARTED: `started_at` → `started_at + estimated_minutes` (実行中ブロック)
- DONE: `started_at` → `completed_at` (完了ブロック、グレーアウト)

変更対象ファイル:
- `src/components/app/DayTimeline.tsx` — セグメントベースからタイルベースに全面書き換え。タイルの kind と lifecycle に基づいてブロック位置を計算。ブロックにタイル名と残り時間を表示。色分け: STARTED=green, READY(scheduled)=blue, DONE=gray, fixed_event=purple
- `src/app/app/timeline/page.tsx` — `useTodaySegments` の代わりに `useTiles` からタイル一覧を取得して DayTimeline に渡す。スケジュール統計 (計画時間, 実行済み時間, 残り時間) を表示
- `src/hooks/useTiles.ts` — tiles ロード時に `temporal_conditions` JSONB をパースして `fixed_start_at` 等のフィールドを展開する処理を追加

### D. Now ページの再設計

**Before:** ポモドーロタイマー + フラットリスト
**After:** 実行制御ハブ — アクティブタイル+タイマー(可変時間) + ガイダンス(次のタイル候補) + ミニタイムライン

変更対象ファイル:
- `src/app/app/now/page.tsx` — 構成を再設計:
  1. **実行中セクション**: アクティブタイルのカード + 可変時間タイマー + [完了][中断][+延長] ボタン
  2. **ガイダンスセクション**: 次のタイル候補 (スケジュール順 or 優先度順の上位3件)。各候補にワンタップ開始ボタン
  3. **ミニタイムライン**: 現在時刻周辺の3時間分を表示 (計画されたタイル + 現在の実行状況)
  4. **クイック追加**: 既存の TileForm (ただし強化版)
- `src/components/app/Timer.tsx` — ポモドーロ周期UIを削除。タイル名+残り時間+プログレスバー+操作ボタンのシンプルな表示に変更。色はステップタイプではなくフェーズ (work=暖色, idle=ニュートラル) で決定

### E. プロンプトページの再設計

**Before:** タイマー完了で起動するポモドーロ的プロンプト
**After:** スケジュール駆動のプロンプト — 「予定開始時刻です」「タイルの時間切れです」「次のタイルがあります」

変更対象ファイル:
- `src/app/app/prompt/page.tsx` — プロンプト生成ロジックを変更:
  1. **タイマー完了**: 「このタイルの予定時間が終了しました」→ [完了] [延長+15分] [延長+5分]
  2. **スケジュール催促**: 次のタイルの開始時刻が近い (5分以内) → 「次: "タイル名" の開始時刻です」→ [開始] [スキップ]
  3. **アイドル提案**: 何もしていない + READY タイルがある → 優先度順で提案
  4. 各プロンプトに「このアクションが残りのスケジュールに与える影響」をテキストで表示

### F. スケジューラ (軽量版)

新規作成: `src/lib/engine/scheduler.ts`

タイルリストを受け取り、`estimated_start_at` を計算して返すシンプルな関数。
- fixed_event は固定位置
- flex_window はウィンドウ内でセンタリング
- duration_only は priority 降順で空きスロットに配置
- 入力: タイル配列 + 現在時刻
- 出力: タイル配列 (estimated_start_at 付き)
- Supabase には書かない (クライアントサイド計算のみ)

### G. TileCard の強化

変更対象ファイル:
- `src/components/app/TileCard.tsx` — 追加表示:
  - tile_kind バッジ (固定/柔軟/自由)
  - 計画時間 (例: "14:00–15:15")
  - エネルギーレベル表示 (low/med/high のドット or ラベル)
  - 実行中の場合: 経過時間/予定時間のプログレス

---

## タスク分割

### Task 1: タイマーエンジンをポモドーロから可変時間に変更

対象: `src/lib/engine/timer.ts`, `src/lib/engine/types.ts`

やること:
- `TimerConfig` から `focusMinutes`, `shortBreakMinutes`, `longBreakMinutes`, `longBreakInterval` を削除
- `TimerSnapshot` から `stepType`, `stepIndex` を削除。`linkedTileId: string | null` を追加
- `getStepType()`, `getStepDurationMs()`, `advanceStep()`, `getCompletedPomodoros()` を削除
- 新規関数: `startCountdown(durationMs: number, tileId?: string): TimerSnapshot` — 任意の時間でカウントダウン開始
- 新規関数: `extendTimer(snapshot: TimerSnapshot, deltaMs: number): TimerSnapshot` — 延長
- `tickTimer()`, `pauseTimer()`, `formatTime()` は維持 (ロジック変更なし)
- `TimerState` (types.ts) から `stepType`, `stepIndex` を削除

対象: `src/hooks/useTimer.ts`

やること:
- `onStepComplete` を `onTimerComplete` にリネーム
- `skip`, `advance` を削除。`extend(deltaMinutes: number)` を追加
- `start` を `startWith(durationMinutes: number, tileId?: string)` に変更

対象: `src/hooks/useExecutionEngine.ts`

やること:
- `startWork(tileId)` でタイルの `estimated_minutes` を取得してタイマーを開始
- `startBreak` を「ユーザ指定分数の休憩タイマー」に変更 (デフォルト5分)
- `skipStep` を削除。`extendWork(minutes: number)` を追加
- ステップ完了コールバックの通知文言を変更 (ポモドーロ文言を削除)

### Task 2: タイル型定義の強化

対象: `src/lib/engine/types.ts`

やること:
- `TileKind` 型追加: `'duration_only' | 'fixed_event' | 'flex_window'`
- `EnergyLevel` 型追加: `'low' | 'medium' | 'high'`
- `Tile` インターフェースに追加: `tile_kind`, `energy`, `fixed_start_at`, `fixed_end_at`, `window_start_at`, `window_end_at`, `estimated_start_at` (全て `string | null`)
- `CreateTileInput` に追加: `tile_kind`, `energy`, `fixed_start_at`, `fixed_end_at`, `window_start_at`, `window_end_at`

### Task 3: TileForm 再設計

対象: `src/components/app/TileForm.tsx`

やること:
- タイル種別セレクタ追加 (3つのラジオ or セグメントコントロール): `自由 (duration_only)` | `予定 (fixed_event)` | `時間帯 (flex_window)`
- 種別に応じたフィールドの出し分け:
  - `duration_only`: 推定時間のみ (既存)
  - `fixed_event`: 日付ピッカー (開始日時 + 終了日時)。`<input type="datetime-local">` を使用
  - `flex_window`: 日付ピッカー (開始日時 + 終了日時) + 推定時間
- エネルギーレベル選択: 3段階セグメント (低/中/高)
- 優先度は既存のスライダーを維持
- デフォルト: `duration_only`, energy=`medium`, estimated_minutes=`25`

### Task 4: useTiles フック改修

対象: `src/hooks/useTiles.ts`

やること:
- `createTile`: `tile_kind`, `energy` を `objective_conditions` JSONB に格納。時間制約を `temporal_conditions` JSONB に格納
- `loadTiles`: tiles 取得後に `temporal_conditions` と `objective_conditions` から上記フィールドを展開してフラットな `Tile` 型にマップ
- `startTile`: 変更なし (既存ロジック維持)
- `completeTile`: 変更なし

### Task 5: スケジューラ実装

対象: 新規 `src/lib/engine/scheduler.ts`

やること:
- `scheduleDay(tiles: Tile[], now: Date): Tile[]` 関数を実装
- ロジック:
  1. `fixed_event` を固定位置に配置
  2. `flex_window` をウィンドウ内でセンタリング
  3. `duration_only` (READY のみ) を priority 降順で空きスロットに配置
  4. 各タイルに `estimated_start_at` を設定して返す
- 衝突検出: 固定イベントと重なる場合は後ろにずらす
- 空きスロット検出: タイルの終了時刻から次のタイル開始時刻の間のギャップ

### Task 6: DayTimeline をタイルベースに全面書き換え

対象: `src/components/app/DayTimeline.tsx`

やること:
- props を `segments[]` から `tiles[]` に変更
- タイルの kind + lifecycle に基づいてブロック位置を計算:
  - `fixed_event`: `fixed_start_at` → `fixed_end_at`
  - `flex_window`: ウィンドウ内で `estimated_minutes` 幅でセンタリング
  - `duration_only` + `estimated_start_at` あり: `estimated_start_at` → `estimated_start_at + estimated_minutes`
  - `STARTED`: `started_at` → `started_at + estimated_minutes`
  - `DONE`: `started_at` → `completed_at`
- ブロック表示: タイル名 + 時間範囲 + ライフサイクルバッジ
- 色分け: STARTED=green, READY(scheduled)=blue/outline, DONE=gray, fixed_event=purple

### Task 7: Timeline ページ改修

対象: `src/app/app/timeline/page.tsx`

やること:
- `useTodaySegments` の代わりに `useTiles` + `scheduleDay` を使用
- タイムラインにスケジュール済みタイル + 実行中 + 完了済みを全て表示
- 統計ヘッダー: 計画合計時間 / 実行済み時間 / 残り時間
- 「未スケジュール」セクション: `duration_only` で `estimated_start_at` がないタイルをタイムライン下部にリスト表示

### Task 8: Timer コンポーネント改修

対象: `src/components/app/Timer.tsx`

やること:
- ポモドーロ周期UI (stepType 色分け、ポモドーロドット) を削除
- タイル名 + 残り時間 + プログレスバー + 操作ボタンのシンプル表示に変更
- ボタン: [開始/一時停止/再開] [完了] [延長 +5min] [延長 +15min]
- アイドル時: 「タイルを選択して開始」のプレースホルダー表示
- `TimerBar.tsx` も同様に stepType 参照を削除

### Task 9: Now ページ再設計

対象: `src/app/app/now/page.tsx`

やること:
- 構成を3セクションに変更:
  1. **実行中**: アクティブタイル+タイマー(可変)、または「アイドル」表示。操作: [完了] [中断] [延長+5] [延長+15]
  2. **次の候補** (ガイダンス): `scheduleDay` の結果から次の3タイルを表示。各タイルにワンタップ [開始] ボタン。時刻とタイル名を表示
  3. **ミニタイムライン**: 現在時刻 ± 1.5 時間の DayTimeline (compact 版)。今の実行状況と直近の予定を視覚的に確認
- クイック追加は維持 (TileForm)

### Task 10: Prompt ページ再設計

対象: `src/app/app/prompt/page.tsx`

やること:
- ポモドーロ文言を全て削除
- プロンプト生成ロジック:
  1. タイマー完了 → 「"タイル名" の予定時間が終了しました」→ [完了] [延長+15分] [延長+5分]
  2. 次タイルの開始時刻が近い → 「"タイル名" の開始時刻です (14:00)」→ [開始] [スキップ]
  3. アイドル + READY タイルあり → 「"タイル名" (推定Xmin, 優先度Y) を始めますか?」→ [開始]
- 各プロンプトカードにタイル情報 (種別、推定時間、優先度) を表示

### Task 11: TileCard 強化

対象: `src/components/app/TileCard.tsx`

やること:
- tile_kind バッジ追加: 予定(紫) / 時間帯(青) / 自由(グレー)
- 計画時間表示: `fixed_start_at` or `estimated_start_at` があれば「14:00–15:15」形式で表示
- エネルギーレベル: ドット表示 (低=1, 中=2, 高=3)
- 実行中プログレス: 経過時間/予定時間のバー

### Task 12: PhaseIndicator + TimerBar の修正

対象: `src/components/app/PhaseIndicator.tsx`, `src/components/app/TimerBar.tsx`

やること:
- PhaseIndicator: ポモドーロ stepType 参照を削除。work/break/idle のみ維持
- TimerBar: stepType 色分け (`focus` → red, `short_break` → green) を削除。work=暖色, break=寒色 のシンプル配色に変更。タイル名を常に表示

### Task 13: ビルド確認 + 動作検証

やること:
- `bun run build` — コンパイルエラーなし確認
- `bun run lint` — 新規コードにエラーなし確認
- Vercel デプロイ: `npx vercel --prod`
- 動作確認チェックリスト:
  - [ ] タイル作成: 3種別 (自由/予定/時間帯) で作成できる
  - [ ] タイマー: タイルの推定時間でカウントダウンが始まる (25分固定ではない)
  - [ ] 延長: +5分 / +15分 でタイマーが延長される
  - [ ] タイムライン: 計画されたタイルが未来の時間帯に表示される
  - [ ] タイムライン: 完了タイルがグレーで表示される
  - [ ] ガイダンス: 次のタイル候補が優先度/スケジュール順で表示される
  - [ ] プロンプト: タイマー完了時に適切なプロンプトが出る

---

## 参照ファイル (実装者向け)

pomodoroom デスクトップ版の設計を参照する際に読むべきファイル:

| 概念 | 参照元 |
|------|--------|
| タイムライン計算ロジック | `pomodoroom/src/components/m3/DayTimelinePanel.tsx` L76-147 |
| タイル種別の時間解決 | `pomodoroom/src/components/m3/DayTimelinePanel.tsx` の `resolveSegment` |
| ガイダンスボード | `pomodoroom/src/components/m3/GuidanceBoard.tsx` |
| タスクダイアログ (フォーム設計) | `pomodoroom/src/components/TaskDialog.tsx` |
| タイル型定義 | `pomodoroom/src/types/` 内の Task/V2Task/TaskKind |
| タイマーエンジン | `pomodoroom/crates/pomodoroom-core/src/timer/engine.rs` |
| スケジューラ | `pomodoroom/crates/pomodoroom-core/src/jit_engine.rs` |
| tastile-core ドメイン型 | `tastile-core/crates/tastile-domain/src/` |
| 既存 JSONB スキーマ | `tastile-web/supabase/migrations/20260313000001_initial_schema.sql` (temporal_conditions, objective_conditions 等) |

---

## リスク

1. **JSONB パース**: `temporal_conditions` に格納したデータの型安全性がない。Zod バリデーション追加を検討
2. **スケジューラの精度**: クライアントサイド計算のため、タブ切り替えやリロードで `estimated_start_at` がリセットされる。永続化するなら Supabase に書き戻す必要あり
3. **datetime-local の UX**: ブラウザの日時ピッカーはモバイルで使いにくい場合がある

## ロールバック

全ての変更は既存ファイルの修正のみ (新規 `scheduler.ts` を除く)。git revert で元に戻せる。
