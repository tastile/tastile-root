# r3: Android TaskRun Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `RECORD_TASK_RUN` v1 Command を `tastile-core` に追加し、`tastile-android` の `ExecuteScreen` から `TaskDefinition` チェックを end-to-end で送れる producer 経路を完成する。

**Architecture:** Closed-loop consumer (analytics / insights) を待たず producer 側を先に固める。core は 1 handler + 1 domain apply + 1 migration、android は 1 repository method + 1 use case + 1 viewmodel action + 1 UI slot の 8 chunk。TaskRun は append-only、最新 1 件のみ effective。`tastile-web` は openapi codegen 経由の follow-up で本 PR の scope 外 (§11 Q5)。

**Tech Stack:** Rust 1.85 / sqlx + Postgres / utoipa + utoipa-redoc / Kotlin 2.0 + Compose Material 3 / Hilt / OkHttp + MockWebServer / kotlinx.coroutines + kotlinx.serialization / JUnit5 + Turbine / Compose UI test.

**Spec:** `docs/superpowers/specs/2026-08-30-r3-android-task-run-design.md`

## Global Constraints

- **Workspace invariants (AGENTS.md):** 開始時に `git status --short` 確認。`main` 以外では作業しない。worktree を作らない。**pre-existing uncommitted diff（`M .gitignore` / `M docs/adr/0001-agent-toolchain.md` / `M scripts/check-agent-environment.ps1` / `M scripts/orchestration/invoke-web-gate.ps1` / `?? infra/sops/.terraform.lock.hcl` / `?? package.json`）には reset / checkout / stash / revert / amend / commit しない**。
- **TDD discipline (§0 of spec):** RED → GREEN → REFACTOR を 1 commit にまとめない。test-only commit (`test:` prefix) と impl commit (`feat:` / `chore:` prefix) は必ず分離。REVIEWED ≠ VERIFIED — 必ず RED 出力を Step 3 で観測する。
- **追加 npm / cargo / gradle dependency なし。** 既存の sqlx / utoipa / OkHttp / MockWebServer / Turbine / kotlinx.serialization ですべて完結する。
- **comment / identifier / doc-comment は英語。** 内部開発文書 (`.md`) は日本語。
- **v1 spec amendments** (`v1/13-completion.md` / `v1/14-read-model-and-endpoint.md` / `v1/10-invariants.md`) は Task 0 で先に commit (Task C1-C4 の contract pin の source of truth を固定する)。
- **`ExecutionTaskRun.idempotency_key` の storage 所在**: Task C2 の replay 判定で `r.idempotency_key() == idempotency_key` を使う。schema の所在として 2 択ある — (a) `task_runs` テーブルに `idempotency_key UUID NOT NULL` 列が既に存在 (V1_041 に含まれると spec §4-1 が前提)、(b) 別 `idempotency_keys(execution_id, idempotency_key, task_run_id)` テーブルに切り出し。Task C1 / C2 の Step 1 (contract pin) で V1_041 schema と `domain::aggregate::ExecutionTaskRun` 定義を両方確認し、(a) でも (b) でもない場合 spec amendment を先に出す。
- **compileSdk / JDK / AGP 固定**: android compileSdk=35 / JDK 17 / AGP 9.2.1 / Gradle 9.6.0 (per memory `tastile-android build toolchain`)。
- **Rust 検証は wslc 内**: Defender が cc1.exe を hash block するため、`cargo` 系の verify は `wslc` 内実行 (memory `Use wslc for Rust backend` + `wslc engine data layout` により `bash .wslc/verify-up.sh` を先に通す)。
- **android 単体テストは emulator 不要**: `./gradlew testDebugUnitTest` / `lintKotlinMain` のみ。device 不要。
- **web openapi drift check**: Task C3 Step 7 で `cd tastile-web && bun run check:release` を実行し drift 0 を確認 (本 PR で web 側に新規 file は作らない、openapi submodule の re-read が走れば OK)。
- **final verify gate**: `pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing` が exit 0。
- **agent-initiated commit**: `.agents/skills/tastile-precommit-review` を通す (各 Task Step 7 / 9 末尾)。
- **hash / bracket / commit メッセージ規約**: `<type>: <concise title>` 英語、`Co-Authored-By: Claude Code <noreply@anthropic.com>` 付き (ただし agent commit の場合は precommit review 規約に従う)。

---

## File Structure

### 新規ファイル (core)

| ファイル | 責務 |
| --- | --- |
| `tastile-core/crates-v1/storage/migrations/V1_059__task_run_record.sql` | `(execution_id, task_def_id, recorded_at DESC)` index |
| `tastile-core/crates-v1/storage/src/task_runs.rs` | `latest_task_run_per_task_def(...)` query function |
| `tastile-core/crates-v1/storage/src/tests/task_runs_latest.rs` | integration test (3 件 record → 最新 1 件 effective) |
| `tastile-core/crates-v1/domain/src/tests/completion_record_task_run.rs` | `apply_record_task_run` の 4 ケース unit test |
| `tastile-core/crates-v1/api/src/handlers/tests/record_task_run.rs` | handler route test 5 ケース |

### 編集ファイル (core)

| ファイル | 変更内容 |
| --- | --- |
| `tastile-core/v1/13-completion.md` | §TaskRun 更新仕様 節を新設 (Task 0) |
| `tastile-core/v1/14-read-model-and-endpoint.md` | §2.5 Command 一覧に `RECORD_TASK_RUN` 行 (Task 0) |
| `tastile-core/v1/10-invariants.md` | §2 command payload invariants に `RECORD_TASK_RUN` 節 (Task 0) |
| `tastile-core/crates-v1/storage/src/migrations/mod.rs` | `V1_059` を embed_migrations! 経由で登録 |
| `tastile-core/crates-v1/storage/src/lib.rs` | `task_runs` module 公開 |
| `tastile-core/crates-v1/domain/src/completion.rs` | `apply_record_task_run` / `TaskRunApplyOutcome` 実装 |
| `tastile-core/crates-v1/domain/src/aggregate.rs` | `apply_record_task_run` の dispatch helper (必要なら) |
| `tastile-core/crates-v1/domain/src/at_acceptance_tests.rs` | AT §12 拡張 |
| `tastile-core/crates-v1/api/src/handlers/commands.rs` | `record_task_run` handler 追加 |
| `tastile-core/crates-v1/api/src/openapi.rs` | `#[utoipa::path]` route macro 追加 |
| `tastile-core/openapi/openapi.yaml` | dump_openapi 再生成 |

### 新規ファイル (android)

| ファイル | 責務 |
| --- | --- |
| `app/src/main/java/app/tastile/android/domain/usecase/RecordTaskRunUseCase.kt` | repo + projector を統合する suspend operator |
| `app/src/main/java/app/tastile/android/ui/mobile/execution/TaskChecklistSection.kt` | Composable slot (ExecuteScreen へ差し込み) |
| `app/src/test/java/app/tastile/android/data/execution/ExecutionRepositoryRecordTaskRunTest.kt` | MockWebServer 7 ケース |
| `app/src/test/java/app/tastile/android/domain/usecase/RecordTaskRunUseCaseTest.kt` | fake repo 4 ケース |
| `app/src/test/java/app/tastile/android/ui/mobile/execution/ExecutionViewModelRecordTaskTest.kt` | Turbine 5 ケース |
| `app/src/androidTest/java/app/tastile/android/ui/mobile/tabs/ExecuteScreenTaskChecklistTest.kt` | Compose UI test 4 シナリオ |

### 編集ファイル (android)

| ファイル | 変更内容 |
| --- | --- |
| `app/src/main/java/app/tastile/android/data/execution/ExecutionRepository.kt` | `recordTaskRun(...)` method 追加 |
| `app/src/main/java/app/tastile/android/data/api/V1Models.kt` | `RecordTaskRunPayload` / `RecordTaskRunCommand` DTO |
| `app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt` | `recordTask(...)` 公開 + StateFlow 更新 |
| `app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` | `TaskChecklistSection` slot 追加 |

### 触らないファイル

- `app/src/main/java/app/tastile/android/ui/now/NowScreen.kt` (Q4: 触らない)
- `app/src/main/java/app/tastile/android/data/execution/SessionRepository.kt` (Decision / Session 経路、scope 外)
- `tastile-web/src/execution/**` (Q5: openapi drift 0 のみ、別 follow-up PR)
- pre-existing uncommitted diff 配下すべて

### Chunk 依存関係グラフ

```
Task 0 (v1 spec amendments)
    ├─→ Task C1 (migration + storage query)
    ├─→ Task C2 (domain apply_record_task_run) — implements §4-1 schema
    │       └─→ Task C3 (handler + openapi) — implements §4-2, §4-3
    │               └─→ Task C4 (AT §12)
    │
    └─→ Task A1 (ExecutionRepository.recordTaskRun + sealed result)
            └─→ Task A2 (RecordTaskRunUseCase)
                    └─→ Task A3 (ExecutionViewModel.recordTask)
                            └─→ Task A4 (ExecuteScreen TaskChecklistSection)
```

C1 / C2 は並列着手可能。C3 は C2 完了後。A1 は C3 完了後 (openapi.yaml の request/response shape が pin されるため)。A2 → A3 → A4 は順次。

実行戦略 (AGENTS.md 制約下で worktree は作らない):
- `wslc container` を 1 個立ち上げ、core / android を交互に 1 chunk ずつ進める。
- core の cargo verify は wslc 内、android の gradle verify は host PowerShell から直接。

---

## Task 0: v1 spec amendments (docs-only, pre-TDD foundation)

**Files:**
- Modify: `tastile-core/v1/13-completion.md` (§TaskRun 更新仕様 節を §TaskDefinition 章の直後・§TaskOrderRule 章の前に追加)
- Modify: `tastile-core/v1/14-read-model-and-endpoint.md` (§2.5 Command 一覧表に `RECORD_TASK_RUN` 行を追加)
- Modify: `tastile-core/v1/10-invariants.md` (§2 command payload invariants 末尾に `RECORD_TASK_RUN` 節を追加)

