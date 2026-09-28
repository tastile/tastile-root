# Tastile 全史 raw corpus — 前史から 2026-09-29 まで

> Captured: 2026-09-29 JST
>
> この文書は Tastile の正式な architecture SoT ではない。
> 後続の architecture / ubiquitous language / KPI / SLO / PoC / ADR / D2/TALA 再定義に先立ち、
> ChatGPT の長期会話履歴・memory、過去会話で参照された project reports / reviews / repository facts から、
> Tastile の前史から現在までに分かる情報をなるべく圧縮せず repository 側へ外部化するための raw corpus である。
>
> 現在採用されていない用語、失敗した案、途中実装、矛盾した記録、同じ出来事の重複説明も意図的に残す。
> 「後から見ればどう整理すべきか」はこの文書では判断しない。
>
> secret / password / token / private key / 個人用ネットワーク値そのものは記録しない。
> ただし、それらに関する障害・移行・設計判断が存在した事実は残す。

---

## 2025年以前〜2025年: Pomodoroへの関心とTastile以前

### Pomodoroを使う側だった時期

- 2025年のプロジェクト学習資料には、Pomodoro timer を自作する前は他のサイトの Pomodoro timer を利用していた、と記録されている。
- 同資料では Pomodoro technique を「25分作業 + 5分休憩を繰り返す」ものとして扱っている。
- この時点で関心の中心は「タスク管理サービスを作る」ことではなく、自分の集中・学習効率を改善する実践的な timer だった。

### 2025-07-06 前後: 自分のWebサイトにPomodoro timerを実装

- 自分の Web サイト上に Pomodoro timer を実装した記録がある。
- 当時の URL は `https://www.yusuke-kim.com/tools/pomodoro`。
- 25分の作業、5分の短い休憩、15分の長い休憩という Pomodoro の基本サイクルを持っていた。
- notification / sound、settings、session / statistics、auto-start、progress 表示なども実装対象だった。
- 2025年の資料では「形にはなっているが、もっと整頓して使いやすくしたい」という評価が残っている。
- この段階ではまだ `Pomodoroom` や `Tastile` という名前は存在しない。

### テスト週間を起点とする別の歴史記述

- 後に作られた Tastile の project history / 学習資料では、起点を
  「テスト週間に勉強効率化のためポモドーロタイマーの Web アプリを開発『pomodoroom』」
  と説明している。
- この説明と、2025年の個人サイト上の Pomodoro timer の記録がどの時点で一本化したかは、現在取得できた履歴だけでは確定できない。
- したがって、この raw corpus では
  1. 他サイトの Pomodoro を使っていた
  2. 自分の Web サイトに Pomodoro timer を実装した
  3. テスト週間の勉強効率化を目的とする Pomodoroom が存在した
  という記録を、無理に一つの出来事へ統合しない。

### 2025-12-01: 「1つのタスクへ集中」から「複数の仕事を進めながら集中」へ

- 会話では「ポモドーロで1タスクなら集中できる」という前提が置かれていた。
- そのうえで、「2タスク双方で集中を維持するにはどうするか」という問題が明示された。
- 複数の具体案を大量に求めており、この時点で単純な countdown timer だけでは問題が解けない認識がある。
- 後の Pomodoroom/Tastile にある task switching、interruption、next action、scheduling、execution control の問題意識につながる初期記録として残る。

---

## 2026-02: Pomodoroom が timer から task / execution system へ拡張

### 2026-02-10: Pomodoroom repository と現実の作業状況

- active repository として `rebuildup/pomodoroom` が使われていた。
- 作業状況の例として、複数の project/task を進めながら、
  AI の処理待ち、Discord、動画、SNS、他 project の待ち時間などが同時に存在する状況が語られた。
- 「2つの lane では足りない。4 project 待ちのようなこともある」という認識があった。
- 問題は「タスク一覧を管理すること」ではなく、並行状況の中で自分が何をすべきか見失わないことだった。

### 「缶詰型集中」と「電車案内型」

- 目標 UX は「缶詰型集中」と「電車案内型時間系明解ワークフロー」という言葉で表現された。
- 「缶詰型集中」は、作業対象から意識が逸れにくい環境・制御を作る方向。
- 「電車案内型」は、次に何をいつやるかを、路線・列車・駅のように明確にする方向。
- 会話内の対応関係:
  - Room = 路線
  - Session sequence = 列車
  - Work / Break / Review / Buffer = 駅
  - task switch = 乗換
  - interruption / overrun = 遅延
- 未来のすべてを見せるのではなく、2〜6駅程度を見せる案もあった。
- task switch は原則 break / review / buffer のような自然な境界で行う思想があった。

### 作業中UIを極端に単純化する発想

- 実作業中に本当に必要なのは
  - Now
  - remaining time
  - memo box
  - Resume
  程度でよいという設計案があった。
- 作業中に再計画や大きな判断をさせず、気づいたことは memo box へ退避させる方向があった。
- 「作業管理UIを操作すること」が新しい作業にならないようにする意図がある。

### Schedulerをかなり自動化したいという要求

- 作業時間を自動推定・自動配置したい。
- Google Calendar 等の予定制約を考慮したい。
- 仕事だけでなく、生活上必要な時間、macro-scale の時間も扱いたい。
- 休憩をユーザーが逐次決めるより、system が自動決定または推奨したい。
- 後の automatic placement / recurring / Window / break / Flow と完全に同一ではないが、問題意識はここですでに存在する。

### Anchor / Ambient

- Discord、動画、SNS 等を `Ambient` として扱う発想があった。
- Ambient を単に禁止・停止することは望まれていなかった。
- 何を見ているかを常時監視して排除する構成も主眼ではなかった。
- 代わりに、本来やるべきことへ意識を戻す `Anchor` を強くしたい、という方向だった。
- Anchor は大きな管理画面ではなく、floating notification に近い interaction として想定された。
- ユーザーに小さな選択・応答だけを求めるものとして考えられていた。

### Material 3 移行とUI token

- 2026-02-10 時点で Pomodoroom は Material 3 移行中だった。
- CSS token、Light/Dark 切替、`?window=tokens` の DesignTokenShowcase などが入った。
- review では型checkの分離、巨大な rem 値、無効 color、ref prop、theme synchronization など複数の問題が指摘された。

### TaskState / Pressure / NowHub / Board / Candidate

- task state model は `READY / RUNNING / PAUSED / DONE`。
- `Pressure` という語が使われた。
- `Anchor` / `Ambient` は task store から派生させる実装があった。
- `NowHub`、`Board`、`NextTaskCandidates`、EnergyPicker、SessionCard 等のUI/機能があった。
- Phase 1 では NowHub + Ambient(PAUSED) + NextTaskCandidates を統合。
- candidate には READY / PAUSED が入り、直近完了、同一 group 文脈などが score に影響した。
- deferred / blocked / waiting penalty があった。
- interrupted work を優先しやすくする bonus があったが、interruptCount を PAUSED 再開用に仮加算すると実履歴を壊す点が review で問題視された。
- interruption bonus が大きすぎると他の priority factor を支配する懸念もあった。
- idle 時に Play/Pause が resume 扱いになり start できない問題があり、`timer.start()` への分岐が必要とされた。

