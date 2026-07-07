# 2026-07-07 Cognito Avatar Integration Design

## 概要

web (Next.js) と Android (Kotlin/Compose) でアカウントのアバター画像を表示・アップロードできるようにする。
**v1/15 §1-1 の既存決定** に従い、アバター URL は **Cognito に保存せず** バックエンド DB (`v1_owner.avatar_url`) に置く。Cognito は識別専用 (JWT `sub` → UUIDv5 → `v1_owner_user.cognito_sub` JOIN)。これにより Cognito User Pool にカスタム属性を追加せず、既存の pool スキーマを汚さない。

完了基準は「Cognito ログイン後、自分の avatar_url が SiteHeader/TopAppBar に表示され、別アカウントの avatar_url が他ユーザーのタイムラインで正しくフェッチでき、ユーザーが avatar をアップロードすると revision が increment されて全クライアントで即時反映される」こと。

**クライアントは source を 256x256 WebP に pre-resize してから 1ファイルだけ PUT する** (variants 32/64/128 はサーバー側 `commit_upload` 内で `image` crate + `webp` crate により生成)。PUT 上限は WebP 変換後 2MB。

## 設計判断の確定事項 (ユーザー確認済み 2026-07-07)

| 項目 | 確定 | 根拠 / メモ |
|---|---|---|
| アバター URL のソース | **`v1_owner.avatar_url`** (既存DB) | v1/15 §1-1 の既存決定。Cognito カスタム属性は追加しない |
| スコープ | **表示 + S3 アップロードフロー** | 仕様 v1/15 §3 完全準拠。`POST /v1/uploads/avatar` → S3 PUT → `commit` の3段階 |
| Web 表示場所 | **SiteHeader 右上** + **ProfilePanel 内** | ヘッダーは常時表示の小型、ProfilePanel は大型+編集 |
| Android 表示場所 | **TopAppBar** + **ProfileScreen** | TimelineScreen v33 の Avatar slot + プロフィール画面 |
| Fallback chain | **`avatar_url` → Gravatar (email_verified=true 時のみ) → イニシャル** | v1/15 §1-3 を踏襲、Gravatar は verified メールのみ (privacy) |
| アップロードアプローチ | **A: v1/15 §3 完全準拠** (presigned PUT + server-side variant 生成 + revision optimistic lock) | 工数大だが仕様整合性・HEAD 検証・他クライアント競合回避 |
| Variant 生成 | **サーバー側 (Rust `image` crate + `webp` crate)** | クライアントは source.webp 1個だけ PUT。`upload_avatar.rs` の `commit_upload` 内で 32/64/128 を生成 |
| `get_profile` の認可 | **意図的に anonymous read 可** (`@Public` マークを付与) | 他ユーザーの avatar を timeline/comment で表示する場面が大量にあるため |
| `patch_profile` の認可 | **JWT sub の UUIDv5 が path の `{kind}:{id}` と一致必須**、不一致は 403 | 現状 `_owner_id` を discard しているバグを修正 |
| `create_upload` の認可 | **`target_kind:target_id` が JWT sub の UUIDv5 と一致必須** | 任意ユーザーへのアップロードを防ぐ |
| Feature flag | **`avatar_enabled`** (web + Android + backend) | ロールバック用。`false` で Avatar 描画オフ、API は 503 |
| ロールアウト順 | **Phase A: backend → Phase B: web → Phase C: android** | 各 phase 内に 2-3 PR |

## ゴール

1. Cognito ログイン後、ユーザーが `v1_owner.avatar_url` を **アップロード・表示・更新** できる
2. SiteHeader (web) / TopAppBar (android) に **自分の avatar_url** が常に表示される
3. **他ユーザーの avatar_url** が timeline / comment / owner mention で正しく表示される
4. Avatar URL が `null` の場合、Gravatar (verified email のみ) → イニシャル の順で fallback
5. 1 ユーザーが同時に 2 端末から PATCH しても **revision 競合** でデータロストしない
6. 不正な S3 URL (HEAD 失敗) や期限切れ presigned URL を **commit 時に弾く**
7. Feature flag `avatar_enabled` で全機能を 1 スイッチでオフにできる (ロールバック)

## 非ゴール (別 plan に defer)

- Avatar 削除 API (`DELETE /v1/owners/0/{id}/avatar`)。Phase 5 で別タスク
- 古い revision の S3 オブジェクトを 90日 TTL で自動削除する Lifecycle Rule
- AWS WAF / CloudFront Function での画像 hotlink 防止
- WebAuthn / passkey での プロフィール編集認可 (現状は Cognito JWT のみ)
- v0 → v1 avatar データ移行 (v0 は avatar 機能なし、移行不要)
- v1/15 §1-3 の profile scope override UI (Phase A は global profile のみ)
- グループ / 組織 (kind>0) 用の avatar。Phase A は USER (kind=0) のみ

## アーキテクチャ

### 全体フロー