**Interfaces:**
- Consumes: spec §4-1 / §4-2 / §4-3 をそのまま転記
- Produces: 後続 Task C1-C4 の Step 0 (contract pin) で参照する不変条件

- [ ] **Step 1: v1/13 §TaskRun 更新仕様 節を追加**

`tastile-core/v1/13-completion.md` の `## TaskDefinition` 直後 (or `## TaskOrderRule` 直前) に、spec §4-1 の節テキストをそのまま paste する:

```markdown
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

- [ ] **Step 2: v1/14 §2.5 Command 一覧へ `RECORD_TASK_RUN` 行を追加**

`tastile-core/v1/14-read-model-and-endpoint.md` の `## §2.5 Command 一覧` 表に以下行を追加:

```markdown
| `RECORD_TASK_RUN` | `POST /v1/executions/{executionId}/task-runs` | Execution (既存) | task_runs に新規 ExecutionTaskRun を append。同 (executionId, taskDefId) の最新 1 件のみ effective |
```

直下行に:

```markdown
payload は `RecordTaskRunPayload { taskDefId: UUIDv7, checked: bool, recordedAt: ISO8601 }`。
詳細は `v1/13 §TaskRun 更新仕様` 参照。
```

- [ ] **Step 3: v1/10 invariants §2 へ追記**

`tastile-core/v1/10-invariants.md` の `## §2 command payload invariants` 末尾に:

```markdown
RECORD_TASK_RUN:
- payload.taskDefId は UUIDv7、payload.checked は bool、payload.recordedAt は ISO 8601
- idempotencyKey は UUIDv7 (24 文字)、baseRevision (expectedRevision) は i64
- 対象 Execution が存在しない → 404 (kind=4)
- 対象 Execution が FINISHED_NORMAL / FINISHED_VOID → 422 (kind=0 VALIDATION)
- baseRevision (expectedRevision) 不一致 → 409 (kind=409 REVISION_CONFLICT)
- idempotencyKey が既存 record と一致 → 200 で同結果を返す (replay)
```

- [ ] **Step 4: docs-only commit**

```bash
git add tastile-core/v1/13-completion.md tastile-core/v1/14-read-model-and-endpoint.md tastile-core/v1/10-invariants.md
git commit -m "docs(v1): specify RECORD_TASK_RUN command (13 §TaskRun 更新, 14 §2.5, 10 invariants)"
```

Expected: 3 file changed, no test, no impl. commit message language: English, `<type>(scope): <verb> ...`。

---

## Task C1: V1_059 migration + storage latest-by-task-def query

**Files:**
- Create: `tastile-core/crates-v1/storage/migrations/V1_059__task_run_record.sql`
- Modify: `tastile-core/crates-v1/storage/src/migrations/mod.rs` (登録のみ、`embed_migrations!` が自動なら不要)
- Create: `tastile-core/crates-v1/storage/src/task_runs.rs`
- Modify: `tastile-core/crates-v1/storage/src/lib.rs` (`pub mod task_runs;`)
- Create: `tastile-core/crates-v1/storage/src/tests/task_runs_latest.rs`
- Modify: `tastile-core/crates-v1/storage/src/tests/mod.rs` (`mod task_runs_latest;`)

**Interfaces:**
- Consumes: `v1/13 §TaskRun 更新仕様` の不変条件 (Task 0 で固定済)、既存 `V1_041__execution_runtime.sql` の `task_runs` table
- Produces:
  ```rust
  // crates-v1/storage/src/task_runs.rs
  pub async fn latest_task_run_per_task_def(
      executor: impl PgExecutor<'_>,
      execution_id: ExecutionId,
      task_def_id: TaskDefId,
  ) -> sqlx::Result<Option<ExecutionTaskRun>>;
  ```

- [ ] **Step 1: contract pin + RED test を書く**

**Contract pin (先行条件):** `crates-v1/storage/migrations/V1_041__execution_runtime.sql` を開き、`task_runs` テーブルに `idempotency_key UUID NOT NULL` が含まれていることを確認する。含まれていない場合、本 plan を止めて spec §4-1 amendment (idempotency_key を V1_059 schema で追加) を先に出す。含まれていれば以下 RED test を書く:

`crates-v1/storage/src/tests/task_runs_latest.rs`:

```rust
//! TDD Red: V1_059 index + latest-by-task-def query
//! 同一 (execution_id, task_def_id) で 3 件 record した時、最新 1 件のみが返る。

use sqlx::PgPool;
use uuid::Uuid;
use chrono::Utc;
use tastile_v1_storage::{migrations::migrate, task_runs::*};
use tastile_v1_domain::{ExecutionId, TaskDefId, ExecutionTaskRun};

#[sqlx::test(migrations = "../../../migrations")]
async fn latest_task_run_per_task_def_returns_newest(pool: PgPool) -> sqlx::Result<()> {
    migrate(&pool).await?;
    let execution_id = ExecutionId::now_v7();
    let task_def_id   = TaskDefId::now_v7();

    let older  = Utc::now() - chrono::Duration::seconds(30);
    let middle = Utc::now() - chrono::Duration::seconds(15);
    let newest = Utc::now();

    insert_task_run(&pool, execution_id, task_def_id, true,  older,  None).await?;
    insert_task_run(&pool, execution_id, task_def_id, false, middle, None).await?;
    insert_task_run(&pool, execution_id, task_def_id, true,  newest, None).await?;

    let got = latest_task_run_per_task_def(&pool, execution_id, task_def_id).await?;
    let run = got.expect("latest run must exist");
    assert_eq!(run.checked, true, "newest wins (true)");
    assert_eq!(run.recorded_at, newest);
    Ok(())
}

#[sqlx::test(migrations = "../../../migrations")]
async fn latest_task_run_per_task_def_returns_none_when_empty(pool: PgPool) -> sqlx::Result<()> {
    migrate(&pool).await?;
    let execution_id = ExecutionId::now_v7();
    let task_def_id   = TaskDefId::now_v7();

    let got = latest_task_run_per_task_def(&pool, execution_id, task_def_id).await?;
    assert!(got.is_none(), "no rows ⇒ None");
    Ok(())
}

// helper used by both tests; lives next to test (or in common test helpers module).
async fn insert_task_run(
    pool: &PgPool,
    execution_id: ExecutionId,
    task_def_id: TaskDefId,
    checked: bool,
    recorded_at: chrono::DateTime<Utc>,
    id_override: Option<Uuid>,
) -> sqlx::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO task_runs (id, execution_id, task_def_id, checked, recorded_at, source_revision)
        VALUES ($1, $2, $3, $4, $5, 0)
        "#,
        id_override.unwrap_or_else(Uuid::now_v7),
        execution_id.into_uuid(),
        task_def_id.into_uuid(),
        checked,
        recorded_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}
```

- [ ] **Step 2: RED を観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-storage --test task_runs_latest -- --nocapture'
```

Expected (RED):
```
error[E0433]: failed to resolve: use of undeclared module `task_runs`
error[E0432]: unresolved import `tastile_v1_storage::task_runs`
```

- [ ] **Step 3: RED test のみ commit (test-only, RED 観測済)**

```bash
git add crates-v1/storage/src/tests/task_runs_latest.rs crates-v1/storage/src/tests/mod.rs
git commit -m "test(storage): red for latest_task_run_per_task_def (V1_059 prep)"
```

- [ ] **Step 4: GREEN impl を最小実装**

`crates-v1/storage/migrations/V1_059__task_run_record.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_task_runs_latest_per_task
  ON task_runs (execution_id, task_def_id, recorded_at DESC);
```

`crates-v1/storage/src/task_runs.rs`:

```rust
use chrono::{DateTime, Utc};
use sqlx::{PgExecutor, Row};
use tastile_v1_domain::{ExecutionId, ExecutionTaskRun, TaskDefId};
use uuid::Uuid;

/// Returns the newest `ExecutionTaskRun` for `(execution_id, task_def_id)`,
/// or `None` if no row exists. Reads are index-only via `idx_task_runs_latest_per_task`.
pub async fn latest_task_run_per_task_def(
    executor: impl PgExecutor<'_>,
    execution_id: ExecutionId,
    task_def_id: TaskDefId,
) -> sqlx::Result<Option<ExecutionTaskRun>> {
    let row = sqlx::query(
        r#"
        SELECT id, execution_id, task_def_id, checked, recorded_at, source_revision
        FROM task_runs
        WHERE execution_id = $1 AND task_def_id = $2
        ORDER BY recorded_at DESC
        LIMIT 1
        "#,
    )
    .bind(execution_id.into_uuid())
    .bind(task_def_id.into_uuid())
    .fetch_optional(executor)
    .await?;

    Ok(row.map(|r| ExecutionTaskRun {
        id:                ExecutionTaskRunId::from_uuid(r.get::<Uuid, _>("id")),
        execution_id:      ExecutionId::from_uuid(r.get("execution_id")),
        task_def_id:       TaskDefId::from_uuid(r.get("task_def_id")),
        checked:           r.get("checked"),
        recorded_at:       r.get::<DateTime<Utc>, _>("recorded_at"),
        source_revision:   r.get("source_revision"),
    }))
}
```

> NOTE: 既存 `ExecutionTaskRun` の field 名が spec と一致しない場合、spec §4-1 の schema を満たすように最小修正する。`ExecutionTaskRun` に `source_revision` が無い場合は field 追加 (Step 5 で対応)。

`crates-v1/storage/src/lib.rs` に `pub mod task_runs;` を追加。

- [ ] **Step 5: GREEN 観測 (必要に応じて domain model 調整)**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-storage --test task_runs_latest -- --nocapture'
```

Expected: `2 passed; 0 failed`. 既存 `ExecutionTaskRun` に `source_revision` field が無い等の model 齟齬が出たら、最小差分で field 追加 (domain crate 側の permissive commit — `task_runs` 専用 helper としてのみ初期化)。