### Phase 2 TaskBoard

- TaskBoard を Ready / Deferred の2列へ刷新。
- priority による defer / undefer。
- TaskCreateDialog。
- TaskEditDrawer / TaskDetailDrawer。
- TaskOperations の統一。
- review では:
  - DnD の priority callback 未分割
  - card 操作 click bubbling
  - edit save button 欠落
  - v2 Task state 判定誤り
  - postpone 未処理
  - TaskCreateDialog の Ctrl/Cmd+N、Ctrl+Enter、focus trap 欠落
  - M3 token を使っていない箇所
  - TaskDetailDrawer null crash
  - estimatedMinutes 変更時に estimatedPomodoros が追随しない
  等が指摘された。

### SQLite / Rust / scheduler / calendar / notifications

- SQLite/Rust migration が進んでいた。
- notification、Scheduler、CalendarSidePanel、Timeline、Project、Stats/Session、settings、shortcuts、persistence を持っていた。
- review では:
  - READY/RUNNING/PAUSED/DONE transition の不整合
  - task が複数 lane に重複
  - gap を過剰に埋める
  - energy 計算が時刻依存で不安定
  - break/routine type が失われる
  - countdown が固定 `Date.now()` に依存して更新されない
  - SQLite/Tauri migration 後も localStorage 系が残る
  - theme initialization の FOUC
  があった。
- proposal detection は TaskStore / Google Calendar が real data を持つまで一時的に disabled。
- 一部 UI state は SQLite/Tauri cache へ移されたが TTL は無かった。

### 2026-02-11: Pomodoroom という名前の限界

- 「ポモドーロタイマーを押さなくなってきた」ため改名を検討。
- 候補は task、助ける、助かる、room、calendar 等の連想。
- `Tascal` が好感触だったが、既存商標・既存利用が多い懸念があった。
- 最終的には task 系の語を名前に直接含めなくてもよく、Gemini のように独立した brand name でもよいという考えに広がった。

### 2026-02-12: calendar-integrated desktop task manager

- Pomodoroom は「calendar と連携する desktop task manager で、Pomodoro のように集中を支援するもの」と説明された。
- logo 方針:
  - white background
  - Google Blue に近い blue
  - grayなし
  - gradientなし
  - hierarchy は blue shade
- 初案に対し「遠距離で識別不能」「Google Blue ではない」という否定的評価があった。
- integration test は tasks / calendar events / free-time detection / proposal generation / priority を通した。
- TaskStore tests は Anchor/Ambient derivation、strict state transition、estimated-duration extension。
- Scheduler は schedule generation / auto-fill。
- Timeline は calendar retrieval / gap suggestion。
- Google Calendar の all-day event は UTC datetime 化ではなく YYYY-MM-DD として扱わないと日付がずれる問題があった。
- parallel timeline blocks は固定 `lane * 33.33%` ではなく dynamic lane sizing が必要だった。

### 2026-02-15: scheduling の複雑化

- hard / soft constraint scheduling を実装。
- monthly checkpoint replay。
- calendar DB。
- settings / audio / cross-platform fix。
- checkpoint id を秒だけで作ると collision する問題。
- `now` を一度 capture し nanos / UUID、real `created_at`、index を使う方向が議論された。
- auto schedule split では progress をそのままコピーしない。focus duration から再計算し、必要なら incomplete とする。
- project_ids / group_ids が Task に追加されたが、persist / restore / update / test / migration が足りない点が指摘された。
- estimatedMinutes edit が保存されない問題。
- Calendar/Todo import で `estimatedStartAt` が失われる問題。
- interruption 後の restart notification:
  - 15分後相当
  - next task start
  - next task の後
  などがあった。
- GuidanceBoard は next countdown / ambient candidates / elapsed minutes を表示。
- RecurringTaskEditor の編集中 state が外部updateに上書きされる問題。

### 2026-02-16〜17: external sync と execution edge

- Google Tasks sync:
  - pagination 不足
  - list fetch failure が silent
  - aggregate failure に service が入らない
  - completion time overwrite
  - 25分 hard-code
  - 広い external-service permission
  - duplicated Tokio runtime
  等の review finding。
- break/activity notification:
  - state mismatch により completion notification 到達不能
  - minute string に logic 依存
  - dismiss state 未保存
- `DRIFTING` operation/state が repair work に現れた。
- local data は `~/.pomodoroom`。
- warnings / unused code / label safety / notification error handling も修正対象だった。

---

## 2026-03: Pomodoroom から Tastile へ

### 2026-03-11: incremental extension ではなく全面再設計

- Pomodoroom を完全に作り直し、business として成立する product にしたいという判断。
- 既存 application を延命する前提ではなく、別/new application として扱う。
- PC を primary work surface とする。
- smartphone access は必須。
- OS 深い機能との統合を重視。
- React Native 等の cross-platform client を主軸にはしない。
- iOS / Android は native 対応を重視。
- Google Calendar を DB / Source of Truth にしない。
- Calendar を SoT にすると sync complexity が増え、UX も悪化すると判断。
- Calendar は auxiliary input / integration。

### 2026-03-12: Tastile 名称と domain

- `tastile.app` 取得。
- 名称説明は `Tastile = task + tile + style`。
- Pomodoroom の redesign から Tastile project へ移行。
- 初期技術候補:
  - Core: Rust / Tokio / Axum / SQLite / SQLx
  - Windows: C# / WinUI 3
  - Apple: SwiftUI
  - Android: Kotlin / Jetpack Compose
  - Cloud/Web: TypeScript / Next.js / PostgreSQL / Drizzle
- Core responsibility:
  - scheduler
  - decision
  - session
  - interruption
  - resume
  - notifications
  - synchronization
  - storage
  - jobs
- client は thin。
- Pomodoroom から引き継ぐ候補:
  - timer
  - work/break
  - session start/end/history
  - task create/select/complete
  - Google Calendar retrieval/placement
  - local persistence/API
- Tastile で特に残したい要素:
  - session
  - task-session connection
  - execution log
  - focus/execution control
- YouTube/entertainment は Pomodoroom 由来だが Tastile の product feature として不要。
- execution control と project management は接続したい。
- memo は究極に低い cognitive load を目指す。
- Project は task の付属概念として扱いたい。
- AI が structure を「手足」のように参照・書き換えできることを望む。
- AI は人間が可能な操作と同じ操作をする執事的な方向も語られた。
- PAUSED を独立 state にする必要性を疑い、priority/condition 等の parameter で表せるなら state を増やさない方向が好まれた。