```
┌─────────────────────────────────────────────────────────────────┐
│  Web (Next.js 15)                                                │
│  ├ SiteHeader (top-right) ──→ useCurrentUser() (TanStack Query)  │
│  ├ ProfilePanel     ──→ useCurrentUser() + UploadAvatar          │
│  └ lib/avatar/FallbackChain.ts: url → Gravatar(verified) → initials│
│                                                                  │
│  Android (Kotlin + Compose + Coil)                               │
│  ├ TopAppBar ──→ AvatarLoader(viewModel.avatarUrl)              │
│  ├ ProfileScreen ──→ AvatarLoader + AvatarUpload                │
│  └ avatar/FallbackChain.kt: url → Gravatar(verified) → initials │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  Bearer JWT (Cognito)
┌─────────────────────────────────────────────────────────────────┐
│  tastile-core API                                                │
│  ├ GET   /v1/owners/0/{id}/profile     ← @Public (anonymous OK) │
│  ├ PATCH /v1/owners/0/{id}/profile     ← require_owner(path)    │
│  ├ POST  /v1/uploads/avatar           ← require_owner(target)   │
│  └ POST  /v1/uploads/avatar/{id}/commit ← require_owner(upload) │
│            │                                                      │
│            ▼                                                      │
│  v1_owner.avatar_url (text, nullable) + OutboxEvent::ProfileUpdated│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  presigned PUT (15min TTL)
┌─────────────────────────────────────────────────────────────────┐
│  S3 bucket: TASTILE_AVATAR_BUCKET (default: tastile-avatar-dev) │
│  pending/<upload_id>/source.webp                                 │
│  committed/<kind>/<id>/r<rev>/source.webp                        │
│  committed/<kind>/<id>/r<rev>/variants/{32,64,128}.webp          │
│                                                                  │
│  CloudFront (NEW) → https://cdn.tastile.app/avatar/v1/...        │
└─────────────────────────────────────────────────────────────────┘
```

### 識別フロー (既存、`project_tastile_v1_bridge_auth_uuidv5.md`)

```
Cognito JWT id_token
  └─ claims.sub (string)               ← Cognito user identifier
      └─ Uuid::new_v5(NAMESPACE_OID, sub_bytes)   ← owner_id (UUIDv5)
          └─ v1_owner_user.cognito_sub JOIN
              └─ v1_owner row
                  └─ avatar_url (text, nullable)
```

`authenticate()` ヘルパーが JWT を検証して `(owner_id, actor_id)` を返す。**現状 `_owner_id` を discard しているバグを修正** し、`require_owner(path_kind, path_id)` で path の `{kind}:{id}` と一致確認する。

## バックエンド (tastile-core)

### `upload_avatar.rs` の TODO 解消 (Phase A PR2)

`crates/v1/api/src/handlers/upload_avatar.rs` の 6 つの TODO を埋める。

#### `create_upload` (POST /v1/uploads/avatar)

```rust
async fn create_upload(
    State(state): State<ApiState>,
    Extension(actor): Extension<Actor>,
    Json(req): Json<CreateUploadRequest>,
) -> Result<(StatusCode, Json<UploadCreatedView>), ApiHttpError> {
    // 1. require_owner で target_kind:target_id == actor.owner_id を強制
    require_owner(actor, req.target_kind, req.target_id)?;
    
    // 2. content_type 検証 (image/webp のみ)
    if req.content_type != "image/webp" {
        return Err(ApiHttpError::bad_request("UNSUPPORTED_CONTENT_TYPE"));
    }
    
    // 3. byte_size 上限 (2 MB)
    if req.byte_size > 2 * 1024 * 1024 {
        return Err(ApiHttpError::bad_request("PAYLOAD_TOO_LARGE"));
    }
    
    // 4. upload_id 生成 + claim_token = HMAC-SHA256(upload_id, owner_id, secret)
    let upload_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::minutes(15);
    let claim_token = sign_claim(&upload_id, &owner_id, &state.hmac_secret, expires_at);
    
    // 5. presigned PUT URL を aws-sdk-s3 で生成
    let presigned_put_url = state.s3_client
        .get_object()
        .bucket(&state.avatar_bucket)
        .key(format!("pending/{upload_id}/source.webp"))
        .presigned(PresigningConfig::expires_in(Duration::minutes(15))?)
        .await?
        .uri()
        .to_string();
    
    // 6. upload_id, presigned_put_url, expires_at, claim_token を返す
    Ok((StatusCode::CREATED, Json(UploadCreatedView {
        upload_id,
        presigned_put_url,
        expires_at,
        claim_token,
    })))
}
```

#### `commit_upload` (POST /v1/uploads/avatar/{upload_id}/commit)

