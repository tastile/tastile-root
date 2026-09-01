# r3: Android TaskRun Producer — Design Spec

> **Status:** design freeze 待ち (brainstorm 経由、Q1-Q3 + §0 TDD 承認済)
> **Date:** 2026-08-30
> **Spec target:** `tastile-core` + `tastile-android` の実行時 TaskRun 経路
> **Plan target:** `docs/plans/2026-08-30-r3-android-task-run.md` (本 spec を入力に作成)
> **Required sub-skill (plan 実行時):** `superpowers:test-driven-development` + `superpowers:executing-plans` (or `superpowers:subagent-driven-development`)

## §0. TDD discipline (mandatory)

各 chunk は次の 7 step を **物理的に順守** する。`verify-tastile-change` を chunk 末で通すには、Step 2 の RED 観測ログを提示することが前提条件 (REVIEWED ≠ VERIFIED)。

```
Step 0: contract pin — openapi.yaml の該当 path / schema を読み、§X の interface signature と一致するか確認。差異があれば plan 側で吸収せず spec へ戻す。
Step 1: RED test を書く
  - core: domain unit test + API handler route test (両方失敗)
  - android: ExecutionRepository MockWebServer test + RecordTaskRunUseCase test + Compose UI test (全部失敗)
Step 2: RED を観測 (cargo test / ./gradlew test の fail 出力をキャプチャ)
Step 3: GREEN impl を最小実装
  - core: domain apply → handler → V1_059 migration → openapi dump
  - android: ExecutionRepository method → RecordTaskRunUseCase → ExecutionViewModel.recordTask() → ExecuteScreen UI
Step 4: 全 test green 観測
Step 5: REFACTOR (重複削除・命名整理・seam 確認)
Step 6: verify gate
  - core: cargo clippy --all-targets -- -D warnings + cargo test
  - android: ./gradlew lintKotlinMain + ./gradlew testDebugUnitTest
  - web: bun run check:release (openapi drift)
  - workspace: pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast
Step 7: commit
  - RED test は test-only commit (prefix: test:)
  - GREEN impl は別 commit (prefix: feat: / chore:)
  - agent-initiated commit は .agents/skills/tastile-precommit-review 経由
```

RED → GREEN → REFACTOR を 1 commit にまとめない。

## §1. Background & Goal

### 1-1. 背景

v1 Phase A が完了し、Execution lifecycle (`START_EXECUTION` / `PAUSE_EXECUTION` / `RESUME_EXECUTION` / `FINISH_EXECUTION`) は `tastile-core` / `tastile-web` / `tastile-android` の三層で扱える。`TaskDefinition` の schema は Plan 側に保持されているが、**実行中に TaskDefinition へ check を入れ、`Execution.taskRuns` に反映する経路が end-to-end で繋がっていない** (investigation 2026-08-29 時点)。

直近の `tastile-core` commits (`c3af9b9` / `3e4d608` / `23ac72d` / `a90ee5a` / `1f839c7`) は v1/13 closed-loop / source optimizer を構築中であり、これは TaskRun accumulation を input にする。TaskRun を正確に溜める **producer 側** (Android 実機能) を固めることが closed-loop の前提となる。

### 1-2. Goal

`RECORD_TASK_RUN` を v1 Command に追加し、`tastile-android` の ExecuteScreen から `TaskDefinition` の check を送れる経路を実装する。`tastile-web` は openapi codegen 経由で追従する follow-up PR とし、本 spec の scope 外とする (Q5 参照)。

### 1-3. Non-goals

- Now screen (`ui/now/NowScreen.kt`) は触らない
- Decision / Session 経路 (`SessionRepository.submitFeedback`) は触らない
- closed-loop consumer 側 (analytics / insights) は別 brainstorm 案件
- web parity は本 PR の scope 外 (openapi drift 0 のみ確認)

## §2. Vocabulary (codebase-design)

本 spec で使う用語 (per mattpocock `codebase-design`):

- **Module**: `crates-v1/api` / `crates-v1/domain` / `crates-v1/storage` / `app.tastile.android.data` / `app.tastile.android.domain` / `app.tastile.android.ui`
- **Interface**: `ExecutionRepository.recordTaskRun(...)` の method signature + invariants (idempotencyKey / baseRevision / taskDefId / checked / closedLifecycle rejection)
- **Seam**: `RECORD_TASK_RUN` handler の entry point (header 2 + JSON body で input を切る)
- **Depth**: 1 call で (1) revision guard (2) 同 TaskDef への最新 1 件適用 (3) 409 時の idempotent replay 判定、が完結する
- **Leverage**: android の 1 メソッドと core の 1 handler が N call sites (dashboard / timeline / calendar / future analytics) を unlock する
- **Locality**: TaskRun 更新の不変条件は `crates-v1/domain/src/completion.rs` に集中させ、handler / android use case には分散させない