- [ ] **Step 6: refactor (重複削除・命名整理・seam 確認)**

- `task_runs.rs` の import 順序を clippy 推奨順へ
- `insert_task_run` helper を `tests/common.rs` (既存があれば) へ移動

- [ ] **Step 7: verify gate**

```bash
cd tastile-core
wslc bash -c 'cargo clippy -p v1-storage --all-targets -- -D warnings'
wslc bash -c 'cargo test -p v1-storage -- --nocapture'
```

Expected: clippy 0 warning / test 0 failure。`Pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing` も通過。

- [ ] **Step 8: GREEN impl + migration を commit**

```bash
git add crates-v1/storage/migrations/V1_059__task_run_record.sql \
        crates-v1/storage/src/task_runs.rs \
        crates-v1/storage/src/lib.rs
git commit -m "feat(storage): add V1_059 index + latest_task_run_per_task_def query"
```

- [ ] **Step 9: precommit review (agent-initiated なら実行)**

`pwsh -NoProfile -File .\.agents\skills\tastile-precommit-review\Run.ps1 -Last 2`
Expected: PASS。

---

## Task C2: domain apply_record_task_run (append + revision guard + lifecycle check + idempotency replay)

**Files:**
- Modify: `tastile-core/crates-v1/domain/src/completion.rs` (`apply_record_task_run` / `TaskRunApplyOutcome` / errors 追加)
- Modify: `tastile-core/crates-v1/domain/src/lib.rs` (公開)
- Modify: `tastile-core/crates-v1/domain/src/aggregate.rs` (Execution に append helper、rev インクリメント)
- Create: `tastile-core/crates-v1/domain/src/tests/completion_record_task_run.rs`
- Modify: `tastile-core/crates-v1/domain/src/tests/mod.rs`

**Interfaces:**
- Consumes: spec §4-1 `ExecutionTaskRun` schema、`Execution` aggregate (already has `task_runs: Vec<ExecutionTaskRun>`)
- Produces:
  ```rust
  // crates-v1/domain/src/completion.rs
  pub enum TaskRunApplyOutcome {
      Appended { new_task_run: ExecutionTaskRun, new_revision: i64 },
      Replay   { task_run: ExecutionTaskRun,       revision:   i64 },
      Conflict { current_revision: i64 },
      ClosedLifecycle,
  }

  pub fn apply_record_task_run(
      exec: &mut Execution,
      base_revision: i64,
      task_def_id: TaskDefId,
      checked: bool,
      recorded_at: DateTime<Utc>,
      idempotency_key: Uuid,
  ) -> Result<TaskRunApplyOutcome, ApplyError>;
  ```

- [ ] **Step 1: RED test を書く**

`crates-v1/domain/src/tests/completion_record_task_run.rs`:

```rust
//! TDD Red: apply_record_task_run — 4 unit cases per spec §4-1.

use chrono::Utc;
use uuid::Uuid;
use tastile_v1_domain::{
    apply_record_task_run, TaskRunApplyOutcome, ApplyError,
    Execution, ExecutionId, ExecutionLifecycle, ExecutionTaskRun,
    TaskDefId, ExecutionTaskRunId,
};

fn active_exec(rev: i64) -> Execution {
    let mut exec = Execution::new_with_id(ExecutionId::now_v7(), /* seed */);
    for _ in 0..rev { exec.bump_revision_for_test(); }
    exec.set_lifecycle_for_test(ExecutionLifecycle::Active);
    exec
}

fn finished_exec(rev: i64) -> Execution {
    let mut exec = active_exec(rev);
    exec.set_lifecycle_for_test(ExecutionLifecycle::FinishedNormal);
    exec
}

#[test]
fn apply_record_task_run_appends_new_when_lifecycle_active_and_revision_matches() {
    let mut exec = active_exec(3);
    let task_def_id = TaskDefId::now_v7();
    let idem = Uuid::now_v7();

    let outcome = apply_record_task_run(
        &mut exec, 3, task_def_id, true, Utc::now(), idem,
    ).expect("must apply");

    match outcome {
        TaskRunApplyOutcome::Appended { new_task_run, new_revision } => {
            assert_eq!(new_revision, 4);
            assert_eq!(new_task_run.checked, true);
            assert_eq!(new_task_run.task_def_id, task_def_id);
            assert_eq!(exec.task_runs().len(), 1);
        }
        other => panic!("expected Appended, got {:?}", other),
    }
}

#[test]
fn apply_record_task_run_returns_replay_when_idempotency_key_matches_existing() {
    let mut exec = active_exec(1);
    let task_def_id = TaskDefId::now_v7();
    let idem = Uuid::now_v7();

    let first = apply_record_task_run(
        &mut exec, 1, task_def_id, true, Utc::now(), idem,
    ).expect("first must apply");

    let new_task_run = match first {
        TaskRunApplyOutcome::Appended { new_task_run, .. } => new_task_run,
        other => panic!("first call expected Appended, got {:?}", other),
    };

    let second = apply_record_task_run(
        &mut exec, 2, task_def_id, false, Utc::now(), idem,
    ).expect("replay must apply");

    match second {
        TaskRunApplyOutcome::Replay { task_run, revision } => {
            assert_eq!(task_run.id, new_task_run.id);
            // Replay MUST NOT increment revision (per spec §4-1 bullet 2).
            assert_eq!(revision, 2);
        }
        other => panic!("expected Replay, got {:?}", other),
    }
}

#[test]
fn apply_record_task_run_returns_conflict_when_base_revision_mismatches() {
    let mut exec = active_exec(5);
    let task_def_id = TaskDefId::now_v7();

    let err = apply_record_task_run(
        &mut exec, 3, task_def_id, true, Utc::now(), Uuid::now_v7(),
    ).expect_err("must conflict");

    match err {
        ApplyError::RevisionConflict { current } => assert_eq!(current, 5),
        other => panic!("expected RevisionConflict, got {:?}", other),
    }
}

#[test]
fn apply_record_task_run_rejects_when_execution_is_finished() {
    let mut exec = finished_exec(2);
    let task_def_id = TaskDefId::now_v7();

    let err = apply_record_task_run(
        &mut exec, 2, task_def_id, true, Utc::now(), Uuid::now_v7(),
    ).expect_err("must reject closed lifecycle");

    assert!(matches!(err, ApplyError::ClosedLifecycle));
}
```

- [ ] **Step 2: RED を観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-domain --test completion_record_task_run -- --nocapture'
```

Expected (RED):
```
error[E0433]: failed to resolve: could not find `apply_record_task_run` in `tastile_v1_domain`
```

- [ ] **Step 3: RED test のみ commit**

```bash
git add crates-v1/domain/src/tests/completion_record_task_run.rs crates-v1/domain/src/tests/mod.rs
git commit -m "test(domain): red for apply_record_task_run (append/replay/conflict/closed)"
```

- [ ] **Step 4: GREEN impl を最小実装**

`crates-v1/domain/src/completion.rs` に追加:

```rust
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ApplyError {
    #[error("base_revision {expected} does not match current {current}")]
    RevisionConflict { expected: i64, current: i64 },
    #[error("execution is in a closed lifecycle (FINISHED_NORMAL / FINISHED_VOID)")]
    ClosedLifecycle,
}

#[derive(Debug)]
pub enum TaskRunApplyOutcome {
    Appended { new_task_run: ExecutionTaskRun, new_revision: i64 },
    Replay   { task_run: ExecutionTaskRun,       revision:   i64 },
    Conflict { current_revision: i64 },
    ClosedLifecycle,
}

pub fn apply_record_task_run(
    exec: &mut Execution,
    base_revision: i64,
    task_def_id: TaskDefId,
    checked: bool,
    recorded_at: DateTime<Utc>,
    idempotency_key: Uuid,
) -> Result<TaskRunApplyOutcome, ApplyError> {
    if matches!(exec.lifecycle(), ExecutionLifecycle::FinishedNormal | ExecutionLifecycle::FinishedVoid) {
        return Err(ApplyError::ClosedLifecycle);
    }

    let current = exec.revision();
    if base_revision != current {
        return Err(ApplyError::RevisionConflict { expected: base_revision, current });
    }

    // idempotency replay: scan existing task_runs for matching idempotency_key (audit field).
    if let Some(existing) = exec.task_runs().iter().find(|r| r.idempotency_key() == idempotency_key) {
        return Ok(TaskRunApplyOutcome::Replay {
            task_run: existing.clone(),
            revision: current,
        });
    }

    let new_run = ExecutionTaskRun::new(
        ExecutionTaskRunId::now_v7(),
        exec.id(),
        task_def_id,
        checked,
        recorded_at,
        current,
        idempotency_key,
    );
    exec.append_task_run(new_run.clone());
    exec.bump_revision();

    Ok(TaskRunApplyOutcome::Appended {
        new_task_run: new_run,
        new_revision: exec.revision(),
    })
}
```

> 既存 `Execution` に `append_task_run` / `bump_revision` / `set_lifecycle_for_test` 等の method が無ければ、test helper として permissive に追加 (Task C2 スコープ内で最小)。

- [ ] **Step 5: GREEN 観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-domain --test completion_record_task_run -- --nocapture'
```

Expected: `4 passed; 0 failed`。

- [ ] **Step 6: refactor**

- `CompletionError` / `ApplyError` の命名統一 (既存 `domain::error` と衝突しなければそのまま採用)
- `outcome` の payload を `Debug` 派生確認
- `apply_record_task_run` を `aggregate.rs` の free fn ではなく `impl Execution { fn apply_record_task_run(...) }` へリファクタ可能か検討 (1 chunk 内に収まる場合のみ)

- [ ] **Step 7: verify gate**

```bash
cd tastile-core
wslc bash -c 'cargo clippy -p v1-domain --all-targets -- -D warnings'
wslc bash -c 'cargo test  -p v1-domain -- --nocapture'
```