```rust
async fn commit_upload(
    State(state): State<ApiState>,
    Extension(actor): Extension<Actor>,
    Path(upload_id): Path<Uuid>,
    Json(req): Json<CommitUploadRequest>,
) -> Result<Json<UploadCommittedView>, ApiHttpError> {
    // 1. claim_token の HMAC 検証
    let claims = verify_claim(&req.claim_token, &state.hmac_secret)?;
    if claims.upload_id != upload_id {
        return Err(ApiHttpError::unauthorized("INVALID_CLAIM"));
    }
    if Utc::now() > claims.expires_at {
        return Err(ApiHttpError::unauthorized("CLAIM_EXPIRED"));
    }
    
    // 2. require_owner (upload_id の owner == actor.owner_id)
    require_owner(actor, claims.target_kind, claims.target_id)?;
    
    // 3. S3 HEAD で pending/<id>/source.webp の存在確認
    let head = state.s3_client
        .head_object()
        .bucket(&state.avatar_bucket)
        .key(format!("pending/{upload_id}/source.webp"))
        .send().await
        .map_err(|_| ApiHttpError::service_unavailable("UPLOAD_NOT_FOUND"))?;
    
    // 4. byte_size と content_type 検証
    if head.content_length() != Some(claims.byte_size) {
        return Err(ApiHttpError::bad_request("SIZE_MISMATCH"));
    }
    if head.content_type() != Some("image/webp") {
        return Err(ApiHttpError::bad_request("CONTENT_TYPE_MISMATCH"));
    }
    
    // 5. v1_owner から現在の revision を取得 (楽観ロック用)
    let mut tx = state.pool.begin().await?;
    let current = repo_owner::get_for_update(&mut tx, 0, actor.owner_id).await?
        .ok_or_else(|| ApiHttpError::not_found("OWNER_NOT_FOUND"))?;
    let new_rev = current.revision + 1;
    
    // 6. S3 CopyObject: pending/ → committed/0/<id>/r<new_rev>/
    let dest_key = format!("committed/0/{}/r{}/source.webp", actor.owner_id, new_rev);
    state.s3_client.copy_object()
        .bucket(&state.avatar_bucket)
        .key(&dest_key)
        .copy_source(format!("{}/pending/{}/source.webp", state.avatar_bucket, upload_id))
        .send().await?;
    
    // 7. variants 32/64/128 を Rust で生成 (image + webp crate)
    let source_bytes = state.s3_client.get_object()
        .bucket(&state.avatar_bucket)
        .key(&dest_key)
        .send().await?
        .body.collect().await?
        .into_bytes();
    for size in [32u32, 64, 128] {
        let variant = image::load_from_memory(&source_bytes)?
            .resize(size, size, image::imageops::FilterType::Lanczos3);
        let mut out = Vec::new();
        variant.write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::WebP)?;
        state.s3_client.put_object()
            .bucket(&state.avatar_bucket)
            .key(format!("committed/0/{}/r{}/variants/{}.webp", actor.owner_id, new_rev, size))
            .content_type("image/webp")
            .body(out.into())
            .send().await?;
    }
    
    // 8. v1_owner.avatar_url 更新 + revision increment
    let avatar_url = format!("https://cdn.tastile.app/avatar/v1/committed/0/{}/r{}/source.webp", actor.owner_id, new_rev);
    repo_owner::update_avatar_url(&mut tx, 0, actor.owner_id, &avatar_url, new_rev).await?;
    
    // 9. OutboxEvent::ProfileUpdated エンキュー
    outbox::enqueue(&mut tx, OutboxEvent::ProfileUpdated {
        owner_kind: 0,
        owner_id: actor.owner_id,
        avatar_url: Some(avatar_url.clone()),
        revision: new_rev,
        at: Utc::now(),
    }).await?;
    
    // 10. pending/ を削除
    state.s3_client.delete_object()
        .bucket(&state.avatar_bucket)
        .key(format!("pending/{upload_id}/source.webp"))
        .send().await?;
    
    tx.commit().await?;
    
    Ok(Json(UploadCommittedView {
        owner_kind: 0,
        owner_id: actor.owner_id,
        scope_kind: None,
        scope_id: None,
        avatar_url,
    }))
}
```

#### `auth-guard` ヘルパー (新規: `crates/v1/api/src/auth/guard.rs`)

```rust
pub fn require_owner(actor: Actor, path_kind: i16, path_id: Uuid) -> Result<(), ApiHttpError> {
    if actor.owner_kind != path_kind || actor.owner_id != path_id {
        return Err(ApiHttpError::forbidden("NOT_OWNER"));
    }
    Ok(())
}

pub fn authenticate(/* ... */) -> Result<(Actor, Uuid), ApiHttpError> {
    // 既存の JWT 検証を Actor 構造体で返すようにリファクタ
    Ok(Actor { owner_kind: 0, owner_id: <uuidv5>, actor_id: <uuidv5> })
}
```

`owner.rs` の `get_profile` (現状認証なし) には `@Public` マクロを付けて anonymous read を明示。`patch_profile` には `require_owner(actor, kind, id)?;` を追加。

### Outbox イベント (既存パターン踏襲)

`v1_owner.avatar_url` 更新時に OutboxEvent をエンキュー:

```rust
OutboxEvent::ProfileUpdated {
    owner_kind: i16,
    owner_id: Uuid,
    avatar_url: Option<String>,
    revision: i64,
    at: DateTime<Utc>,
}
```

Phase A では outbox table への INSERT のみ。Consumer (notification fan-out, search index 更新) は別タスク。テーブルスキーマは `v1_outbox_event` (既存) を利用。

### S3 バケット + CloudFront (Phase A PR1)

`deploy/aws/foundation/foundation.yaml` に追記:

```yaml
AvatarBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: !Sub "${ProjectName}-${EnvironmentName}-avatars"
    PublicAccessBlockConfiguration:
      BlockPublicAcls: true
      BlockPublicPolicy: true
      IgnorePublicAcls: true
      RestrictPublicBuckets: true
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault: { SSEAlgorithm: AES256 }

AvatarOAI:
  Type: AWS::CloudFront::CloudFrontOriginAccessIdentity
  Properties:
    CloudFrontOriginAccessIdentityConfig:
      Comment: !Sub "${ProjectName}-${EnvironmentName}-avatar-oai"

AvatarDistribution:
  Type: AWS::CloudFront::Distribution
  Properties:
    DistributionConfig:
      Origins:
        - DomainName: !GetAtt AvatarBucket.RegionalDomainName
          OriginId: avatar-s3
          S3OriginConfig:
            OriginAccessIdentity: !Sub "origin-access-identity/cloudfront/${AvatarOAI}"
      DefaultCacheBehavior:
        TargetOriginId: avatar-s3
        ViewerProtocolPolicy: redirect-to-https
        AllowedMethods: [GET, HEAD]
        CachedMethods: [GET, HEAD]
        TTL: 86400
      PriceClass: PriceClass_100
      ViewerCertificate:
        AcmCertificateArn: !ImportValue "TastileAcmCertificate"
        SslSupportMethod: sni-only
      Aliases: ["cdn.tastile.app"]
```

