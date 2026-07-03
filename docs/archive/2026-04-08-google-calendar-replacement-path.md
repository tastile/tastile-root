# Google Calendar Replacement Path Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tastile を、Google Calendar 連携と Google Calendar 相当の月次/年次カレンダービューを備えた実用レベルの単独運用プロダクトへ最短距離で引き上げる。

**Architecture:** `core` に Google Calendar 同期境界、外部イベント取り込み/書き戻し、月/年ビュー投影 API を実装し、各クライアントはその read model と command surface を表示するだけに寄せる。`desktop` を最初のフル接続実装とし、`android` と `web` は同じ integration/timeline 契約に接続する薄いクライアントとして実装する。タイルの真実性を守るため、Google event ID・sync token・credential などの外部同期情報は tile 本体ではなく sync/integration 永続層に隔離する。Google Calendar 連携は特別扱いせず、`Tastile -> outbound change log -> provider adapter -> remote apply` と `Google -> inbound change fetch -> provider adapter -> core import/reconcile` の単一路線で扱い、手動同期・自動同期・特定カレンダー同期のすべてを同じパイプラインに通す。

**Tech Stack:** Rust (`tastile-core`, `tastile-api`, `tastile-sync`, `tastile-storage`), C# WinUI 3 (`tastile-desktop`), Kotlin/Compose (`tastile-android`), Next.js/TypeScript (`tastile-web`), Supabase Auth/user_links, Google Calendar REST API v3

**Personal Use-Case Assumptions:**
- 単一ユーザーのフリーランス運用。主戦場は Windows desktop、外出時は Android、補助閲覧/軽編集は Web。
- Google Calendar には「商談/会議/病院/私用/締切前提の固定予定」があり、Tastile はそれを読み込んで実行制御に反映する必要がある。
- Tastile 側から Google Calendar へは「Tastile 管理下の予定だけ」を専用 calendar もしくは識別可能な event 群として書き出す。
- v1 では team/shared calendar、複数 Google アカウント、CalDAV 汎用化、Exchange 連携は非目標。

**Required Calendar Flows:**
- `Tastile -> Google Calendar`: Tastile に入力した予定・固定枠・再計算結果が Google Calendar に反映される
- `Google Calendar -> Tastile`: Google Calendar に入力した予定が Tastile に取り込まれる
- `Tastile <-> specific Google calendar`: 特定 calendar を Tastile の同期対象として双方向に維持する

**Priority Order:**
1. `Tastile -> Google Calendar`
2. `Google Calendar -> Tastile`
3. `specific calendar bidirectional sync`

**Sync Design Rule:**
- UI や platform ごとに別ルートを作らない
- 手動同期でも自動同期でも同じ importer/exporter/reconciler を使う
- 「片方向 import/export」も「双方向 sync」の部分モードとして実装する
- 直接 Google に書く特別ケースや、Google からの入力だけ別パーサを通す実装は禁止

---

## Phase Ordering

1. `core`: 単一 sync pipeline、認可情報、outbound first、inbound second、calendar read model、API 契約
2. `desktop`: 最初の Google OAuth 接続 UI、同期操作、月/年ビュー
3. `android`: 既存 daemon/core bridge 契約に接続し、同じ integration/timeline surface を表示
4. `web`: daemon/WASM 互換 read model を消費し、補助的な calendar UI を追加

## Core Sync Modes

`core` は同じ engine で次の3モードを持つ。

1. `push_only`
   Tastile で発生した変更を Google Calendar に反映する。最優先で完成させる。
2. `pull_only`
   Google Calendar で発生した変更を Tastile に取り込む。
3. `bidirectional`
   特定 calendar を対象に push/pull の両方を有効化する。

各モードは別実装ではなく、同じ sync engine の有効フラグとして表現する。

---

### Task 1: Core に Calendar Integration 境界を作る

**Files:**
- Create: `tastile-core/crates/tastile-sync/src/calendar/mod.rs`
- Create: `tastile-core/crates/tastile-sync/src/calendar/types.rs`
- Create: `tastile-core/crates/tastile-sync/src/calendar/google_client.rs`
- Create: `tastile-core/crates/tastile-sync/src/calendar/mapping.rs`
- Modify: `tastile-core/crates/tastile-sync/src/lib.rs`
- Modify: `tastile-core/crates/tastile-api/src/handlers/integration_handlers.rs`
- Modify: `tastile-core/crates/tastile-api/src/router.rs`

