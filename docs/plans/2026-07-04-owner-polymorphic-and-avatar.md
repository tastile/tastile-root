# 2026-07-04 owner-polymorphic-and-avatar

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:executing-plans` を Step 1 から順に使う。
> 各 Step は 1 commit。Step 完了 = 当該 AT 全件 Green。

## Goal

Tastile に **polymorphic Owner 集約 + Profile + Avatar upload** を導入する。
- Cognito ユーザーだけでなく、将来の Project / Workspace を同じ owner の種類として扱う
- ユーザーは avatar を Tastile 側でホスティング (S3) し、Slack/Discord 風にサーバー(プロジェクト)単位で display_name/avatar の override を持てる
- 既存 10 テーブルの `owner_id` を **破壊せず** polymorphic に拡張
- Phase A スコープ = Cognito USER の global profile + S3 avatar upload。Project/Workspace/membership のテーブルは **作成のみ**で Phase X に持ち越し

## Background / Brainstorming decisions

| Question | Decision |
| --- | --- |
| Profile の fields | Discord レベル = `display_name, avatar_url, bio, accent_color` |
| Cognito linkage | DB に `v1_owner_user.cognito_sub` 保存 (別途 JWT claim も) |
| Polymorphic owner を今入れるか | **今入れる**(あとから schema 書き直しが高コスト) |
| Per-scope override (Server profile) | **Phase A でスキーマ + 解決ロジックのみ実装**。UI は Phase X |
| Avatar upload | S3 Presigned PUT + CloudFront OAC。クライアント側 resize + WebP |
| Cognito `picture` attribute ミラー | **行わない** (`v1_owner` を SSoT、JWT claim には乗せない) |
| Cognito passwordless 強化 | 本プランでは扱わない(別 plan: `2026-07-XX-auth-hardening`) |

## 設計

### Section 1 — Data model

新規 owner 系 5 テーブル + 既存 10 テーブルへの `owner_kind` 列追加。

#### 1.1 `v1_owner` — polymorphic 集約

```sql
CREATE TABLE v1_owner (
    kind         smallint NOT NULL,    -- OwnerKind: 0=USER, 1=PROJECT, 2=WORKSPACE
    id           uuid     NOT NULL,
    display_name text     NOT NULL,
    avatar_url   text,
    bio          text,
    accent_color text,
    revision     bigint   NOT NULL,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    archived_at  timestamptz,
    PRIMARY KEY (kind, id),
    CONSTRAINT v1_owner_kind_range CHECK (kind BETWEEN 0 AND 255),
    CONSTRAINT v1_owner_archived_after_update
        CHECK (archived_at IS NULL OR archived_at >= updated_at)
);
CREATE INDEX v1_owner_id_idx ON v1_owner(id);
CREATE INDEX v1_owner_active_idx ON v1_owner(kind, updated_at DESC) WHERE archived_at IS NULL;
```

#### 1.2 kind 別 1:1 拡張テーブル (3 件)

```sql
-- USER 専用 (Cognito linkage)
CREATE TABLE v1_owner_user (
    kind           smallint NOT NULL,  -- 0 固定
    id             uuid     NOT NULL,
    cognito_sub    text     NOT NULL UNIQUE,
    email          text     NOT NULL,
    email_verified boolean  NOT NULL DEFAULT false,
    state          smallint NOT NULL DEFAULT 0,   -- 0=ACTIVE, 1=SUSPENDED, 2=DELETED
    last_login_at  timestamptz,
    PRIMARY KEY (kind, id),
    FOREIGN KEY (kind, id) REFERENCES v1_owner(kind, id),
    CONSTRAINT v1_owner_user_kind CHECK (kind = 0)
);

CREATE TABLE v1_owner_project (
    kind       smallint NOT NULL,  -- 1 固定
    id         uuid     NOT NULL,
    short_name text     NOT NULL UNIQUE,
    parent_kind smallint,
    parent_id   uuid,
    state      smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, id),
    FOREIGN KEY (kind, id) REFERENCES v1_owner(kind, id),
    FOREIGN KEY (parent_kind, parent_id) REFERENCES v1_owner(kind, id),
    CONSTRAINT v1_owner_project_kind CHECK (kind = 1)
);

