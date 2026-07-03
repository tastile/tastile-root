# Project Management (owner_id wiring) 設計

- **Status**: Validated (2026-06-30)
- **Draft date**: 2026-06-29
- **Validation date**: 2026-06-30
- **Author**: brainstorming session with user
- **Scope**: `tastile-core` (v1) と `tastile-web` を「プロジェクト = 任意 subject を owner とする Tile 集合」として end-to-end で接続する
- **Out of scope**: access_repo grant 機構、Subject member role (ADMIN/MEMBER/VIEWER)、複数ユーザー招待、Email 通知

## 0. 確定した設計判断 (2026-06-30 ユーザー確認済み)

1. **CALENDARS サイドパネル**: 既存の work/break/fixed/done ブロックタイプチェックボックスを**廃止**し、Project (owner) チェックボックスで**完全置換**。ブロックタイプの表示切替は v1 仕様外 (タイルの `kind` で個別に制御)
2. **新規プロジェクト作成 UX**: `window.prompt()` は使わず、**ProjectsSidePanel 内のインラインフォーム**で実装 (name + color + slug)。色と slug は省略可
3. **workspace データモデル**: `display_name` (必須) + `color` (任意) + `slug` (任意、URL/識別子用)。description は MVP 後
4. **マイグレーション**: 新規マイグレーションは作らない。`v1_subject` は既存 V1_003__tenancy を正本とする

## 1. 背景と目的

`tastile-core` v1 era では全 Aggregate が `owner_id` を持ち、v1/14 §8 で「すべての Read/Command は owner 境界で認可する」と定義されている。一方:

- `v1_subject` テーブルが **どの migration にも存在しない** (`access_repo.rs` が参照するテーブルが DB に無い)
- `access_repo.rs` は完全実装済みだが起動不可
- subject の list / update / delete エンドポイントが未実装
- コマンドの `owner_id` が常に認証ヘッダ (`x-owner-id`) から決まり、body で上書きする経路が無い
- read query が常に単一 `owner_id = $1` でフィルタされ、複数 owner の UNION が無い

`tastile-web` 側:

- `useProjectsStore` (zustand + localStorage) は **バックエンドと未接続**。フリーテキストのラベルベース疑似プロジェクト
- `ProjectsMain` は `labelFilter` (ラベルの交差) でフィルタ。所有権ではない
- `QuickTileCreate` の `meta.project` は **string (フリーテキスト)**。所有権 ID ではない
- タイムライン (ScheduleSidePanel / TimelineSidePanel) に「プロジェクト可視性チェックボックス」が無い

### 設計の絶対条件

1. **owner_id を end-to-end で実際に接続する**。`v1_subject` テーブルを作り、コマンドで body 指定可能にし、read で複数 owner を UNION する
2. **プロジェクト = `v1_subject` の `kind=1` (WORKSPACE) 行**。新しい kind は追加しない
3. **MVP**: subject list / create / delete のみ。grant 機構 (v1_grant, v1_capability, v1_notification, v1_audit_event, v1_condition_atom) は未使用
4. **MVP**: メンバーシップは `v1_subject.owner_user_id` の単一カラムで表現。`v1_subject_member` テーブルは作らない (将来 full grant 機構に戻すときに追加)
5. **後方互換性なし**。開発中なので既存データ・既存 API レスポンスを破壊して良い
6. **v1 仕様遵守**: 数値定数のみ (v1/10 §2)、owner 境界で認可 (v1/14 §8)
7. **新ファイル追加不要、既存ファイル直接編集**で進める。`useProjectsStore` 削除 / `labelFilter` 削除 / `meta.project` 削除
8. **マイグレーションファイルを作らない**。`V1_001__base.sql` を直接編集する
9. **ビルド/型チェック/lint/test を必ず通す**。最終確認は `cargo test --workspace` + `bun test` + `bunx tsc --noEmit`

### 触って良いファイル / 触らないファイル