## §3. Workflow lens (loop-me)

per mattpocock `loop-me` の vocabulary:

- **Trigger**: Android ExecuteScreen で `TaskDefinition` の Checkbox を user がタップ
- **Checkpoint**: revision conflict (409) 時のみ silent reconcile — UI に brief を 1 行出す (push-right 原則)
- **Push-right**: 成功時は楽観更新のみ。失敗時のみ reconcile dialog
- **Brief**: 「TaskRun 更新: {taskDefId} → {checked:bool} (rev:{n} → rev:{n+1})」を snackbar / brief で 1 行
- **Definition of Done**: implementer agent が質問なしに build 可能。v1/13 / v1/14 amendment 込み。

## §4. v1 spec 改訂

### 4-1. `tastile-core/v1/13-completion.md` への追加

§TaskRun 更新仕様節を新設 (TaskDefinition 章の直後、TaskOrderRule 章の前):

```
## TaskRun 更新仕様

Execution 進行中、ユーザーは TaskDefinition に対し check / uncheck を行える。
これは Execution aggregate 内の taskRuns[] に新しい ExecutionTaskRun を append する形で表現する。

不変条件:
- 同一 (executionId, taskDefId) に対する TaskRun は最新 1 件のみが effective
- TaskRun の record には idempotencyKey を持たせ、再送時は同結果を返す
- record には baseRevision を要求し、revision 不一致時は 409 を返す
- record は Execution lifecycle (ACTIVE / PAUSED) 中のみ許可。
  FINISHED_NORMAL / FINISHED_VOID の Execution への record は 422
- taskRuns 自体は V1_041__execution_runtime.sql に既に存在 (V1_059 は index 追加のみ)

schema:
ExecutionTaskRun
├─ id              ExecutionTaskRunId (UUIDv7)
├─ executionId     ExecutionId
├─ taskDefId       TaskDefId
├─ checked         bool
├─ recordedAt      DateTime<Utc>
└─ sourceRevision  i64  // record 時点の Execution.revision (audit 用)
```

### 4-2. `tastile-core/v1/14-read-model-and-endpoint.md` §2.5 Command 一覧 への追加

| Command kind 文字列 | Path | 対象 Aggregate | 効果 |
| --- | --- | --- | --- |
| `RECORD_TASK_RUN` | `POST /v1/executions/{executionId}/task-runs` | Execution (既存) | task_runs に新規 ExecutionTaskRun を append。同 (executionId, taskDefId) の最新 1 件のみ effective |

input 共通エンベロープ (`expectedRevision` / `idempotencyKey` / `occurredAt` / `payload`) を取る。
`payload` は `RecordTaskRunPayload { taskDefId: UUIDv7, checked: bool, recordedAt: ISO8601 }`。
詳細は `v1/13 §TaskRun 更新仕様` 参照。

### 4-3. `tastile-core/v1/10-invariants.md` への追記

§2 "command payload invariants" に追加:

```
RECORD_TASK_RUN:
- payload.taskDefId は UUIDv7、payload.checked は bool、payload.recordedAt は ISO 8601
- idempotencyKey は UUIDv7 (24 文字)、baseRevision (expectedRevision) は i64
- 対象 Execution が存在しない → 404 (kind=4)
- 対象 Execution が FINISHED_NORMAL / FINISHED_VOID → 422 (kind=0 VALIDATION)
- baseRevision (expectedRevision) 不一致 → 409 (kind=409 REVISION_CONFLICT)
- idempotencyKey が既存 record と一致 → 200 で同結果を返す (replay)
```

## §5. Core module 設計 (deep module)

### Task C1: V1_059 migration + task_runs index

**Files:**
- Create: `tastile-core/crates-v1/storage/migrations/V1_059__task_run_record.sql`

**Seam (depth):** `(execution_id, task_def_id, recorded_at DESC)` の降順 index。最新 1 件取得を O(log N) にし、`completion.rs` の `latest_task_run_per_task_def` 集計クエリを index-only scan に持っていく。