**Step 1: Write the failing test**

- Add contract tests proving `core` can represent:
  - external fixed event
  - Tastile-owned scheduled event
  - detached/deleted remote event
  - per-provider sync cursor and permission scope

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-sync calendar_`
Expected: FAIL because calendar sync types and provider boundary do not exist

**Step 3: Write minimal implementation**

- Introduce provider-agnostic types:
  - `ExternalCalendarProvider`
  - `CalendarConnectionState`
  - `CalendarSyncCursor`
  - `RemoteCalendarEvent`
  - `CalendarMirrorRecord`
  - `CalendarSyncPlan`
- Extend integration settings from the current boolean-only Google settings to include:
  - provider status
  - selected calendar id
  - granted scopes
  - sync mode (`push_only`, `pull_only`, `bidirectional`)
  - last successful full sync
  - write policy and read policy that map to the same engine

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-sync calendar_`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-sync/src/calendar tastile-core/crates/tastile-sync/src/lib.rs tastile-core/crates/tastile-api/src/handlers/integration_handlers.rs tastile-core/crates/tastile-api/src/router.rs
git commit -m "feat(core): add calendar integration boundary"
```

---

### Task 2: Core に Google Calendar 認証情報と同期メタデータ永続層を追加する

**Files:**
- Modify: `tastile-core/crates/tastile-storage/src/schema.sql`
- Modify: `tastile-core/crates/tastile-storage/src/migration.rs`
- Create: `tastile-core/crates/tastile-storage/src/calendar_store.rs`
- Modify: `tastile-core/crates/tastile-storage/src/lib.rs`
- Modify: `tastile-core/crates/tastile-api/src/state.rs`
- Modify: `tastile-core/crates/tastile-sync/src/client.rs`

**Step 1: Write the failing test**

- Add storage tests for:
  - calendar connection row save/load
  - remote event mirror row save/load
  - sync token update
  - disconnect cleanup that preserves tile truth

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-storage calendar_store`
Expected: FAIL because schema/table/store are missing

**Step 3: Write minimal implementation**

- Add dedicated tables, for example:
  - `calendar_connections`
  - `calendar_event_mirror`
  - `calendar_sync_state`
- Store external references outside `tiles` and outside tile JSON.
- Keep sensitive credential material out of `Tile` and out of scheduler inputs.
- Reuse Supabase `user_links` only as cross-device profile bootstrap if needed; local fast-path state still lives in SQLite.
- Persist per-calendar mode so a single selected Google calendar can run in `push_only`, `pull_only`, or `bidirectional`.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-storage calendar_store`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-storage/src/schema.sql tastile-core/crates/tastile-storage/src/migration.rs tastile-core/crates/tastile-storage/src/calendar_store.rs tastile-core/crates/tastile-storage/src/lib.rs tastile-core/crates/tastile-api/src/state.rs tastile-core/crates/tastile-sync/src/client.rs
git commit -m "feat(core): persist calendar sync metadata"
```

---

### Task 3: Tastile -> Google Calendar の outbound path を最優先で実装する

**Files:**
- Modify: `tastile-core/crates/tastile-sync/src/sync_engine.rs`
- Create: `tastile-core/crates/tastile-sync/src/calendar/google_sync.rs`
- Create: `tastile-core/crates/tastile-sync/tests/google_calendar_sync_test.rs`
- Modify: `tastile-core/crates/tastile-core/src/handler/command_handler.rs`
- Modify: `tastile-core/crates/tastile-core/src/recalc/mod.rs`

**Step 1: Write the failing test**