| 区分 | ファイル |
| --- | --- |
| **バックエンド: 編集** | `crates/v1/storage/migrations/V1_001__base.sql` (`v1_subject` 追加), `crates/v1/storage/src/access_repo.rs` (owner_user_id 関連 + list_for_owner), `crates/v1/api/src/handlers/access.rs` (list / delete + workspace 専用 create), `crates/v1/api/src/handlers/common.rs` (create_tile で body.owner_id サポート), `crates/v1/api/src/handlers/commands.rs` (全コマンドで owner_id 経路追加), `crates/v1/api/src/handlers/read.rs` (list_tiles に owner_ids クエリ), `crates/v1/api/src/handlers/timeline.rs` (get_timeline に owner_ids クエリ), `crates/v1/api/src/main.rs` (route 登録) |
| **バックエンド: 削除** | `commands.rs` の `meta.project` 文字列ハンドリング (web 側なので該当なし。バックエンドは `owner_id` (UUID) のみ) |
| **バックエンド: 触らない** | `crates/v1/storage/migrations/v0/`, `crates/v1/storage/migrations/v1/V*.sql` (並行稼働ルール), `crates/v1/api/src/handlers/{placement,execution,flow,...}.rs` のロジック |
| **フロント: 編集** | `src/lib/api/endpoints.ts` (subject エンドポイント定義), `src/lib/api/v1/build-command.ts` (`project` → `owner_subject_id`), `src/lib/stores/quick-create-store.ts` (`meta.project` → `meta.ownerSubjectId`), `src/components/projects/ProjectsMain.tsx` (labelFilter → owner_id), `src/components/panels/ProjectsSidePanel.tsx` (API 呼び出し), `src/components/panels/ScheduleSidePanel.tsx` (チェックボックス), `src/components/panels/CalendarSidePanel.tsx` (TimelineSidePanel として共有, チェックボックス), `src/components/tiles/QuickTileCreate.tsx` (§7 Meta → Owner), `src/app/dashboard/schedule/page.tsx` (チェックボックス状態連携), `src/app/dashboard/timeline/page.tsx` (チェックボックス状態連携) |
| **フロント: 削除** | `src/lib/stores/projects-store.ts` (完全削除), `useProjectsStore` を使う全コンポーネント (labelFilter / プロンプトベース作成) |
| **フロント: 触らない** | `src/components/shell/*`, `src/lib/daemon/*` (auth), `src/lib/cognito/*` |

## 2. アーキテクチャ

### 2.1 全体像

```
tastile-web                              tastile-core (v1)
─────────────                            ──────────────────
Browser (Cognito sub)
  │  ↓ id_token
  ▼
[proxy bridge] ─ x-tastile-web-session-user + bridge secret
  │
  ▼
GET /v1/access/subjects?kind=1 ────► access_repo::list_for_owner
                                     ↓
                                     v1_subject (kind=1, owner_user_id=actor)
                                     ← list

GET /v1/access/subjects (POST) ─────► access_repo::create_workspace
                                     ↓
                                     v1_subject (kind=1, owner_user_id=actor)
                                     ← id

GET /v1/tiles?owner_ids=u,p1,p2  ───► read::list_tiles
                                     ↓
                                     v1_tile WHERE owner_id = ANY(u,p1,p2)
                                       AND owner_id 集合 ⊆ (actor の subject 集合)
                                     ← tiles

POST /v1/tiles { owner_id: p1 } ────► commands::create_tile
                                     ↓
                                     1. body.owner_id を抽出
                                     2. owner_id == actor → OK
                                        owner_id.kind=1 → v1_subject.owner_user_id 検証
                                     3. v1_tile INSERT (owner_id = p1)
                                     ← CommandResponse
```

### 2.2 データモデル

`v1_subject` を `V1_001__base.sql` に追記:

```sql
CREATE TABLE v1_subject (
    id                uuid PRIMARY KEY,
    kind              smallint NOT NULL,        -- 0=USER 1=WORKSPACE 2=GROUP 3=ROLE 4=ORG
    external_subject  text UNIQUE,
    slug              text,                     -- MVP 2026-06-30: optional URL/識別子
    display_name      text NOT NULL,
    email             text,
    parent_subject_id uuid REFERENCES v1_subject(id),
    owner_user_id     uuid,                     -- MVP: WORKSPACE の単一所有者
    disabled_at       timestamptz,
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    CHECK (kind BETWEEN 0 AND 4),
    CHECK (kind <> 1 OR owner_user_id IS NOT NULL)  -- kind=1 (WORKSPACE) なら owner_user_id 必須
);
CREATE INDEX v1_subject_kind_idx ON v1_subject(kind);
CREATE INDEX v1_subject_owner_idx ON v1_subject(owner_user_id);
```