CREATE TABLE v1_owner_workspace (
    kind      smallint NOT NULL,  -- 2 固定
    id        uuid     NOT NULL,
    plan_tier smallint NOT NULL DEFAULT 0,
    state     smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, id),
    FOREIGN KEY (kind, id) REFERENCES v1_owner(kind, id),
    CONSTRAINT v1_owner_workspace_kind CHECK (kind = 2)
);
```

#### 1.3 per-scope override (`v1_owner_scope_profile`)

```sql
CREATE TABLE v1_owner_scope_profile (
    owner_kind  smallint NOT NULL,    -- 0=USER 固定 (Phase A)
    owner_id    uuid     NOT NULL,
    scope_kind  smallint NOT NULL,    -- 1=PROJECT, 2=WORKSPACE
    scope_id    uuid     NOT NULL,
    display_name text,
    avatar_url   text,
    bio          text,
    accent_color text,
    revision     bigint   NOT NULL,
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (owner_kind, owner_id, scope_kind, scope_id),
    FOREIGN KEY (owner_kind, owner_id) REFERENCES v1_owner(kind, id),
    FOREIGN KEY (scope_kind, scope_id) REFERENCES v1_owner(kind, id),
    CHECK (owner_kind = 0 AND scope_kind IN (1, 2))
);
-- Phase A では行無し。Phase X の membership 実装と一緒に着手
```

#### 1.4 membership (`v1_owner_membership`) — Phase A 行無し

```sql
CREATE TABLE v1_owner_membership (
    id              uuid     PRIMARY KEY,
    scope_kind      smallint NOT NULL,    -- 1=PROJECT or 2=WORKSPACE
    scope_id        uuid     NOT NULL,
    actor_kind      smallint NOT NULL,    -- ActorKind: 0=USER
    actor_id        uuid     NOT NULL,
    role            smallint NOT NULL,    -- 0=OWNER, 1=ADMIN, 2=EDITOR, 3=VIEWER
    granted_by_kind smallint NOT NULL,
    granted_by_id   uuid     NOT NULL,
    granted_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    CONSTRAINT v1_owner_membership_scope_actor_unique_active
        UNIQUE (scope_kind, scope_id, actor_kind, actor_id) WHERE revoked_at IS NULL,
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
    CHECK (scope_kind IN (1, 2) AND actor_kind BETWEEN 0 AND 255)
);
CREATE INDEX v1_owner_membership_actor_idx
    ON v1_owner_membership(actor_kind, actor_id) WHERE revoked_at IS NULL;
CREATE INDEX v1_owner_membership_scope_idx
    ON v1_owner_membership(scope_kind, scope_id, role) WHERE revoked_at IS NULL;
```

#### 1.5 既存 10 テーブルへの `owner_kind` 追加

`v1_tile / v1_recurring / v1_plan / v1_placement / v1_execution / v1_change_set / v1_window / v1_flow / v1_feedback_txn / v1_session` の各々に:

```sql
ALTER TABLE v1_<x> ADD COLUMN owner_kind smallint NOT NULL DEFAULT 0;
ALTER TABLE v1_<x> ADD CONSTRAINT v1_<x>_owner_kind_range
    CHECK (owner_kind BETWEEN 0 AND 255);
-- 既存の owner_idx を (owner_kind, owner_id) に張り替え
```

DEFAULT 0 + 既存行 0 backfill で破壊なし。Phase A では 0=USER のみが書かれる。

### Section 2 — API 表面

#### 2.1 Profile CRUD

```
GET    /v1/owners/{kind}/{id}/profile
PATCH  /v1/owners/{kind}/{id}/profile
       body: { display_name?, avatar_url?, bio?, accent_color?, expected_revision? }
       → STALE_REVISION (v1/10 §4-2)

GET    /v1/scopes/{kind}/{id}/members/{actor_kind}/{actor_id}/profile
       → 200 { display_name, avatar_url, bio, accent_color, source: "override|global", revision }

PUT    /v1/scopes/{kind}/{id}/members/{actor_kind}/{actor_id}/profile-override
DELETE /v1/scopes/{kind}/{id}/members/{actor_kind}/{actor_id}/profile-override
       (Phase A では 501 "not yet supported")
```

Idempotency-Key ヘッダ必須。 `PATCH`/`PUT` は部分更新。

#### 2.2 Avatar Upload (Presigned PUT → S3 直接)

```
POST   /v1/uploads/avatar
       body: { target_kind, target_id, scope_kind?, scope_id?, content_type, byte_size }
       → 201 { upload_id, presigned_put_url, expires_at, claim_token }