- Add end-to-end sync tests for:
  - Tastile scheduled tile export -> Google event upsert
  - Tastile update -> same Google event patch
  - Tastile delete/close -> Google event cancel or detach policy
  - manual sync and auto sync hitting the same outbound pipeline

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-sync google_calendar_sync`
Expected: FAIL because the sync engine only knows Supabase tile snapshots

**Step 3: Write minimal implementation**

- Define ownership rules:
  - `tastile_owned`: created or exported by Tastile, editable in Tastile and mirrored to Google
  - `remote_owned`: reserved for later inbound import
- Mapping rules for outbound:
  - fixed time tile -> Google timed event
  - all-day/date-bound tile -> Google all-day event
  - recurrence-enabled tile -> Google recurring event only if recurrence expression can be represented safely; otherwise export expanded occurrences
- The implementation must expose one reusable `plan_outbound_changes()` path used by:
  - sync now
  - background sync
  - future bidirectional reconciliation

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-sync google_calendar_sync`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-sync/src/sync_engine.rs tastile-core/crates/tastile-sync/src/calendar/google_sync.rs tastile-core/crates/tastile-sync/tests/google_calendar_sync_test.rs tastile-core/crates/tastile-core/src/handler/command_handler.rs tastile-core/crates/tastile-core/src/recalc/mod.rs
git commit -m "feat(core): add outbound google calendar sync path"
```

---

### Task 4: Google Calendar -> Tastile の inbound path を同じ engine に追加する

**Files:**
- Modify: `tastile-core/crates/tastile-sync/src/sync_engine.rs`
- Modify: `tastile-core/crates/tastile-sync/src/calendar/google_sync.rs`
- Create: `tastile-core/crates/tastile-sync/tests/google_calendar_import_test.rs`
- Modify: `tastile-core/crates/tastile-core/src/recalc/mod.rs`
- Modify: `tastile-core/crates/tastile-api/src/handlers/integration_handlers.rs`

**Step 1: Write the failing test**

- Add end-to-end sync tests for:
  - remote fixed meeting import -> fixed/label-like tile materialization
  - remote edit -> same imported tile update
  - remote cancel/delete -> imported tile closure/hide policy
  - same parser path used in pull-only and bidirectional mode

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-sync google_calendar_import`
Expected: FAIL because inbound import path does not exist

**Step 3: Write minimal implementation**

- Add reusable `fetch_inbound_changes()` and `apply_inbound_changes()` paths.
- Mapping rules:
  - external meetings -> fixed time tiles with external provenance
  - all-day events -> blocking tiles
  - recurring Google events -> expanded occurrences only inside projection horizon
- Imported events remain distinguishable in projection and editing policy, but they still go through the same importer/reconciler as bidirectional sync.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-sync google_calendar_import`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-sync/src/sync_engine.rs tastile-core/crates/tastile-sync/src/calendar/google_sync.rs tastile-core/crates/tastile-sync/tests/google_calendar_import_test.rs tastile-core/crates/tastile-core/src/recalc/mod.rs tastile-core/crates/tastile-api/src/handlers/integration_handlers.rs
git commit -m "feat(core): add inbound google calendar import path"
```

---

### Task 5: Core に特定 calendar の双方向同期と Google Calendar 代替 day/week/month/year read model を追加する

**Files:**
- Modify: `tastile-core/crates/tastile-api/src/handlers/read_handlers.rs`
- Modify: `tastile-core/crates/tastile-api/src/router.rs`
- Create: `tastile-core/crates/tastile-core/src/scheduler/calendar_projection.rs`
- Create: `tastile-core/crates/tastile-core/tests/calendar_projection_test.rs`
- Modify: `tastile-core/crates/tastile-core/src/scheduler/time_pie.rs`
- Modify: `tastile-core/crates/tastile-core/src/scheduler/recurrence.rs`
- Modify: `tastile-core/crates/tastile-sync/tests/google_calendar_sync_test.rs`

**Step 1: Write the failing test**

- Add projection tests for:
  - month grid with spillover days
  - year heatmap / month summary buckets
  - recurring tile occurrence expansion
  - imported Google events appearing in the same projection as Tastile tiles
  - timezone-safe month boundaries
  - bidirectional mode on a specific calendar reusing the same outbound/inbound engine

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-core calendar_projection`
Expected: FAIL because only `/views/timeline/today` exists

**Step 3: Write minimal implementation**

- Add new API families:
  - `GET /views/calendar/day`
  - `GET /views/calendar/week`
  - `GET /views/calendar/month`
  - `GET /views/calendar/year`
- Response should include:
  - blocks
  - all-day spans
  - overflow counters
  - ownership (`remote_owned`, `tastile_owned`, `synthetic`)
  - editability flags
  - calendar source label
- Extend recurrence parser carefully. Current monthly support exists, but year-scale projection needs stable occurrence enumeration and cap controls.
- Add calendar selection and mode control APIs without introducing a separate sync route.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-core calendar_projection`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-api/src/handlers/read_handlers.rs tastile-core/crates/tastile-api/src/router.rs tastile-core/crates/tastile-core/src/scheduler/calendar_projection.rs tastile-core/crates/tastile-core/tests/calendar_projection_test.rs tastile-core/crates/tastile-core/src/scheduler/time_pie.rs tastile-core/crates/tastile-core/src/scheduler/recurrence.rs
git commit -m "feat(core): add bidirectional calendar sync and projection api"
```

---

### Task 6: Desktop を最初のフル接続クライアントとして完成させる

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Models/ApiModels.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Views/IntegrationsWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/IntegrationsWindow.xaml.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Views/TimelineWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/TimelineWindow.xaml.cs`
- Create: `tastile-desktop/src/TastileDesktop/Services/CalendarViewportResolver.cs`
- Create: `tastile-desktop/tests/TastileDesktop.Tests/CalendarViewportResolverTests.cs`

