# Project Management (owner_id wiring) 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (推奨) または superpowers:executing-plans を使用。Steps は checkbox (`- [ ]`) 形式で進捗管理。

## 0. Validated decisions (2026-06-30)

ユーザー確認済み。実装時に厳密に従う:

1. **CALENDARS サイドパネル**: 既存の work/break/fixed/done チェックボックスは**完全削除**。Projects チェックボックスで**置換**。
2. **新規プロジェクト作成 UX**: `window.prompt()` 廃止。ProjectsSidePanel 内の**インラインフォーム** (name + color + slug)。
3. **workspace データモデル**: `display_name` (必須) + `color` (任意) + `slug` (任意、URL 識別子用)。
4. **マイグレーション**: V1_003__tenancy を正本。新規マイグレーション作成なし。
5. **追加**: PATCH `/v1/access/subjects/{id}` で display_name / slug / color を部分更新。

**Goal:** `tastile-core` (v1) と `tastile-web` を「プロジェクト = 任意 subject を owner とする Tile 集合」として end-to-end で接続する。`v1_subject` テーブルを作り、コマンドで body 指定可能にし、read で複数 owner の UNION を取る。Web はプロジェクト作成/選択/可視性チェックボックス UI を持つ。

**Architecture:** 2 フェーズ分割 (Backend → Frontend)。Backend は `v1_subject` (kind=1 = WORKSPACE = プロジェクト) を追加し、`access_repo` 経由で CRUD と所有者検証を提供。コマンドは body の `owner_id` を受けて所有者検証付きで動作。read は `owner_ids=[...]` のクエリで複数 owner の UNION を返す。Frontend は `useProjects` (SWR) で一覧、`ProjectsSidePanel` から CRUD、`ScheduleSidePanel` / `TimelineSidePanel` にチェックボックス、`QuickTileCreate` §7 を Owner セレクタに置き換え。

**Tech Stack:**
- Rust 1.x + sqlx + axum (tastile-core v1)
- PostgreSQL 15+ (UUIDv7, CHECK 制約)
- Next.js 15 (App Router) + TypeScript (tastile-web)
- SWR (useProjects キャッシュ) — ただし SWR 未導入なら React state + useEffect で代替
- lucide-react, Tailwind CSS v4
- bun (パッケージマネージャ + テストランナー)
- cargo test, bun test, bunx tsc --noEmit, bun run lint

**受け入れ基準:** spec `2026-06-29-project-management-design.md` §6 の 6 条件 (Task 11 で検証)。

---

## ファイル構造 (実装で固定する境界)

```
tastile-core/crates/v1/
├─ storage/
│  ├─ migrations/V1_001__base.sql           ← v1_subject 追加 (Task 1)
│  └─ src/access_repo.rs                    ← create_workspace / list_workspaces_for_owner / delete_workspace 追加 (Task 2)
├─ api/src/
│  ├─ handlers/
│  │  ├─ access.rs                          ← create_workspace / list_my_workspaces / delete_subject ハンドラ追加 (Task 3)
│  │  ├─ common.rs                          ← resolve_command_owner ヘルパー追加 (Task 4)
│  │  ├─ commands.rs                        ← 全コマンドで body.owner_id サポート (Task 4)
│  │  ├─ read.rs                            ← list_tiles に owner_ids クエリ追加 (Task 5)
│  │  └─ timeline.rs                        ← get_timeline に owner_ids クエリ追加 (Task 6)
│  └─ main.rs                               ← 新規ルート登録 (Task 3)

tastile-web/src/
├─ lib/
│  ├─ api/endpoints.ts                      ← listMyWorkspaces / createWorkspace / deleteSubject 追加 (Task 7)
│  ├─ api/v1/build-command.ts               ← project → owner_subject_id (Task 8)
│  ├─ api/v1/submit.ts                      ← owner_subject_id を payload に含める (Task 8)
│  ├─ hooks/use-projects.ts                 ← 新規 useProjects フック (Task 7)
│  ├─ hooks/use-tile-list.ts                ← ownerIds パラメータ追加 (Task 7)
│  ├─ stores/projects-store.ts              ← 削除 (Task 9)
│  └─ stores/quick-create-store.ts          ← meta.project → meta.ownerSubjectId (Task 8)
└─ components/
   ├─ projects/ProjectsMain.tsx             ← labelFilter 削除 + owner_id フィルタに置換 (Task 9)
   ├─ panels/ProjectsSidePanel.tsx          ← useProjects 経由の CRUD に置換 (Task 9)
   ├─ panels/ScheduleSidePanel.tsx          ← プロジェクトチェックボックス追加 (Task 10)
   ├─ panels/CalendarSidePanel.tsx          ← TimelineSidePanel 用プロジェクトチェックボックス追加 (Task 10)
   ├─ tiles/QuickTileCreate.tsx             ← §7 Meta → Owner セレクタ (Task 8)
   └─ (関連ページ)
      ├─ app/dashboard/schedule/page.tsx    ← Projects セクションから URL 経由でメインへ渡す (Task 10)
      └─ app/dashboard/timeline/page.tsx    ← 同上 (Task 10)
```

---

## ロールバック戦略

各 Task は 1 commit。`git revert <hash>` で個別巻き戻し可能。
特に触ってはいけない領域:
- `tastile-core/crates/v0/` — 完全凍結 (旧 v7 実装)
- `tastile-core/crates/v1/storage/migrations/v1/V*.sql` — 並行稼働中、別系統
- `tastile-web/src/lib/daemon/` — 認証
- `tastile-web/src/components/shell/` — UI シェル

---

## Task 1: v1_subject スキーマ検証 (no-op)

**重要な発見 (2026-06-30 計画調整):**
- `v1_subject` テーブルは既に `crates/v1/storage/src/migrations.rs` の `V1_004_ACCESS_GRANT` に存在 (`V1_001__base.sql` ではない)
- 列: `id, kind, external_subject, slug, display_name, email, parent_subject_id, locale, timezone, avatar_url, created_at, updated_at, last_seen_at, disabled_at`
- CHECK: `kind IN (0,1,2,3,4)` (5 値)
- 所有権は `v1_subject_member (subject_id, member_id, role, state)` で管理 (role=0=OWNER, state=0=ACTIVE)
- **新規 `owner_user_id` カラムは不要**。MVP は既存スキーマで完結

**Files:** なし (検証のみ)

**目的:** Task 2 以降が前提とする `v1_subject` + `v1_subject_member` の存在と列を runtime で検証。

- [ ] **Step 1: 検証スクリプト作成**

`crates/v1/storage/tests/test_subject_schema_present.rs` を新規作成:

```rust
//! Verify v1_subject + v1_subject_member tables exist with expected
//! columns. This guards against the schema diverging from the MVP
//! project-management wiring assumed by Tasks 2..6.

use sqlx::PgPool;

#[sqlx::test]
async fn v1_subject_has_required_columns(pool: PgPool) {
    let row: (bool, bool) = sqlx::query_as(
        "SELECT
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='v1_subject' AND column_name='id'),
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='v1_subject' AND column_name='kind')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(row.0, "v1_subject.id column missing");
    assert!(row.1, "v1_subject.kind column missing");
}

#[sqlx::test]
async fn v1_subject_member_supports_owner_role(pool: PgPool) {
    let row: (i32,) = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.tables
         WHERE table_name = 'v1_subject_member'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, 1, "v1_subject_member table should exist");

    // kind=1 (WORKSPACE) + USER as OWNER via v1_subject_member works
    let workspace_id = uuid::Uuid::new_v4();
    let user_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO v1_subject (id, kind, display_name, created_at, updated_at)
         VALUES ($1, 1, 'test-ws', now(), now())",
    )
    .bind(workspace_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO v1_subject (id, kind, display_name, created_at, updated_at)
         VALUES ($1, 0, 'test-user', now(), now())",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO v1_subject_member (subject_id, member_id, role, state, joined_at)
         VALUES ($1, $2, 0, 0, now())",
    )
    .bind(workspace_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let owner: Option<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT member_id FROM v1_subject_member
         WHERE subject_id = $1 AND role = 0 AND state = 0",
    )
    .bind(workspace_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(owner.map(|(u,)| u), Some(user_id));
}
```

- [ ] **Step 2: テスト実行 → 成功確認 (スキーマ既存のため)**