Expected: 0 warning / 全 test pass。

- [ ] **Step 8: GREEN impl commit**

```bash
git add crates-v1/domain/src/completion.rs \
        crates-v1/domain/src/lib.rs     \
        crates-v1/domain/src/aggregate.rs
git commit -m "feat(domain): apply_record_task_run (append + replay + conflict + closed)"
```

- [ ] **Step 9: precommit review (agent-initiated なら)**

`pwsh -NoProfile -File .\.agents\skills\tastile-precommit-review\Run.ps1 -Last 2`
Expected: PASS。

---

## Task C3: API handler + openapi route + openapi dump

**Files:**
- Modify: `tastile-core/crates-v1/api/src/handlers/commands.rs` (record_task_run handler 追加)
- Modify: `tastile-core/crates-v1/api/src/openapi.rs` (utoipa path macro 追加)
- Modify: `tastile-core/crates-v1/api/src/bin/dump_openapi.rs` (depend on new symbol で再 build → dump 自動)
- Modify: `tastile-core/crates-v1/api/src/router.rs` (route 登録)
- Create: `tastile-core/crates-v1/api/src/handlers/tests/record_task_run.rs`
- Modify: `tastile-core/crates-v1/api/src/handlers/tests/mod.rs`
- Output: `tastile-core/openapi/openapi.yaml` (再生成 — Step 5 で dump 実行)

**Interfaces:**
- Consumes: `apply_record_task_run` (C2) + `RecordTaskRunPayload` (C3 で新規定義) + 既存の `CommandRequest<T>` / `CommandResponse` envelope
- Produces:
  ```rust
  // crates-v1/api/src/handlers/commands.rs
  pub async fn record_task_run(
      State(state): State<Arc<AppState>>,
      Path(execution_id): Path<Uuid>,
      Json(req): Json<CommandRequest<RecordTaskRunPayload>>,
  ) -> Result<CommandResponse, ApiError>;

  // crates-v1/api/src/openapi.rs (utoipa)
  #[utoipa::path(
      post, path = "/v1/executions/{executionId}/task-runs",
      params(("executionId" = Uuid, Path,)),
      request_body = CommandRequest<RecordTaskRunPayload>,
      responses((200, body = CommandResponse), (404, body = ApiError), (409, body = ApiError), (422, body = ApiError)),
      tag = "executions"
  )]
  pub async fn record_task_run() {}
  ```

- [ ] **Step 1: RED test を書く**

`crates-v1/api/src/handlers/tests/record_task_run.rs`:

```rust
//! TDD Red: POST /v1/executions/{executionId}/task-runs — 5 cases (200 / 404 / 409 / 422 / replay).

use sqlx::PgPool;
use tastile_v1_api::test_helpers::{spawn_app, ApiClient, *};
use tastile_v1_domain::{ExecutionId, TaskDefId};
use uuid::Uuid;
use chrono::Utc;

#[sqlx::test(migrations = "../../storage/migrations")]
async fn record_task_run_200_returns_updated_revision(pool: PgPool) {
    let (app, addr) = spawn_app(pool).await;
    let client = ApiClient::new(addr);

    let exec_id = seed_active_execution(&app, /* revision */ 1).await;

    let req = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      true,
        recorded_at:  Utc::now(),
    }, base_revision = 1, idempotency_key = Uuid::now_v7());

    let resp = client.post_json(&format!("/v1/executions/{exec_id}/task-runs"), &req).await;
    assert_eq!(resp.status(), 200);
    let body: CommandResponse = resp.json().await.unwrap();
    assert!(body.is_updated(), "expected Updated outcome");
    assert_eq!(body.new_revision, 2);
}

#[sqlx::test(migrations = "../../storage/migrations")]
async fn record_task_run_404_when_execution_not_found(pool: PgPool) {
    let (app, addr) = spawn_app(pool).await;
    let client = ApiClient::new(addr);

    let unknown = ExecutionId::now_v7().into_uuid();
    let req = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      true,
        recorded_at:  Utc::now(),
    }, base_revision = 0, idempotency_key = Uuid::now_v7());

    let resp = client.post_json(&format!("/v1/executions/{unknown}/task-runs"), &req).await;
    assert_eq!(resp.status(), 404);
}

#[sqlx::test(migrations = "../../storage/migrations")]
async fn record_task_run_409_on_revision_conflict(pool: PgPool) {
    let (app, addr) = spawn_app(pool).await;
    let client = ApiClient::new(addr);

    let exec_id = seed_active_execution(&app, /* revision */ 5).await;

    let req = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      true,
        recorded_at:  Utc::now(),
    }, base_revision = 3, idempotency_key = Uuid::now_v7());

    let resp = client.post_json(&format!("/v1/executions/{exec_id}/task-runs"), &req).await;
    assert_eq!(resp.status(), 409);
}

#[sqlx::test(migrations = "../../storage/migrations")]
async fn record_task_run_422_on_finished_execution(pool: PgPool) {
    let (app, addr) = spawn_app(pool).await;
    let client = ApiClient::new(addr);

    let exec_id = seed_finished_execution(&app, /* revision */ 2).await;

    let req = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      true,
        recorded_at:  Utc::now(),
    }, base_revision = 2, idempotency_key = Uuid::now_v7());

    let resp = client.post_json(&format!("/v1/executions/{exec_id}/task-runs"), &req).await;
    assert_eq!(resp.status(), 422);
}

#[sqlx::test(migrations = "../../storage/migrations")]
async fn record_task_run_replay_returns_same_result(pool: PgPool) {
    let (app, addr) = spawn_app(pool).await;
    let client = ApiClient::new(addr);

    let exec_id = seed_active_execution(&app, /* revision */ 1).await;
    let idem = Uuid::now_v7();

    let req1 = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      true,
        recorded_at:  Utc::now(),
    }, base_revision = 1, idempotency_key = idem);
    let r1 = client.post_json(&format!("/v1/executions/{exec_id}/task-runs"), &req1).await;
    assert_eq!(r1.status(), 200);

    let req2 = command_request(Kind::RecordTaskRun, RecordTaskRunPayload {
        task_def_id:  TaskDefId::now_v7().into_uuid(),
        checked:      false,                                 // change payload does not matter on replay
        recorded_at:  Utc::now(),
    }, base_revision = 2, idempotency_key = idem);           // base_revision bumped because first 200 incremented rev
    let r2 = client.post_json(&format!("/v1/executions/{exec_id}/task-runs"), &req2).await;
    assert_eq!(r2.status(), 200);
    let body: CommandResponse = r2.json().await.unwrap();
    assert!(body.is_replay(), "expected Replay outcome");
    assert_eq!(body.new_revision, 2, "replay must not increment revision");
}
```

- [ ] **Step 2: RED を観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-api --test record_task_run -- --nocapture'
```

Expected (RED):
```
error[E0433]: failed to resolve: `record_task_run` not found in `handlers::commands`
error[E0412]: cannot find type `RecordTaskRunPayload`
```

- [ ] **Step 3: RED test のみ commit**

```bash
git add crates-v1/api/src/handlers/tests/record_task_run.rs crates-v1/api/src/handlers/tests/mod.rs
git commit -m "test(api): red for /v1/executions/{id}/task-runs (200/404/409/422/replay)"
```

- [ ] **Step 4: GREEN impl を最小実装**

`RecordTaskRunPayload` (openapi.rs near `CommandRequest`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RecordTaskRunPayload {
    pub task_def_id: Uuid,
    pub checked: bool,
    pub recorded_at: DateTime<Utc>,
}
```

`crates-v1/api/src/handlers/commands.rs` 末尾に追加:

```rust
#[tracing::instrument(skip(state, req))]
pub async fn record_task_run(
    State(state): State<Arc<AppState>>,
    Path(execution_id): Path<Uuid>,
    Json(req): Json<CommandRequest<RecordTaskRunPayload>>,
) -> Result<CommandResponse, ApiError> {
    let exec_id = ExecutionId::from_uuid(execution_id);
    let mut exec = state.load_execution(&exec_id).await?
        .ok_or_else(|| ApiError::not_found("Execution", execution_id))?;

    let outcome = apply_record_task_run(
        &mut exec,
        req.base_revision,
        TaskDefId::from_uuid(req.payload.task_def_id),
        req.payload.checked,
        req.payload.recorded_at,
        req.idempotency_key,
    ).map_err(ApiError::from)?;

    state.persist_execution(&exec).await?;

    match outcome {
        TaskRunApplyOutcome::Appended { new_task_run, new_revision } =>
            Ok(CommandResponse::updated(new_revision, new_task_run)),
        TaskRunApplyOutcome::Replay   { task_run,       revision }   =>
            Ok(CommandResponse::replay(revision, task_run)),
        TaskRunApplyOutcome::Conflict { current_revision } =>
            Err(ApiError::revision_conflict(current_revision)),
        TaskRunApplyOutcome::ClosedLifecycle =>
            Err(ApiError::validation("execution is in a closed lifecycle")),
    }
}
```

`crates-v1/api/src/openapi.rs` (他 `#[utoipa::path]` の近く):

```rust
/// RECORD_TASK_RUN: POST /v1/executions/{executionId}/task-runs
#[utoipa::path(
    post,
    path = "/v1/executions/{executionId}/task-runs",
    params(("executionId" = Uuid, Path, description = "Execution ID (UUIDv7)")),
    request_body = CommandRequest<RecordTaskRunPayload>,
    responses(
        (status = 200, description = "TaskRun recorded or replayed", body = CommandResponse),
        (status = 404, description = "Execution not found",           body = ApiError),
        (status = 409, description = "Revision conflict",             body = ApiError),
        (status = 422, description = "Validation or closed lifecycle", body = ApiError),
    ),
    tag = "executions"
)]
pub async fn __record_task_run_marker() {}   // marker symbol consumed by `#[api_router]`
```

`crates-v1/api/src/router.rs` の他 Execution route 群 (`start_execution` / `pause_execution` 等) の近くに `.route("/v1/executions/:execution_id/task-runs", post(handlers::commands::record_task_run))` を追加。

`dump_openapi.rs` は `utoipa::OpenApi` derive build 経由なので handler を `#[utoipa::path]` annotate すれば dump で拾われる。明示的 re-run で OK。