PUT    <presigned_put_url>           # クライアント → S3
POST   /v1/uploads/avatar/{upload_id}/commit
       body: { claim_token }
       → 200 { owner_kind, owner_id, scope_kind?, scope_id?, avatar_url }
       副作用: profile 更新 + Outbox event
```

#### 2.3 Timeline embed

`GET /v1/timeline` の element に:

```json
{
  "tile_id": "...",
  "kind": 1,
  "owner": {
    "ref":     { "kind": 0, "id": "<uuid>" },
    "profile": { "display_name": "Alice", "avatar_url": "https://cdn..." }
  }
}
```

override は Timeline レスポンスに含めない(必要なら scope sync endpoint から別途)。

### Section 3 — S3 / CloudFront / IAM

| Bucket | `tastile-avatar-<env>` (private, OAC only) |
| --- | --- |
| Distribution | CloudFront + Origin Access Control, `https://cdn.tastile.example/avatar/v1/...` |
| Path | `/committed/<kind>/<id>/r<rev>/source.webp` + `/variants/{32,64,128}.webp` |
| Presigned URL TTL | 15 分 |
| Lifecycle | `pending/*` → 15 min 後 Expire / `committed/.../r<N>` (N != latest) → 30d 後 Glacier → 90d 削除 |
| API role | `s3:PutObject/GetObject` to `pending/*` + `committed/*` (Condition で `aws:PrincipalTag/app=tastile-api`) |
| CORS | AllowedOrigins = `app.tastile.example` + `localhost:3000`、PUT only |
| Client resize | クライアント側 `<canvas>` / Android `BitmapFactory` で 256/64/32 を WebP encode → 3 variants 同時 PUT |

Cognito `picture` ミラーは **行わない**(JWT に profile は乗らない。`v1_owner` を SSoT)。

### Section 4 — Client 統合

Web:
- `/settings/profile` panel → avatar tap → file picker → 3-step progress (pick / upload / commit)
- Display fallback chain: `profile.avatar_url → Gravatar(email) → initials(display_name)`
- TopBar `Avatar` (memory v33) を `owner_profile` から供給

Android (Compose):
- Coil (`io.coil-kt.coil3:coil-compose`) で `AsyncImage(model = profile.avatar_url, ...)`
- `BitmapFactory` decode → scale → WebP encode → 3 variants 同時
- Placeholder: `drawText(display_name[0], accent_color ?: 預り)` (timeline v33 と整合)

Sync:
- `OutboxEvent::ProfileUpdated { owner_kind, owner_id, scope_kind?, scope_id?, fields[], new_revision }`
- クライアントは自分が開いている scope に属する owner だけ subscribe
- revision 単調増加を信頼(古い rev は破棄)

### Section 5 — Acceptance Tests

AT-074 〜 AT-086 を追加。Total 89 件 Green 完了条件。

| AT | Category | シナリオ |
| --- | --- | --- |
| AT-074 | Domain Unit | OwnerKind 定数: USER=0, PROJECT=1, WORKSPACE=2、範囲 0..255 |
| AT-075 | Domain Unit | Profile の expected_revision 競合で ApiErrorKind::STALE_REVISION |
| AT-076 | Domain Unit | Global profile PATCH、null フィールド = no-op |
| AT-077 | Domain Unit | Scope override PATCH、scope = USER は不可 |
| AT-078 | PostgreSQL Integration | 拡張テーブルへの kind 違反 insert が CHECK で reject |
| AT-079 | PostgreSQL Integration | 既存 10 tables の owner_kind DEFAULT 0 で backfill、既存 SELECT が動的不変 |
| AT-080 | PostgreSQL Integration | membership 部分 UNIQUE INDEX(revoked_at IS NULL の行で 1 件以下) |
| AT-081 | PostgreSQL Integration | profile 更新 → v1_stamp に entity_kind=OWNER, role=UPDATED 記録 |
| AT-082 | API E2E | JWT 初回サインイン → v1_owner + v1_owner_user 自動作成 |
| AT-083 | API E2E | POST `/v1/uploads/avatar` → presigned URL → PUT → commit → profile.avatar_url 更新 + Outbox |
| AT-084 | API E2E | commit の claim_token 不一致で VALIDATION |
| AT-085 | API E2E | Timeline GET レスポンスに `owner.profile.{display_name, avatar_url}` 埋込み |
| AT-086 | API E2E | scope_kind > 0 の path は 501 "not yet supported" |