**Index DDL (sketch):**
```sql
CREATE INDEX IF NOT EXISTS idx_task_runs_latest_per_task
  ON task_runs (execution_id, task_def_id, recorded_at DESC);
```

`recorded_at` は `V1_041__execution_runtime.sql` で `NOT NULL` 既定のため partial index の `WHERE` 句は不要。

**TDD Steps:**
- Step 1: storage の integration test に「同一 (executionId, taskDefId) で 3 件 record → 最新 1 件のみ effective」を追加 (RED)
- Step 2: `cargo test -p v1-storage` で RED 観測
- Step 3: V1_059 migration + storage layer の latest-by-task-def query を実装 (GREEN)
- Step 4: green 観測
- Step 5: refactor
- Step 6: verify gate (cargo clippy + cargo test)
- Step 7: commit (test 先行 commit + migration commit の 2 commit)

### Task C2: domain apply (TaskRun append + revision guard + lifecycle check)

**Files:**
- Modify: `tastile-core/crates-v1/domain/src/completion.rs`
- Modify: `tastile-core/crates-v1/domain/src/aggregate.rs`

**Interface:**
```rust
pub fn apply_record_task_run(
    exec: &mut Execution,
    base_revision: i64,
    task_def_id: TaskDefId,
    checked: bool,
    recorded_at: DateTime<Utc>,
    idempotency_key: Uuid,
) -> Result<TaskRunApplyOutcome, ApplyError>;

pub enum TaskRunApplyOutcome {
    Appended { new_task_run: ExecutionTaskRun, new_revision: i64 },
    Replay { task_run: ExecutionTaskRun, revision: i64 },  // idempotent
    Conflict { current_revision: i64 },                     // 409
    ClosedLifecycle,                                          // 422 FINISHED_*
}
```

**Depth:** 1 call で revision guard + lifecycle check + idempotency replay 判定 + new_revision 計算 を完結。

**TDD Steps:**
- Step 1: `completion_tests.rs` に 4 つの unit test (Appended / Replay / Conflict / ClosedLifecycle) を追加 (RED)
- Step 2: `cargo test -p v1-domain` で RED 観測
- Step 3: `aggregate.rs` に `apply_record_task_run` 実装 (GREEN)
- Step 4: green 観測
- Step 5: refactor
- Step 6: verify gate
- Step 7: commit

### Task C3: API handler + openapi 公開

**Files:**
- Modify: `tastile-core/crates-v1/api/src/handlers/commands.rs`
- Modify: `tastile-core/crates-v1/api/src/openapi.rs`
- Modify: `crates-v1/api/src/bin/dump_openapi.rs` (再生成トリガ)
- Output: `tastile-core/openapi/openapi.yaml` (再生成)

**Interface:**
```rust
pub async fn record_task_run(
    State(state): State<Arc<AppState>>,
    Path(execution_id): Path<Uuid>,
    Json(req): Json<CommandRequest<RecordTaskRunPayload>>,
) -> Result<CommandResponse, ApiError>;
```

**Route macro (openapi.rs に追記):**
```rust
/// RECORD_TASK_RUN: POST /v1/executions/{executionId}/task-runs
#[utoipa::path(
    post,
    path = "/v1/executions/{executionId}/task-runs",
    params(("executionId" = Uuid, Path, description = "Execution ID (UUIDv7)")),
    request_body = CommandRequest<RecordTaskRunPayload>,
    responses(
        (status = 200, description = "TaskRun recorded or replayed", body = CommandResponse),
        (status = 404, description = "Execution not found", body = ApiError),
        (status = 409, description = "Revision conflict", body = ApiError),
        (status = 422, description = "Validation or closed lifecycle", body = ApiError),
    ),
    tag = "executions"
)]
pub async fn record_task_run() {}
```

**TDD Steps:**
- Step 1: handler test に「正常系 / 404 / 409 / 422 / idempotent replay」5 ケース追加 (RED)
- Step 2: `cargo test -p v1-api` で RED 観測
- Step 3: handler impl + openapi route 追加 + `cargo run -p v1-api --bin dump_openapi` 実行 (GREEN)
- Step 4: green 観測
- Step 5: refactor
- Step 6: verify gate (cargo clippy + cargo test + `bun run check:release` in `tastile-web` で openapi drift 0 確認)
- Step 7: commit

### Task C4: AT (acceptance test) §12 への追加

**Files:**
- Modify: `tastile-core/crates-v1/domain/src/at_acceptance_tests.rs`