### 2026-03-24: automatic scheduling

- recurring scheduling / generation が進む。
- due-date / start-time tie-break。
- negative overdue duration が 1〜59分で truncation される bug。
- overdue / due-soon / interrupted regression test を要求。
- recurring generation では duplicate-instance risk、title/time dedup の不安定さ、anchored recurrence drift / window boundary 問題も review で指摘。
- break generation / recalculation。
- priority reallocation。
- SemanticRole。
- event persistence / restoration。
- JSON error handling。
- focus policy:
  - completed block count
  - break cycle
  - `break_splits_work`
  - session-gap reset
- docs と implementation の不一致が残った。

### 2026-03-28: Android

- tastile-core JNI integration。
- event sync / projection。
- exact-alarm notifications。
- Supabase persistence を含む work。
- boot/time rescheduling。
- `./gradlew verify` / CI hardening。
- review finding:
  - rejected acknowledgement handling
  - snapshot user-scope validation
  - replay/bridge locking
  - alarm API guards
  - stale UI
  - event-sequence ordering
  - cancellation / error propagation

### 2026-03-28: Desktop

- Google OAuth。
- sync。
- update plumbing。
- ExecutionView が older ActiveTile view を置換。
- quota/conflict/manual-duration。
- startup / CI / tests。
- review finding:
  - OAuth state/callback leak
  - shared-file race / destructive take
  - endless re-auth
  - auth/session clear incompleteness
  - update URL validation
  - clock-triggered UI refresh
  - daemon integrity/hash/cache fail-closed
  - UI/error handling

### 2026-03-28: Core

- scheduler
- persistence
- auth/API
- daemon tick
- Rust crates
- WASM/JNI
- synchronization
- storage
- CLI/IPC
  と責務が非常に広がっていた。
- review finding:
  - OAuth state / XSS
  - revision/event-count consistency
  - label-only projection
  - priority classification
  - blocking operation inside async
  - SQLite error propagation

---

## 2026-04: schedule/execution/calendar system の急速な肥大化

### 2026-04-02

- `DeleteTile` を delete より close semantics へ。
- `UpdateTile` 追加。
- scheduler 由来 next actionable tile / projected start。
- editable read。
- SSE state publication。
- review:
  - partial update が next_action / done_definition を消す
  - closed SSE channel で busy loop
  - replay/reducer duplication
  - 7-day projection lock
  - label split が scheduling に影響
  - machine-specific plan path 漏れ

### 2026-04-04: Web companion / Supabase

- Web が Rust Core parity を目指す。
- WASM / daemon read path。
- Supabase sync。
- offline queue。
- conflict resolution architecture。
- sync status UI。
- freshness check。
- defensive validation。
- 後の AWS/RDS 中心構成より前に Supabase が実装上重要だった時期。

### 2026-04-06: Coreではない外部client

- CSV → Tastile API tool を Tastile Core に入れず別 application とする。
- 各 platform backend の API を呼ぶ。
- local Web app から開始。
- 「1日で完成しないなら作らない」という hard constraint。
- 1日版:
  - Vite + React + TypeScript
  - PapaParse
  - health/session/read connection check
  - CSV load
  - title 等の最小 mapping
  - dry-run
  - create-only sequential POST
  - success/failure view
- update / upsert / sync / advanced UI は切る。
- これは Tastile を service/API として他 client が利用する発想の初期事例。

### 2026-04-07

- fixed-schedule prompt start/end auto action。
- 30秒 delay。
- cooldown / fingerprint。
- startup recovery exclusion。
- Timeline wheel zoom / scope。
- WinUI COM transient failure 対応。
- prompt dispatch / selection policy を中央化。
- label creation は execution guard を bypass せず可能にする。
- sound settings。
- multi-week/month/year range。
- completion scope。
- break insertion parameter。
- Web PR #3:
  - persisted tiles workspace tabs(list/timeline/changes)
  - daemon/WASM parity read models
  - prompt defer / startup-recovery actions
  - timeline zoom
  - theme persistence
- Android PR #2:
  - dashboard/prompt parity
  - timeline normalization/fallback
  - daemon diagnostics/maintenance
  - notifications
  - sync fallback

### 2026-04-08〜12: CalendarStore / projection / recovery

- Desktop month/week/year calendar grid。
- viewport-based fetching。
- range/anchor resolver。
- sync-mode / calendar control。
- .NET 9。
- review:
  - stale fire-and-forget polling
  - range change detection only by item hash
  - clipping/overflow
  - expensive visual-tree traversal
  - calendar selection reset不可
- Core calendar persistence:
  - schema v3
  - calendar connections
  - event mirror
  - sync cursor/state
  - CalendarStore
  - upsert/patch/cancel
  - incoming import
  - duplicate recurring root repair
  - disconnect cleanup
- break / recurrence materialization。
- recurring template/instance IDs。
- horizon recurrence materialization。
- day/week/month/year calendar API。
- daemon に re-entrant snapshot deadlock があった。
- startup recovery anchor。
- break generation horizon。
- occupied interval。
- time-pie / calendar projection。
- Google OAuth/client/sync plumbing。
- review:
  - unstable recovery anchor
  - focus carryover ignored
  - pagination
  - immediate-expiry prompt
  - overdue break finalize 未完成
- `pomodoroom loop` regression test が Tastile Core に残っており、直接の継承関係がコードにも現れていた。

### 2026-04-13: Tastile Tile と Google Calendar の相互運用

- 明示要求: Tastile の tile schema は Google Calendar より能力が高いものにし、相互連携可能にする。
- Tile は execution domain 本体として維持。
- Calendar compatibility は別 facet/layer。
- execution side:
  - segments
  - interruption/resume
  - target duration
  - prompt
  - memo
- calendar/interop side:
  - calendarId/eventId/iCalUID
  - etag/sequence
  - attendees
  - visibility/transparency
  - conferenceData
  - reminders
  - attachments
  - RRULE / exception
  - extendedProperties 等
- Tastile recurrence と Google RRULE は別概念。
- work segment は原則 Google へ first-class event として同期しない。
- external sync state / etag / sequence / source ownership は interop sync に隔離。
- 段階案:
  1. lossless import
  2. Google → Tastile round-trip
  3. Tastile → Google
  4. bidirectional conflict handling
  5. recurring instance

### 2026-04-13〜16: Break / Phase / Recalc / Startup

- due break を execution candidate に入れる。
- recalc-generated break に `generated_by_recalc`。
- legacy daemon tick を削除。
- explicit Break segment。
- review:
  - `phase_ends_at` が wall clock/current time を混ぜる
  - expired boundary ignore
  - prompt overwrite each tick
  - HashMap iteration nondeterminism
  - generated tile update constraints不足
- tile-first execution:
  - PhaseKind 依存を DerivedPhase / `active_segment_mode` へ置換
  - fixed-time / non-splittable tile は phase completion behavior を変える