```bash
cd tastile-core
cargo test -p tastile-v1-storage --test test_subject_schema_present -- --nocapture
```

Expected: 2 件 PASS。V1_004 マイグレーションが既に存在するため。

- [ ] **Step 3: 全テスト影響確認**

```bash
cd tastile-core
cargo test --workspace --lib
```

Expected: 全件 PASS。

- [ ] **Step 4: コミット**

```bash
cd tastile-core
git add crates/v1/storage/tests/test_subject_schema_present.rs
git commit -m "test(v1): verify v1_subject and v1_subject_member schema for MVP"
```

**注:** マイグレーションファイルは変更なし (既存 V1_004 を正本として使用)。

---

## Task 2: access_repo にワークスペース CRUD 追加 (v1_subject_member ベース)

**Files:**
- Modify: `tastile-core/crates/v1/storage/src/access_repo.rs` (末尾追記)
- Test: `tastile-core/crates/v1/storage/tests/test_access_repo_workspaces.rs` (新規)

**目的:** `access_repo` にワークスペース作成・一覧・削除関数を追加。所有権は `v1_subject_member (role=0=OWNER)` で管理 (既存パターン踏襲)。

- [ ] **Step 1: 失敗するテストを書く**

`crates/v1/storage/tests/test_access_repo_workspaces.rs` を新規作成:

```rust
//! Verify workspace CRUD via v1_subject_member (role=0=OWNER).

use sqlx::PgPool;
use storage::access_repo::{self, subject_kind};
use uuid::Uuid;

#[sqlx::test]
async fn create_workspace_creates_subject_and_owner_member(pool: PgPool) {
    let owner = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    let ws = access_repo::create_workspace(
        &mut tx,
        owner,
        "My Project",
        Some("my-project"),
        Some("#3366ff"),
        chrono::Utc::now(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(ws.kind, subject_kind::WORKSPACE);
    assert_eq!(ws.display_name, "My Project");

    // v1_subject_member に OWNER 行が作られている
    let members: Vec<(i16, i16,)> = sqlx::query_as(
        "SELECT role, state FROM v1_subject_member
         WHERE subject_id = $1 AND member_id = $2",
    )
    .bind(ws.id)
    .bind(owner)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(members.len(), 1, "owner member row must exist");
    assert_eq!(members[0].0, 0, "role must be 0=OWNER");
    assert_eq!(members[0].1, 0, "state must be 0=ACTIVE");
}

#[sqlx::test]
async fn list_workspaces_for_owner_returns_only_owned(pool: PgPool) {
    let owner_a = Uuid::new_v4();
    let owner_b = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    access_repo::create_workspace(&mut tx, owner_a, "A1", None, None, chrono::Utc::now())
        .await.unwrap();
    access_repo::create_workspace(&mut tx, owner_a, "A2", None, None, chrono::Utc::now())
        .await.unwrap();
    access_repo::create_workspace(&mut tx, owner_b, "B1", None, None, chrono::Utc::now())
        .await.unwrap();
    tx.commit().await.unwrap();

    let list_a = access_repo::list_workspaces_for_owner(&pool, owner_a).await.unwrap();
    assert_eq!(list_a.len(), 2);

    let list_b = access_repo::list_workspaces_for_owner(&pool, owner_b).await.unwrap();
    assert_eq!(list_b.len(), 1);
    assert_eq!(list_b[0].display_name, "B1");
}

#[sqlx::test]
async fn delete_workspace_only_owner_can_delete(pool: PgPool) {
    let owner = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    let ws = access_repo::create_workspace(&mut tx, owner, "X", None, None, chrono::Utc::now())
        .await.unwrap();
    tx.commit().await.unwrap();

    // 所有者以外が削除しようとする
    let other = Uuid::new_v4();
    let res = access_repo::delete_workspace(&pool, ws.id, other).await;
    assert!(res.is_err(), "non-owner should not delete");

    // 所有者は削除できる (cascade で member も消える)
    access_repo::delete_workspace(&pool, ws.id, owner).await.unwrap();
    let fetched = access_repo::get_subject_by_id(&pool, ws.id).await;
    assert!(fetched.is_err(), "should be gone after delete");
}
```

- [ ] **Step 2: テスト実行 → 失敗確認 (関数未定義)**

```bash
cd tastile-core
cargo test -p tastile-v1-storage --test test_access_repo_workspaces -- --nocapture
```

Expected: `create_workspace` 等が未定義でコンパイルエラー。

- [ ] **Step 3: access_repo.rs に実装追加**

`crates/v1/storage/src/access_repo.rs` の末尾に追記。**重要**: `create_subject` のシグネチャや `SubjectRow` には触らない (既存通り)。

```rust
// ---------------------------------------------------------------
// Workspace CRUD (MVP project-management feature).
// Ownership is tracked via v1_subject_member (role=0=OWNER).
// ---------------------------------------------------------------

/// Create a new WORKSPACE subject and grant `owner_user_id` the OWNER
/// role in `v1_subject_member`. Both rows live in the same transaction
/// so observers never see a workspace without an owner.
pub async fn create_workspace(
    tx: &mut Transaction<'_, Postgres>,
    owner_user_id: Uuid,
    display_name: &str,
    slug: Option<&str>,
    color: Option<&str>,
    now: DateTime<Utc>,
) -> RepoResult<SubjectRow> {
    // 1. v1_subject 行 (kind=1=WORKSPACE) を作成
    let subject = create_subject(
        tx,
        subject_kind::WORKSPACE,
        None,
        slug,
        display_name,
        color.map(str::to_string),
        None,
        now,
    )
    .await?;
    // 2. v1_subject_member に OWNER 行を挿入 (role=0, state=0=ACTIVE)
    sqlx::query(
        "INSERT INTO v1_subject_member (subject_id, member_id, role, state, joined_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(subject.id)
    .bind(owner_user_id)
    .bind(member_role::OWNER)
    .bind(member_state::ACTIVE)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    Ok(subject)
}

/// List WORKSPACE subjects owned by `owner_user_id` (role=0=OWNER, state=0=ACTIVE).
pub async fn list_workspaces_for_owner(
    pool: &PgPool,
    owner_user_id: Uuid,
) -> RepoResult<Vec<SubjectRow>> {
    let rows: Vec<(Uuid, i16, Option<String>, Option<String>, String, Option<String>, Option<Uuid>, Option<DateTime<Utc>>, DateTime<Utc>, DateTime<Utc>)> =
        sqlx::query_as(
            "SELECT s.id, s.kind, s.external_subject, s.slug, s.display_name, s.email, s.parent_subject_id, s.disabled_at, s.created_at, s.updated_at
             FROM v1_subject s
             JOIN v1_subject_member m ON m.subject_id = s.id
             WHERE s.kind = $1
               AND s.disabled_at IS NULL
               AND m.member_id = $2
               AND m.role = $3
               AND m.state = $4
             ORDER BY s.created_at ASC",
        )
        .bind(subject_kind::WORKSPACE)
        .bind(owner_user_id)
        .bind(member_role::OWNER)
        .bind(member_state::ACTIVE)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id, kind, external_subject, slug, display_name, email, parent_subject_id, disabled_at, created_at, updated_at)| {
        SubjectRow {
            id, kind, external_subject, slug, display_name, email,
            parent_subject_id, disabled_at, created_at, updated_at,
        }
    }).collect())
}

/// Delete a workspace. Only the OWNER can delete. v1_subject_member の
/// ON DELETE CASCADE (V1_004) で member 行も削除される。
pub async fn delete_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
    actor_user_id: Uuid,
) -> RepoResult<()> {
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT s.id FROM v1_subject s
         JOIN v1_subject_member m ON m.subject_id = s.id
         WHERE s.id = $1 AND s.kind = $2
           AND m.member_id = $3 AND m.role = $4 AND m.state = $5",
    )
    .bind(workspace_id)
    .bind(subject_kind::WORKSPACE)
    .bind(actor_user_id)
    .bind(member_role::OWNER)
    .bind(member_state::ACTIVE)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Err(RepoError::Forbidden(format!(
            "workspace {workspace_id} not owned by {actor_user_id}"
        )));
    }
    sqlx::query("DELETE FROM v1_subject WHERE id = $1")
        .bind(workspace_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update a workspace's mutable fields. Only the OWNER can update.
/// Pass `None` for fields that should not change, and `Some(None)` for
/// fields that should be set to NULL.
pub async fn update_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
    actor_user_id: Uuid,
    display_name: Option<&str>,
    slug: Option<Option<&str>>,
    color: Option<Option<&str>>,
    now: DateTime<Utc>,
) -> RepoResult<SubjectRow> {
    // OWNER 関係チェック
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT s.id FROM v1_subject s
         JOIN v1_subject_member m ON m.subject_id = s.id
         WHERE s.id = $1 AND s.kind = $2
           AND m.member_id = $3 AND m.role = $4 AND m.state = $5",
    )
    .bind(workspace_id)
    .bind(subject_kind::WORKSPACE)
    .bind(actor_user_id)
    .bind(member_role::OWNER)
    .bind(member_state::ACTIVE)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Err(RepoError::Forbidden(format!(
            "workspace {workspace_id} not owned by {actor_user_id}"
        )));
    }
    // COALESCE で「未指定 = 既存値維持」「Some(None) = NULL 設定」を実現
    sqlx::query(
        "UPDATE v1_subject
         SET display_name = COALESCE($1, display_name),
             slug         = CASE WHEN $2 IS NOT NULL THEN $2 ELSE slug END,
             color        = CASE WHEN $3 IS NOT NULL THEN $3 ELSE color END,
             updated_at   = $4
         WHERE id = $5",
    )
    .bind(display_name)
    .bind(slug.map(|s| s.map(str::to_string)))
    .bind(color.map(|c| c.map(str::to_string)))
    .bind(now)
    .bind(workspace_id)
    .execute(pool)
    .await?;
    get_subject_by_id(pool, workspace_id).await
}
```