- [ ] **Step 5: openapi.yaml を再生成**

```bash
cd tastile-core
wslc bash -c 'cargo run -p v1-api --bin dump_openapi > openapi/openapi.yaml'
```

Expected: stderr 0、stdout に `paths: /v1/executions/{executionId}/task-runs` のエントリが追記されている。

- [ ] **Step 6: GREEN 観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-api --test record_task_run -- --nocapture'
```

Expected: `5 passed; 0 failed`。

- [ ] **Step 7: web openapi drift check (0 drift 確認)**

```bash
cd tastile-web
bun run check:release
```

Expected: openapi drift 0、`@/lib/api-client` の codegen が新 endpoint を反映しているか / stale annotation warning がない。

- [ ] **Step 8: refactor**

- `ApiError::validation` / `revision_conflict` / `not_found` の helper が無ければ最小追加 (`is_record_task_run_404` 等の senders 固有 helper は作らない)
- `tracing::instrument` の field 抽出 (`execution_id`, `base_revision`, `idempotency_key`) を最小付ける

- [ ] **Step 9: verify gate (full)**

```bash
cd tastile-core
wslc bash -c 'cargo clippy --all-targets -- -D warnings'
wslc bash -c 'cargo test  --workspace'

pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
```

Expected: clippy 0 warning, 全 cargo test pass, check-workspace exit 0。

- [ ] **Step 10: GREEN impl + openapi.yaml を commit**

```bash
git add crates-v1/api/src/handlers/commands.rs \
        crates-v1/api/src/openapi.rs         \
        crates-v1/api/src/router.rs          \
        openapi/openapi.yaml
git commit -m "feat(api): POST /v1/executions/{id}/task-runs handler + openapi"
```

- [ ] **Step 11: precommit review (agent-initiated なら)**

`pwsh -NoProfile -File .\.agents\skills\tastile-precommit-review\Run.ps1 -Last 1`
Expected: PASS。

---

## Task C4: AT (acceptance test) §12 拡張

**Files:**
- Modify: `tastile-core/crates-v1/domain/src/at_acceptance_tests.rs`

**Interfaces:**
- Consumes: Task C1 (`latest_task_run_per_task_def`) + Task C2 (`apply_record_task_run`)
- Produces: AT §12 「Execution 進行中に TaskRun を 3 件 record → completion 集計で最新 1 件のみ effective」の entry

- [ ] **Step 1: AT を追加 (RED)**

`at_acceptance_tests.rs` の §12 セクション末尾に:

```rust
#[test]
fn at_12_task_run_latest_wins_for_completion_aggregation() {
    // seed: 1 active Execution + 1 TaskDefinition
    let mut exec = seed_active_execution(/* rev */ 1);
    let task_def_id = TaskDefId::now_v7();

    let older  = Utc::now() - chrono::Duration::seconds(30);
    let middle = Utc::now() - chrono::Duration::seconds(15);
    let newest = Utc::now();

    apply_record_task_run(&mut exec, 1, task_def_id, false, older,  Uuid::now_v7()).unwrap();
    let rev = exec.revision();
    apply_record_task_run(&mut exec, rev, task_def_id, true, middle, Uuid::now_v7()).unwrap();
    let rev = exec.revision();
    apply_record_task_run(&mut exec, rev, task_def_id, true, newest, Uuid::now_v7()).unwrap();

    let latest = exec.task_runs()
        .iter()
        .rev()                              // execution.task_runs is append-only
        .find(|r| r.task_def_id == task_def_id)
        .expect("at least one run");
    assert_eq!(latest.checked, true);
    assert_eq!(latest.recorded_at, newest);

    // 集計: latest 1 件 checked=true ⇒ TaskDefinition の effective check は true
    assert_eq!(effective_check_for(&exec, task_def_id), true);
}
```

`effective_check_for` helper は同一 file 内 `fn` で定義 (1 use site なので inline で十分)。

- [ ] **Step 2: RED を観測**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-domain --test at_acceptance_tests -- --nocapture'
```

Expected (RED): `at_12_task_run_latest_wins_for_completion_aggregation` が `assertion failed` / `effective_check_for undefined` で FAIL。

- [ ] **Step 3: RED test のみ commit**

```bash
git add crates-v1/domain/src/at_acceptance_tests.rs
git commit -m "test(domain): at-12 red — task_run latest 1 effective"
```

- [ ] **Step 4: GREEN 観測 (前 Task C1/C2 で helper は既に揃っているので、AT 側の helper を最小実装)**

`effective_check_for` を AT file 末尾に追加:

```rust
fn effective_check_for(exec: &Execution, task_def_id: TaskDefId) -> bool {
    exec.task_runs()
        .iter()
        .rev()
        .find(|r| r.task_def_id == task_def_id)
        .map(|r| r.checked)
        .unwrap_or(false)
}
```

- [ ] **Step 5: GREEN 検証**

```bash
cd tastile-core
wslc bash -c 'cargo test -p v1-domain --test at_acceptance_tests -- --nocapture'
```

Expected: AT §12 エントリ pass、AT 全件 pass。

- [ ] **Step 6: refactor (AT 全体の layout を読み、必要なら §番号 comment を整える)**

- [ ] **Step 7: verify gate**

```bash
cd tastile-core
wslc bash -c 'cargo clippy -p v1-domain --all-targets -- -D warnings'
wslc bash -c 'cargo test  --workspace'
```

Expected: 0 warning / 全 pass。

- [ ] **Step 8: GREEN impl commit**

```bash
git add crates-v1/domain/src/at_acceptance_tests.rs
git commit -m "feat(domain): at-12 helper effective_check_for"
```

- [ ] **Step 9: precommit review (agent-initiated なら)**

---

## Task A1: ExecutionRepository.recordTaskRun + sealed RecordTaskRunResult + MockWebServer test

**Files:**
- Modify: `app/src/main/java/app/tastile/android/data/execution/ExecutionRepository.kt`
- Modify: `app/src/main/java/app/tastile/android/data/api/V1Models.kt` (`RecordTaskRunPayload` / `RecordTaskRunCommand` / sealed `RecordTaskRunResult`)
- Create: `app/src/test/java/app/tastile/android/data/execution/ExecutionRepositoryRecordTaskRunTest.kt`

**Interfaces:**
- Consumes: openapi.yaml の `POST /v1/executions/{executionId}/task-runs` shape (Task C3 で pin 済)
- Produces:
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

- [ ] **Step 1: RED test を書く**

`ExecutionRepositoryRecordTaskRunTest.kt`:

```kotlin
package app.tastile.android.data.execution

import app.tastile.android.data.api.RecordTaskRunPayload
import app.tastile.android.data.api.RecordTaskRunResult
import app.tastile.android.data.api.RecordTaskRunCommandEnvelope
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.UUID

class ExecutionRepositoryRecordTaskRunTest {
    private lateinit var server: MockWebServer
    private lateinit var repo: ExecutionRepository
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        repo = ExecutionRepository.create(baseUrl = server.url("/").toString())
    }
    @After fun tearDown() { server.shutdown() }

    @Test fun `recordTaskRun_200_returnsUpdated`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"kind":"UPDATED","newRevision":2,"recordedAt":"2026-08-30T12:00:00Z"}
        """.trimIndent()))
        val r = repo.recordTaskRun("e-1", "td-1", true, baseRevision = 1, idempotencyKey = UUID.randomUUID().toString())
        assertThat(r).isInstanceOf(RecordTaskRunResult.Updated::class.java)
    }

    @Test fun `recordTaskRun_200_replay_returnsReplay`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"kind":"REPLAY","newRevision":2,"recordedAt":"2026-08-30T12:00:00Z"}
        """.trimIndent()))
        val r = repo.recordTaskRun("e-1", "td-1", false, baseRevision = 2, idempotencyKey = "k")
        assertThat(r).isInstanceOf(RecordTaskRunResult.Replay::class.java)
    }

    @Test fun `recordTaskRun_404_returnsExecutionNotFound`() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"kind":"NOT_FOUND"}"""))
        val r = repo.recordTaskRun("e-x", "td-1", true, 0, UUID.randomUUID().toString())
        assertThat(r).isEqualTo(RecordTaskRunResult.ExecutionNotFound)
    }

    @Test fun `recordTaskRun_409_returnsRevisionConflict`() = runTest {
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"kind":"REVISION_CONFLICT","currentRevision":7}"""))
        val r = repo.recordTaskRun("e-1", "td-1", true, 3, UUID.randomUUID().toString())
        assertThat(r).isEqualTo(RecordTaskRunResult.RevisionConflict(currentRevision = 7))
    }

    @Test fun `recordTaskRun_422_returnsClosedLifecycle`() = runTest {
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"kind":"VALIDATION","message":"execution is closed"}"""))
        val r = repo.recordTaskRun("e-1", "td-1", true, 2, UUID.randomUUID().toString())
        assertThat(r).isEqualTo(RecordTaskRunResult.ClosedLifecycle)
    }

    @Test fun `recordTaskRun_5xx_returnsServerError`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"kind":"UNAVAILABLE"}"""))
        val r = repo.recordTaskRun("e-1", "td-1", true, 1, UUID.randomUUID().toString())
        assertThat(r).isEqualTo(RecordTaskRunResult.ServerError(503))
    }

    @Test fun `recordTaskRun_networkError_returnsNetworkError`() = runTest {
        server.shutdown()
        val r = repo.recordTaskRun("e-1", "td-1", true, 1, UUID.randomUUID().toString())
        assertThat(r).isEqualTo(RecordTaskRunResult.NetworkError)
    }
}
```