- Supabase failure 後も Google Calendar sync を続行する変更。
- ただし last_success time semantics が曖昧。
- forced start で previous segment を閉じず overlapping segment を作れる問題。
- PR #22 系:
  - snapshot-first restore
  - recurring materialization before recovery
  - fixed-window/break handling
  - active split projection capping
  - isolated CLI simulation: `tick-at`, `tick-range`, seeded scenarios, JSON consistency report
  - open-segment authoritative in-progress
  - due-break no longer blocks work start
  - deterministic break regeneration/preservation
  - startup orphan-break recovery
- review:
  - materialized recurring instance が fixed_* bounds を欠く
  - unrestricted bypass-auth env が危険
- EndTile default action は COMPLETE_PHASE 寄りへ変更。
- timeout path が COMPLETE_TILE を優先している review finding。
- Desktop prompt timeout default / ISO8601 expiry / wall-clock command tick polling 等。

### 2026-04-16: GitHub Actions minutes

- GitHub Actions included 2,000 minutes を使い切った。
- 2026年9月だけではなく、この時点ですでに CI 容量/コストが delivery の制約になっていた。
- 4/16〜4/30 の Actions usage cost は later receipt で $0.41、total receipt $0.45 と記録された。

---

## 2026-05: architecture 自体を疑い始める

### 2026-05-19

- 早期 product でも単なる Web demo ではなく、Google Calendar 級の実用的基盤に近づけたい。
- Rust/frontend composition と mobile expansion を維持したい。
- 問題:
  - algorithm redundancy
  - DB concept redundancy
  - irregular operation に弱い
  - 継ぎ足し implementation で理解困難
- Onion architecture を検討。
- Tauri と MUI は将来方向から外す。
- `TimeCore` / `Entry` のような generic box を嫌う。
- `tastile` 自体を generic internal key に乱用しない。
- generation / hierarchy で意味が分かるのに重複 name を付けない。
- すべてのI/Oを universal `Command` へ包む抽象も否定。
- feature は独立して意味を持ち、Rust/frontend connection は explicit にしたい。
- 一時案として `task/slot/alarm/repeat/plan/remind/...`、`input/task/slot/plan/alarm/remind/run/journal/arrange` のような feature-oriented module も検討された。
- ただし後には state/workflow box 中心ではなく「fact から導出する」方向へも転換。
- architecture を考えること自体が目的にならないよう、構造が定まれば product/business/schedulingへ戻る方針。

### 2026-05-25

- Supabase project `tastile` が7日以上 low activity で auto-pause 対象になる通知。
- Supabase はこの時点まで実利用/実験の一部だった。

### 2026-05-28

- Core PR #24/#25 で broad migration/recovery review。
- API / WASM / Recalc / Scheduler / Storage/Event Store / Sync / Google Calendar tests 等。
- PhaseKind removal migration guide。
- auth/session restore。
- command/read API。
- state projection / time-pie projection。
- prompt engine。
- recalc integration。
- daemon。
- offline queue / sync engine。
- Docker Compose。
- old architecture/plugin docs。
- 2026年4月 recovery plans。
- repository の実態には old Command/Event/Reducer/Scheduler、巨大 TileCore、旧Task/Block語彙、README/docs の不一致が残っていた。
- user の設計原則として「use caseごとに processing scope を増やさない」。
- mechanism / condition / objective / obligation(debt) / ownership or affiliation で説明したい。
- 新しい abstraction は必要な時だけ導入。

---

## 2026-06: AWS beta、競合整理、v7、v1 era

### 2026-06-07: AWS beta real path

- region は ap-northeast-1。
- EC2 public / RDS private。
- Cognito User Pool。
- ECR。
- SSM。
- RDS は managed master password + Secrets Manager 方向。
- `/health` = 200。
- `/ready` = 200。
- unauthenticated protected read (`/read/tiles`) = 401。
- DNS/TLS は初回成功時点では未完成。
- RDS automated backup retention = 0 だった。
- manual snapshot を作成。
- 初回 SSM operation の経路で DB password が露出し、その後 rotate。
- 以後 secret を chat / git に置かない方針を明確化。
- beta hostname は `beta.tastile.app`。
- Cloudflare DNS-only。
- admin access は限定 CIDR を使った。具体の個人 CIDR は raw public doc には出さない。
- Cloudflare CLI `bunx cf` v0.0.6:
  - auth/context/zones
  - dns records
  等を利用可能。

### AWSを選んだ理由として学習資料に残るもの

- Rust / Axum / Tokio / SQLx:
  - type safety
  - performance/stability
  - API / worker / time calculation を同一言語
  - Rust経験
- PostgreSQL / Amazon RDS:
  - multi-user
  - transaction
  - concurrent update
  - history
  - structured data
- AWS:
  - industry adoption
  - initial credits
  - learning / career value
- Next.js 16 / React 19 / TypeScript / Bun:
  - previous experience
  - UI/BFF/auth/payment affinity
- Kotlin / Compose:
  - notification
  - OS API integration
- Cognito:
  - shared identity across Web/Android
  - JWT boundary
- これらは当時の選定理由であり、2026-09-29 の再評価結果ではない。

### 2026-06-13〜18: SES

- AWS SES の認証メール準備。
- ap-northeast-1 で tastile.app DKIM 成功。
- `mail.tastile.app` custom MAIL FROM 成功。
- Cognito signup verification、OTP login、recovery、security notification 等、初期100通/日未満を想定した申請。
- rate limit / bounce / complaint 時停止などの説明。
- SES sending limit / production access increase は後に AWS から不承認。
- us-east-1 側では DKIM detection failure の記録もあり、regionごとに状態が異なる履歴がある。

### 2026-06-16 前後: v6→v7

- v6→v7 見直し。
- D-022 採用、D-021 以下 superseded という履歴。
- 6-stage pipeline。
- Source / Compiled / Working の3層。
- State join view。
- compile boundary。
- runtime tick。
- placement resolution。
- invariants I-1〜I-25。
- fact stream。
- `pomodoroom/CORE_POLICY.md` から
  - 「常に主行動は1つ」
  - 「介入は不可避」
  - `Tastile controls human execution`
  に連なる思想。
- `tastile-domain` zero-dependency。
- `execution.rs` に PhaseKind/Execution。
- `tick.rs`、`runtime.rs`、`placement.rs`。
- SQLite を Store trait で abstraction。
- API は tile start/complete/defer/extend、break start/end、tick/tick-at/tick-range、execution read、startup recovery、break recurrence ensure 等。
- この v7 設計は後の v1 では current SoT ではない。

### 2026-06-17: competitive landscape

- TickTick を非常に重要な close competitor と認識。
- TickTick:
  - Tasks
  - Calendar
  - Habit
  - Pomodoro/Focus
  - Eisenhower
  - Timeline
  - Duration
  - recurrence
  - Focus Statistics
  - Google Calendar sync