## 対象 v1 章 (正本への影響)

- `v1/02-core-entities.md` §Tile に owner polymorphic の注釈を追記
- 新章 `v1/02-owner-and-profile.md`(または `v1/15-owner-and-profile.md`) を起こして詳細正本化
- `v1/10-invariants.md` に **#12-15** を追記:
  - #12: owner_kind ∈ OwnerKind (0..255)、未指定 = 0=USER
  - #13: 拡張テーブルの PK は対応 kind のみ (CHECK で強制)
  - #14: membership の同一 (scope, actor) で revoked_at IS NULL の行は 1 件以下
  - #15: membership の actor_kind ∈ ActorKind (0..3)
- `v1/14-read-model-and-endpoint.md` に Profile CRUD + Upload の path を追記

## 触るファイル (Phase A)

```
新規:
  docs/v1/02-owner-and-profile.md                       (or v1/15)
  crates/tastile-domain/src/aggregate/owner_kind.rs
  crates/tastile-domain/src/aggregate/owner_state.rs
  crates/tastile-domain/src/aggregate/membership_role.rs
  crates/tastile-core/src/owner/{mod,repo,scope_resolve}.rs
  crates/tastile-storage/migrations/v1/V010__v1_owner_kind_columns.sql
  crates/tastile-storage/migrations/v1/V011__v1_owner_and_extensions.sql
  crates/tastile-storage/migrations/v1/V012__v1_owner_scope_and_membership.sql
  crates/tastile-storage/src/repo_owner_user.rs
  crates/tastile-storage/src/repo_owner_membership.rs
  crates/tastile-api/src/routes/v1/owner.rs
  crates/tastile-api/src/routes/v1/upload_avatar.rs
  crates/tastile-api/src/routes/v1/owner_scope_profile.rs
  crates/tastile-core/src/sync/profile_event.rs
  crates/tastile-api/src/handlers/jwt_auth.rs            (modify for v1_owner_user bootstrap)
  crates/tastile-core/src/effective/timeline_query.rs    (modify for owner_profile embed)
  tastile-web/src/features/profile/ProfilePanel.tsx
  tastile-web/src/features/avatar/UploadAvatar.tsx
  tastile-web/src/lib/avatar/FallbackChain.ts
  tastile-android/.../profile/ProfileScreen.kt
  tastile-android/.../avatar/AvatarUpload.kt
  tastile-android/.../avatar/AvatarLoader.kt
  infra (CDK or Terraform): s3 bucket, CloudFront, IAM role, lifecycle, CORS
```

## 触らないファイル

- `crates/tastile-scheduler/`, `tastile-daemon/`, `tastile-cli/`, `tastile-mcp/`, `tastile-plugin-runtime/` — 凍結
- `tastile-platform`, `tastile-transport` — workspace 外
- `crates/tastile-core/src/{command,event,handler,reducer,recalc,scheduler}/` — 旧実装凍結(並行稼働継続)
- `crates/tastile-storage/migrations/V*.sql` 旧 — 凍結
- `docs/archive/2026-06-24-*` — 凍結
- `docs/MOST_IMPORTANT_PLAN/` — 再参照禁止
- AWS Cognito auth の強化 — 別 plan

## 不変条件 (v1/10) への影響

- 新 #12-15 を追記(§「対象 v1 章」参照)
- 既存不変条件は維持。特に #2 (数値定数) / #4 (JSONB 禁止) / #6 (Execution は Placement だけ) は不変
- Phase A で GLOBAL profile 1:fork、`v1_owner_membership` 0 件のため既存の permission check `tile.owner_id == caller_id` を崩さない

## ロールアウト (10 step / 1 step = 1 commit)