AT §12 に「Execution 進行中に TaskRun を 3 件 record → completion 集計で最新 1 件のみ effective」を追加。

**TDD Steps:**
- Step 1: AT を書く (RED)
- Step 2: `cargo test -p v1-domain --test at_acceptance_tests` で RED 観測
- Step 3: 既存 flow との結線点を確認し、最小修正で GREEN
- Step 4-7: standard

## §6. Android module 設計

### Task A1: ExecutionRepository.recordTaskRun + MockWebServer test

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/execution/ExecutionRepository.kt`
- Create: `tastile-android/app/src/test/java/app/tastile/android/data/execution/ExecutionRepositoryTest.kt`

**Interface:**
```kotlin
suspend fun recordTaskRun(
    executionId: String,
    taskDefId: String,
    checked: Boolean,
    baseRevision: Long,
    idempotencyKey: String,
): RecordTaskRunResult

sealed interface RecordTaskRunResult {
    data class Updated(val newRevision: Long, val recordedAt: String) : RecordTaskRunResult
    data class Replay(val newRevision: Long, val recordedAt: String) : RecordTaskRunResult
    data class RevisionConflict(val currentRevision: Long) : RecordTaskRunResult
    data object ExecutionNotFound : RecordTaskRunResult
    data object ClosedLifecycle : RecordTaskRunResult
    data class ValidationError(val message: String) : RecordTaskRunResult
    data class ServerError(val code: Int) : RecordTaskRunResult
    data object NetworkError : RecordTaskRunResult
}
```

**Seam (depth):** HTTP error → 8 種類の sealed result への decoding を 1 か所に局所化。

**TDD Steps:**
- Step 1: MockWebServer で 200 / 200-replay / 404 / 409 / 422 / 5xx / network-error 7 ケース (RED)
- Step 2: `./gradlew testDebugUnitTest` で RED 観測
- Step 3: repository method impl (GREEN)
- Step 4-7: standard

### Task A2: RecordTaskRunUseCase

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/domain/usecase/RecordTaskRunUseCase.kt`
- Create: `tastile-android/app/src/test/java/app/tastile/android/domain/usecase/RecordTaskRunUseCaseTest.kt`

**Interface:**
```kotlin
class RecordTaskRunUseCase @Inject constructor(
    private val repo: ExecutionRepository,
    private val executionState: ExecutionStateProjector,
) {
    suspend operator fun invoke(
        executionId: String,
        taskDefId: String,
        checked: Boolean,
    ): RecordTaskRunResult
}
```

**Behavior:**
- repo に `RecordTaskRunUseCase` 内で idempotencyKey を UUIDv7 で生成
- `baseRevision` は `ExecutionStateProjector.currentRevision(executionId)` から取得 (push-right)
- 成功 / replay → `ExecutionStateProjector.taskRunsUpdated(newRevision)`
- Conflict → `ExecutionStateProjector.requestRefresh(executionId)` を発火

**TDD Steps:**
- Step 1: fake repo を使った unit test 4 ケース (Updated / Replay / Conflict / ClosedLifecycle) (RED)
- Step 2: RED 観測
- Step 3: GREEN impl
- Step 4-7: standard

### Task A3: ExecutionViewModel.recordTask

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt`

**Interface:**
```kotlin
fun recordTask(
    executionId: String,
    taskDefId: String,
    checked: Boolean,
)
```

**Behavior:**
- 楽観更新 (UI state を即座に checked=val に)
- RecordTaskRunUseCase 起動
- 結果 dispatch:
  - `Updated` / `Replay` → state 確定、brief 表示
  - `Conflict` → state 再取得 → snackbar で brief
  - `ClosedLifecycle` / `ExecutionNotFound` → snackbar
  - `ServerError` / `NetworkError` → snackbar + retry CTA

**TDD Steps:**
- Step 1: viewmodel unit test (with fake use case + Turbine) を 5 ケース (RED)
- Step 2: RED 観測
- Step 3: GREEN impl
- Step 4-7: standard

### Task A4: ExecuteScreen UI 拡張

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt`

**UI 仕様:**
- 既存の Execute tab に **TaskChecklistSection** を slot 形式で追加
- 各 `TaskDefinition` に対し `Checkbox` + label を 1 行 (slot のため section 単体を別 file に切っても良い)
- check 変化時に `viewmodel.recordTask(...)` を起動
- 楽観更新 + 失敗時 reconcile は snackbar 経由 (Brief)