- Tastile の違いは feature 数ではなく、
  `定期条件 → 配置 → timeline → execution state → 崩れた後の再配置`
  に置いた。
- state/behavior として未開始、実行中、中断、延期、完了、失敗など。
- fixed work の間へ variable work を入れる。
- interruption / delay / failure / waiting for re-placement を扱う。
- direct competitors として Motion / Reclaim AI / SkedPal / Morgen。
- adjacent: Sunsama / Akiflow / Structured / Todoist / Tiimo / Llama Life / Routinery / Focus To-Do / Forest。
- 「AI万能秘書」より、崩れた予定の再配置・差し替え・execution record を differentiator にする考え。

### プロジェクト学習資料に残る明示的な origin chain

- テスト週間に Pomodoroom を開発。
- Web app では常駐管理・実行が難しい。
- Tauri/Rust で desktop 化。
- task management 等が増える。
- execution management idea が増える。
- framework limitation で low-level implementation が難しくなる。
- application split を計画。
- この時点で Tastile project を立ち上げ domain 取得。
- local Rust app + frontend communication を試す。
- implementation に苦戦。
- online sync を考えると data が混線。
- 実現したい機能から遠ざかる。
- software architecture を学び強く影響を受ける。
- backend-centric service に転換。
- 「ここまで半年」。
- その後 v7 で開発するが複雑化し、v1 era で白紙から再構築。

### product thesis として当時書かれたもの

- calendar app = 予定。
- clock app = 実行。
- task management app = やる事。
- 既存 application は各機能を持つが、記録から人間が実際に実行するまでの behavior へ十分踏み込まない。
- Tastile は task を minute-level schedule へ落とし、実行まで support。
- 日常で思いついた idea/task が即座に concrete schedule placement になる。
- habit support。
- alarm-clock のような force を ordinary tasks にも働かせる。
- planned vs actual drift を system が吸収し、ずれた予定を調整する。
- 初期 target user は「勤務時間ではなく集中して仕事した量が成果につながりやすい freelancer」。
- user permission を使った team schedule management も将来像に含まれた。
- Tastile は task-list tool ではなく execution-control system。

### 2026-06-24: v1 era

- v7 complexity を理由に、v1 era として仕様を白紙から再構築。
- backend が service の核。
- frontend/client は thin client。
- UI、notifications、platform-native capability を client が担う。
- business/domain logic を client に置かない。
- immediate priority は Web + Android。
- Desktop / iOS / Mac は後続。
- current canonical set は後に `tastile-core/v1/00..15-*.md`。
- old v7 docs は archive。
- phases:
  - Phase A: Tile / Plan / Recurring / Placement / Execution / Span / Window
  - Phase B: Condition AST / Reference / Frame / Gap
  - Phase C: Metric / Flow / Candidate / ChangeSet conflict
  - Phase D: DecisionRun / Session / Delivery
  - Phase 5: v0 removal after client migration

### 2026-06-27〜28

- Phase A implementation が大規模に入る。
- domain / state-event pipeline / scheduler / storage / API / daemon / CLI / plugins / migration。
- 384 files 規模の review で automated review が skip された履歴。
- 2026-06-28 の簡潔な product 説明:
  - Web/mobile/desktop schedule management service
  - fixed plan / deadline work / recurring / interrupted resume を tile で time axis へ配置
  - schedule collapse 後に next action を再構築
  - Core scheduling/state transition + API/DB + clients
  - start/interruption/postpone/recurrence/restart recovery を simulation test
  - current screen state ではなく operation/event record から recoverable にする

---

## 2026-07: v1 workspace / visibility / environment

### 2026-07-22: generation naming

- core repository: `tastile/tastile-core`。
- 一時期 current workspace は v1 only、v0 は archive。
- 後に `crates-v0/`, `crates-v1/`, `crates-v2/` independent Cargo workspaces。
- naming の鉄則: 「できるだけ短く」。
- directory hierarchy で v0/v1 が分かるなら crate/package name に generation を重複しない。
- same workspace では同名 package が衝突するため、generation を独立 workspace に分ける方向。
- generation-specific Rust toolchain boundary。
- root-level one-size-fits-all toolchain を嫌う。

### 2026-07-22: public/private

- Core のみ private を基本方向。
- Web / Android / Desktop / SDK / schema / docs は公開候補。
- UI は自由に customize できる姿勢。
- internal algorithm / admin API / AWS detail / DB internal type は public SDK/contract に漏らさない。
- license案では Apache-2.0 を public client 系に勧める議論があり、brand/trademark は code license と分離する方向。
- AGPL は client customization/open distribution 方針に不向きという評価。
- これは実際の最終 license status をこの文書で確定するものではない。

### 2026-07-23: placement/relation

- `inside_parent` は authoritative ではない方向。
- `INSIDE` relation が normalized input。
- `EffectivePlacement.inside` は derived/compatibility projection。
- legacy write は relation mutation へ同 transaction で変換。
- same layer/rank/key conflict は silent winner でなく BLOCKED。
- Segment は own placement / placement ID を持つ。
- Execution は concrete segment placement を参照。

### 2026-07-24〜26: WSLC

- clean reinstall / reproducible environment を重視。
- 問題は build artifact ではなく JDK11/17、SDK/toolchain の乱立。
- WSLC を WSL built-in OCI CLI preview として利用検討。
- Linux side:
  - Core
  - Web
  - Android
- Windows side:
  - Desktop WinUI/.NET
- fixed environment案:
  - Ubuntu 24.04
  - JDK 17
  - Bun 1.3.14
  - Android commandline tools 13114758
  - SDK 37
  - build-tools 35.0.0
  - NDK 27.1.12297006
  - Rust stable
  - Android Java17
  - Gradle wrapper 9.6.1
  - AGP 9.2.1
- `tastile-dev:2026-07` image、`/workspace` mount、`in-wslc.ps1` single entrypoint の案。
- host へ JDK/Rust/Bun/Gradle/Android SDK を追加しない方向。
- Web は build 成功したが Core/Android は toolchain/version issue が残った時点もある。
- `wslc-cli-basic/storage.vhdx` が約100GB。
- all containers stop/delete、`image prune --all` 後も大きく残った。
- `tastile-core-dev` が自動再作成され running。
- image prune reclaim は約2.13GB。
- dynamic VHDX が shrinkしない、volume、Cursor/Dev Container auto rebuild 等を調査。

### 2026-07-28: report/evidence

- final report は既存Word/過去report template 構成を維持し、内容重視。
- 必須 section: まとめ / 考察 / 今後の展望。
- public Web/Android evidence は commit message + URL。
- private Core は commit ID + message。
- root は integrated management / agent harness evidence。
- candidate Core commits:
  - `71cf2ae` AI harness
  - `8e778df` v0/v1 split
  - `a1609c8` v1 implementation
  - `f01145b` acceptance tests
  - `52f8aa5` real validation logs
  - `6bb5247` auto-placement worker
  - `7bb9e1c` tile-centric