`v1_subject_member` は **作らない**。MVP は `owner_user_id` で十分。grant 機構が将来必要になったら access_repo のスケルトンを活性化する。

### 2.3 認可モデル

2 つのパスを許可:

1. **actor = owner_id** (`v1_subject.id` と `x-owner-id` ヘッダが一致): 全コマンド可
2. **actor = workspace の所有者**: body で `owner_id = workspace.id` を指定可能
   - 検証: `v1_subject.owner_user_id = actor AND v1_subject.kind = 1 AND disabled_at IS NULL`
   - 一致しなければ `ApiErrorKind::FORBIDDEN (1)`

`x-owner-id` ヘッダ由来の actor と body の `owner_id` が両方指定された場合、**body を優先**。ヘッダの actor はそのまま記録。

## 3. バックエンド実装

### 3.1 `v1_subject` テーブル

**注 (2026-06-30 検証済み)**: `v1_subject` テーブルは既に V1_003__tenancy migration で作成済み (V1_001__base.sql ではない)。**新規マイグレーションは作らない**。V1_003 を正本とし、列の確認のみ Task 1 の検証スクリプトで実施。

`migrations.rs` は `V1_*` プレフィックスを順次適用する実装。新規テーブル追加は idempotent な `CREATE TABLE IF NOT EXISTS` なので、再適用で重複エラーは出ない。

### 3.2 `access_repo.rs` 拡張

新規関数:

```rust
pub mod subject_kind {
    pub const USER: i16 = 0;
    pub const WORKSPACE: i16 = 1;
    pub const GROUP: i16 = 2;
    pub const ROLE: i16 = 3;
    pub const ORG: i16 = 4;
}

pub async fn create_workspace(
    tx: &mut Transaction<'_, Postgres>,
    owner_user_id: Uuid,
    display_name: &str,
    slug: Option<&str>,
    color: Option<&str>,
    now: DateTime<Utc>,
) -> RepoResult<SubjectRow>;

pub async fn list_workspaces_for_owner(
    pool: &PgPool,
    owner_user_id: Uuid,
) -> RepoResult<Vec<SubjectRow>>;

pub async fn delete_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
    actor_user_id: Uuid,
) -> RepoResult<()>;

pub async fn update_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
    actor_user_id: Uuid,
    display_name: Option<&str>,
    slug: Option<Option<&str>>,
    color: Option<Option<&str>>,
    now: DateTime<Utc>,
) -> RepoResult<SubjectRow>;
```

注: `access_repo.rs` の既存 `create_subject` / `get_subject_by_id` / `get_subject_by_external` はそのまま残す。MVP では使わないがスケルトンを保持。

### 3.3 `access.rs` handler 拡張

```rust
// 既存 (kind 自由)
POST   /v1/access/subjects
GET    /v1/access/subjects/{id}
GET    /v1/access/subjects/by-external

// 新規
GET    /v1/access/subjects?kind=1       list_my_workspaces (actor の WORKSPACE 一覧)
POST   /v1/access/workspaces            create_workspace (kind=1 固定 + owner_user_id 自動設定)
PATCH  /v1/access/subjects/{id}         update_workspace (display_name / slug / color を部分更新、OWNER のみ)
DELETE /v1/access/subjects/{id}         delete (OWNER のみ)
```

`POST /v1/access/workspaces` は専用エンドポイント。`POST /v1/access/subjects` は MVP では無効化 (kind を 1..4 で何でも受け付ける現状は混乱を招く)。

### 3.4 コマンド経路の owner_id

`crates/v1/api/src/handlers/common.rs` に新ヘルパー:

```rust
/// Resolve the target owner_id from (body, header, fallback).
/// body takes precedence; falls back to x-owner-id; final fallback is
/// the authenticate() result.
///
/// Authorization: if body_owner_id != actor_user_id, validate that
/// body_owner_id is a WORKSPACE subject owned by actor_user_id.
/// Otherwise return FORBIDDEN.
pub async fn resolve_command_owner(
    state: &AppState,
    headers: &HeaderMap,
    body_owner_id: Option<Uuid>,
) -> Result<Uuid, ApiHttpError>;
```