注: `create_subject` の既存シグネチャ (8 引数、`email: Option<&str>`、`owner_user_id` なし) を厳密に踏襲。V1_004 の `v1_subject_member` PRIMARY KEY `(subject_id, member_id)` で重複 INSERT 防止。

- [ ] **Step 4: テスト実行 → 成功確認**

```bash
cd tastile-core
cargo test -p tastile-v1-storage --test test_access_repo_workspaces -- --nocapture
```

Expected: 3 件 PASS。

- [ ] **Step 5: ビルド & 全テスト確認**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy -p tastile-v1-storage --all-targets -- -D warnings
cargo test --workspace --lib
```

Expected: すべて成功。

- [ ] **Step 6: コミット**

```bash
cd tastile-core
git add crates/v1/storage/src/access_repo.rs crates/v1/storage/tests/test_access_repo_workspaces.rs
git commit -m "feat(v1): add workspace CRUD via v1_subject_member"
```

---

## Task 3: access.rs にワークスペースエンドポイント追加

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/access.rs` (末尾追記)
- Modify: `tastile-core/crates/v1/api/src/main.rs` (route 登録)
- Test: `tastile-core/crates/v1/api/tests/test_workspace_endpoints.rs` (新規)

**目的:** 3 つの HTTP エンドポイントを追加:
- `POST /v1/access/workspaces` — ワークスペース作成 (kind=1 固定、actor を owner に設定)
- `GET /v1/access/subjects?kind=1` — actor のワークスペース一覧
- `DELETE /v1/access/subjects/{id}` — ワークスペース削除 (OWNER のみ)

- [ ] **Step 1: 失敗するテストを書く**

`crates/v1/api/tests/test_workspace_endpoints.rs` を新規作成 (インテグレーションテスト):

```rust
//! Verify /v1/access/workspaces and /v1/access/subjects endpoints.
use axum::http::StatusCode;
use serde_json::{json, Value};

#[tokio::test]
async fn create_workspace_returns_id() {
    let app = /* test harness: spawn_test_app().await */;
    let res = app.post("/v1/access/workspaces")
        .header("x-actor-id", uuid::Uuid::new_v4().to_string())
        .json(&json!({"display_name": "My Project", "color": "#3366ff"}))
        .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: Value = res.json().await;
    assert_eq!(body["kind"], 1);
    assert_eq!(body["display_name"], "My Project");
}
```

注: テストハーネスは既存 `crates/v1/api/tests/` 配下のファイルを参考に構築する (例: `auth.rs` テスト)。`spawn_test_app` ヘルパーが既存にあればそれを使う。なければ `axum::Router` を直接構築して `tower::ServiceExt::oneshot` で叩く最小ハーネスを書く。

- [ ] **Step 2: テスト実行 → 失敗確認**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_workspace_endpoints -- --nocapture
```

Expected: route 未登録で 404。

- [ ] **Step 3: access.rs にハンドラ追加**

`crates/v1/api/src/handlers/access.rs` の末尾に追記:

```rust
// --- POST /v1/access/workspaces ---------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceBody {
    pub display_name: String,
    pub slug: Option<String>,
    pub color: Option<String>,
}

pub async fn create_workspace_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateWorkspaceBody>,
) -> Result<(StatusCode, Json<access_repo::SubjectRow>), StatusCode> {
    let actor = read_actor(&headers)?;
    if body.display_name.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let mut tx = state.store.pool.begin().await.map_err(|_| internal())?;
    let now = Utc::now();
    let row = access_repo::create_workspace(
        &mut tx,
        actor,
        &body.display_name,
        body.slug.as_deref(),
        body.color.as_deref(),
        now,
    )
    .await
    .map_err(map_repo_error)?;
    tx.commit().await.map_err(|_| internal())?;
    Ok((StatusCode::CREATED, Json(row)))
}

// --- GET /v1/access/subjects?kind=1 -----------------------------------

pub async fn list_subjects_handler(
    State(state): State<AppState>,
    Query(q): Query<ListSubjectsQuery>,
    headers: HeaderMap,
) -> Result<Json<ListResponse<access_repo::SubjectRow>>, StatusCode> {
    let actor = read_actor(&headers)?;
    let items = if q.kind == Some(access_repo::subject_kind::WORKSPACE) {
        access_repo::list_workspaces_for_owner(&state.store.pool, actor)
            .await
            .map_err(map_repo_error)?
    } else {
        return Err(StatusCode::UNPROCESSABLE_ENTITY); // MVP: kind=1 のみサポート
    };
    Ok(Json(ListResponse { count: items.len(), items }))
}

#[derive(Debug, Deserialize, Default)]
pub struct ListSubjectsQuery {
    pub kind: Option<i16>,
}

// --- DELETE /v1/access/subjects/{id} ---------------------------------

pub async fn delete_subject_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let actor = read_actor(&headers)?;
    access_repo::delete_workspace(&state.store.pool, id, actor)
        .await
        .map_err(map_repo_error)?;
    Ok(StatusCode::NO_CONTENT)
}

// --- PATCH /v1/access/subjects/{id} ---------------------------------

#[derive(Debug, Deserialize)]
pub struct UpdateSubjectBody {
    pub display_name: Option<String>,
    pub slug: Option<Option<String>>,
    pub color: Option<Option<String>>,
}