- Web/Android も UX 調整継続。
- Web/Android repo public、Core private。
- Play Store tester requirement 12人/14日で正式公開は8月以降という制約。
- Web/Android/API/DB/auth/notification までは広く実装されたが、正式公開・automatic placement quality・re-adjustment・first-use UI は未完と評価。

---

## 2026-08: identity/auth redesign

### 2026-08-21

- Tastile は Web を経由して token を返し、Android 等複数 platform で使う想定。
- data subject は user/project という別物を増やすより `owner` を中心に考えたい。
- Cognito `sub → Tastile user → owner` が二重 identity に感じられた。
- Better Auth を PostgreSQL に置く案:
  - auth user/account/session
  - owner
  - task/calendar/schedule under owner
- Rust API は JWT/JWKS verify。
- owner_id を JWT に入れるか DB resolve するかは当時未決。
- Cognito Identity Pool は client が AWS resource を直接触らないなら不要。
- Cloudflare中心へ段階移行案:
  - Cognito → Better Auth
  - EC2/ECS → Containers
  - S3 → R2
  - SQS → Queues
  - cron → Workflows
  - CloudWatch → Cloudflare Observability
  - PostgreSQL/RDS は当面維持 + Hyperdrive
- D1 は size / single-threaded 制約等から primary DB には不適という評価。

---

## 2026-09: release-driven operation と production hardening

### 2026-09-05 以降: sprint/release

- fully sprint/release-oriented operation。
- daily scrum/check は 10:00。
- GitHub Projects を canonical work-state。
- Linear は summary/overview でよく、canonical detail ではない。
- release branch は `release-x-y-z`。
- implementation branch はその repository の Issue number。
- first meaningful commit で Draft PR。
- release PR が無い、branchがあるのにPRが無い、などを inconsistency として report。
- enhancement issue creation は遠慮しない。
- `RED` / `NO-SHIP` は project stop を意味しない。
- gate が満たされるまで release 作業を継続する。

### release version semantics / merge policy

- 2026-09-21 頃の方針:
  - major = production release
  - minor = sprint
  - patch = sprint内 adjustment
- main:
  - approve count mandatory なし
  - review conversation resolve 必須
  - release branch 以外から main を通常 path にしない
  - merge commit 固定
  - squashしない

### 2026-09-07: Android Kotlin update と secret-blocked CI

- Kotlin 2.2.10 → 2.4.20。
- Issue #19 / commit `14f9601d24c3e91990c9badf456434bc28c31c7d` / Draft PR #20。
- CI failure は Kotlin 自体より `GOOGLE_ANDROID_CLIENT_ID` empty/unset が原因。
- #18 も empty secret で failure。
- infrastructure/config secret が code change validation を block する例。

### 2026-09-12: release RED

- R07 #11 は RED/NO-GO history を維持。
- 一時は R02 operator evidence が主blockerと見えたが、再監査後「R02だけ」説を撤回。
- unfinished 13 tickets / initial estimate 41h という監査。
- outstanding:
  - R04 restore
  - R05 independent RC
  - Web W02/W03/W05/W06/W07
  - Android A02/A05/A06/A07
  - その他
- W06 は real browser evidence不足。
- Android は signed current candidate evidence不足。
- Projects item / required fields も不十分な時点。
- Web PR #107 は implementation/CI complete:
  - pr-smoke
  - quality
  - Dependency review
  - React Doctor
  - mergeable
  だが Draft、Ready化、independent review、real API browser smoke、merge が残った。

### 2026-09-13: Draft の意味

- review thread resolved + CI green + 実装完了なのに Draft のまま、という状態を user が不整合と指摘。
- 完成したものを「安全のためDraft」に放置しない。
- finished PR は Ready へ進める。

### 2026-09-14: Linear

- rebuildup workspace へ切替。
- Tastile / ido-bata integration。
- organization labels、Tastile 0.6.0 等を移行。
- active release projects。
- Release-driven Agile Operations 更新。
- Linear は GitHub Organization integration を複数 workspace で同時利用しにくい制約。
- GitHub detailed truth / Linear summary という後の方針へ。

### 2026-09-15〜17: Android real-device release proof

- signed real Android build で QuickCreate Create が正常に操作できない問題。
- networkだけではなく app logic/UI issue。
- Better Auth `emailVerified` を一 test account で手動修正。
- cookie `__Secure-` prefix 両対応。
- signed APK reinstall。
- identity chain を確認。
- test strategy が根本問題:
  - basic gesture で防げる failure を見逃した
  - instrumented/gesture test が必要
  - mock/unit green だけでは release proof にならない
- real-device test では同一 identity で login する hard requirement。
- 別 owner / new signup / Google login へ逃げない。
- target owner は conversation上 `63039b7e` と記録され、当時 565 placements / 2 sources。
- sign-in後、同一 artifact + production で:
  - timeline
  - detail
  - edit/save
  - start/complete
  - force-stop
  - cold relaunch
  を通す必要。
- 9/17時点で Public Beta 9/19向け RED。
- Android PR #35 source_tile_id routing fix `2baab7d6` → `f06c7f5`、後者 canary failure の履歴。
- A05/A07/R04/R05、Web W02/W07、Core #128 等が未完。
- feature freeze、QuickCreate等 scope cut の判断。

### 2026-09-20: AWS/Cloudflare placement と staging

- 当時の overall path:
  - Cloudflare DNS/TLS/CDN
  - AWS EC2: Next.js/API/worker/nginx/download
  - RDS
- responsibility再配分案:  - Cloudflare = DNS/WAF/Web Workers/R2 distribution
  - AWS = EC2 API/worker/RDS
  - GitHub = source/CI/release
- `download.tastile.app` を S3→presign→SSM→EC2/nginx から R2へ移行。
- immutable release + short-cache stable manifest。
- staging:
  - `staging.app.tastile.app`
  - `staging.api.tastile.app` 系を検討し、後に cert constraint から `api.staging.app.tastile.app` を canonical とした履歴
  - dedicated EC2 / worker / RDS
  - production DB share禁止
- BetterAuth + private RDS を Workersへ直接持っていく場合 Hyperdrive/VPC 等が必要なため Web full migration は後判断。
- permanent develop branch は不要。
- `feature → release-x-y-z → main` 維持。

### 2026-09-20: production localhost incident

- production Web 実機/ブラウザで:
  - `localhost/api/proxy/read/active-tile`
  - `localhost/api/proxy/access/notifications?limit=20`
  - `localhost/api/proxy/read/execution-view`
  - `localhost/api/proxy/access/subjects`
  - `localhost/api/proxy/read/tiles?...`
  等へ request。
