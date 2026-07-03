# 自動開始終了監査と最短修正計画

## 前提

- すべての決定はアルゴリズムとタイルデータからのみ導く。
- タイルが唯一の真実であり、別系統の実行状態を真実として持たない。
- タイル書き換えは再計算アルゴリズムを最上位に据えて整理する。
- 休憩は特別な相ではなく、再計算で生成される通常タイルである。
- プロンプトの30秒待機中も、既定動作は発火時点から進行しているものとして扱う。

## core 監査結果

### 重大

1. `PhaseKind` / `Execution` 系がまだ主要経路に残っている。
   - `crates/tastile-domain/src/execution.rs`
   - `crates/tastile-core/src/store/state.rs`
   - `crates/tastile-api/src/state.rs`
   - `crates/tastile-api/src/handlers/read_handlers.rs`
   - タイル導出ではなく「現在相」を別概念で扱う経路が残っており、絶対原則と衝突している。

2. 自動開始終了の daemon 経路が通常コマンド経路の永続化と状態通知を通っていない。
   - `crates/tastile-daemon/src/tick.rs`
   - `crates/tastile-api/src/handlers/command_handlers.rs`
   - daemon は `handler.handle(...)` を直接叩いて state を更新するが、`batch_append` / `save_app_tile_snapshot` / `publish_state_event` を通していない。
   - そのため自動開始終了が durable state と UI 更新の正式経路に乗らない。

3. 30秒待機モデルが「既定動作は発火時点から進んでいる」を表現できていない。
   - `crates/tastile-core/src/store/state.rs`
   - `crates/tastile-daemon/src/tick.rs`
   - `PendingPrompt` は `created_at` と `expires_at` しか持たず、既定動作の仮適用時刻や仮適用結果を持たない。
   - timeout 後に `now` で command を投げており、発火時点へのバックデート要件を満たしていない。

4. prompt / auto-execution エンジンが二重化している。
   - `crates/tastile-core/src/prompt/engine.rs`
   - `crates/tastile-scheduler/src/prompt_engine.rs`
   - `crates/tastile-scheduler/src/auto_execution.rs`
   - 新旧の責務が混在しており、実行判断の唯一性が壊れている。

### 高

5. prompt 永続化の設計と実装が分離している。
   - `crates/tastile-core/src/event/payloads.rs`
   - `crates/tastile-core/src/reducer/mod.rs`
   - `crates/tastile-core/src/store/state.rs`
   - `PromptScheduled` / `PromptCleared` は存在するが、daemon tick は `state.pending_prompts` を直接書き換える。
   - `pending_prompt_ids` と `pending_prompts` の二重管理になっている。

6. `StartBreak` / `EndBreak` が特殊コマンドとして強く残っている。
   - `crates/tastile-core/src/handler/command_handler.rs`
   - `crates/tastile-api/src/state.rs`
   - 休憩を通常タイルとして扱う方針に対して、実行面では依然として特別扱いが強い。

7. `BreakStartedPayload.linked_tile_id` がタイル間関係を持ち込んでいる。
   - `crates/tastile-core/src/event/payloads.rs`
   - タイル自体に外部参照は持たせていないが、実行事実として強い関連を保存している。

8. `SplitAndExtend` が `objective.target_work_min` を直接増やしている。
   - `crates/tastile-core/src/handler/command_handler.rs`
   - 他パラメータから導出されるべき量を仮置きで増やしており、ユーザーのパラメータ原則に反する。

### 中

9. `process_tick_once()` に旧来の自動開始終了経路が残り、daemon 側の新経路と責務が重なっている。
   - `crates/tastile-api/src/state.rs`
   - API 側 tick も `PhaseKind` ベースで自動開始終了を行うため、daemon loop と二重責務になっている。

10. `read_handlers` は pending prompt がなければその場で `PromptEngine` を再評価して prompt view を返す。
    - `crates/tastile-api/src/handlers/read_handlers.rs`
    - 永続 prompt と瞬間評価 prompt が同じ read API で混ざる。

11. スケジューリング順位は概ね意図に近いが、現状の分類はまだ粗い。
    - `crates/tastile-core/src/scheduler/priority.rs`
    - `crates/tastile-core/src/scheduler/time_pie.rs`
    - 現在は
      - 固定
      - 定期固定
      - 非分割レンジ
      - 定期非分割レンジ
      - break
      - split/maximize/regular split
      の順だが、break を「全時間充填前提の基底タイル」として扱う設計にはまだ届いていない。

12. `recalculate()` は tile を直接 insert/remove/update している。
    - `crates/tastile-core/src/recalc/mod.rs`
    - ユーザーの意図する「tile 変更は再計算だけ」に近い一方、実際には command handler も tile を変えているため統一されていない。

## desktop 監査結果

### 重大