OAI (Origin Access Identity) で S3 を private にして CloudFront 経由のみ配信。S3 key と CDN URL は完全一致:

| 用途 | S3 key | CDN URL |
|---|---|---|
| 256px 正本 (avatar_url に保存) | `committed/0/<id>/r<rev>/source.webp` | `https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/source.webp` |
| 128px variant | `committed/0/<id>/r<rev>/variants/128.webp` | `https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/128.webp` |
| 64px variant | `committed/0/<id>/r<rev>/variants/64.webp` | `https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/64.webp` |
| 32px variant | `committed/0/<id>/r<rev>/variants/32.webp` | `https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/32.webp` |

`v1_owner.avatar_url` カラムには **常に source.webp (256px) の URL** を保存。クライアントは `<img srcset>` を使って表示サイズに応じて variants を切替:

```html
<img
    src="https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/source.webp"
    srcset="
        https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/32.webp 32w,
        https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/64.webp 64w,
        https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/variants/128.webp 128w,
        https://cdn.tastile.app/avatar/v1/committed/0/<id>/r<rev>/source.webp 256w
    "
    sizes="(max-width: 640px) 32px, (max-width: 1024px) 64px, 128px"
    width="128" height="128" alt="" />
```

Android の Coil は `ImageRequest.Builder.data(src)` で source URL を渡し、`ImageLoader` の `Components` で `OkHttp` の URL rewrite interceptor を使って `source.webp` → `variants/<size>.webp` に置換 (DisplayMetrics.density から size を逆算)。

### エラーハンドリングマトリクス

| シナリオ | HTTP | code | クライアント挙動 |
|---|---|---|---|
| `create_upload` で target_id != actor | 403 | `NOT_OWNER` | toast で「権限がありません」 |
| `create_upload` で content_type != image/webp | 400 | `UNSUPPORTED_CONTENT_TYPE` | toast + 再選択 |
| `create_upload` で byte_size > 2MB | 400 | `PAYLOAD_TOO_LARGE` | クライアント事前チェック |
| `commit` で claim_token 不正 | 401 | `INVALID_CLAIM` | toast + 再アップロード |
| `commit` で claim 期限切れ | 401 | `CLAIM_EXPIRED` | 再アップロード |
| `commit` で S3 HEAD 失敗 | 503 | `UPLOAD_NOT_FOUND` | 5秒後リトライ |
| `commit` で size mismatch | 400 | `SIZE_MISMATCH` | abort + 再アップロード |
| `patch_profile` で revision 不一致 | 409 | `STALE_REVISION` | refetch → 再試行ダイアログ |
| `patch_profile` で kind:id != actor | 403 | `NOT_OWNER` | toast |
| Feature flag OFF | 503 | `FEATURE_DISABLED` | UI 自体が描画されない |

## Web クライアント (tastile-web)

### 状態管理

`src/lib/stores/user-store.ts` (新規): TanStack Query で `useCurrentUser()` を提供:

```typescript
export function useCurrentUser() {
    return useQuery({
        queryKey: ["current-user"],
        queryFn: async () => {
            const res = await fetch("/api/me");
            if (!res.ok) throw new Error("FETCH_FAILED");
            return (await res.json()) as CurrentUser;
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
    });
}

export function usePatchProfile() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: PatchProfileRequest) => {
            const id = qc.getQueryData<CurrentUser>(["current-user"])!.owner_id;
            const res = await fetch(`/api/v1/owners/0/${id}/profile`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw await res.json();
            return res.json();
        },
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: ["current-user"] });
            const prev = qc.getQueryData<CurrentUser>(["current-user"]);
            qc.setQueryData<CurrentUser>(["current-user"], (old) => ({ ...old!, ...patch }));
            return { prev };
        },
        onError: (err, vars, ctx) => {
            qc.setQueryData(["current-user"], ctx?.prev);
            if (err.code === "STALE_REVISION") {
                qc.invalidateQueries({ queryKey: ["current-user"] });
            }
        },
        onSettled: () => qc.invalidateQueries({ queryKey: ["current-user"] }),
    });
}
```

### `/api/me` BFF (新規: `app/api/me/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { getAccountOwnerId, getAccountUserClaims } from "@/lib/cognito/account-session";
import { getCoreClient } from "@/lib/api/core-client";

export const dynamic = "force-dynamic";