`commands.rs` の全コマンドで `read_owner` を `resolve_command_owner` に置換。コマンドペイロードに `owner_id: Option<Uuid>` を受けるようにする:

```rust
#[derive(Deserialize)]
pub struct CreateTileBody {
    pub payload: CreateTilePayload,
    pub owner_id: Option<Uuid>,
}
```

### 3.5 read 経路の owner_ids

`list_tiles` (`read.rs:119`):

```rust
#[derive(Deserialize)]
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
    let owner_ids: Vec<Uuid> = match q.owner_ids {
        Some(s) => s.split(',').filter_map(|x| Uuid::parse_str(x).ok()).collect(),
        None => vec![actor],  // デフォルトは actor の Personal のみ
    };
    // 認可: owner_ids の各々が actor に許可されているか
    for &oid in &owner_ids {
        if oid == actor { continue; }
        let subj = access_repo::get_subject_by_id(&state.store.pool, oid).await?;
        if subj.kind != 1 || subj.owner_user_id != Some(actor) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let rows = sqlx::query_as("SELECT ... FROM v1_tile WHERE owner_id = ANY($1) AND archived_at IS NULL ORDER BY created_at DESC LIMIT $2")
        .bind(&owner_ids)
        .bind(limit.unwrap_or(500))
        ...
}
```

`get_timeline` (`timeline.rs:54`) にも同じ `owner_ids` クエリを追加。`WHERE p.owner_id = ANY($N)` に置換。

### 3.6 検証

- `cargo test --workspace` 全件 Green
- 追加ユニットテスト:
  - `access_repo::create_workspace` で `owner_user_id` が actor に設定される
  - `access_repo::delete_workspace` で actor が所有者でない場合 `Forbidden`
  - `resolve_command_owner` で body.owner_id が他人の workspace なら FORBIDDEN
- 追加インテグレーションテスト (任意): E2E でワークスペース作成 → タイル作成 → list で取得

## 4. フロントエンド実装

### 4.1 API クライアント

`src/lib/api/endpoints.ts` に追加:

```ts
listMyWorkspaces: {
  method: "GET",
  path: "/access/subjects?kind=1",
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

### 4.2 `useProjects` フック

`src/lib/hooks/use-projects.ts` (新規):

```ts
export interface Workspace {
  id: string;
  display_name: string;
  slug: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export function useProjects() {
  return useSWR("/access/subjects?kind=1", async () => {
    const res = await getCoreClient().call<{ items: Workspace[] }>("listMyWorkspaces");
    if (!res.ok) throw new Error(res.error.message);
    return res.data.items;
  }, { refreshInterval: 0, revalidateOnFocus: true });
}

export async function createWorkspace(displayName: string, color?: string) {
  const res = await getCoreClient().call<Workspace>("createWorkspace", {
    body: { display_name: displayName, color },
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

export async function deleteWorkspace(id: string) {
  const res = await getCoreClient().call<{ ok: true }>("deleteSubject", { pathParams: { id } });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}
```

### 4.3 既存コードの置換

**注 (2026-06-30 検証済み)**: 既存の「CALENDARS」セクションの work/break/fixed/done チェックボックスは廃止 (ユーザー判断 §0.1)。新規 Projects セクションで置換。`ProjectsMain` のインライン作成フォームは name + color + slug 入力可能。

### 4.3.1 インライン作成フォームの構造

`ProjectsSidePanel.tsx` 内で、`+ New` ボタン押下時に直下に小さなフォーム (collapsible) を表示:

```tsx
{creating ? (
  <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 px-2 py-2 border-t border-border/40">
    <Input
      autoFocus
      placeholder="Project name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      maxLength={80}
      required
    />
    <div className="flex items-center gap-2">
      <Input
        placeholder="slug (optional)"
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
        pattern="[a-z0-9-]+"
        maxLength={40}
      />
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-8 w-12 rounded border border-border cursor-pointer"
      />
    </div>
    <div className="flex items-center gap-1.5">
      <Button type="submit" size="sm" disabled={!name.trim()}>Create</Button>
      <Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
    </div>
  </form>
) : (
  <button onClick={() => setCreating(true)}>+ New</button>
)}
```

`handleSubmit`:
```ts
const ws = await createWorkspace({ display_name: name.trim(), slug: slug.trim() || null, color });
await refresh();
handleSelect(ws.id);
setCreating(false);
setName(""); setSlug(""); setColor("#6b7280");
```

### 4.3.2 既存コードの置換

**削除**:

- `src/lib/stores/projects-store.ts` ファイルごと削除
- `useProjectsStore` を import している全箇所を `useProjects` に置換
- `ProjectsMain.tsx` の `labelFilter` ロジック全削除
- `QuickTileCreate.tsx` の `meta.project` (フリーテキスト) を全削除
- `useQuickCreateStore` の `meta.project` 型を削除し `meta.ownerSubjectId: string | null` に変更
- `lib/api/v1/build-command.ts` の `project` フィールドを `owner_subject_id: string | null` に変更、ペイロードに含める

**`ProjectsMain.tsx` 新規**:

```ts
"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { TileCardCompact } from "@/components/tiles/TileCardCompact";
import { Skeleton } from "@/components/ui/Skeleton";
import { useProjects } from "@/lib/hooks/use-projects";
import { useTileList } from "@/lib/hooks/use-tile-list";
import { mapListViewToTile } from "@/lib/utils/map-list-view-to-tile";

export function ProjectsMain() {
  const searchParams = useSearchParams();
  const ownerId = searchParams.get("owner");
  const { workspaces, loading: wsLoading } = useProjects();
  const project = ownerId ? workspaces.find((w) => w.id === ownerId) : null;

  const { tiles, loading } = useTileList({
    ownerIds: ownerId ? [ownerId] : undefined,  // 新クエリパラメータ
    limit: 500,
  });

  return (
    <PageContainer>
      <PageHeader title={project ? project.display_name : "All Projects"} ... />
      {/* TileCardCompact のリスト */}
    </PageContainer>
  );
}
```

**注 (2026-06-30 検証済み)**: ユーザーは「オーナーごとの情報についてより詳しく設定を読み書きできるようにする」と要求。MVP では ProjectsMain 上部に ProjectEditForm (display_name / slug / color の編集 + tile count / created_at の表示) を表示。MVP 後の将来拡張 (description, default_priority, member 管理) は本仕様の Out of scope。

**`ProjectsSidePanel.tsx` 新規**:

```ts
"use client";

import { useProjects, createWorkspace, deleteWorkspace } from "@/lib/hooks/use-projects";

export function ProjectsSidePanel() {
  const { workspaces, refresh } = useProjects();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentOwner = searchParams.get("owner") ?? null;

  function handleCreate() {
    const name = prompt("Project name:");
    if (!name) return;
    void createWorkspace(name).then(() => refresh());
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this project?")) return;
    void deleteWorkspace(id).then(() => refresh());
  }

  // ... (All Projects + ワークスペース一覧 + + New / 🗑)
}
```

### 4.4 タイムライン / スケジュールのチェックボックス

**注 (2026-06-30 検証済み)**: 既存の `CalendarSidePanel` の work/break/fixed/done チェックボックスは**完全削除**。サイドパネル最上部に Projects チェックボックスを配置。`ScheduleSidePanel` にも同様の Projects セクションを追加。

`ScheduleSidePanel.tsx` に追加:

```ts
"use client";

import { useProjects } from "@/lib/hooks/use-projects";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function ScheduleSidePanel() {
  const { workspaces } = useProjects();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL: ?projects=<id1>,<id2>,... 省略時は全選択
  const selected = useMemo(() => {
    const raw = searchParams.get("projects");
    return raw ? raw.split(",") : workspaces.map((w) => w.id);
  }, [searchParams, workspaces]);

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === workspaces.length) params.delete("projects");
    else params.set("projects", next.join(","));
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
        Projects
      </div>
      <div className="px-2 flex flex-col gap-1">
        {workspaces.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={selected.includes(w.id)}
              onChange={() => toggle(w.id)}
              className="..."
            />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: w.color ?? "#6b7280" }} />
            <span className="truncate">{w.display_name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

`TimelineSidePanel` (`CalendarSidePanel` を流用) にも同じ「Projects」セクションを追加。

### 4.5 QuickTileCreate の Owner 選択

`src/components/tiles/QuickTileCreate.tsx` の §7 Meta セクションを以下に置換:

```tsx
<section>
  <h3>Owner</h3>
  <select
    value={state.meta.ownerSubjectId ?? ""}
    onChange={(e) => useQuickCreateStore.getState().setMeta("ownerSubjectId", e.target.value || null)}
  >
    <option value="">Personal (default)</option>
    {workspaces.map((w) => (
      <option key={w.id} value={w.id}>{w.display_name}</option>
    ))}
  </select>
</section>
```

`build-command.ts` のペイロード:

```ts
{
  // 既存フィールド...
  owner_subject_id: state.meta.ownerSubjectId,
}
```

`commands.ts` の `CreateTilePayload` (Rust) に `owner_id` が未定義なら追加。`buildCreateTileCommand` で `owner_subject_id` を envelope に乗せる。

### 4.6 検証

- `bun test` 全件 Green
- `bunx tsc --noEmit` エラーなし
- `bun run lint` 警告なし
- 手動 E2E:
  1. Cognito ログイン → `/dashboard/projects`
  2. 「+ New」でワークスペース作成 → 一覧に表示
  3. ワークスペース選択 → タイル 0 件
  4. `+ New Tile` → Owner でプロジェクト選択 → 作成 → ProjectsMain の一覧に表示
  5. `/dashboard/schedule` でワークスペースのチェックボックス ON/OFF → 表示が切り替わる

## 5. ロールアウト

### 5.1 開発フロー

1. **バックエンド**:
   1. ~~`V1_001__base.sql` に `v1_subject` を追加~~ (スキップ: V1_003__tenancy 既存)
   2. `access_repo.rs` に `create_workspace` / `list_workspaces_for_owner` / `delete_workspace` / `update_workspace` を追加
   3. `access.rs` に `POST /v1/access/workspaces`, `PATCH /v1/access/subjects/{id}`, `DELETE /v1/access/subjects/{id}`, `GET /v1/access/subjects?kind=1` を追加
   4. `commands.rs` 全コマンドで body.owner_id サポート
   5. `read.rs::list_tiles` と `timeline.rs::get_timeline` に owner_ids クエリ追加
   6. `cargo test --workspace` で AT 全件 Green
2. **フロントエンド**:
   1. `useProjects` フック作成 (list / create / update / delete)
   2. `endpoints.ts` に list/create/update/delete 定義
   3. `projects-store.ts` 削除
   4. `ProjectsMain.tsx` / `ProjectsSidePanel.tsx` 書き換え (インライン作成フォーム + edit フォーム)
   5. `CalendarSidePanel.tsx` の work/break/fixed/done チェックボックスを**削除**、Projects チェックボックスで**置換**
   6. `QuickTileCreate.tsx` の §7 書き換え、`build-command.ts` のペイロード書き換え
   7. `ScheduleSidePanel.tsx` / `TimelineSidePanel` (CalendarSidePanel) に Projects チェックボックス追加
   8. `bun test` / `bunx tsc --noEmit` / `bun run lint`
3. **E2E**:
   1. dev server を起動 (`bun dev`)
   2. ブラウザで Cognito ログイン → 上記手動 E2E を実行
   3. スクリーンショット取得 (`verify-project-management.png`)

### 5.2 ロールバック

- `V1_001__base.sql` 追記を `git revert`
- `access_repo.rs` / `access.rs` の変更を `git revert`
- `commands.rs` / `read.rs` / `timeline.rs` の変更を `git revert`
- フロントエンド: `git revert` で全変更を巻き戻し

### 5.3 コミット方針

- 1 機能 = 1 commit (Conventional Commits)
  - `feat(v1): add v1_subject table and workspace CRUD endpoints`
  - `feat(v1): wire owner_id through commands and reads`
  - `feat(web): replace projects-store with useProjects hook`
  - `feat(web): add project checkbox panel to schedule and timeline`
  - `feat(web): add owner selector to QuickTileCreate`

## 6. 受け入れ条件 (Definition of Done)

1. `cargo test --workspace` が全件 Green (新規 AT も追加済み)
2. `cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings`
3. `bun test` / `bunx tsc --noEmit` / `bun run lint` がエラー・警告なし
4. 上記 §4.6 の手動 E2E が動作
5. `docs/decisions.md` に決定ログを追記 (本設計の承認履歴)
6. コミット履歴が `feat(v1): ...` / `feat(web): ...` の規約に従う