| Step | 内容 | AT |
| --- | --- | --- |
| 1 | Spec 更新: `v1/02-owner-and-profile.md` 起案、`v1/10` #12-15 追記、`v1/14` Profile CRUD 追記。HARNESS §3-8 に V010..V012 追記 | (docs のみ) |
| 2 | Storage V010: 既存 10 tables に `owner_kind smallint NOT NULL DEFAULT 0` + CHECK + index 張替え | (既存テスト全件 Green を確認) |
| 3 | Storage V011: `v1_owner` + `v1_owner_user` + `v1_owner_project` + `v1_owner_workspace` 作成 | (既存テスト) |
| 4 | Storage V012: `v1_owner_scope_profile` + `v1_owner_membership` 作成 | (既存テスト) |
| 5 | Domain: `OwnerKind` / `OwnerState` / `MembershipRole` constants + 単体 | AT-074 |
| 6 | Storage repo: `repo_owner_user.rs` / `repo_owner_membership.rs` | AT-078, 079, 080 |
| 7 | API: JWT auth に v1_owner_user bootstrap 組み込み + `GET/PATCH /v1/owners/0/{id}/profile` | AT-075, 076, 082 |
| 8 | API: Upload endpoint + S3/CloudFront infra (CDK) + commit | AT-083, 084 |
| 9 | API: Timeline embed (`owner.profile.{display_name, avatar_url}`) + Sync Event | AT-081, 085 |
| 10 | API: scope path は 501 skeleton + web/android 統合 | AT-086 + 手動 browser devtools / emulator |

## リスク (top 3)

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **10 テーブル ALTER TABLE で本番 lock 時間**: PG 11+ は `ADD COLUMN DEFAULT` は instant (metadata only)。古い version では full rewrite | 動作環境の PG version を Step 2 開始前に `SHOW server_version;` で確認。低い場合は `ALTER ... NOT VALID + VALIDATE CONSTRAINT` 段階 lock、または maintenance window |
| 2 | **JWT 初回サインインの race**: 同時 2 request で v1_owner_user が 2 行作られる | `v1_owner_user.cognito_sub UNIQUE` で保証。conflict 側は既存 SELECT に fall back。Idempotency-Key ヘッダを middleware で必須化 |
| 3 | **S3 presigned URL の漏洩**: presigned は secret ではなく time-limited 共有 URL | TTL 15 分 + `Content-Type` を presign に固定(任意 Content-Type 拒否) + bucket public-access-block all + OAC で CloudFront 経由のみ read |

## ロールバック

各 step 1 commit = 巻き戻し単位。

```bash
git revert <step-commit>           # code + migration 巻き戻し
psql: DROP TABLE v1_owner_scope_profile, v1_owner_membership, ...;  # V/V step
cdk destroy tastile-avatar-<env>-stack  # infra 巻き戻し(bucket に data が残る場合は保護)
```

**denylist 操作**: `prisma migrate reset` 等は叩かない。cascade DDL / 本番 `DROP TABLE` は使わない。

## 受け入れ条件 (Definition of Done)

- [ ] **AT-001 〜 AT-086** 89 件全件 Green(`cargo test --workspace` exit 0)
- [ ] `cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings` clean
- [ ] `v1/10-invariants.md` に #12-15 追記済、`v1/02-owner-and-profile.md` 起案済
- [ ] `v1/00-glossary.md` から新章に link されている
- [ ] `HARNESS.md` §5 実装履歴に "Phase A Owner Polymorphic + Avatar 完了" 追記
- [ ] Web: chrome-devtools MCP で `/settings/profile` panel → avatar upload 動線実行 → Timeline で Avatar 表示確認
- [ ] Android: 同上
- [ ] auth 強化 plan とは独立ロールアウト可
- [ ] 不要: Cognito `picture` ミラー、Project/Workspace row、membership row、scope override 実装(**Phase X で着手**)

## スコープ外 (Out-of-scope, 別 plan)

| 項目 | 次 plan |
| --- | --- |
| Cognito passwordless 強化 (password / TOTP / invite-only) | `2026-07-XX-auth-hardening` |
| Project 集約実装 (row 書き込み、Command / Validation) | `2026-08-XX-project-aggregate` |
| Workspace 集約実装 | `2026-08-XX-workspace-aggregate` |
| `v1_owner_membership` 利用開始 + 権限チェック移行 | `2026-08-XX-membership-authz` |
| `v1_owner_scope_profile` UI 実装 (`PUT/DELETE` 501 → real handler) | `2026-09-XX-server-profile-ui` |
| Cognito `picture` attribute ミラー Lambda | `2026-XX-XX-cognito-picture-mirror` |

## 関連リンク

- HARNESS.md (v1 spec 集約)
- v1/10-invariants.md
- v1/12-acceptance-tests.md (AT 一覧)
- 既存 plan: docs/plans/2026-07-01-tastile-cleanup-and-v1-recovery.md
- Memory: project_cognito_passwordless_spam_risk.md (auth 強化とは独立して扱うこと)