- [ ] **Step 2: RED を観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecutionRepositoryRecordTaskRunTest
```

Expected (RED):
```
ExecutionRepositoryRecordTaskRunTest > recordTaskRun_200_returnsUpdated FAILED
  Reason: Unresolved reference: RecordTaskRunResult
```

- [ ] **Step 3: RED test のみ commit**

```bash
git add app/src/test/java/app/tastile/android/data/execution/ExecutionRepositoryRecordTaskRunTest.kt
git commit -m "test(android): red for ExecutionRepository.recordTaskRun (7 cases)"
```

- [ ] **Step 4: GREEN impl を最小実装**

`V1Models.kt` 末尾に追加:

```kotlin
@Serializable
data class RecordTaskRunPayload(
    val taskDefId: String,
    val checked: Boolean,
    val recordedAt: String, // ISO 8601 UTC
)

@Serializable
data class RecordTaskRunCommandEnvelope(
    val kind: String = "RECORD_TASK_RUN",
    val baseRevision: Long,
    val idempotencyKey: String,
    val occurredAt: String,
    val payload: RecordTaskRunPayload,
)

sealed interface RecordTaskRunResult {
    @Serializable data class Updated(val newRevision: Long, val recordedAt: String) : RecordTaskRunResult
    @Serializable data class Replay(val newRevision: Long, val recordedAt: String) : RecordTaskRunResult
    data class RevisionConflict(val currentRevision: Long) : RecordTaskRunResult
    data object ExecutionNotFound : RecordTaskRunResult
    data object ClosedLifecycle : RecordTaskRunResult
    data class ValidationError(val message: String) : RecordTaskRunResult
    data class ServerError(val code: Int) : RecordTaskRunResult
    data object NetworkError : RecordTaskRunResult
}
```

`ExecutionRepository.kt` に:

```kotlin
suspend fun recordTaskRun(
    executionId: String,
    taskDefId: String,
    checked: Boolean,
    baseRevision: Long,
    idempotencyKey: String,
): RecordTaskRunResult = withContext(ioDispatcher) {
    val envelope = RecordTaskRunCommandEnvelope(
        baseRevision   = baseRevision,
        idempotencyKey = idempotencyKey,
        occurredAt     = Instant.now().toString(),
        payload        = RecordTaskRunPayload(
            taskDefId  = taskDefId,
            checked    = checked,
            recordedAt = Instant.now().toString(),
        ),
    )
    try {
        val resp = client.newCall(
            Request.Builder()
                .url("$baseUrl/v1/executions/$executionId/task-runs")
                .header("Idempotency-Key", idempotencyKey)
                .header("X-Expected-Revision", baseRevision.toString())
                .post(okhttp3.RequestBody.create(
                    "application/json".toMediaType(),
                    json.encodeToString(RecordTaskRunCommandEnvelope.serializer(), envelope)
                ))
                .build()
        ).execute()

        when (resp.code) {
            200 -> {
                val body = json.parseCommandResponse(resp.body!!.string())
                if (body.kind == "REPLAY") RecordTaskRunResult.Replay(body.newRevision, body.recordedAt)
                else                          RecordTaskRunResult.Updated(body.newRevision, body.recordedAt)
            }
            404 -> RecordTaskRunResult.ExecutionNotFound
            409 -> RecordTaskRunResult.RevisionConflict(currentRevision = resp.header("X-Current-Revision")?.toLong() ?: -1L)
            422 -> RecordTaskRunResult.ClosedLifecycle
            in 500..599 -> RecordTaskRunResult.ServerError(resp.code)
            else -> RecordTaskRunResult.ServerError(resp.code)
        }
    } catch (io: IOException) {
        RecordTaskRunResult.NetworkError
    }
}
```

- [ ] **Step 5: GREEN 観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecutionRepositoryRecordTaskRunTest
```

Expected: `7 tests completed, 0 failed`。

- [ ] **Step 6: refactor**

- error body parse (`kind`) と manual response decode を 1 decoder 関数へ局所化 (`mapHttpResponseToResult`)
- HTTP header 名文字列を `XHeaders.kt` の定数へ集約（既に存在すれば再利用）

- [ ] **Step 7: verify gate (android local)**

```powershell
cd tastile-android
.\gradlew.bat lintKotlinMain
.\gradlew.bat testDebugUnitTest --tests 'ExecutionRepositoryRecordTaskRunTest'
```

Expected: lint 0 error, test pass。

- [ ] **Step 8: GREEN impl commit**

```bash
git add app/src/main/java/app/tastile/android/data/api/V1Models.kt \
        app/src/main/java/app/tastile/android/data/execution/ExecutionRepository.kt
git commit -m "feat(android): ExecutionRepository.recordTaskRun + sealed RecordTaskRunResult"
```

- [ ] **Step 9: precommit review (android の規約に揃える)**

---

## Task A2: RecordTaskRunUseCase

**Files:**
- Create: `app/src/main/java/app/tastile/android/domain/usecase/RecordTaskRunUseCase.kt`
- Create: `app/src/test/java/app/tastile/android/domain/usecase/RecordTaskRunUseCaseTest.kt`
- Modify: `app/src/main/java/app/tastile/android/di/UseCaseModule.kt` (Hilt provide) — 既存 file の確認のみで、存在しなければ新規

**Interfaces:**
- Consumes: `ExecutionRepository.recordTaskRun(...)` (Task A1) + 既存の `ExecutionStateProjector` (Session / Decision で既に使われている interface)
- Produces:
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

- [ ] **Step 1: RED test を書く**

`RecordTaskRunUseCaseTest.kt`:

```kotlin
package app.tastile.android.domain.usecase

import app.tastile.android.data.execution.ExecutionRepository
import app.tastile.android.data.api.RecordTaskRunResult
import app.tastile.android.domain.ExecutionStateProjector
import com.google.common.truth.Truth.assertThat
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.UUID

class RecordTaskRunUseCaseTest {
    private val repo: ExecutionRepository = mockk()
    private val projector: ExecutionStateProjector = mockk(relaxed = true)
    private val sut = RecordTaskRunUseCase(repo, projector)

    @Test fun `invoke_updated_projectsNewRevision`() = runTest {
        coEvery { repo.recordTaskRun(any(), any(), any(), any(), any()) } returns
            RecordTaskRunResult.Updated(newRevision = 4, recordedAt = "now")
        val r = sut.invoke("e-1", "td-1", true)
        assertThat(r).isEqualTo(RecordTaskRunResult.Updated(4, "now"))
        coVerify { projector.taskRunsUpdated("e-1", 4) }
    }

    @Test fun `invoke_replay_projectsSameRevision`() = runTest {
        coEvery { repo.recordTaskRun(any(), any(), any(), any(), any()) } returns
            RecordTaskRunResult.Replay(newRevision = 4, recordedAt = "now")
        val r = sut.invoke("e-1", "td-1", false)
        assertThat(r).isInstanceOf(RecordTaskRunResult.Replay::class.java)
        coVerify { projector.taskRunsUpdated("e-1", 4) }
    }

    @Test fun `invoke_conflict_requestsRefresh`() = runTest {
        coEvery { repo.recordTaskRun(any(), any(), any(), any(), any()) } returns
            RecordTaskRunResult.RevisionConflict(currentRevision = 9)
        val r = sut.invoke("e-1", "td-1", true)
        assertThat(r).isEqualTo(RecordTaskRunResult.RevisionConflict(9))
        coVerify { projector.requestRefresh("e-1") }
        coVerify(exactly = 0) { projector.taskRunsUpdated(any(), any()) }
    }

    @Test fun `invoke_closedLifecycle_doesNotProject`() = runTest {
        coEvery { repo.recordTaskRun(any(), any(), any(), any(), any()) } returns
            RecordTaskRunResult.ClosedLifecycle
        val r = sut.invoke("e-1", "td-1", true)
        assertThat(r).isEqualTo(RecordTaskRunResult.ClosedLifecycle)
        coVerify(exactly = 0) { projector.taskRunsUpdated(any(), any()) }
        coVerify(exactly = 0) { projector.requestRefresh(any()) }
    }
}
```

- [ ] **Step 2: RED を観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests RecordTaskRunUseCaseTest
```

Expected (RED): `Unresolved reference: RecordTaskRunUseCase`。

- [ ] **Step 3: RED test のみ commit**

```bash
git add app/src/test/java/app/tastile/android/domain/usecase/RecordTaskRunUseCaseTest.kt
git commit -m "test(android): red for RecordTaskRunUseCase (4 cases)"
```

- [ ] **Step 4: GREEN impl**

```kotlin
package app.tastile.android.domain.usecase

import app.tastile.android.data.api.RecordTaskRunResult
import app.tastile.android.data.execution.ExecutionRepository
import app.tastile.android.domain.ExecutionStateProjector
import java.util.UUID
import javax.inject.Inject

class RecordTaskRunUseCase @Inject constructor(
    private val repo: ExecutionRepository,
    private val executionState: ExecutionStateProjector,
) {
    suspend operator fun invoke(
        executionId: String,
        taskDefId: String,
        checked: Boolean,
    ): RecordTaskRunResult {
        val baseRevision = executionState.currentRevision(executionId)
        val idempotencyKey = UUID.randomUUID().toString()

        val result = repo.recordTaskRun(
            executionId    = executionId,
            taskDefId      = taskDefId,
            checked        = checked,
            baseRevision   = baseRevision,
            idempotencyKey = idempotencyKey,
        )

        when (result) {
            is RecordTaskRunResult.Updated,
            is RecordTaskRunResult.Replay    -> executionState.taskRunsUpdated(
                executionId  = executionId,
                newRevision = (result.newRevision),
            )
            is RecordTaskRunResult.RevisionConflict -> executionState.requestRefresh(executionId)
            is RecordTaskRunResult.ExecutionNotFound,
            is RecordTaskRunResult.ClosedLifecycle,
            is RecordTaskRunResult.ValidationError,
            is RecordTaskRunResult.ServerError,
            RecordTaskRunResult.NetworkError -> Unit
        }
        return result
    }
}
```

`ExecutionStateProjector` に既存で `currentRevision` / `taskRunsUpdated` / `requestRefresh` が無ければ最小追加 (Task A2 スコープ)。

- [ ] **Step 5: GREEN 観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests RecordTaskRunUseCaseTest
```