export async function GET() {
    const ownerId = await getAccountOwnerId();
    if (!ownerId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    
    const claims = await getAccountUserClaims();
    const profile = await getCoreClient().getOwnerProfile(0, ownerId);
    
    return NextResponse.json({
        owner_id: ownerId,
        email: claims.email,
        email_verified: claims.email_verified,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        accent_color: profile.accent_color,
        revision: profile.revision,
    });
}
```

`getAccountOwnerId()`: `account-session.ts` の `getAccountUserSub()` で cookie から `sub` 取得 → `Uuid.v5(NAMESPACE_OID, sub)` で owner_id 計算 (Rust 側と namespace 同じものを使う)。

### エンドポイント追加 (`src/lib/api/endpoints.ts`)

```typescript
getOwnerProfile: {
    method: "GET",
    path: "/v1/owners/{kind}/{id}/profile",
    tag: "Read",
    summary: "Get owner profile",
    auth: false,  // @Public
    keywords: ["owner", "profile"],
},
patchOwnerProfile: {
    method: "PATCH",
    path: "/v1/owners/{kind}/{id}/profile",
    tag: "Write",
    summary: "Patch owner profile",
    auth: true,
    keywords: ["owner", "profile"],
},
createAvatarUpload: {
    method: "POST",
    path: "/v1/uploads/avatar",
    tag: "Write",
    summary: "Create avatar upload (presigned URL)",
    auth: true,
    keywords: ["avatar", "upload"],
},
commitAvatarUpload: {
    method: "POST",
    path: "/v1/uploads/avatar/{upload_id}/commit",
    tag: "Write",
    summary: "Commit avatar upload",
    auth: true,
    keywords: ["avatar", "upload", "commit"],
},
```

### 表示コンポーネント

```
SiteHeader (現状)
└── div.right-actions
    ├── <Link href="/dashboard/profile">
    │   <Avatar size="sm" />        {/* 新規 */}
    │   </Link>
    ├── <NotificationBell />
    └── <LogoutButton />

Avatar (新規: src/components/Avatar.tsx)
├── props: { owner: OwnerView, size: 'sm'|'md'|'lg', clickable? }
└── 内部で resolveAvatarSource() を呼んで url|gravatar|initials を切替
```

### FallbackChain.ts 完成 (`src/lib/avatar/FallbackChain.ts`)

```typescript
import md5 from "crypto-js/md5";

export type AvatarSource =
    | { kind: "url"; src: string }
    | { kind: "gravatar"; src: string }
    | { kind: "initials"; initials: string; bg: string };

export interface AvatarOwner {
    avatar_url: string | null;
    display_name: string;
    email_verified: boolean;
    email?: string;
}

export function resolveAvatarSource(owner: AvatarOwner): AvatarSource {
    if (owner.avatar_url) return { kind: "url", src: owner.avatar_url };
    if (owner.email_verified && owner.email) {
        return { kind: "gravatar", src: gravatarUrl(owner.email) };
    }
    return { kind: "initials", ...initialsFromName(owner.display_name) };
}

export function gravatarUrl(email: string): string {
    const hash = md5(email.trim().toLowerCase()).toString();
    return `https://www.gravatar.com/avatar/${hash}?d=404&s=256`;
}

function initialsFromName(name: string): { initials: string; bg: string } {
    const initials = name.trim().slice(0, 2).toUpperCase() || "?";
    const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const palette = ["#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
    return { initials, bg: palette[hash % palette.length] };
}
```

`<Avatar>` コンポーネントは `useQuery(["gravatar", email])` で HEAD 200 を確認して URL を採用。404 なら initials にフォールバック。

### UploadAvatar.tsx 完成 (`src/features/avatar/UploadAvatar.tsx`)

```typescript
export function UploadAvatar({ ownerId, onComplete }: Props) {
    const [progress, setProgress] = useState<UploadProgress>(UploadProgress.Idle);
    const inputRef = useRef<HTMLInputElement>(null);
    
    const handleFile = async (file: File) => {
        if (file.size > 10 * 1024 * 1024) {
            toast.error("ファイルが大きすぎます (10MB以下)");
            return;
        }
        
        setProgress(UploadProgress.Resizing);
        const webpBlob = await resizeToWebp(file, 256);
        if (webpBlob.size > 2 * 1024 * 1024) {
            toast.error("WebP 変換後も 2MB を超えています");
            return;
        }
        
        setProgress(UploadProgress.Requesting);
        const created = await api.createAvatarUpload({
            target_kind: 0,
            target_id: ownerId,
            content_type: "image/webp",
            byte_size: webpBlob.size,
        });
        
        setProgress(UploadProgress.Uploading);
        const putRes = await fetch(created.presigned_put_url, {
            method: "PUT",
            headers: { "Content-Type": "image/webp" },
            body: webpBlob,
        });
        if (!putRes.ok) {
            toast.error("S3 アップロード失敗");
            return;
        }
        
        setProgress(UploadProgress.Committing);
        const committed = await api.commitAvatarUpload(created.upload_id, {
            claim_token: created.claim_token,
        });
        
        setProgress(UploadProgress.Done);
        onComplete(committed.avatar_url);
    };
    
    return (
        <>
            <input ref={inputRef} type="file" accept="image/webp,image/png,image/jpeg"
                   hidden onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Button onClick={() => inputRef.current?.click()} disabled={progress !== UploadProgress.Idle && progress !== UploadProgress.Done}>
                {progress === UploadProgress.Idle ? "Change avatar" : <ProgressLabel stage={progress} />}
            </Button>
        </>
    );
}
```

`resizeToWebp`: `createImageBitmap(file)` → `OffscreenCanvas(256, 256)` → 中心正方形 crop → `convertToBlob({ type: "image/webp", quality: 0.85 })`。

### ProfilePanel.tsx 完成 (`src/features/profile/ProfilePanel.tsx`)

```
<Panel open={panel === "profile"} onClose={close}>
    <div className="avatar-section">
        <Avatar owner={user} size="lg" />
        <UploadAvatar ownerId={user.owner_id} onComplete={() => queryClient.invalidateQueries(["current-user"])} />
    </div>
    <TextField label="Display name" defaultValue={user.display_name}
               onBlur={(v) => patchProfile({ display_name: v, expected_revision: user.revision })} />
    <TextField label="Bio" multiline maxLength={500} defaultValue={user.bio ?? ""}
               onBlur={(v) => patchProfile({ bio: v, expected_revision: user.revision })} />
    <ColorPicker value={user.accent_color ?? "#3b82f6"}
                 onChange={(c) => patchProfile({ accent_color: c, expected_revision: user.revision })} />
</Panel>
```

`STALE_REVISION` (409) は refetch 後に「他端末で変更されました、再試行しますか?」ダイアログを表示。

### Feature flag

`src/lib/feature-flags.ts` (新規) で `avatar_enabled` フラグを読み、`<Avatar>` は flag=false 時に `null` を返す。SiteHeader も `<Link href="/dashboard/profile">` の代わりに `<Link href="/auth/login">` (旧UI) を表示。

## Android クライアント (tastile-android)

### 状態管理

`ProfileViewModel` (Hilt):

```kotlin
@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repo: ProfileRepository,
    private val auth: AuthStorage,
) : ViewModel() {
    val state: StateFlow<ProfileState> = repo.observeProfile()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProfileState.Loading)
    
    val currentOwnerId: StateFlow<Uuid?> = auth.observeOwnerId()
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    
    fun uploadAvatar(file: File) = viewModelScope.launch {
        runCatching { repo.uploadAvatar(file) }
            .onSuccess { repo.refresh() }
            .onFailure { /* toast */ }
    }
    
    fun refresh() = viewModelScope.launch { repo.refresh() }
}
```

`AuthStorage`: DataStore Preferences に Cognito ログイン callback で `owner_id = uuidv5(sub)` を保存。

### ProfileRepository (`data/profile/ProfileRepository.kt`)

```kotlin
class ProfileRepository @Inject constructor(
    private val api: KtorClient,
    private val auth: AuthStorage,
    private val profileCache: ProfileCache,  // DataStore<OwnerProfile>
) {
    fun observeProfile(): Flow<OwnerProfile?> = profileCache.observe()
    
    suspend fun refresh() {
        val ownerId = auth.getOwnerId() ?: return
        val res: OwnerProfileDto = api.get("/v1/owners/0/$ownerId/profile")
        profileCache.put(res.toDomain())
    }
    
    suspend fun uploadAvatar(file: File) {
        val ownerId = auth.getOwnerId() ?: throw IllegalStateException("NOT_AUTHENTICATED")
        val webpBytes = withContext(Dispatchers.IO) { ImageResizer.resizeToWebp(file, 256) }
        
        val created: UploadCreatedDto = api.post("/v1/uploads/avatar", mapOf(
            "target_kind" to 0,
            "target_id" to ownerId,
            "content_type" to "image/webp",
            "byte_size" to webpBytes.size,
        ))
        
        // S3 PUT (OkHttp 直接でも Ktor でも OK)
        api.rawPut(created.presigned_put_url, webpBytes, "image/webp")
        
        val committed: UploadCommittedDto = api.post(
            "/v1/uploads/avatar/${created.upload_id}/commit",
            mapOf("claim_token" to created.claim_token)
        )
        // committed.avatar_url が新 URL
    }
}
```

### ImageResizer (`avatar/ImageResizer.kt`)

```kotlin
object ImageResizer {
    suspend fun resizeToWebp(uri: Uri, size: Int): ByteArray = withContext(Dispatchers.IO) {
        val input = context.contentResolver.openInputStream(uri)!!
        val src = BitmapFactory.decodeStream(input)!!
        val crop = centerSquareCrop(src)
        val scaled = Bitmap.createScaledBitmap(crop, size, size, true)
        val out = ByteArrayOutputStream()
        if (Build.VERSION.SDK_INT >= 30) {
            scaled.compress(Bitmap.CompressFormat.WEBP_LOSSY, 85, out)
        } else {
            // libwebp-jni または WebPEncoder.encode(scaled, 85) のフォールバック
            WebPEncoder.encode(scaled, 85, out)
        }
        out.toByteArray()
    }
    