1. desktop が既定動作を独自に決めて30秒後に実行している。
   - `src/TastileDesktop/ViewModels/MainViewModel.cs`
   - `src/TastileDesktop/Services/PromptAutoActionPolicy.cs`
   - fixed schedule 判定も auto action 選択も desktop 側で行っており、責務が core から漏れている。

2. desktop の 30秒既定動作は「発火時点から既定動作が進行している」を満たしていない。
   - `src/TastileDesktop/ViewModels/MainViewModel.cs`
   - `Task.Delay(30s)` のあとで action を実行しているだけで、発火時刻に遡った処理がない。

3. PollingService は「tick-based auto processing」をやめて read-only poll に切り替えているが、wall clock poll を開始していない。
   - `src/TastileDesktop/Services/PollingService.cs`
   - `StartAsync()` で `_wallClockPollTimer.Start(...)` が呼ばれていない。
   - SSE の `state_changed` 依存になるが、core daemon の自動実行経路はその通知を出していない。

### 高

4. prompt の再描画判定が `PromptId` のみで、created/expires/stale の変化を無視している。
   - `src/TastileDesktop/Services/PollingService.cs`
   - prompt の時間経過状態を UI が追従できない。

5. prompt cooldown / fingerprint suppression が、同一 prompt の再通知を握り潰す。
   - `src/TastileDesktop/ViewModels/MainViewModel.cs`
   - 自動実行後や dismiss 後の再評価が必要なケースで prompt が見えなくなる可能性がある。

6. `PromptNotificationPolicy` は実質スタブ。
   - `src/TastileDesktop/Services/PromptNotificationPolicy.cs`
   - label 以外は常に toast 表示、intervention は常に無効で、要件に沿う通知方針になっていない。

7. legacy 通知系が core の prompt action 体系を迂回している。
   - `src/TastileDesktop/Services/NotificationService.cs`
   - `src/TastileDesktop/Services/InterventionEngine.cs`
   - `StartBreakAsync(5)` など固定値のデスクトップ独自動作が残っている。

### 中

8. desktop API model が read/write で automation 名称不整合を抱えている。
   - `src/TastileDesktop/Models/ApiModels.cs`
   - read model は `auto_start` / `auto_complete`、write model は `auto_start_allowed` / `auto_end_allowed`。
   - 直ちに自動開始終了バグの主因とは断定しないが、責務整理時に揃えるべき。

## 最短修正計画

### Phase 1: まず止血する

1. daemon の自動実行経路を SharedState の正式コマンド実行経路に統合する。
   - 自動開始終了と prompt default 実行後に
     - event append
     - snapshot save
     - sync trigger
     - `state_changed` publish
     を必ず通す。

2. desktop から独自 auto default 実行を除去する。
   - `PromptAutoActionPolicy`
   - `AutoExecutePromptActionAsync`
   - fixed schedule 判定による desktop 側 default decision
   を停止する。

3. PollingService の wall clock poll を有効化する。
   - 1秒または数秒間隔で軽量 poll を回し、state event が来なくても prompt/実行状態が前進するようにする。
   - これは本質修正ではなく止血。

### Phase 2: 要件通りの prompt time model に直す

4. core に「prompt 発火時刻」と「既定動作の仮適用時刻」を導入する。
   - pending prompt は `triggered_at` を持つ。
   - 既定動作は prompt 作成時点から進行中として execution/timeline/view に反映する。

5. 30秒後は「新規実行」ではなく「仮適用を確定」に変える。
   - 実行 command の timestamp は `triggered_at` ベース。
   - 30秒以内の別選択があれば、その時点で仮適用を打ち消して別決定を materialize する。

6. pending prompt を event-sourced に揃える。
   - `PromptScheduled` / `PromptCleared` を本実装にする。
   - `pending_prompt_ids` と `pending_prompts` の二重管理をやめ、単一の prompt state に統一する。

### Phase 3: 原則違反を除去する

7. `PhaseKind` / `Execution` 依存を read model 以外から除去する。
   - 自動開始終了判断は tile 条件と recalc 結果からのみ導く。

8. `StartBreak` / `EndBreak` の特殊経路を縮退させる。
   - break tile の生成は recalc。
   - 実行は通常 tile start/complete に寄せる。

9. `SplitAndExtend` による `target_work_min` 直接加算を廃止する。
   - 延長は derived execution intent として扱い、tile objective の真値を汚さない。

10. scheduling priority を再定義する。
    - break を「空き時間の後付け」ではなく、時間全体を埋める再計算生成物として再整理する。
    - そのうえで tie-break は scoring のみで行う。

## 受け入れ条件

- 固定開始タイルは発火時刻に started とみなされる。
- break 開始と break 終了も同じモデルで扱われる。
- 30秒待機中、timeline / execution view / toast 表示は既定動作進行中の状態を示す。
- 30秒後は確定のみが起こり、開始時刻や終了時刻は発火時点のまま保存される。
- desktop は prompt の表示とユーザー入力だけを担当し、既定動作の意味決定をしない。
- 自動開始終了で発生した変更は event store と UI に即時反映される。