**Step 1: Write the failing test**

- Add client/UI tests for:
  - Google connect/disconnect/sync-now flows
  - sync mode selection (`push_only`, `pull_only`, `bidirectional`)
  - target calendar selection
  - month and year viewport contract mapping
  - rendering of imported fixed events vs Tastile-owned events

**Step 2: Run test to verify it fails**

Run: `dotnet test .\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj --filter Calendar`
Expected: FAIL because desktop client only knows today timeline and boolean integration state

**Step 3: Write minimal implementation**

- Desktop responsibilities:
  - first-party OAuth launch
  - integration configuration UI
  - connect/disconnect/re-sync/rebuild actions
  - sync mode and target calendar selection
  - rich month/year calendar surface
- Desktop must not decide scheduling semantics. It only changes viewport, dispatches commands, and renders `core` projection.

**Step 4: Run test to verify it passes**

Run: `dotnet test .\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj --filter Calendar`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs tastile-desktop/src/TastileDesktop/Models/ApiModels.cs tastile-desktop/src/TastileDesktop/Views/IntegrationsWindow.xaml tastile-desktop/src/TastileDesktop/Views/IntegrationsWindow.xaml.cs tastile-desktop/src/TastileDesktop/Views/TimelineWindow.xaml tastile-desktop/src/TastileDesktop/Views/TimelineWindow.xaml.cs tastile-desktop/src/TastileDesktop/Services/CalendarViewportResolver.cs tastile-desktop/tests/TastileDesktop.Tests/CalendarViewportResolverTests.cs
git commit -m "feat(desktop): add calendar sync controls and month-year views"
```

---

### Task 7: Android を core 契約に接続する

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/IntegrationRepository.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/TileRepository.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/CoreApiParityModels.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/TimelineScreen.kt`
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/MonthCalendarScreen.kt`
- Create: `tastile-android/app/src/test/java/app/tastile/android/ui/dashboard/MonthCalendarScreenTest.kt`

**Step 1: Write the failing test**

- Add repository/UI tests for:
  - new calendar projection response parsing
  - month viewport rendering
  - integration settings with calendar id / scope / sync mode

**Step 2: Run test to verify it fails**

Run: `.\tastile-android\gradlew testDebugUnitTest --tests "*Calendar*"`
Expected: FAIL because Android models only support today timeline and coarse integration status

**Step 3: Write minimal implementation**

- Android should reuse the same daemon/core endpoints.
- No Android-specific scheduling logic.
- Initial goal is view + basic actions, not full desktop-grade drag/drop editing.

**Step 4: Run test to verify it passes**

Run: `.\tastile-android\gradlew testDebugUnitTest --tests "*Calendar*"`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/data/repository/IntegrationRepository.kt tastile-android/app/src/main/java/app/tastile/android/data/repository/TileRepository.kt tastile-android/app/src/main/java/app/tastile/android/data/repository/CoreApiParityModels.kt tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/TimelineScreen.kt tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/MonthCalendarScreen.kt tastile-android/app/src/test/java/app/tastile/android/ui/dashboard/MonthCalendarScreenTest.kt
git commit -m "feat(android): connect calendar sync modes from core"
```

---

### Task 8: Web を core/daemon/WASM 契約に接続する

**Files:**
- Modify: `tastile-web/src/lib/daemon/client.ts`
- Modify: `tastile-web/src/lib/wasm/core-engine.ts`
- Modify: `tastile-web/src/app/dashboard/integrations/page.tsx`
- Modify: `tastile-web/src/components/timeline/TimelineView.tsx`
- Create: `tastile-web/src/components/calendar/MonthCalendar.tsx`
- Create: `tastile-web/src/components/calendar/YearCalendar.tsx`
- Create: `tastile-web/src/components/calendar/MonthCalendar.test.tsx`