**TDD Steps:**
- Step 1: Compose UI test (`createComposeRule`) で 4 シナリオ (RED)
  - 表示 (3 タスクのうち 1 件 checked)
  - check on → viewmodel.recordTask 呼び出し
  - Conflict 時の reconcile snackbar
  - ClosedLifecycle 時の error snackbar
- Step 2: RED 観測
- Step 3: GREEN impl
- Step 4-7: standard

## §7. Data flow

```
[user] tap Checkbox on ExecuteScreen
  → ExecuteScreen.TaskChecklistSection Checkbox onCheckedChange
  → ExecutionViewModel.recordTask(executionId, taskDefId, checked)
    ├─ optimistic update: UI state.checked を即座に更新
    └─ RecordTaskRunUseCase.invoke
         └─ ExecutionRepository.recordTaskRun
              ├─ idempotencyKey = UUIDv7().toString()
              ├─ baseRevision = ExecutionStateProjector.currentRevision(executionId)
              └─ POST /v1/executions/{executionId}/task-runs
                   ├─ header: Idempotency-Key
                   ├─ header: X-Expected-Revision
                   └─ body: CommandRequest { payload: { kind: RECORD_TASK_RUN, value: { taskDefId, checked, recordedAt } } }
                   ↓
              [core] record_task_run handler
                   └─ domain::apply_record_task_run
                        ├─ lifecycle check (ACTIVE/PAUSED のみ許可)
                        ├─ baseRevision check (不一致 → 409)
                        ├─ idempotencyKey replay check
                        └─ execution.task_runs.append(new TaskRun) + revision++
                   ↓
              [response] CommandResponse { result: Updated, new_revision, recordedAt }
                   ↓
              ExecutionStateProjector.taskRunsUpdated(newRevision)
                   ↓
              ExecuteScreen.Checkbox state confirmed (楽観更新が確定)
```

### 7-1. Conflict 時の挙動

```
Updated / Replay   → state confirmed, snackbar "TaskRun 更新: {taskDefId} → {checked} (rev:{n} → rev:{n+1})"
Conflict           → state を baseRevision で再取得 → snackbar "他の端末が更新しました (rev:{n} → rev:{n+1})"
ClosedLifecycle    → snackbar "Execution は既に終了しています"
ExecutionNotFound  → snackbar "Execution が見つかりません"
ValidationError    → snackbar "入力エラー: {message}"
ServerError(5xx)   → snackbar "更新に失敗しました (Retry)" + 再 tap で retry
NetworkError       → snackbar "通信エラー (Retry)" + 再 tap で retry
```

## §8. Error handling

| 状況 | HTTP | Android `RecordTaskRunResult` | UI 反応 |
| --- | --- | --- | --- |
| Validation error (payload 不正) | 422 kind=0 | `ValidationError(message)` | snackbar |
| Execution not found | 404 kind=4 | `ExecutionNotFound` | snackbar |
| baseRevision 不一致 | 409 kind=409 | `RevisionConflict(currentRevision)` | snackbar + reconcile |
| Execution FINISHED_* | 422 kind=0 | `ClosedLifecycle` | snackbar |
| Idempotent replay | 200 (同 result) | `Replay(newRevision, recordedAt)` | (無音 success) |
| 5xx | 5xx | `ServerError(code)` | snackbar + retry CTA |
| Network error | - | `NetworkError` | snackbar + retry CTA |

すべての error path は sealed interface で網羅する。`null` や `Throwable` を直接 UI に伝播させない。

## §9. Testing (refs §0)

§0 の discipline を **そのまま** chunk ごとの test 構造に適用する。test-only commit は OK、RED → GREEN → REFACTOR を 1 commit にまとめない。

具体的な test 置き場:

- core:
  - `crates-v1/storage/src/tests/` (storage integration)
  - `crates-v1/domain/src/completion_tests.rs` (domain unit)
  - `crates-v1/domain/src/at_acceptance_tests.rs` (AT §12)
  - `crates-v1/api/src/handlers/commands.rs` 近接 test (handler route)
- android:
  - `app/src/test/java/app/tastile/android/data/execution/ExecutionRepositoryTest.kt`
  - `app/src/test/java/app/tastile/android/domain/usecase/RecordTaskRunUseCaseTest.kt`
  - `app/src/test/java/app/tastile/android/ui/mobile/execution/ExecutionViewModelTest.kt`
  - `app/src/androidTest/java/app/tastile/android/ui/mobile/tabs/ExecuteScreenTest.kt` (Compose UI test)