- `net::ERR_CONNECTION_REFUSED`。
- side panel が実質壊れていた。
- production config/contract problem が earlier test で防げなかった具体例。

### Core staging #137 と権限境界

- staging backend を production から分離。
- target:
  - Cloudflare
  - staging EC2
  - `tastile-api.service`
  - `tastile-worker.service`
  - staging RDS PostgreSQL
- staging が `TASTILE_ENV=staging` だから security guard が弱くならないよう production-equivalent auth guard。
- staging/production:
  - PostgreSQL share禁止
  - runtime secret share禁止
  - bridge secret share禁止
  - deployment target share禁止
  - backup/restore target share禁止
- release SHA deploy。
- API+Worker same revision。
- migration readiness後 Worker start。
- rollback。
- destructive test が production endpoint/DBでは起動しない safeguard。
- 途中で staging EC2 role が同一 account/region の production RDS secret まで読める可能性を発見。
- exact staging secret ARN に permission を narrow する必要。

### 2026-09-22: production auth incident

- Googleで続行が使えない。
- email account signup が HTTP 500。
- path:
  - `/api/auth/sign-in/social`
  - `/api/auth/sign-up/email`
- production authentication correctness 自体が release-hardening item になった。

---

## 2026-09-26〜28: Infisical migration、CLI、boundary cleanup

### Infisical導入の背景

- secrets path が SOPS/KMS/SSM/Secrets Manager/GitHub/env 等に分散。
- Infisicalへ移行。
- repository-local / environment-local ownership へ寄せる。
- root を central decrypt runtime にしない。
- ValidateOnly は 12/12 PASS に到達した時点。
- しかし migration は完全完了せず、後続で多数の failure。

### review tooling limitation

- Copilot review quota exhausted。
- CodeRabbit Free:
  - non-default branch skip
  - Draft auto reviewなし
  - rate limit
- 2026-09-26:
  - Web PR #151 SSM shell quoting
  - Root PR #41 Infisical evidence sync
  - Brands PR #4 `.infisical.json`
  - Core PR #149 artifact upload
  - Web #150 `.env.example`
  - Core/Web OIDC project-slug fix
  等で review automation が不完全。
- review automation unavailable は「review不要」を意味しないので manual/independent review を使う。

### Core DB credential cutover

- RDS master login を application credential として使う状態から dedicated application role へ。
- Core PR #155。
- `docs/production/infisical-db-cutover.md`
- `scripts/v1/bootstrap-infisical-db-role.sh`
- rollback-safe staging/production cutover。
- review は CodeRabbit rate limit。

### Web Infisical deploy failure

- Web deploy 自体は host へ到達。
- health check が `127.0.0.1:3000` で failure。
- cause:
  - systemd unit 上で Infisical login が browser interaction を要求
  - WorkingDirectory 不足/誤り
  - restart loop
- fix:
  - non-interactive `INFISICAL_TOKEN` path
  - explicit WorkingDirectory
  - log rotation