pub async fn update_subject_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<UpdateSubjectBody>,
) -> Result<Json<access_repo::SubjectRow>, StatusCode> {
    let actor = read_actor(&headers)?;
    if let Some(ref name) = body.display_name {
        if name.trim().is_empty() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    let row = access_repo::update_workspace(
        &state.store.pool,
        id,
        actor,
        body.display_name.as_deref(),
        body.slug.as_ref().map(|s| s.as_deref()),
        body.color.as_ref().map(|c| c.as_deref()),
        chrono::Utc::now(),
    )
    .await
    .map_err(map_repo_error)?;
    Ok(Json(row))
}
```

注: `use axum::extract::Query;` の import を access.rs の先頭に追加。

- [ ] **Step 4: main.rs に route 登録**

`crates/v1/api/src/main.rs` の `Router::new()` セクションに追記:

```rust
// Access control: workspaces (MVP)
.route(
    "/v1/access/workspaces",
    post(handlers::access::create_workspace_handler),
)
.route(
    "/v1/access/subjects",
    get(handlers::access::list_subjects_handler),
)
.route(
    "/v1/access/subjects/{id}",
    delete(handlers::access::delete_subject_handler).patch(handlers::access::update_subject_handler),
)
```

- [ ] **Step 5: テスト実行 → 成功確認**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_workspace_endpoints -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: ビルド & 全テスト確認**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy -p tastile-v1-api --all-targets -- -D warnings
cargo test --workspace --lib
```

Expected: すべて成功。

- [ ] **Step 7: コミット**

```bash
cd tastile-core
git add crates/v1/api/src/handlers/access.rs crates/v1/api/src/main.rs crates/v1/api/tests/test_workspace_endpoints.rs
git commit -m "feat(v1): add workspace CRUD HTTP endpoints"
```

---

## Task 4: resolve_command_owner ヘルパー追加 & commands.rs 更新

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/common.rs` (ヘルパー追加)
- Modify: `tastile-core/crates/v1/api/src/handlers/commands.rs` (create_tile, set_plan, create_placement 等で body.owner_id サポート)
- Test: `tastile-core/crates/v1/api/src/handlers/common.rs` の `#[cfg(test)]` セクション

**目的:** コマンドが body で `owner_id` を受けて、所有者検証付きで動作するようにする。actor が body.owner_id を所有していない WORKSPACE なら FORBIDDEN。

- [ ] **Step 1: 失敗するテストを書く**

`crates/v1/api/src/handlers/common.rs` の `#[cfg(test)] mod tests` に追加:

```rust
#[tokio::test]
async fn resolve_command_owner_personal_passes() {
    // actor == owner_id → OK
    let actor = Uuid::new_v4();
    let resolved = /* resolve_command_owner の単体テストは DI が難しいため、
                     handlers/commands.rs 側で E2E テストする形に簡略化 */;
    assert_eq!(resolved, actor);
}
```

実用的には、E2E テストを `crates/v1/api/tests/test_command_owner_id.rs` に書く方が現実的:

```rust
#[tokio::test]
async fn create_tile_with_workspace_owner_succeeds_when_actor_owns_workspace() {
    let app = spawn_test_app().await;
    let actor = Uuid::new_v4();
    let workspace_id = /* app 経由で workspace 作成 */;

    let res = app.post("/v1/tiles")
        .header("x-actor-id", actor.to_string())
        .json(&json!({
            "expectedRevision": null,
            "idempotencyKey": uuid::Uuid::now_v7().to_string(),
            "payload": {
                "kind": 0,
                "external_id": null,
                "content": {"title": "in workspace"},
                "visual": {"color": null, "icon": null}
            },
            "owner_id": workspace_id
        }))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
}
```

- [ ] **Step 2: テスト実行 → 失敗確認 (owner_id 認識せず)**

Expected: 現状は `read_owner` が `x-actor-id` のみ参照するので、`owner_id` を body に入れても無視される。テストは status=200 になるが、`v1_tile.owner_id` が `actor` になる (= workspace_id にならない)。テストは fixture の SELECT で `owner_id == workspace_id` を assert して失敗する。

- [ ] **Step 3: common.rs に resolve_command_owner 追加**

`crates/v1/api/src/handlers/common.rs` の末尾に追加。所有権は `v1_subject_member (role=0=OWNER, state=0=ACTIVE)` で検証:

```rust
use storage::access_repo;

/// Resolve the target owner_id from (body.owner_id, x-actor-id fallback).
///
/// Authorization rules:
///   - body.owner_id == actor         → OK (Personal tile)
///   - body.owner_id != actor         → body.owner_id must be a WORKSPACE
///                                       where actor is OWNER via v1_subject_member
///   - body.owner_id == None          → use x-actor-id (back-compat)
pub async fn resolve_command_owner(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    body_owner_id: Option<Uuid>,
) -> Result<Uuid, ApiHttpError> {
    let (auth_owner, _actor) = match authenticate(state, headers).await {
        Ok(p) => p,
        Err(e) => return Err(e),
    };
    let target = body_owner_id.unwrap_or(auth_owner);
    if target == auth_owner {
        return Ok(target);
    }
    // target != auth_owner → target must be a WORKSPACE owned by auth_owner
    let subj = storage::access_repo::get_subject_by_id(&state.store.pool, target)
        .await
        .map_err(|e| ApiHttpError::from(e))?;
    if subj.kind != storage::access_repo::subject_kind::WORKSPACE
        || subj.disabled_at.is_some()
    {
        return Err(ApiHttpError::forbidden(
            "owner_id must be a workspace owned by the actor",
        ));
    }
    // v1_subject_member で OWNER 関係を確認
    let owner_row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT member_id FROM v1_subject_member
         WHERE subject_id = $1 AND member_id = $2
           AND role = 0 AND state = 0",
    )
    .bind(target)
    .bind(auth_owner)
    .fetch_optional(&state.store.pool)
    .await
    .map_err(|e| ApiHttpError::internal(e))?;
    if owner_row.is_none() {
        return Err(ApiHttpError::forbidden(
            "owner_id must be a workspace owned by the actor",
        ));
    }
    Ok(target)
}
```

注: `ApiHttpError::forbidden(...)` / `ApiHttpError::internal(...)` のコンストラクタ名は実際の common.rs に合わせる (実装時に確認)。

- [ ] **Step 4: commands.rs の create_tile で body.owner_id サポート**

`crates/v1/api/src/handlers/commands.rs` の `create_tile` を更新:

```rust
#[derive(serde::Deserialize)]
pub struct CreateTileRequest {
    #[serde(flatten)]
    pub envelope: domain::CommandRequest<CreateTilePayload>,
    pub owner_id: Option<Uuid>,
}

pub async fn create_tile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateTileRequest>,
) -> Result<Json<CommandResponse>, (StatusCode, Json<domain::ApiError>)> {
    let owner = resolve_command_owner(&state, &headers, req.owner_id)
        .await
        .map_err(|e| /* map to ApiHttpError */)?;
    let actor = /* extract actor from headers */;
    dispatch(
        &state,
        domain::CommandKind::CreateTile,
        CommandPayload::CreateTile(req.envelope.payload),
        req.envelope.expected_revision,
        req.envelope.idempotency_key,
        owner,
        actor,
    )
    .await
}
```

`set_plan`, `create_placement`, `append_changes`, `start_execution` 等すべてのコマンドに同じパターンを適用。各コマンドの `#[derive(Deserialize)]` リクエスト型に `owner_id: Option<Uuid>` を追加し、`read_owner` を `resolve_command_owner` に置換。

注: 各コマンドのリクエスト型は現在 `CommandRequest<T>` を直接 `Json<>` で受けているため、ラップ型 `XxxRequest` を追加するか、`CommandRequest<T>` 自体に `owner_id: Option<Uuid>` フィールドを追加するかは実装時に判断する。**最小変更案**: 各コマンドに `#[serde(flatten)]` で envelope を持ち `owner_id` を持つラップ型を追加する。

- [ ] **Step 5: テスト実行 → 成功確認**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_command_owner_id -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: ビルド & 全テスト確認**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Expected: すべて成功。

- [ ] **Step 7: コミット**

```bash
cd tastile-core
git add crates/v1/api/src/handlers/common.rs crates/v1/api/src/handlers/commands.rs crates/v1/api/tests/test_command_owner_id.rs
git commit -m "feat(v1): wire owner_id through commands with workspace auth"
```

---

## Task 5: list_tiles に owner_ids クエリ追加

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/read.rs:119-166` (list_tiles)
- Test: `crates/v1/api/tests/test_list_tiles_owner_ids.rs` (新規)

**目的:** `GET /v1/tiles?owner_ids=u1,u2` で複数 owner_id の UNION を返す。指定された owner_ids が actor の所有下にあることを検証。

- [ ] **Step 1: 失敗するテストを書く**

`crates/v1/api/tests/test_list_tiles_owner_ids.rs`:

```rust
#[tokio::test]
async fn list_tiles_filters_by_owner_ids() {
    let app = spawn_test_app().await;
    let actor = Uuid::new_v4();
    let other = Uuid::new_v4();

    // actor の Personal tile
    let t1 = create_tile(&app, actor, "personal-1").await;
    // actor 所有の workspace
    let ws = create_workspace(&app, actor, "My Project").await;
    let t2 = create_tile_with_owner(&app, actor, ws.id, "project-1").await;
    // 別ユーザの tile
    let _t3 = create_tile(&app, other, "other-user").await;

    let res = app.get(&format!("/v1/tiles?owner_ids={}", ws.id))
        .header("x-actor-id", actor.to_string())
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await;
    let titles: Vec<&str> = body.as_array().unwrap().iter()
        .map(|t| t["title"].as_str().unwrap()).collect();
    assert!(titles.contains(&"project-1"));
    assert!(!titles.contains(&"personal-1"));
    assert!(!titles.contains(&"other-user"));
}

#[tokio::test]
async fn list_tiles_rejects_unauthorized_owner_ids() {
    let app = spawn_test_app().await;
    let actor = Uuid::new_v4();
    let other = Uuid::new_v4();
    let other_ws = create_workspace(&app, other, "Other").await;

    let res = app.get(&format!("/v1/tiles?owner_ids={}", other_ws.id))
        .header("x-actor-id", actor.to_string())
        .await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}
```

- [ ] **Step 2: テスト実行 → 失敗確認 (現状は owner_id = $1 固定)**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_list_tiles_owner_ids -- --nocapture
```

Expected: `owner_ids` パラメータを認識せず、`x-actor-id` (=actor) の tile のみ返す。`assert!(titles.contains(&"project-1"))` で失敗。

- [ ] **Step 3: read.rs::list_tiles を更新**

`crates/v1/api/src/handlers/read.rs` の `list_tiles` を更新:

```rust
#[derive(serde::Deserialize, Default)]
pub struct ListTilesQuery {
    pub owner_ids: Option<String>,  // CSV
    pub limit: Option<i64>,
}

pub async fn list_tiles(
    State(state): State<AppState>,
    Query(q): Query<ListTilesQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<TileSummary>>, StatusCode> {
    let (actor, _owner_from_auth) = authenticate(&state, &headers).await?;
    let limit = q.limit.unwrap_or(500).clamp(1, 500);

    let owner_ids: Vec<Uuid> = match q.owner_ids {
        Some(s) => s.split(',').filter_map(|x| Uuid::parse_str(x.trim()).ok()).collect(),
        None => vec![actor],
    };
    if owner_ids.is_empty() {
        return Ok(Json(vec![]));
    }

    // 認可: 各 owner_id が actor に許可されていること
    for &oid in &owner_ids {
        if oid == actor { continue; }
        let subj = access_repo::get_subject_by_id(&state.store.pool, oid).await
            .map_err(map_repo_error)?;
        if subj.kind != access_repo::subject_kind::WORKSPACE
            || subj.disabled_at.is_some()
        {
            return Err(StatusCode::FORBIDDEN);
        }
        // v1_subject_member で OWNER 関係を確認
        let owner_row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT member_id FROM v1_subject_member
             WHERE subject_id = $1 AND member_id = $2
               AND role = 0 AND state = 0",
        )
        .bind(oid)
        .bind(actor)
        .fetch_optional(&state.store.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if owner_row.is_none() {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let rows: Result<Vec<(/* ... */)>, sqlx::Error> = sqlx::query_as(
        "SELECT id, kind, title, description, color, icon, plan_id, archived_at, created_at, updated_at
         FROM v1_tile WHERE owner_id = ANY($1) AND archived_at IS NULL ORDER BY created_at DESC LIMIT $2",
    )
    .bind(&owner_ids)
    .bind(limit)
    .fetch_all(&state.store.pool)
    .await;
    /* rows → Vec<TileSummary> 変換は既存ロジックを踏襲 */
}
```

- [ ] **Step 4: テスト実行 → 成功確認**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_list_tiles_owner_ids -- --nocapture
```

Expected: 2 件 PASS。

- [ ] **Step 5: ビルド & 全テスト確認**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Expected: すべて成功。

- [ ] **Step 6: コミット**

```bash
cd tastile-core
git add crates/v1/api/src/handlers/read.rs crates/v1/api/tests/test_list_tiles_owner_ids.rs
git commit -m "feat(v1): add owner_ids query to list_tiles"
```

---

## Task 6: get_timeline に owner_ids クエリ追加

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/timeline.rs:43-110` (get_timeline)
- Test: `crates/v1/api/tests/test_timeline_owner_ids.rs` (新規)

**目的:** `GET /v1/timeline?start=...&end=...&owner_ids=u1,u2` で複数 owner_id の Placements を返す。

- [ ] **Step 1: 失敗するテストを書く**

`crates/v1/api/tests/test_timeline_owner_ids.rs`:

```rust
#[tokio::test]
async fn timeline_filters_by_owner_ids() {
    let app = spawn_test_app().await;
    let actor = Uuid::new_v4();
    let ws = create_workspace(&app, actor, "My Project").await;

    let now = chrono::Utc::now();
    let start = now - chrono::Duration::hours(1);
    let end = now + chrono::Duration::hours(1);

    // Personal placement
    create_placement(&app, actor, actor, start, end, "personal").await;
    // Workspace placement
    create_placement_with_owner(&app, actor, ws.id, start, end, "in-project").await;

    let res = app.get(&format!("/v1/timeline?start={}&end={}&owner_ids={}", start.to_rfc3339(), end.to_rfc3339(), ws.id))
        .header("x-actor-id", actor.to_string())
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await;
    let titles: Vec<&str> = body.as_array().unwrap().iter()
        .filter_map(|p| p["content"]["title"].as_str())
        .collect();
    assert!(titles.contains(&"in-project"));
    assert!(!titles.contains(&"personal"));
}
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Expected: `owner_ids` を認識せず、`x-actor-id` 固定で `personal` のみ返る。

- [ ] **Step 3: timeline.rs を更新**

`crates/v1/api/src/handlers/timeline.rs` の `TimelineParams` と SQL を更新:

```rust
#[derive(Deserialize)]
pub struct TimelineParams {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub parent_placement_id: Option<Uuid>,
    pub include_labels: Option<bool>,
    pub include_closed: Option<bool>,
    pub include_blocked: Option<bool>,
    pub include_nested: Option<bool>,
    pub owner_ids: Option<String>,  // CSV
}

pub async fn get_timeline(/* ... */) -> Result<Json<Vec<TimelineItem>>, StatusCode> {
    /* ... validation ... */
    let (actor, _) = read_owner(&state, &headers).await;

    let owner_ids: Vec<Uuid> = match params.owner_ids {
        Some(s) => s.split(',').filter_map(|x| Uuid::parse_str(x.trim()).ok()).collect(),
        None => vec![actor],
    };

    // 認可 (Task 5 と同じロジック)
    for &oid in &owner_ids {
        if oid == actor { continue; }
        let subj = access_repo::get_subject_by_id(&state.store.pool, oid).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if subj.kind != access_repo::subject_kind::WORKSPACE
            || subj.disabled_at.is_some()
        {
            return Err(StatusCode::FORBIDDEN);
        }
        let owner_row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT member_id FROM v1_subject_member
             WHERE subject_id = $1 AND member_id = $2
               AND role = 0 AND state = 0",
        )
        .bind(oid)
        .bind(actor)
        .fetch_optional(&state.store.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if owner_row.is_none() {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // SQL の `WHERE p.owner_id = $1` を `WHERE p.owner_id = ANY($N)` に変更
    let sql = r#"
        SELECT /* ... */
        FROM v1_placement p
        /* ... */
        WHERE p.owner_id = ANY($1)
          AND b.span_start < $3
          /* ... */
    "#;
    let q = sqlx::query_as::<_, TimelineRow>(sql)
        .bind(&owner_ids)
        .bind(params.start)
        /* ... */
}
```

- [ ] **Step 4: テスト実行 → 成功確認**

```bash
cd tastile-core
cargo test -p tastile-v1-api --test test_timeline_owner_ids -- --nocapture
```

Expected: PASS。

- [ ] **Step 5: ビルド & 全テスト確認**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

- [ ] **Step 6: コミット**

```bash
cd tastile-core
git add crates/v1/api/src/handlers/timeline.rs crates/v1/api/tests/test_timeline_owner_ids.rs
git commit -m "feat(v1): add owner_ids query to get_timeline"
```

---

## Task 7: Frontend - useProjects フック + endpoints 定義 + useTileList 拡張

**Files:**
- Modify: `tastile-web/src/lib/api/endpoints.ts` (3 つの endpoint 追加 + toV1CorePath マッピング)
- Create: `tastile-web/src/lib/hooks/use-projects.ts` (新規 useProjects)
- Modify: `tastile-web/src/lib/hooks/use-tile-list.ts` (ownerIds パラメータ)
- Test: `tastile-web/src/lib/hooks/use-projects.test.ts` (新規)

**目的:** Web から `useProjects()` でワークスペース一覧を取得し、`createWorkspace()` / `deleteWorkspace()` で CRUD。`useTileList` で ownerIds を渡せるようにする。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/hooks/use-projects.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the CoreClient
vi.mock("@/lib/api/endpoints", () => ({
  getCoreClient: () => ({
    call: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        items: [
          { id: "ws-1", kind: 1, display_name: "Project 1", owner_user_id: "u-1", created_at: "2026-06-29T00:00:00Z", updated_at: "2026-06-29T00:00:00Z" },
        ],
      },
    }),
  }),
}));

describe("useProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads workspaces on mount", async () => {
    const { useProjects } = await import("./use-projects");
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaces).toHaveLength(1);
    expect(result.current.workspaces[0].display_name).toBe("Project 1");
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗確認 (関数未定義)**

```bash
cd tastile-web
bun test src/lib/hooks/use-projects.test.ts
```

Expected: モジュール無しで失敗。

- [ ] **Step 3: use-projects.ts を新規作成**

`src/lib/hooks/use-projects.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { getCoreClient } from "@/lib/api/endpoints";

export interface Workspace {
  id: string;
  kind: number;
  display_name: string;
  slug: string | null;
  email: string | null;
  color: string | null;
  owner_user_id: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UseProjectsState {
  workspaces: Workspace[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsState {
  const [state, setState] = useState<Omit<UseProjectsState, "refresh">>({
    workspaces: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await getCoreClient().call<{ items: Workspace[]; count: number }>(
      "listMyWorkspaces",
    );
    if (res.ok) {
      setState({ workspaces: res.data.items ?? [], loading: false, error: null });
    } else {
      setState({ workspaces: [], loading: false, error: new Error(res.error.message) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refresh: load };
}

export async function createWorkspace(displayName: string, color?: string): Promise<Workspace> {
  const res = await getCoreClient().call<Workspace>("createWorkspace", {
    body: { display_name: displayName, color: color ?? null },
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

export async function deleteWorkspace(id: string): Promise<void> {
  const res = await getCoreClient().call<{ ok: true }>("deleteSubject", {
    pathParams: { id },
  });
  if (!res.ok) throw new Error(res.error.message);
}
```

- [ ] **Step 4: endpoints.ts に追加**

`src/lib/api/endpoints.ts` の `ENDPOINTS` オブジェクトに追加:

```ts
listMyWorkspaces: {
  method: "GET",
  path: "/access/subjects",
  tag: "Read",
  summary: "List workspaces owned by me",
  auth: true,
  keywords: ["workspaces", "projects", "list"],
} as EndpointMeta,
createWorkspace: {
  method: "POST",
  path: "/access/workspaces",
  tag: "Commands",
  summary: "Create workspace",
  auth: true,
  keywords: ["workspace", "project", "create"],
} as EndpointMeta,
deleteSubject: {
  method: "DELETE",
  path: "/access/subjects/{id}",
  tag: "Commands",
  summary: "Delete workspace",
  auth: true,
  keywords: ["workspace", "delete"],
} as EndpointMeta,
```

`toV1CorePath` のマップに追加:

```ts
"/access/subjects": "/v1/access/subjects",
"/access/workspaces": "/v1/access/workspaces",
"/access/subjects/{id}": "/v1/access/subjects/{id}",
```

- [ ] **Step 5: use-tile-list.ts に ownerIds 追加**

`src/lib/hooks/use-tile-list.ts` の `UseTileListArgs` と `fetchTiles` を更新:

```ts
export interface UseTileListArgs {
  viewMode?: string;
  lifecycle?: string;
  limit?: number;
  search?: string;
  excludeFuture?: boolean;
  range?: string;
  granularity?: string;
  ownerIds?: string[];  // 追加
}

// fetchTiles 内で:
const res = await getCoreClient().call<{ /* ... */ }>("getTiles", {
  query: {
    view_mode: args.viewMode,
    lifecycle: args.lifecycle,
    limit: args.limit,
    search: args.search,
    exclude_future: args.excludeFuture,
    range: args.range,
    granularity: args.granularity,
    owner_ids: args.ownerIds?.join(","),  // 追加
  },
});

// useEffect deps に args.ownerIds を追加
}, [/* ... */, args.ownerIds]);
```

注: `ownerIds` の join で空配列 → 空文字列 → サーバ側で `vec![]` 判定を避けるため、`undefined` の場合は join しない。

- [ ] **Step 6: テスト実行 → 成功確認**

```bash
cd tastile-web
bun test src/lib/hooks/use-projects.test.ts
```

Expected: PASS。

- [ ] **Step 7: ビルド & 全体テスト**

```bash
cd tastile-web
bunx tsc --noEmit
bun test
```

Expected: エラーなし。

- [ ] **Step 8: コミット**

```bash
cd tastile-web
git add src/lib/api/endpoints.ts src/lib/hooks/use-projects.ts src/lib/hooks/use-projects.test.ts src/lib/hooks/use-tile-list.ts
git commit -m "feat(web): add useProjects hook and ownerIds to useTileList"
```

---

## Task 8: Frontend - owner_subject_id 経由での Tile 作成

**Files:**
- Modify: `tastile-web/src/lib/stores/quick-create-store.ts` (`meta.project` → `meta.ownerSubjectId`)
- Modify: `tastile-web/src/lib/api/v1/build-command.ts` (`project` → `owner_subject_id`)
- Modify: `tastile-web/src/lib/api/v1/submit.ts` (ペイロードに `owner_subject_id` を含める)
- Modify: `tastile-web/src/components/tiles/QuickTileCreate.tsx` (§7 Meta → Owner セレクタ)
- Test: `tastile-web/src/lib/api/v1/build-command.test.ts` (更新)

**目的:** `QuickTileCreate` の §7 をフリーテキスト `project` から、ワークスペース ID (`owner_subject_id`) を選択する Owner セレクタに置き換える。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/api/v1/build-command.test.ts` を更新 (既存テストに新フィールドのアサートを追加):

```ts
it("includes owner_subject_id in payload", () => {
  const wsId = "ws-uuid-1234";
  const state: QuickCreateState = {
    /* ... */
    meta: { ownerSubjectId: wsId, tags: [], memo: "" },
    /* ... */
  };
  const envelopes = buildCreateTileCommand(state, "key-1");
  expect(envelopes[0].request.payload).toMatchObject({ owner_subject_id: wsId });
});

it("omits owner_subject_id when null (Personal default)", () => {
  const state: QuickCreateState = {
    /* ... */
    meta: { ownerSubjectId: null, tags: [], memo: "" },
    /* ... */
  };
  const envelopes = buildCreateTileCommand(state, "key-1");
  expect(envelopes[0].request.payload.owner_subject_id).toBeUndefined();
});
```

- [ ] **Step 2: テスト実行 → 失敗確認 (フィールド無し)**

```bash
cd tastile-web
bun test src/lib/api/v1/build-command.test.ts
```

- [ ] **Step 3: quick-create-store.ts を更新**

`src/lib/stores/quick-create-store.ts`:

```ts
// 1. MetaSlice 型から project を削除
interface MetaSlice {
  ownerSubjectId: string | null;
  tags: string[];
  memo: string;
}

// 2. defaultMeta() を更新
function defaultMeta(): MetaSlice {
  return {
    ownerSubjectId: null,
    tags: [],
    memo: "",
  };
}

// 3. QuickCreateMetaPayload (input イベント) も同様に更新
interface QuickCreateMetaPayload {
  ownerSubjectId?: string | null;
  tags?: string[];
  memo?: string;
}
// event.project → event.ownerSubjectId
```

注: store 内の `project` を参照している箇所は `ownerSubjectId` に置換。`resolvedProject` という派生 getter があれば削除。

- [ ] **Step 4: build-command.ts を更新**

`src/lib/api/v1/build-command.ts` のペイロード構築:

```ts
// CreateTilePayload 等で owner_subject_id を追加
const updatePayload = {
  /* ... */
  owner_subject_id: state.meta.ownerSubjectId ?? null,
  // 旧 `project: state.meta.project` は削除
};
```

`updateTile` (buildUpdateTileCommand) も同様。

- [ ] **Step 5: submit.ts を更新**

`src/lib/api/v1/submit.ts`:

```ts
// CREATE_TILE のペイロードに owner_subject_id を含める
const createPayload = {
  /* ... */
  owner_subject_id: snapshot.meta.ownerSubjectId ?? null,
};
```

注: domain の `CreateTilePayload` に `owner_id: Option<Uuid>` フィールドが追加されている前提 (Task 4 で実施)。これで Rust 側と整合する。

- [ ] **Step 6: QuickTileCreate.tsx の §7 を置換**

`src/components/tiles/QuickTileCreate.tsx` の §7 Meta セクションを書き換え。`useProjects()` を import し、Owner ドロップダウンを追加:

```tsx
import { useProjects } from "@/lib/hooks/use-projects";

// §7 セクション内
function MetaSection() {
  const { workspaces } = useProjects();
  const ownerSubjectId = useQuickCreateStore((s) => s.meta.ownerSubjectId);
  const setOwnerSubjectId = (v: string | null) =>
    useQuickCreateStore.getState().setMeta("ownerSubjectId", v);

  return (
    <section>
      <FormRow label="Owner">
        <Select
          value={ownerSubjectId ?? ""}
          onChange={(e) => setOwnerSubjectId(e.target.value || null)}
        >
          <option value="">Personal (default)</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.display_name}</option>
          ))}
        </Select>
      </FormRow>
    </section>
  );
}
```

注: 既存の `FormRow` / `Select` / `useQuickCreateStore` の API は実装時に厳密に合わせて呼び出す。`setMeta` の引数形式 (path 文字列 or 直接値) は既存パターンに従う。

- [ ] **Step 7: テスト & 型チェック**

```bash
cd tastile-web
bun test src/lib/api/v1/build-command.test.ts
bunx tsc --noEmit
```

Expected: すべて成功。

- [ ] **Step 8: コミット**

```bash
cd tastile-web
git add src/lib/stores/quick-create-store.ts src/lib/api/v1/build-command.ts src/lib/api/v1/submit.ts src/lib/api/v1/build-command.test.ts src/components/tiles/QuickTileCreate.tsx
git commit -m "feat(web): replace project text with owner_subject_id selector"
```

---

## Task 9: Frontend - ProjectsMain & ProjectsSidePanel 書き換え + projects-store.ts 削除

**Files:**
- Modify: `tastile-web/src/components/projects/ProjectsMain.tsx` (完全書き換え)
- Modify: `tastile-web/src/components/panels/ProjectsSidePanel.tsx` (完全書き換え)
- Delete: `tastile-web/src/lib/stores/projects-store.ts`
- Modify: `tastile-web/src/app/dashboard/projects/page.tsx` (変更なしの確認)

**目的:** 既存のラベルベース疑似プロジェクト (labelFilter) を完全に削除し、`owner_id` ベースの所有権フィルタに置換。

- [ ] **Step 1: 既存参照箇所の調査**

```bash
cd tastile-web
grep -rln "useProjectsStore\|projects-store" src/ 2>&1
```

Expected 出力: `ProjectsMain.tsx` と `ProjectsSidePanel.tsx` のみ。これら2つを書き換えれば他に影響なし。

- [ ] **Step 2: ProjectsMain.tsx を書き換え** (validated: インライン編集フォーム + 詳細情報表示)

`src/components/projects/ProjectsMain.tsx` を完全に置換。MVP ユーザー要求「オーナーごとの情報についてより詳しく設定を読み書き」対応:

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { TileCardCompact } from "@/components/tiles/TileCardCompact";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useProjects, updateWorkspace, Workspace } from "@/lib/hooks/use-projects";
import { useTileList } from "@/lib/hooks/use-tile-list";
import { mapListViewToTile } from "@/lib/utils/map-list-view-to-tile";

export function ProjectsMain() {
  const searchParams = useSearchParams();
  const ownerId = searchParams.get("owner");
  const { workspaces, refresh, loading: wsLoading } = useProjects();
  const project = ownerId ? workspaces.find((w) => w.id === ownerId) : null;

  const { tiles, loading } = useTileList({
    ownerIds: ownerId ? [ownerId] : undefined,
    limit: 500,
  });

  return (
    <PageContainer>
      <PageHeader
        title={project ? project.display_name : "All Projects"}
        description={project ? "Tiles owned by this workspace" : "Select a project from the sidebar"}
      />

      {project && <ProjectEditForm project={project} tileCount={tiles.length} onSaved={refresh} />}

      <div className="mt-2 flex items-center justify-between border-b border-border/40 pb-3 text-xs text-foreground-subtle">
        <span className="flex items-center gap-2 font-mono bg-surface-2 px-2 py-0.5 rounded text-[10px] text-foreground-lighter border border-border">
          {project ? (
            <>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color ?? "#6b7280" }} />
              owner_id: {project.id.slice(0, 8)} · slug: {project.slug ?? "(none)"}
            </>
          ) : (
            "All project tiles"
          )}
        </span>
        <span className="font-mono text-[10px] text-foreground-lighter">
          {loading || wsLoading ? "Loading..." : `${tiles.length} items found`}
        </span>
      </div>

      <div className="mt-4">
        {loading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        )}
        {!loading && tiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-foreground-subtle border border-dashed border-border rounded-lg bg-surface-1">
            <p className="text-sm">No tiles in this project.</p>
          </div>
        )}
        {!loading && tiles.length > 0 && (
          <div className="border border-border bg-surface-1 rounded-lg overflow-hidden divide-y divide-border/40 shadow-xs">
            {tiles.map((t) => (
              <TileCardCompact key={t.id} tile={mapListViewToTile(t)} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function ProjectEditForm({ project, tileCount, onSaved }: { project: Workspace; tileCount: number; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(project.display_name);
  const [slug, setSlug] = useState(project.slug ?? "");
  const [color, setColor] = useState(project.color ?? "#6b7280");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("name required"); return; }
    setSaving(true); setError(null);
    try {
      await updateWorkspace(project.id, {
        display_name: name.trim(),
        slug: slug.trim() || null,
        color,
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border border-border/40 rounded-lg bg-surface-1">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-subtle font-semibold">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-subtle font-semibold">Slug</span>
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          pattern="[a-z0-9-]+"
          maxLength={40}
          placeholder="my-project"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-foreground-subtle font-semibold">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-full rounded border border-border cursor-pointer"
        />
      </label>
      <div className="md:col-span-3 flex items-center justify-between text-[10px] text-foreground-subtle font-mono">
        <span>{tileCount} tiles · created {new Date(project.created_at).toLocaleDateString()}</span>
        <div className="flex items-center gap-2">
          {error && <span className="text-status-danger">{error}</span>}
          <Button onClick={save} disabled={saving || !name.trim()} size="sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: ProjectsSidePanel.tsx を書き換え** (validated: インライン作成フォーム)

`src/components/panels/ProjectsSidePanel.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { createWorkspace, deleteWorkspace, useProjects } from "@/lib/hooks/use-projects";
import { cn } from "@/lib/utils/cn";

export function ProjectsSidePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { workspaces, refresh, loading, error } = useProjects();

  const currentOwner = searchParams.get("owner") ?? null;

  function handleSelect(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("owner", id);
    else params.delete("owner");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  async function handleCreate() {
    if (!name.trim()) { setCreateError("name required"); return; }
    try {
      const ws = await createWorkspace({
        display_name: name.trim(),
        slug: slug.trim() || null,
        color,
      });
      await refresh();
      handleSelect(ws.id);
      setName(""); setSlug(""); setColor("#6b7280");
      setCreating(false);
    } catch (e) {
      setCreateError((e as Error).message);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete project "${name}"?`)) return;
    try {
      await deleteWorkspace(id);
      await refresh();
      if (currentOwner === id) handleSelect(null);
    } catch (e) {
      window.alert(`Failed to delete: ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          Projects
        </span>
        <button
          type="button"
          onClick={handleCreate}
          className="text-[10px] text-accent hover:underline"
          data-testid="project-create"
        >
          + New
        </button>
      </div>

      <div className="px-2">
        <div className="flex flex-col space-y-0.5">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              currentOwner === null
                ? "bg-surface-elevated font-medium text-foreground"
                : "text-foreground-subtle hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
            <span className="min-w-0 flex-1 truncate">All Projects</span>
          </button>

          {loading && <div className="px-2 py-1.5 text-[10px] text-foreground-subtle">Loading…</div>}
          {error && <div className="px-2 py-1.5 text-[10px] text-status-danger">{error.message}</div>}

          {workspaces.map((w) => (
            <div key={w.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleSelect(w.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  currentOwner === w.id
                    ? "bg-surface-elevated font-medium text-foreground"
                    : "text-foreground-subtle hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: w.color ?? "#6b7280" }}
                />
                <span className="min-w-0 flex-1 truncate">{w.display_name}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(w.id, w.display_name)}
                aria-label={`Delete ${w.display_name}`}
                className="invisible px-1.5 py-1 text-foreground-subtle hover:text-status-danger group-hover:visible"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: projects-store.ts 削除**

```bash
cd tastile-web
git rm src/lib/stores/projects-store.ts
```

- [ ] **Step 5: 残存参照の最終確認**

```bash
cd tastile-web
grep -rln "projects-store\|useProjectsStore" src/ 2>&1
```

Expected: 出力なし (完全に削除済み)。

- [ ] **Step 6: 型チェック & テスト**

```bash
cd tastile-web
bunx tsc --noEmit
bun test
bun run lint
```

Expected: エラー・警告なし。

- [ ] **Step 7: コミット**

```bash
cd tastile-web
git add -A
git commit -m "feat(web): rewrite ProjectsMain and SidePanel with owner_id filter"
```

---

## Task 10: Frontend - CALENDARS サイドパネルを Projects チェックボックスに置換

**Files:**
- Modify: `tastile-web/src/components/panels/CalendarSidePanel.tsx` (work/break/fixed/done チェックボックスを**削除**、Projects セクションで**置換**)
- Modify: `tastile-web/src/components/panels/ScheduleSidePanel.tsx` (Projects セクション追加)
- Modify: `tastile-web/src/app/dashboard/schedule/page.tsx` (URL クエリから owner_ids を ScheduleMain に渡す)
- Modify: `tastile-web/src/app/dashboard/timeline/page.tsx` (同 timeline)
- Modify: `tastile-web/src/components/schedule/ScheduleMain.tsx` (owner_ids を useTileList / get_timeline に渡す)

**目的 (validated 2026-06-30):** カレンダーサイドパネルの既存 work/break/fixed/done チェックボックスを**完全削除**。Projects (owner) チェックボックスで**置換**。タイムライン / スケジュール画面にサイドパネルからプロジェクト可視性チェックボックスを追加し、URL クエリ `?projects=u1,u2` で状態を管理。`get_timeline` の `owner_ids` に渡す。

- [ ] **Step 1: ScheduleSidePanel.tsx に Projects セクション追加**

`src/components/panels/ScheduleSidePanel.tsx` を更新。既存の内容を保持しつつ、Projects セクションを追加:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useProjects } from "@/lib/hooks/use-projects";
import { cn } from "@/lib/utils/cn";

// 既存のエクスポート関数 ScheduleSidePanel() を保持
export function ScheduleSidePanel() {
  // ... 既存コード ...

  return (
    <div className="flex flex-col gap-6 pt-2 select-none">
      {/* 既存の Time Range / Priority / Search セクション */}
      <ExistingSections />

      {/* Projects セクション (新規追加) */}
      <ProjectsCheckboxSection />
    </div>
  );
}

function ProjectsCheckboxSection() {
  const { workspaces, loading } = useProjects();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const allIds = useMemo(() => workspaces.map((w) => w.id), [workspaces]);
  const selected = useMemo(() => {
    const raw = searchParams.get("projects");
    if (!raw) return new Set(allIds);
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams, allIds]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === allIds.length) params.delete("projects");
    else params.set("projects", [...next].join(","));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  if (loading) {
    return <div className="px-3 text-[10px] text-foreground-subtle">Loading projects…</div>;
  }
  if (workspaces.length === 0) return null;

  return (
    <div className="px-3 border-t border-border/40 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-lighter">
          Projects
        </p>
        <span className="font-mono text-[10px] text-foreground-lighter">
          {selected.size}/{workspaces.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {workspaces.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-xs text-foreground-subtle hover:text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(w.id)}
              onChange={() => toggle(w.id)}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
              data-testid={`schedule-project-${w.id}`}
            />
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: w.color ?? "#6b7280" }}
            />
            <span className="min-w-0 flex-1 truncate">{w.display_name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

注: 既存セクション (Time Range, Priority, Search) はそのまま維持。`ExistingSections` プレースホルダーは実装時に実際の関数名に置換。

- [ ] **Step 2: CalendarSidePanel.tsx に Projects セクション追加 (Timeline 用)**

`src/components/panels/CalendarSidePanel.tsx` の `TimelineSidePanel` 関数に Projects セクションを追加。`useSidePanel` 経由で timeline/page.tsx に渡される。

- [ ] **Step 3: ScheduleMain.tsx で URL クエリを owner_ids に変換**

`src/components/schedule/ScheduleMain.tsx`:

```tsx
const searchParams = useSearchParams();
const ownerIdsFromUrl = useMemo(() => {
  const raw = searchParams.get("projects");
  if (!raw) return undefined;  // 全選択相当 (actor の Personal のみ)
  return raw.split(",").filter(Boolean);
}, [searchParams]);

const { tiles, loading } = useTileList({
  /* ... */
  ownerIds: ownerIdsFromUrl,
});
```

- [ ] **Step 4: timeline/page.tsx と schedule/page.tsx の更新**

両ページの `useSidePanel` 呼び出しに `searchParams.get("projects")` の変更を反映。`ScheduleMain` と `TimelinePage` に props として渡すか、または内部で `useSearchParams` を使う。

- [ ] **Step 5: 型チェック & テスト**

```bash
cd tastile-web
bunx tsc --noEmit
bun test
bun run lint
```

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/components/panels/ScheduleSidePanel.tsx src/components/panels/CalendarSidePanel.tsx src/components/schedule/ScheduleMain.tsx src/app/dashboard/schedule/page.tsx src/app/dashboard/timeline/page.tsx
git commit -m "feat(web): add project visibility checkboxes to schedule and timeline"
```

---

## Task 11: 最終検証 (E2E)

**Files:**
- (なし — 検証のみ)

**目的:** spec §6 の 6 条件を満たすことを確認する。

- [ ] **Step 1: バックエンド全テスト**

```bash
cd tastile-core
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Expected: すべて成功。

- [ ] **Step 2: フロントエンド全テスト**

```bash
cd tastile-web
bun test
bunx tsc --noEmit
bun run lint
```

Expected: エラー・警告なし。

- [ ] **Step 3: dev server 起動 + 手動 E2E**

```bash
# Terminal 1
cd tastile-core
cargo run -p tastile-v1-api

# Terminal 2
cd tastile-web
bun dev
```

ブラウザで:
1. Cognito ログイン → `/dashboard/projects`
2. 「+ New」でワークスペース作成 → 一覧に表示
3. ワークスペース選択 → タイル 0 件
4. `/dashboard/tiles?action=new` で `+ New Tile` → Owner でプロジェクト選択 → 作成 → ProjectsMain の一覧に表示
5. `/dashboard/schedule` でワークスペースのチェックボックスを OFF → 表示から消える
6. `/dashboard/timeline` でも同じチェックボックス動作
7. ProjectsSidePanel の `×` ボタンでワークスペース削除 → 確認ダイアログ → 削除

- [ ] **Step 4: スクリーンショット取得**

```bash
cd tastile-web
mkdir -p verify
# ブラウザ DevTools でスクリーンショット → verify/project-management.png
```

- [ ] **Step 5: spec §6 チェックリスト確認**

- [ ] `cargo test --workspace` 全件 Green
- [ ] `cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings` 警告なし
- [ ] `bun test` / `bunx tsc --noEmit` / `bun run lint` エラー・警告なし
- [ ] Step 3 の手動 E2E が動作
- [ ] `docs/decisions.md` に決定ログを追記
- [ ] コミット履歴が `feat(v1): ...` / `feat(web): ...` の規約に従う

- [ ] **Step 6: コミット (必要に応じて修正)**

```bash
cd tastile-core
git status
# 必要なら git commit --allow-empty -m "chore(v1): verified project management feature"

cd tastile-web
git status
# 必要なら git commit --allow-empty -m "chore(web): verified project management feature"
```

---

## Definition of Done (Task 11 で確認)

1. ✅ `cargo test --workspace` 全件 Green
2. ✅ `cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings` 警告なし
3. ✅ `bun test` / `bunx tsc --noEmit` / `bun run lint` エラー・警告なし
4. ✅ 手動 E2E (Step 3) 動作
5. ✅ `docs/decisions.md` に決定ログ追記
6. ✅ コミット履歴が規約遵守