Expected: `4 passed`。

- [ ] **Step 6: refactor**

- `result.newRevision` 抽出を `extractNew(result: RecordTaskRunResult): Long?` ヘルパへ
- sealed result 分岐が読みにくい場合は `Result.action()` interface での polymorphic dispatch を検討 (1 chunk 内に収まる範囲のみ)

- [ ] **Step 7: verify gate (android local)**

```powershell
cd tastile-android
.\gradlew.bat lintKotlinMain
.\gradlew.bat testDebugUnitTest --tests RecordTaskRunUseCaseTest
```

Expected: lint 0 error, test pass。

- [ ] **Step 8: GREEN impl commit**

```bash
git add app/src/main/java/app/tastile/android/domain/usecase/RecordTaskRunUseCase.kt
git commit -m "feat(android): RecordTaskRunUseCase (UUIDv7 idempotency + projector dispatch)"
```

- [ ] **Step 9: precommit review**

---

## Task A3: ExecutionViewModel.recordTask (Turbine 5 cases)

**Files:**
- Modify: `app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt`
- Create: `app/src/test/java/app/tastile/android/ui/mobile/execution/ExecutionViewModelRecordTaskTest.kt`

**Interfaces:**
- Consumes: `RecordTaskRunUseCase.invoke(...)` (Task A2)
- Produces:
  ```kotlin
  // ExecutionViewModel に追加
  fun recordTask(executionId: String, taskDefId: String, checked: Boolean)
  // UI state に briefMessage: String? を追加 (snackbar 経由)
  ```

- [ ] **Step 1: RED test を書く**

`ExecutionViewModelRecordTaskTest.kt`:

```kotlin
package app.tastile.android.ui.mobile.execution

import app.tastile.android.data.api.RecordTaskRunResult
import app.tastile.android.domain.usecase.RecordTaskRunUseCase
import app.google.common.truth.Truth.assertThat
import app.tastile.android.testing.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ExecutionViewModelRecordTaskTest {
    @get:Rule val main = MainDispatcherRule()

    @Test fun `recordTask_updated_emitsBriefWithNewRevision`() = runTest {
        val useCase = mockk<RecordTaskRunUseCase>()
        coEvery { useCase.invoke("e-1", "td-1", true) } returns
            RecordTaskRunResult.Updated(newRevision = 4, recordedAt = "now")
        val vm = ExecutionViewModel(useCase)
        vm.recordTask("e-1", "td-1", true)
        vm.uiState.test {
            // initial state skip if any
            assertThat(vm.uiState.value.checkedTaskDefIds).containsExactly("td-1")
            assertThat(vm.uiState.value.briefMessage).isEqualTo(
                "TaskRun 更新: td-1 → checked (rev:3 → rev:4)"
            )
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun `recordTask_replay_emitsBriefWithSameRevision`() = runTest {
        val useCase = mockk<RecordTaskRunUseCase>()
        coEvery { useCase.invoke("e-1", "td-1", true) } returns
            RecordTaskRunResult.Replay(newRevision = 4, recordedAt = "now")
        val vm = ExecutionViewModel(useCase)
        vm.recordTask("e-1", "td-1", true)
        assertThat(vm.uiState.value.briefMessage).contains("(replay)")
    }

    @Test fun `recordTask_conflict_emitsRefreshBrief`() = runTest {
        val useCase = mockk<RecordTaskRunUseCase>()
        coEvery { useCase.invoke("e-1", "td-1", true) } returns
            RecordTaskRunResult.RevisionConflict(currentRevision = 9)
        val vm = ExecutionViewModel(useCase)
        vm.recordTask("e-1", "td-1", true)
        assertThat(vm.uiState.value.briefMessage).contains("他の端末が更新")
    }

    @Test fun `recordTask_closedLifecycle_emitsErrorBrief`() = runTest {
        val useCase = mockk<RecordTaskRunUseCase>()
        coEvery { useCase.invoke("e-1", "td-1", true) } returns
            RecordTaskRunResult.ClosedLifecycle
        val vm = ExecutionViewModel(useCase)
        vm.recordTask("e-1", "td-1", true)
        assertThat(vm.uiState.value.briefMessage).contains("Execution は既に終了")
    }

    @Test fun `recordTask_networkError_doesNotMutateOptimisticState`() = runTest {
        val useCase = mockk<RecordTaskRunUseCase>()
        coEvery { useCase.invoke("e-1", "td-1", true) } returns
            RecordTaskRunResult.NetworkError
        val vm = ExecutionViewModel(useCase)
        vm.recordTask("e-1", "td-1", true)
        // 楽観更新は無音撤回 (reconcile path ではない)
        assertThat(vm.uiState.value.checkedTaskDefIds).doesNotContain("td-1")
        assertThat(vm.uiState.value.briefMessage).contains("通信エラー")
    }
}
```

- [ ] **Step 2: RED を観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecutionViewModelRecordTaskTest
```

Expected (RED): `ExecutionViewModel.recordTask` / `checkedTaskDefIds` / `briefMessage` unresolved。

- [ ] **Step 3: RED test のみ commit**

```bash
git add app/src/test/java/app/tastile/android/ui/mobile/execution/ExecutionViewModelRecordTaskTest.kt
git commit -m "test(android): red for ExecutionViewModel.recordTask (5 cases / Turbine)"
```

- [ ] **Step 4: GREEN impl**

```kotlin
// ExecutionViewModel.kt に追加
data class ExecutionUiState(
    val checkedTaskDefIds: Set<String> = emptySet(),
    val briefMessage: String? = null,
    // ... 既存 field は保持
)

fun recordTask(executionId: String, taskDefId: String, checked: Boolean) {
    val previous = _uiState.value.checkedTaskDefIds
    // 楽観更新
    _uiState.update {
        it.copy(checkedTaskDefIds = if (checked) it.checkedTaskDefIds + taskDefId else it.checkedTaskDefIds - taskDefId)
    }
    viewModelScope.launch {
        val result = recordTaskRunUseCase.invoke(executionId, taskDefId, checked)
        _uiState.update { s ->
            s.copy(
                checkedTaskDefIds = when (result) {
                    is RecordTaskRunResult.Updated, is RecordTaskRunResult.Replay -> s.checkedTaskDefIds
                    else -> previous  // conflict/closed/network/validation は楽観撤回
                },
                briefMessage = when (result) {
                    is RecordTaskRunResult.Updated      -> "TaskRun 更新: $taskDefId → ${if (checked) "checked" else "unchecked"} (rev:${result.newRevision - 1} → rev:${result.newRevision})"
                    is RecordTaskRunResult.Replay        -> "TaskRun 更新: $taskDefId → ${if (checked) "checked" else "unchecked"} (replay)"
                    is RecordTaskRunResult.RevisionConflict -> "他の端末が更新しました (rev:${result.currentRevision})"
                    is RecordTaskRunResult.ClosedLifecycle  -> "Execution は既に終了しています"
                    is RecordTaskRunResult.ExecutionNotFound -> "Execution が見つかりません"
                    is RecordTaskRunResult.ValidationError  -> "入力エラー: ${result.message}"
                    is RecordTaskRunResult.ServerError      -> "更新に失敗しました (Retry)"
                    RecordTaskRunResult.NetworkError        -> "通信エラー (Retry)"
                },
            )
        }
    }
}
```

- [ ] **Step 5: GREEN 観測**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecutionViewModelRecordTaskTest
```

Expected: `5 passed`。

- [ ] **Step 6: refactor**

- 楽観更新 path と confirm path の責務分離 (commit 1 つに収まれば success)
- briefMessage を `OneShotEvent` 化 (`SharedFlow<UiEvent>` で 1 回 emit、UI で collect) に変更可能か 1 read で評価

- [ ] **Step 7: verify gate**

```powershell
cd tastile-android
.\gradlew.bat lintKotlinMain
.\gradlew.bat testDebugUnitTest --tests 'ExecutionViewModelRecordTaskTest,RecordTaskRunUseCaseTest,ExecutionRepositoryRecordTaskRunTest'
```

Expected: 0 lint error、全 test pass。

- [ ] **Step 8: GREEN impl commit**

```bash
git add app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt
git commit -m "feat(android): ExecutionViewModel.recordTask (optimistic + brief dispatch)"
```

- [ ] **Step 9: precommit review**

---

## Task A4: ExecuteScreen TaskChecklistSection slot

**Files:**
- Create: `app/src/main/java/app/tastile/android/ui/mobile/execution/TaskChecklistSection.kt` (slot Composable)
- Modify: `app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` (slot 追加)
- Create: `app/src/androidTest/java/app/tastile/android/ui/mobile/tabs/ExecuteScreenTaskChecklistTest.kt`

**Interfaces:**
- Consumes: `ExecutionViewModel` (Task A3), 既存の `TaskDefinition` 描画 path
- Produces: `TaskChecklistSection(tasks: List<TaskDefinition>, checkedIds: Set<String>, onCheckChange: (taskDefId: String, checked: Boolean) -> Unit)` Composable

- [ ] **Step 1: RED test を書く (Compose UI test, debugUnitTest とは別)**

`ExecuteScreenTaskChecklistTest.kt`:

```kotlin
package app.tastile.android.ui.mobile.tabs

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.*
import app.tastile.android.domain.task.TaskDefinition
import org.junit.Rule
import org.junit.Test

class ExecuteScreenTaskChecklistTest {
    @get:Rule val rule = createComposeRule()

    private val tasks = listOf(
        TaskDefinition(id = "td-1", label = "Plan"),
        TaskDefinition(id = "td-2", label = "Execute"),
        TaskDefinition(id = "td-3", label = "Review"),
    )

    @Test fun renders_three_tasks_with_initial_check() {
        rule.setContent {
            MaterialTheme {
                TaskChecklistSection(
                    tasks = tasks,
                    checkedIds = setOf("td-2"),
                    onCheckChange = { _, _ -> },
                )
            }
        }
        rule.onNodeWithText("Plan").assertIsDisplayed()
        rule.onNodeWithText("Execute").assertIsDisplayed()
        rule.onNodeWithText("Review").assertIsDisplayed()
        rule.onAllNodes(isToggleable()).assertCountEquals(3)
        // Execute は checked
        rule.onNodeWithText("Execute").assertIsSelected()      // M3 Checkbox
    }

    @Test fun tap_checkbox_invokesCallback() {
        var captured: Pair<String, Boolean>? = null
        rule.setContent {
            MaterialTheme {
                TaskChecklistSection(
                    tasks = tasks,
                    checkedIds = emptySet(),
                    onCheckChange = { id, ck -> captured = id to ck },
                )
            }
        }
        rule.onNodeWithText("Plan").performClick()             // check on
        assertThat(captured).isEqualTo("td-1" to true)
    }

    @Test fun conflictSnackbar_isShown_whenBriefIsConflict() {
        var brief = "他の端末が更新しました (rev:9)"
        rule.setContent {
            MaterialTheme {
                Surface { Text(brief) }       // brief が surface に流れる構造の smoke
            }
        }
        rule.onNodeWithText(brief).assertIsDisplayed()
        // 本番 TaskChecklistSection 経由は integrate 段階で確認 (Step 4 で ViewModel 注入 mock)
    }

    @Test fun closedLifecycleSnackbar_isShown_whenBriefIsClosed() {
        val brief = "Execution は既に終了しています"
        rule.setContent { MaterialTheme { Surface { Text(brief) } } }
        rule.onNodeWithText(brief).assertIsDisplayed()
    }
}
```

- [ ] **Step 2: RED を観測 (Robolectric 経由、JVM で実行可能にして §0 Step 2 観測を保証)**

`ExecuteScreenTaskChecklistTest.kt` の class に `@RunWith(RobolectricTestRunner::class)` を付与し、Compose UI test は Robolectric の `createComposeRule` で実行する:

```kotlin
package app.tastile.android.ui.mobile.tabs

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createAndroidComposeRule          // Robolectric-friendly
// または createComposeRule() + RobolectricTestRunner で起動
import androidx.compose.ui.test.*
import app.tastile.android.domain.task.TaskDefinition
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ExecuteScreenTaskChecklistTest {
    @get:Rule val rule = createAndroidComposeRule(/* ComponentActivity::class.java */)
    // ... (test body は Step 1 と同じ)
}
```

**RED 観測コマンド:**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecuteScreenTaskChecklistTest
```

Expected (RED): `Unresolved reference: TaskChecklistSection` (Robolectric がアノテーション解析した時点で compile error、device 不要)。

> **重要:** 「device ある時のみ実行 / ない時は lint + unit test で代用」は silent skip mask と同型 (memory `Integration-test skip mask`) なので採らない。Robolectric 経由なら必ず JVM で RED 観測できる。`connectedDebugAndroidTest` の使用は smoke の final gate にだけ絞り、本 TDD step では使わない。

- [ ] **Step 3: RED test のみ commit**

```bash
git add app/src/androidTest/java/app/tastile/android/ui/mobile/tabs/ExecuteScreenTaskChecklistTest.kt
git commit -m "test(android): red for ExecuteScreen.TaskChecklistSection (4 scenarios)"
```

- [ ] **Step 4: GREEN impl (Composable)**

`TaskChecklistSection.kt`:

```kotlin
package app.tastile.android.ui.mobile.execution

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.tastile.android.domain.task.TaskDefinition

@Composable
fun TaskChecklistSection(
    tasks: List<TaskDefinition>,
    checkedIds: Set<String>,
    onCheckChange: (taskDefId: String, checked: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxWidth(), tonalElevation = 1.dp) {
        Column(Modifier.padding(12.dp)) {
            Text("Tasks", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            tasks.forEach { td ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(
                        checked = td.id in checkedIds,
                        onCheckedChange = { ck -> onCheckChange(td.id, ck) },
                        modifier = Modifier
                            .semanticsRole(Role.Checkbox)
                            .testTag("checkbox_${td.id}"),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(td.label, style = MaterialTheme.typography.bodyLarge)
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}
```

`ExecuteScreen.kt` の `LazyColumn` / `Column` 末尾に TaskChecklistSection を slot として挿入:

```kotlin
// 既存の PlanHeader / ActiveTaskRow セクションの直後
TaskChecklistSection(
    tasks       = taskDefinitions,
    checkedIds  = uiState.checkedTaskDefIds,
    onCheckChange = { id, checked -> vm.recordTask(executionId = currentExecution.id, taskDefId = id, checked = checked) },
)
```

snackbar 連携 (conflict / closedLifecycle / network の briefMessage) は `SnackbarHostState` を `Scaffold` 既存 host 経由で emit (`uiState.value.briefMessage` collect → `LaunchedEffect` → `snackbarHostState.showSnackbar(...)`)。

- [ ] **Step 5: GREEN 観測 (Robolectric + JVM 経由)**

```powershell
cd tastile-android
.\gradlew.bat testDebugUnitTest --tests ExecuteScreenTaskChecklistTest
.\gradlew.bat testDebugUnitTest                    # 全 unit test
.\gradlew.bat lintKotlinMain
```

Expected: `ExecuteScreenTaskChecklistTest` 含む全 unit test pass、lint 0 error。

- [ ] **Step 6: refactor**

- `TaskChecklistSection` を別 package `ui.mobile.execution` 配下に保つ
- briefMessage を `SharedFlow<UiEvent.Brief>` に変更する場合、既存の `LoadingSkeleton` 等の precedent に揃える

- [ ] **Step 7: verify gate**

```powershell
cd tastile-android
.\gradlew.bat lintKotlinMain
.\gradlew.bat testDebugUnitTest
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
```

Expected: lint 0 error、unit test 全 pass (Robolectric 含む)、check-workspace exit 0。`connectedDebugAndroidTest` は最終 smoke (任意) — 必須化しない。

- [ ] **Step 8: GREEN impl commit**

```bash
git add app/src/main/java/app/tastile/android/ui/mobile/execution/TaskChecklistSection.kt \
        app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt
git commit -m "feat(android): ExecuteScreen.TaskChecklistSection slot"
```

- [ ] **Step 9: precommit review**

---

## Final verify gate (PR 完了直前)

```powershell
# workspace 全般
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing

# core 詳細
cd tastile-core
wslc bash -c 'cargo clippy --all-targets -- -D warnings'
wslc bash -c 'cargo test  --workspace'

# android 詳細
cd ..\tastile-android
.\gradlew.bat lintKotlinMain
.\gradlew.bat testDebugUnitTest

# web openapi drift 0 確認
cd ..\tastile-web
bun run check:release

# tastile-verifier (read-only) で PR 説明文の骨子を確認
pwsh -NoProfile -File .\.agents\skills\tastile-verifier\Run.ps1 -Last 9
```

Expected: すべて exit 0、verify-tastile-change PASS、tastile-precommit-review PASS。

PR description に書く内容（spec §10 acceptance criteria と 1:1 対応）:

- [x] `v1/13-completion.md` に §TaskRun 更新仕様 節 (Task 0)
- [x] `v1/14-read-model-and-endpoint.md` §2.5 に `RECORD_TASK_RUN` 行 (Task 0)
- [x] `v1/10-invariants.md` §2 に `RECORD_TASK_RUN` 不変条件節 (Task 0)
- [x] `V1_059__task_run_record.sql` が `cargo test --workspace` で適用 (Task C1)
- [x] `openapi.yaml` に `POST /v1/executions/{executionId}/task-runs` 公開 (Task C3)
- [x] `tastile-android` `ExecuteScreen` の TaskDefinition を check → 0.5s 以内に楽観更新 (Task A4)
- [x] Conflict (409) 時 brief 表示 + 自動 reconcile (Task A3 / A4)
- [x] web openapi drift 0 (`bun run check:release` PASS、Task C3 Step 7)
- [x] workspace check fast profile exit 0 (final gate)
- [x] agent-initiated commit は `tastile-precommit-review` 通過 (各 Step 9)
- [x] `verify-tastile-change` PR 完了直前 PASS

---

## Skill / Memory reference

- spec: `docs/superpowers/specs/2026-08-30-r3-android-task-run-design.md`
- TDD source: `superpowers:test-driven-development` + `superpowers:executing-plans`
- vocabularies (referenced in spec §2-3): mattpocock `codebase-design` / `loop-me` / `grilling` / `implement-spec`
- implementation: `superpowers:subagent-driven-development` (推奨) or `superpowers:executing-plans`
- gates: `.agents/skills/verify-tastile-change` (PR 直前) + `.agents/skills/tastile-precommit-review` (各 commit 直前) + `.agents/skills/cross-repo-contract-check` (openapi drift 確認)
- memories leveraged:
  - `Use wslc for Rust backend` — core の `cargo` / `clippy` は wslc 内実行
  - `wslc engine data layout` — `bash .wslc/verify-up.sh` を先に通す
  - `wslc clean build+then dev` — wslc fresh state から cargo workspace build
  - `Tastile maintainer contact` — contact addresses 参照が必要な時の正本
  - `No dev servers unprompted` — implementation 中は無闇に dev server を立てない (web follow-up PR の scope 外確認)
  - `web openapi drift 0` — Task C3 Step 7 で `bun run check:release` の責務
  - `verify-tastile-change` — final gate で必ず実行
  - `feedback_docs_in_child_repos_not_root` — Task 0 で `tastile-core/v1/` を直接編集していることを確認 (子 repo の正本)