test 命名規約: `<method>_<scenario>_<expected>` (例: `recordTaskRun_409_returnsRevisionConflict`)。

## §10. Acceptance criteria

§0 の 7 step を全 chunk で通過 + 下記:

- [ ] `tastile-core/v1/13-completion.md` に §TaskRun 更新仕様 節が追加されている
- [ ] `tastile-core/v1/14-read-model-and-endpoint.md` §2.5 に `RECORD_TASK_RUN` 行が追加されている
- [ ] `tastile-core/v1/10-invariants.md` §2 に `RECORD_TASK_RUN` 不変条件節が追加されている
- [ ] `V1_059__task_run_record.sql` が `cargo test --workspace` で適用される
- [ ] `openapi.yaml` に `POST /v1/executions/{executionId}/task-runs` が公開されている
- [ ] `tastile-android` の `ExecuteScreen` で `TaskDefinition` をチェック → 0.5 秒以内に楽観更新が反映
- [ ] Conflict (409) 時に brief 表示 + 自動 reconcile が起きる
- [ ] web は本 PR では触らないが、`bun run check:release` で openapi drift 0
- [ ] workspace check: `pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast` が exit 0
- [ ] agent-initiated commit は `.agents/skills/tastile-precommit-review` 通過 (TDD §0 Step 7)
- [ ] `verify-tastile-change` を PR 完了直前に実行し PASS 確認

## §11. Open questions (resolved)

### Q4: 既存 Now / Execute との関係

**Decision:** 既存 Execute tab を拡張、独立 screen は作らない。`TaskChecklistSection` を `ExecuteScreen` に slot として追加する (分離したい場合は別 file へ切り出し可能)。Now screen (`ui/now/NowScreen.kt`) は時刻表示中心で別目的のため触らない。

### Q5: web parity binding

**Decision:** Android 先行的。`tastile-web` は openapi codegen (`pnpm codegen`) で自動追従する follow-up PR とする。本 PR では web 側に新規 file を作らないが、`bun run check:release` で openapi drift が 0 になることを確認する。

## §12. Risks & Rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| v1/13 / v1/14 / v1/10 amendment | 別 PR で amend (本 PR と分離可能) | `git revert` |
| V1_059 migration | 可逆設計 (down 不要、index 追加のみ) | `DROP INDEX idx_task_runs_latest_per_task` |
| Execution aggregate 肥大 | TaskRun は append-only、別 aggregate 化 (v1.2) は後段 | n/a |
| SessionRepository.submitFeedback への副作用 | scope 外として明示、触らない | n/a |
| Android 楽観更新の整合性 | Conflict 時に必ず reconcile、UI state は server 確定後に確定 | n/a |
| openapi drift | Task C3 Step 6 で `bun run check:release` 確認 | openapi 修正 + 再 dump |
| agent commit 規約違反 | `.agents/skills/tastile-precommit-review` を Step 7 で必須化 | 直前の commit を amend |

---

## Appendix A — Reference paths

- v1 spec: `tastile-core/v1/13-completion.md`, `tastile-core/v1/14-read-model-and-endpoint.md`, `tastile-core/v1/10-invariants.md`
- core migration target: `tastile-core/crates-v1/storage/migrations/V1_059__task_run_record.sql`
- core domain target: `tastile-core/crates-v1/domain/src/{aggregate,completion}.rs`
- core api target: `tastile-core/crates-v1/api/src/handlers/commands.rs`, `tastile-core/crates-v1/api/src/openapi.rs`
- core openapi output: `tastile-core/openapi/openapi.yaml` (再生成)
- android data target: `tastile-android/app/src/main/java/app/tastile/android/data/execution/ExecutionRepository.kt`
- android domain target: `tastile-android/app/src/main/java/app/tastile/android/domain/usecase/RecordTaskRunUseCase.kt`
- android ui target: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt`, `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt`

## Appendix B — Skill reference

- brainstorm source: `superpowers:brainstorming` (Q1-Q5 経由)
- investigation source: `investigate-first` (2026-08-29 4 軸走査)
- TDD source: `superpowers:test-driven-development` + `superpowers:executing-plans`
- vocabularies: mattpocock `codebase-design`, mattpocock `loop-me`, mattpocock `grilling` (Q&A discipline)
- implementation: mattpocock `implement-spec` (task graph, frontier, subagent worktree)
- gate: `.agents/skills/verify-tastile-change` + `.agents/skills/tastile-precommit-review`