**Step 1: Write the failing test**

- Add tests for:
  - daemon client parsing of calendar month/year responses
  - WASM fallback parity for read-only calendar projection
  - integrations page rendering richer Google state and sync mode

**Step 2: Run test to verify it fails**

Run: `bun test src/components/calendar/MonthCalendar.test.tsx src/lib/daemon/client.test.ts`
Expected: FAIL because web only has today timeline and a boolean integration panel

**Step 3: Write minimal implementation**

- Web is a companion surface:
  - read model rendering
  - simple connect/disconnect/sync
  - month/year visibility
- Keep advanced conflict resolution and heavy editing centered on desktop first.

**Step 4: Run test to verify it passes**

Run: `bun test src/components/calendar/MonthCalendar.test.tsx src/lib/daemon/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/lib/daemon/client.ts tastile-web/src/lib/wasm/core-engine.ts tastile-web/src/app/dashboard/integrations/page.tsx tastile-web/src/components/timeline/TimelineView.tsx tastile-web/src/components/calendar/MonthCalendar.tsx tastile-web/src/components/calendar/YearCalendar.tsx tastile-web/src/components/calendar/MonthCalendar.test.tsx
git commit -m "feat(web): add core-backed calendar sync controls and views"
```

---

### Task 9: Verification, rollout, and migration hardening

**Files:**
- Create: `docs/verification/google-calendar-replacement-checklist.md`
- Modify: `docs/decisions.md`
- Modify: `tastile-core/crates/tastile-api/tests/e2e_test.rs`
- Modify: `tastile-core/crates/tastile-sync/tests/sync_test.rs`
- Modify: `tastile-desktop/tests/TastileDesktop.Tests/CoreApiClientIntegrationSettingsTests.cs`
- Modify: `tastile-android/app/src/test/java/app/tastile/android/data/repository/IntegrationRepositoryNetworkFallbackTest.kt`
- Modify: `tastile-web/e2e/dashboard-wasm-parity.spec.ts`

**Step 1: Write the failing test/checklist**

- Add cross-platform verification for:
  - desktop-connected account appears on android/web
  - Tastile input -> Google reflection works before all other modes
  - Google fixed events block scheduling in core
  - Tastile-owned events export and round-trip cleanly
  - month/year counts match across desktop/android/web

**Step 2: Run the suites**

Run:
- `cargo test --workspace`
- `dotnet test .\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj`
- `.\tastile-android\gradlew testDebugUnitTest`
- `bun test`

Expected: at least one suite fails before hardening is complete

**Step 3: Implement fixes and docs**

- Document conflict policy and ownership policy in `docs/decisions.md`
- Add recovery instructions for stale Google tokens and corrupted sync cursors

**Step 4: Re-run the suites**

Expected: PASS

**Step 5: Commit**

```bash
git add docs/verification/google-calendar-replacement-checklist.md docs/decisions.md tastile-core/crates/tastile-api/tests/e2e_test.rs tastile-core/crates/tastile-sync/tests/sync_test.rs tastile-desktop/tests/TastileDesktop.Tests/CoreApiClientIntegrationSettingsTests.cs tastile-android/app/src/test/java/app/tastile/android/data/repository/IntegrationRepositoryNetworkFallbackTest.kt tastile-web/e2e/dashboard-wasm-parity.spec.ts
git commit -m "test: verify google calendar replacement path end to end"
```

---

## Scope Guardrails

- `core` の非目標:
  - generic CalDAV provider abstraction beyond Google
  - collaborative calendars
  - natural-language calendar planning
- `desktop` の非目標:
  - Outlook 連携
  - UI だけで完結する同期ロジック
- `android/web` の非目標:
  - platform-specific scheduling engines
  - desktop より先に高度編集 UI を作ること

## Fastest Viable Slice

最短で価値を出す順序は次です。

1. `core`: `push_only` outbound sync
2. `desktop`: connect + sync now + month view
3. `core`: `pull_only` inbound import
4. `core`: `bidirectional` specific calendar sync
5. `desktop`: year view + conflict prompts
6. `android`: month view + integration status
7. `web`: month view + integration status

この順序なら、あなたの最優先である「Tastile に入力すると Google Calendar に同期される」を最初に成立させ、その後に Google Calendar からの入力取り込み、最後に特定 calendar の双方向同期へ自然に拡張できます。すべて同じ sync engine を通すので、後から別経路の実装負債を抱えにくいです。