- 後に deploy success。
- SSM shell quoting regression も複数 PR (#151/#154/#157) で修正。

### Android / Desktop

- Android:
  - env mapping fix
  - signed AAB success
  - v0.6.0 release
  - PR #52 が ANDROID_KEY_* → RELEASE_* mapping + fail closed
- Desktop:
  - Infisical migration regression を `--file` 利用で修正 PR #39
  - migration-only CI helper retirement PR #40
  - v0.7.0 line cutover

### Windows cleanup

- 2026-09-27:
  - source checkout 実体 0
  - 約33GB回収
  - Web #134 を `134-recovered` commit `129bddac` で保存
  - Infisical scratch `becdc51c` 保存
  - Android/Core/Desktop 等の未保存物を判定して削除
  - empty root directory が bash CWD lock で残存
- root branch 35:
  - `484e161` 追加
  - 誤って削除した OpenAPI submodule pointer を復元
  - PR #45 Draft/OPEN
  - diff は journal 2件 + `docs/runbooks/infisical-setup.md`

### Root #44: repository independence

- root の `.gitmodules` に tastile-openapi。
- Web が `../openapi/openapi.yaml`。
- Android が `../../openapi/openapi.yaml`。
- root filesystem layout が build dependency になっていた。
- root に SOPS KMS/IAM Terraform、decrypt scripts も残る。
- target:
  - Core の Rust OpenAPI definition が generation SoT
  - `tastile-openapi` は generated distribution contract repo
  - each consumer repository が revision を local pin
  - root-relative path禁止
  - standalone clone/build/test/CI
  - root OpenAPI submodule 削除
  - SOPS/KMS/decrypt responsibility を owning repoへ or obsoleteなら削除
  - root は governance / architecture / release coordination / workspace tooling / cross-repo validation / organization docs に縮退
  - root を production artifact/build/runtime dependency にしない

### Tastile CLI separation

- formal user-facing Rust client として Core から分離。
- API-only。
- Core internal crate に依存しない。
- browser authentication。
- TUI。
- ratatui 3-pane。
- CLI/TUI は同じ `app::*` functions。
- operations:
  - auth login `--print-url`
  - today
  - source tile read/create/update/reflow
  - execution start/pause/resume/finish
  - prompts
- OpenAPI submodule pin の報告: `b0c781d...`。
- 18 operations。
- standalone build/test/drift check success。
- initial real-account E2E は Web `/cli/authorize` / token exchange 未完成でblocked。
- auth DoD:
  - Better Auth `/cli/authorize`
  - `/api/cli/token`
  - PKCE S256
  - TTL <= 5 min
  - scope intersection `tastile.read tastile.write`
  - atomic single-use
  - user binding
- CLI PR #2 で callback URL に `/cli/callback` を余計に足す bug が review で見つかり、direct `redirect_uri()` 使用が必要。
- Web PR #158:
  - `/cli/authorize`
  - `/api/cli/token`
- Core PR #176:
  - granular API-token scopes
  - centralized `AuthContext`
- later CLI:
  - public
  - 3 OS CI green checkpoint
  - 18/18 OpenAPI drift
  - v1.0.0 release

---

## 「生活のフレームワーク」

### 2026-09-26〜27

- Tastile branding/product direction として「生活のフレームワーク」という言葉が発案された。
- 単なる marketing copy ではなく、Tastile を
  - planned work / obligation primitives
  - execution control
  - scheduling / re-scheduling
  - human feedback
  - multi-platform client / integration
  を提供する framework と見る再解釈。
- 最初に root 側で Issue 化しようとした。
- しかし user が「根本の方針は tastile-core の docs が SoT では？」と指摘。
- root issue は duplicate/superseded 扱い。
- Core #172 を canonical issue として、`v1/00-glossary.md`, `01-scope.md`, `02-core-entities.md` と整合させる方向。
- これは root architecture SoT と Core domain SoT の ownership 境界が曖昧であることを示す事例。

---

## GitHub Actions budget / cost

### 過去から継続する問題

- 2026-04 時点で included 2,000 minutes exhausted。
- 2026-06 には Actions storage 0.45/0.5GB = 90% の通知もあった。
- 2026-09 に private repo CI が release blocker になるほど再び深刻化。

### 2026-09-28頃

- hard spending cap = $2 を維持。
- user は「billing を増やす」解決を拒否。
- runner minutes を下げることが主 lever。
- successful Core private-repo CI run の一例:
  - quality 約20.3 min Linux
  - Windows contract 約0.4 min
- headroom は Linux 約333min / Windows 約200min と評価された時点があり、
  full quality run に換算すると約16回程度しかない。
- normal merge traffic で month end 前に再枯渇する。
- Core #191/#192/#193:
  - Rust-non-impacting change は lightweight contract path
  - Rust change は fmt/clippy/test
  - redundant build 削減
- #194/#195/#196:
  - side-effect-free runner allocation probe
  - workflow_dispatch
  - main-only
  - empty permissions
  - production/tag/Infisical mutationなし
- probe 自体も「予算が復旧したか」を安全に確認する目的。

---

## 2026-09-27〜28: production/release checkpoint

- production では Core 1.0.1 / Web 1.0.2 が稼働した checkpoint。
- Web initial deploy で約72秒停止。
- rollback → redeploy。
- Infisical migration は 403 workaround が残る。
- full secret leakage がないと判断できる範囲では Stripe/provider/AES key rotation は不要という整理。
- Core #141 migration / deploy helper hardening 等が残件。
- production smoke では `/admin/login` が expected 200 でなく 307 となり、legacy production main behavior が観測された。
- release branch には fix があるが #91→main 未mergeなので production未deploy、という evidence。
- Android:
  - signed AAB generation / signature verification success
  - Play upload は already-used versionCode で failure
- 9/28 時点でも release は当初日程から9日超過した RED と表現された。
- Core PR #177 merge `08ea760`。
- Infisical PR #178。
- Web 1.0.4 `895d2f8` / PR #165 等の進行。
- 完了していない release gate を理由に project を中止する方針ではない。

---

## 2026-09-28〜29: AWS / Infisical 前提そのものを再評価

### AWS free credits の消滅

- AWS の free credits はすでに使い切った。
- これまで AWS を採用した理由には:
  - industry prevalence
  - learning/career value
  - free credit
  が含まれていた。
- free credit がなくなったので、EC2/RDS/VPC/IAM/SSM 等の固定費・運用費を通常の production cost として再評価する必要。

### Infisical migration 未完

- Infisical cutover は完全には終わっていない。
- bug が多い。
- autonomous agents が environment/auth/deploy/credential boundary で止まり続ける。
- old AWS runtime 向け Infisical integration を完全に磨いた後に infra migration すると、secret injection / deploy / runtime identity / staging-prod split を二度作り直す可能性が高い。

### 一般公開通知前に infra を変更する判断

- broad general public announcement の前に infra を変更・固定する方が合理的という方向。
- これは release を諦めることではない。
- proposed sequence:
  1. observable product behavior をなるべくfreeze
  2. infrastructure migration
  3. target runtime 前提で Infisical contract を完成
  4. staging verification
  5. production cutover
  6. evidence-based soak
  7. broad public announcement
- public users が増えた後なら session/data/scheduler/notifications/downtime/rollback を守りながら migration する必要があり、現在より難しい。

### target infra candidates — 未確定

- Cloudflare は残す可能性が高い:
  - DNS
  - CDN
  - WAF
  - Web/edge
  - R2
- EC2 は strong removal candidate。
- PostgreSQL/RDS は compute と別に判断。
- candidates:
  - Cloud Run Tokyo + Cloud SQL/PostgreSQL
  - Cloud Run Tokyo + Supabase Tokyo
  - Cloudflare Containers + PostgreSQL
  - managed AWS container compute + Aurora Serverless 等
- 2026-09-29 時点では target architecture 未決。
- 「AWS全面採用」が default premise ではなくなった。

---

## 2026-09-29: architecture SoT を作り直す要求

- 全体 architecture を再定義して明確な Source of Truth にしたい。
- D2 を採用候補。
- TALA を architecture layout に利用候補。
- ただし diagram 自体だけを SoT にしない。
- ambiguity 回避のため machine-readable structured files が必要。
- ubiquitous language definition が必要。
- PoC 定義が必要。
- KPI が必要。
- SLO / operational success criteria も対象。
- ADR linkage。
- repository / ownership mapping。
- D2/TALA:
  - software architecture に向く orthogonal layout
  - selected node fixed positioning + auto layout
  - node追加で layout が大きく変わることがある
  - long one-way flow は Dagre/ELK の方が安定する可能性
- 最も多く正確な Tastile history/intention が残っている場所として ChatGPT 会話履歴/memory を認識。
- そのため canonical redesign より先に、会話前提を捨てられる raw corpus を root/core へ吐き出すことを要求。
- user の明示要求:
  - 「未移植情報だけ」ではない
  - Pomodoroomのさらに前、Pomodoroへの関心から
  - 最初期から現在まで
  - 生の情報を重視
  - 圧縮しない
  - 整理は今しない
  - 分かることすべてを文章として外部化

---

## 現在の repository / SoT ownership と矛盾し得る点

- `tastile-root`:
  - workspace/governance shell
  - overall policy/auth/infra docs
  - cross-repo coordination
- `tastile-core`:
  - domain/API/schema
  - current canonical v1 `00..15`
- clients:
  - implementation local docs
- business logic は Core。
- client thin。
- root #44 は root 自体を build/runtime dependency から外す方向。
- しかし「生活のフレームワーク」をどこに置くかで root vs Core ownership が実際に揺れた。
- 新architecture SoTでは product-wide fact と domain semantic fact の明確なownershipが必要。

---

## 意図的に解決しない historical contradictions

- personal Web Pomodoro → Pomodoroom の exact transition は未確定。
- local SQLite-centered Core と backend/PostgreSQL-centered service は successive architectures。
- Supabase sync phase と AWS RDS production phase は両方実在。
- Cognito-centric identity と Better Auth + owner-centric identity は successive designs。
- READY/RUNNING/PAUSED/DONE、DRIFTING、PhaseKind/DerivedPhase、v7 pipeline、v1 Plan/Placement/Execution は同時に現行ではない。
- Google Calendar integration は深く実装されたが Calendar SoT は早い段階で否定されていた。
- Tauri は Pomodoroom desktop化に使われたが後に future Tastile direction から外された。
- root OpenAPI shared submodule は実在したが repository independence 方針で廃止対象。
- AWS は明確な理由で採用されたが free-credit消滅/operations failure により再評価中。
- 「execution-control system」と「生活のフレームワーク」の関係は未確定。
- この文書はこれらを統合して一つの答えにしない。