    private fun centerSquareCrop(src: Bitmap): Bitmap {
        val side = minOf(src.width, src.height)
        val x = (src.width - side) / 2
        val y = (src.height - side) / 2
        return Bitmap.createBitmap(src, x, y, side, side)
    }
}
```

### AvatarLoader 完成 (`avatar/AvatarLoader.kt`)

```kotlin
@Composable
fun AvatarLoader(
    owner: OwnerProfile?,
    size: Dp = 40.dp,
    onClick: (() -> Unit)? = null,
) {
    val src = remember(owner) {
        owner?.let { resolveAvatarSource(it)?.src }
    }
    val initials = remember(owner) {
        owner?.let { resolveAvatarSource(it)?.initials }
    }
    
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        if (src != null) {
            AsyncImage(
                model = src,
                contentDescription = owner?.display_name ?: "",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else if (initials != null) {
            Text(
                text = initials,
                fontSize = (size.value * 0.4f).sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

fun resolveAvatarSource(owner: OwnerProfile): AvatarSource? {
    if (!owner.avatar_url.isNullOrBlank()) return AvatarSource.Url(owner.avatar_url)
    if (owner.email_verified && !owner.email.isNullOrBlank()) {
        return AvatarSource.Gravatar(gravatarUrl(owner.email))
    }
    val initials = owner.display_name.trim().take(2).uppercase().ifEmpty { "?" }
    return AvatarSource.Initials(initials, colorFromName(owner.display_name))
}

fun gravatarUrl(email: String): String {
    val hash = md5(email.trim().lowercase())
    return "https://www.gravatar.com/avatar/$hash?d=404&s=256"
}
```

Gravatar の HEAD 確認は Coil の `ImageLoader` で `ImageRequest.Builder(HttpUriFetcher)` を使い、404 なら `fallback` を initials に。Coil 3.x では `error` Painter で対応。

### AvatarUpload 完成 (`avatar/AvatarUpload.kt`)

```kotlin
@Composable
fun AvatarUpload(
    viewModel: ProfileViewModel = hiltViewModel(),
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf<UploadProgress>(UploadProgress.Idle) }
    val pickPhoto = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                try {
                    progress = UploadProgress.Uploading
                    viewModel.uploadAvatar(context.contentResolver.openInputStream(uri)?.use {
                        File.createTempFile("avatar", ".webp", context.cacheDir).apply {
                            outputStream().use { out -> it.copyTo(out) }
                        }
                    }!!)
                    progress = UploadProgress.Done
                } catch (e: Exception) {
                    progress = UploadProgress.Idle
                    // toast
                }
            }
        }
    }
    
    OutlinedButton(
        onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        enabled = progress == UploadProgress.Idle || progress == UploadProgress.Done,
    ) {
        Text(when (progress) {
            UploadProgress.Idle -> "Change avatar"
            UploadProgress.Uploading -> "Uploading…"
            UploadProgress.Done -> "Done"
        })
    }
}
```

### TopAppBar / ProfileScreen 配線

- `TimelineScreen.kt` の TopAppBar に Avatar slot があれば `AvatarLoader(viewModel.currentProfile.collectAsState().value, size = 32.dp, onClick = { nav.navigate("profile") })`
- `ProfileScreen.kt` line 42 の `// TODO: AvatarUpload component` を `AvatarUpload()` に置換、画面上部に `AvatarLoader(size = 128.dp)` を大きく配置。`ProfileViewModel` を `hiltViewModel()` で取得。

### Feature flag

`BuildConfig.AVATAR_ENABLED` (gradle で環境別に設定) で `<Avatar>` 描画と `AvatarUpload` ボタンを gate。`false` のときは `AvatarLoader` は `null` を返す。

## ロールアウト順序

### Phase A: バックエンドのみ (3 PR)

1. **PR1**: S3 bucket + CloudFront infra (`foundation.yaml` 追記 + `deploy-foundation.ps1` 動作確認)
2. **PR2**: `upload_avatar.rs` 実装 + `owner.rs` 認可整理 + 統合テスト → staging 反映
3. **PR3**: `/api/me` BFF (web) + OutboxEvent 配線 + feature flag 追加

### Phase B: Web クライアント (2 PR)

4. **PR4**: `FallbackChain.ts` + `Avatar.tsx` + `useCurrentUser` + SiteHeader 配線 (URLのみ、Gravatar は OFF)
5. **PR5**: `UploadAvatar.tsx` + ProfilePanel 完全実装 + Gravatar 有効化

### Phase C: Android クライアント (2 PR)

6. **PR6**: `AvatarLoader` 配線 (TopAppBar/ProfileScreen) + DataStore owner_id + FallbackChain
7. **PR7**: `AvatarUpload` 実装 + Robolectric テスト

各 PR 後に staging で Cognito hosted UI ログイン → avatar upload → 他端末から同一ユーザーで avatar 表示確認。

## テスト戦略

### バックエンド (tastile-core, Rust)

| テスト | ファイル | 検証 |
|---|---|---|
| Unit: HMAC claim_token | `upload_avatar.rs` inline `#[cfg(test)]` | 不正token拒否、TTL経過後拒否 |
| Unit: image crate リサイズ | `crates/v1/api/src/image/avatar_resize.rs` (新規) | 256x256 source → 32/64/128 WebP生成、byte_size 整合 |
| Integration: 3-step upload happy path | `crates/v1/api/tests/upload_avatar_e2e.rs` (新規) | create → PUT → commit → profile.avatar_url 更新確認 |
| Integration: HEAD verify fail | 同上 | S3 に object がない状態で commit → 503 |
| Integration: revision conflict | `crates/v1/api/tests/owner_profile_e2e.rs` (新規) | 古い expected_revision で PATCH → 409 |
| Integration: authz check | `crates/v1/api/tests/owner_profile_authz.rs` (新規) | 別ユーザーID で PATCH → 403、create_upload の target_id 不一致 → 403 |
| Integration: @Public get_profile | 同上 | 認証なしで GET → 200 |

CI は `tastile-core.wslc` (WSL clone) で実行。Postgres は WSL の `postgres:16-alpine` イメージ。

### Web (tastile-web)

| テスト | ファイル | 検証 |
|---|---|---|
| Unit: FallbackChain | `src/lib/avatar/__tests__/FallbackChain.test.ts` | url / Gravatar 200 / Gravatar 404 / initials の4ケース |
| Unit: Gravatar HEAD | 同上 + `nock` で HTTP モック | 200/404/timeout |
| Component: Avatar | `src/components/__tests__/Avatar.test.tsx` | url 表示 / initials 表示 / Gravatar 失敗時のフォールバック |
| Component: UploadAvatar | `src/features/avatar/__tests__/UploadAvatar.test.tsx` | resize → POST → PUT → commit のMSW モック。S3 PUT は `nock` |
| Integration: profile flow | `app/dashboard/profile/__tests__/page.test.tsx` | 画面遷移 + PATCH + 楽観更新 |

### Android (tastile-android)

| テスト | ファイル | 検証 |
|---|---|---|
| Unit: FallbackChain | `app/src/test/.../avatar/FallbackChainTest.kt` | url / Gravatar (OkHttp MockWebServer) / initials |
| Unit: ImageResizer | `app/src/test/.../avatar/ImageResizerTest.kt` | 256x256入力 → WebP byte配列、サイズ別 |
| Compose UI: AvatarLoader | `app/src/test/.../avatar/AvatarLoaderTest.kt` | Coil の ImageLoader を mock、src/placeholder 切替 |
| Compose UI: AvatarUpload | `app/src/test/.../avatar/AvatarUploadTest.kt` | Robolectric で PhotoPicker → upload flow、MockWebServer で API mock |
| Instrumented: ProfileScreen | `app/src/androidTest/.../profile/ProfileScreenTest.kt` | Hilt + Compose + DataStore + API の結合 |

## マイグレーション / 既存データへの影響

- 新規カラムなし (V011 で `v1_owner.avatar_url` 既存)
- `v1_owner_user.cognito_sub` も既存 (V011)
- 既存ユーザーは `avatar_url = NULL` → fallback で **イニシャル表示**
- データマイグレーション不要
- バックエンドの `get_profile` を `@Public` にする変更は **breaking** (現状は暗黙的に auth スキップ、明示的に)。
  - **Owner**: Phase A PR2 のレビュアーが `rg "401" tastile-web/src` で現状のテストアサーションを grep し、avatar_url 取得経路 (`useCurrentUser` / `ProfilePanel` / SiteHeader) で 401 期待があれば **テスト側の期待値を 200 に修正** する
  - **もし整合テストが修正後に他箇所 (例: Stripe webhook など) で 401 必須のまま残っていた場合**: 該当テストを `auth_required: true` のエンドポイントに絞り、PR description に「許可的化」影響を明記
  - **ロールバック容易性**: 認可ロジックは `auth-guard` ヘルパー 1ファイルに集約されているため、Phase A PR2 を revert すれば `get_profile` は元の挙動 (暗黙的にauthスキップ) に戻る

## ロールバック

- **フロントエンド**: feature flag `avatar_enabled` で FeatureGate。`false` で Avatar コンポーネントは描画されず、SiteHeader も旧UI (ログインリンクのみ)
- **バックエンド**: feature flag `avatar_enabled` は **write 系のみ** 503 返却 (`FEATURE_DISABLED` code)。
  - **write 系 (gated)**: `POST /v1/uploads/avatar`, `POST /v1/uploads/avatar/{id}/commit`, `PATCH /v1/owners/0/{id}/profile` のうち `avatar_url` フィールドへの書き込み
  - **read 系 (NOT gated)**: `GET /v1/owners/0/{id}/profile` は flag 状態に関係なく 200 を返す。これにより flag OFF 期間中も既存 avatar_url を持つクライアントは表示継続可能
  - `v1_owner.avatar_url` カラム自体は触らず既存挙動維持
- **インフラ**: CloudFront + S3 はそのまま残す (削除は別タスク、storage コストは月数ドル)

## セキュリティ / プライバシー

- ユーザーが avatar を削除 (`avatar_url = NULL` で PATCH) → S3 オブジェクトは revision URL で残るが URL は誰も知らないので **削除 API は別タスク**
- 旧 revision の S3 オブジェクト → 90日 TTL の Lifecycle Rule で自動削除 (Phase 5 で実装)
- presigned PUT URL は 15分 TTL、`Content-Type: image/webp` を強制
- `claim_token` は HMAC-SHA256(upload_id, owner_id, secret)、TTL は presigned と同じ
- Gravatar は `email_verified=true` のときのみ (Cognito `email_verified` claim を信頼)
- 認可: すべての write 系エンドポイントで `require_owner(actor, path.kind, path.id)` を強制
- S3 bucket は public read 禁止、CloudFront OAI 経由のみ

## リスク

1. **CDN キャッシュの stale**: CloudFront TTL 24h だが、revision URL に `r<N>` を含むので新しい avatar URL は必ず cache miss → 問題なし
2. **HMAC secret rotation**: `claim_token` の HMAC secret をローテートすると **進行中の upload が commit 失敗** (最大15分の presigned TTL 中)。Phase A は **ローテート頻度 月1以下、運用 SOP で対応**。Phase 5 で multi-secret サポート (`TASTILE_HMAC_SECRETS=current,previous` のカンマ区切り、verify 側で両方試す) を実装予定。**当面は secret rotation を本番で緊急発動しない運用ルール**
3. **android API 30 未満の WebP エンコード**: `Bitmap.compress(WEBP_LOSSY, ...)` は API 30+、`libwebp-jni` または `WebPEncoder` の依存追加が必要 → 影響範囲を PR7 で確認
4. **Cross-region S3**: `ap-northeast-1` 以外からの PUT は latency 増。Phase A は ap-northeast-1 固定で開始、multi-region は別タスク
5. **既存ユーザーの avatar_url NULL**: フォールバックで initials 表示になるが、UX 的に "Change avatar" CTA を明示しないとアップロード画面に到達できない → ProfilePanel/ProfileScreen に必ず "Change avatar" ボタンを表示
6. **get_profile の @Public 化**: 現状は暗黙的に認証スキップ。明示的にすると「private 情報が漏れる」と感じる人がいるかもしれないが、avatar_url は既に公開情報相当なので問題なし