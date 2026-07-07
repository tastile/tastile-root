# 2026-07-07 — Cognito Avatar Integration (Phase A: Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase A of the avatar integration per `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md`. This phase establishes the S3 + CloudFront infra, fills in `upload_avatar.rs` TODOs, fixes `owner.rs` authorization, and ships the `/api/me` BFF on the web side. Phase B (web Avatar component, SiteHeader wiring) and Phase C (Android AvatarLoader + Upload) are deferred to follow-up plans.

**Architecture:**
- New S3 bucket `tastile-${ProjectName}-avatars` (private, public-read blocked) fronted by CloudFront distribution with Origin Access Identity, alternate domain `cdn.tastile.app`.
- Existing `v1/15 §3` 3-step upload: `POST /v1/uploads/avatar` (presigned PUT) → client PUTs 256x256 source.webp → `POST /v1/uploads/avatar/{id}/commit` (HEAD verify, copy, server-side resize to 32/64/128, profile update, OutboxEvent emit).
- Server-side variant generation via Rust `image` crate + `webp` crate (no client-side variant computation).
- `require_owner(actor, path.kind, path.id)` helper centralizes authorization for write endpoints.
- `get_profile` explicitly marked `@Public` (anonymous read OK) since other users' avatars are public.
- `PATCH /v1/owners/0/{id}/profile` now requires actor == path owner; mismatched returns 403.
- Web `/api/me` BFF resolves owner_id from cookie session and returns `{owner_id, email, email_verified, display_name, avatar_url, bio, accent_color, revision}`.

**Tech Stack:**
- Rust: `aws-sdk-s3` 1.x, `aws-config` 1.x, `image` 0.25, `webp` 0.3, `hmac` 0.12, `sha2` 0.10
- TypeScript: vitest 4.1.0 (existing), Node 20
- AWS: CloudFormation `AWS::S3::Bucket`, `AWS::CloudFront::Distribution`, `AWS::CloudFront::CloudFrontOriginAccessIdentity`

**Hard verification gate:**
```bash
# In tastile-core.wslc
cd $HOME/tastile-core.wslc
cargo test --workspace --test upload_avatar_e2e --test owner_profile_authz
# Expected: all tests pass

# Smoke against dev
curl -s -X POST http://localhost:31400/v1/uploads/avatar \
    -H "Authorization: Bearer <jwt>" \
    -H "Content-Type: application/json" \
    -d '{"target_kind":0,"target_id":"<uuid>","content_type":"image/webp","byte_size":1234}'
# Expected: 201 with {upload_id, presigned_put_url, expires_at, claim_token}

# In tastile-web
bun run test -- --run src/lib/api/endpoints
bun run typecheck
# Expected: all pass

# Foundation stack
cd $HOME/tastile-core.wslc
aws cloudformation describe-stack-resources --stack-name tastile-v1-foundation \
    --query "StackResources[?ResourceType=='AWS::CloudFront::Distribution']"
# Expected: AvatarDistribution present
```

**Phase B / C defer note:** This plan covers Phase A only. After Phase A lands and is verified in staging, create `docs/superpowers/plans/2026-07-XX-cognito-avatar-phase-bc.md` (or split into two plans: web and android) following the same TDD conventions. The spec's §「Web クライアント」and §「Android クライアント」 sections are the source of truth for those phases.

---

## File Structure

```
tastile-core/                                       (worktree: tastile-core.wslc, branch wslc-avatar)
├── Cargo.toml                                      (modify: aws-sdk-s3, image, webp, hmac deps)
├── crates/v1/
│   ├── api/
│   │   ├── Cargo.toml                              (modify: aws-* deps, image, webp, hmac)
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   │   ├── mod.rs                          (NEW)
│   │   │   │   └── guard.rs                        (NEW: require_owner)
│   │   │   ├── image/
│   │   │   │   ├── mod.rs                          (NEW)
│   │   │   │   └── avatar_resize.rs                (NEW: resize variants)
│   │   │   ├── storage/
│   │   │   │   ├── mod.rs                          (modify: re-export avatar_s3)
│   │   │   │   └── avatar_s3.rs                    (NEW: presigned_put, copy, delete, head)
│   │   │   ├── security/
│   │   │   │   ├── mod.rs                          (modify: re-export claim)
│   │   │   │   └── claim_token.rs                  (NEW: sign_claim, verify_claim)
│   │   │   ├── handlers/
│   │   │   │   ├── common.rs                       (modify: actor_of + extension extractor)
│   │   │   │   ├── owner.rs                        (modify: @Public marker + require_owner)
│   │   │   │   └── upload_avatar.rs                (modify: fill 6 TODOs)
│   │   │   ├── lib.rs                              (modify: register routes)
│   │   │   └── AppState                            (modify: add s3_client, avatar_bucket, hmac_secret, avatar_enabled)
│   │   └── tests/
│   │       ├── upload_avatar_e2e.rs                (NEW: integration)
│   │       └── owner_profile_authz.rs              (NEW: integration)
│   ├── storage/src/avatar.rs                       (NEW: repo_owner update_avatar_url, get_for_update)
│   ├── storage/src/lib.rs                          (modify: re-export avatar)
│   └── storage/migrations/
│       └── V1_015__v1_owner_avatar.sql             (NEW: outbox event payload extension if needed)
└── deploy/aws/foundation/foundation.yaml           (modify: AvatarBucket, AvatarOAI, AvatarDistribution)

tastile-web/                                        (worktree: tastile-web.avatar, branch avatar-web-phase-a)
├── package.json                                    (verify @testing-library/react, vitest)
├── src/
│   ├── lib/
│   │   ├── api/
│   │   │   └── endpoints.ts                        (modify: add 4 ENDPOINTS entries)
│   │   └── cognito/account-session.ts              (modify: add getAccountOwnerId())
│   ├── app/
│   │   └── api/
│   │       └── me/route.ts                         (NEW: GET /api/me handler)
│   └── lib/api/
│       └── endpoints.test.ts                       (modify: verify new entries)
└── vitest.config.ts                                (verify config)
```

---

# PHASE 0 — Worktree Setup

## Task 0.1: Create `tastile-core.wslc-avatar` worktree

**Files:**
- Worktree: `C:\Users\rebui\Desktop\tastile\tastile-core.wslc-avatar` (new)
- Branch: `wslc-avatar`

- [ ] **Step 1: Verify main is clean**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core"
git status --short
```

Expected: no output (clean tree) OR only the existing modified files from prior plans.

- [ ] **Step 2: Create worktree from main**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core"
git worktree add ../tastile-core.wslc-avatar -b wslc-avatar main
```

Expected: `Preparing worktree (new branch 'wslc-avatar')` then `HEAD is now at <sha>`.

- [ ] **Step 3: Verify branch and rust toolchain**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git branch --show-current
cargo --version
```

Expected: `wslc-avatar` and `cargo 1.83.0` or newer.

- [ ] **Step 4: Switch all subsequent core commands to the worktree path**

Note: All `cd "C:/Users/rebui/Desktop/tastile/tastile-core"` references in subsequent tasks must be replaced with `cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"`. The agent should remember this substitution.

- [ ] **Step 5: Create `tastile-web.avatar` worktree**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web"
git worktree add ../tastile-web.avatar -b avatar-web-phase-a main
git branch --show-current
```

Expected: `avatar-web-phase-a`.

---

# PHASE 1 — Backend Utilities

## Task 1.1: HMAC claim_token sign/verify utility (TDD)

**Files:**
- Create: `crates/v1/api/src/security/mod.rs`
- Create: `crates/v1/api/src/security/claim_token.rs`
- Modify: `crates/v1/api/src/lib.rs` (re-export)
- Test: inline `#[cfg(test)]` in `claim_token.rs`

- [ ] **Step 1: Write failing test for sign/verify roundtrip**

Create `crates/v1/api/src/security/claim_token.rs`:

```rust
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::error::ApiHttpError;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimPayload {
    pub upload_id: Uuid,
    pub target_kind: i16,
    pub target_id: Uuid,
    pub byte_size: i64,
    pub content_type: String,
    pub expires_at: DateTime<Utc>,
}

pub fn sign_claim(
    payload: &ClaimPayload,
    secret: &[u8],
) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    let json = serde_json::to_vec(payload).expect("payload is serializable");
    mac.update(&json);
    let tag = mac.finalize().into_bytes();
    use base64::Engine;
    format!("{}.{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json), base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(tag))
}

pub fn verify_claim(token: &str, secret: &[u8]) -> Result<ClaimPayload, ApiHttpError> {
    let (b64_payload, b64_tag) = token.split_once('.').ok_or_else(|| ApiHttpError::unauthorized("INVALID_CLAIM_FORMAT"))?;
    use base64::Engine;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64_payload)
        .map_err(|_| ApiHttpError::unauthorized("INVALID_CLAIM_ENCODING"))?;
    let tag_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64_tag)
        .map_err(|_| ApiHttpError::unauthorized("INVALID_CLAIM_ENCODING"))?;
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| ApiHttpError::internal("HMAC_INIT_FAILED"))?;
    mac.update(&payload_bytes);
    mac.verify_slice(&tag_bytes).map_err(|_| ApiHttpError::unauthorized("INVALID_CLAIM"))?;
    let payload: ClaimPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiHttpError::unauthorized("INVALID_CLAIM_PAYLOAD"))?;
    if Utc::now() > payload.expires_at {
        return Err(ApiHttpError::unauthorized("CLAIM_EXPIRED"));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> ClaimPayload {
        ClaimPayload {
            upload_id: Uuid::new_v4(),
            target_kind: 0,
            target_id: Uuid::new_v4(),
            byte_size: 1234,
            content_type: "image/webp".to_string(),
            expires_at: Utc::now() + Duration::minutes(15),
        }
    }

    #[test]
    fn sign_then_verify_roundtrips() {
        let secret = b"test-secret-32-bytes-long-xxxxxxxx";
        let payload = sample_payload();
        let token = sign_claim(&payload, secret);
        let decoded = verify_claim(&token, secret).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn verify_rejects_wrong_secret() {
        let payload = sample_payload();
        let token = sign_claim(&payload, b"secret-a");
        let err = verify_claim(&token, b"secret-b").unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Unauthorized));
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let secret = b"test-secret-32-bytes-long-xxxxxxxx";
        let mut payload = sample_payload();
        let token = sign_claim(&payload, secret);
        payload.byte_size += 1;
        let tampered_token = sign_claim(&payload, secret);
        let err = verify_claim(&tampered_token, secret).unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Unauthorized));
    }

    #[test]
    fn verify_rejects_expired_token() {
        let secret = b"test-secret-32-bytes-long-xxxxxxxx";
        let mut payload = sample_payload();
        payload.expires_at = Utc::now() - Duration::seconds(1);
        let token = sign_claim(&payload, secret);
        let err = verify_claim(&token, secret).unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Unauthorized));
    }

    #[test]
    fn verify_rejects_malformed_token() {
        let err = verify_claim("not-a-token", b"secret").unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Unauthorized));
    }
}
```

Create `crates/v1/api/src/security/mod.rs`:

```rust
pub mod claim_token;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api security::claim_token --no-run 2>&1 | tail -20
```

Expected: compilation error (missing `base64` dep, `ApiHttpErrorKind` not defined).

- [ ] **Step 3: Add deps to `crates/v1/api/Cargo.toml`**

```toml
[dependencies]
# ... existing deps ...
hmac = "0.12"
sha2 = "0.10"
base64 = "0.22"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 4: Verify ApiHttpError exposes kind()**

If `ApiHttpError` doesn't have `kind()`, refactor in `crates/v1/api/src/error.rs` to add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiHttpErrorKind {
    BadRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
    ServiceUnavailable,
    Internal,
}

impl ApiHttpError {
    pub fn kind(&self) -> ApiHttpErrorKind {
        match self {
            ApiHttpError::BadRequest(_) => ApiHttpErrorKind::BadRequest,
            ApiHttpError::Unauthorized(_) => ApiHttpErrorKind::Unauthorized,
            ApiHttpError::Forbidden(_) => ApiHttpErrorKind::Forbidden,
            ApiHttpError::NotFound(_) => ApiHttpErrorKind::NotFound,
            ApiHttpError::Conflict(_) => ApiHttpErrorKind::Conflict,
            ApiHttpError::PayloadTooLarge => ApiHttpErrorKind::PayloadTooLarge,
            ApiHttpError::UnsupportedMediaType(_) => ApiHttpErrorKind::UnsupportedMediaType,
            ApiHttpError::ServiceUnavailable(_) => ApiHttpErrorKind::ServiceUnavailable,
            ApiHttpError::Internal(_) => ApiHttpErrorKind::Internal,
        }
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api security::claim_token
```

Expected: `5 passed; 0 failed`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/security/ crates/v1/api/Cargo.toml crates/v1/api/src/error.rs
git commit -m "feat(v1): add HMAC claim_token sign/verify utility"
```

---

## Task 1.2: avatar image resize module (TDD)

**Files:**
- Create: `crates/v1/api/src/image/mod.rs`
- Create: `crates/v1/api/src/image/avatar_resize.rs`
- Modify: `crates/v1/api/src/lib.rs` (re-export)
- Test: inline `#[cfg(test)]` in `avatar_resize.rs`

- [ ] **Step 1: Add image + webp deps**

In `crates/v1/api/Cargo.toml`:

```toml
[dependencies]
image = { version = "0.25", default-features = false, features = ["webp"] }
```

- [ ] **Step 2: Write failing test**

Create `crates/v1/api/src/image/avatar_resize.rs`:

```rust
use image::{ImageEncoder, ImageFormat, RgbaImage};

pub const VARIANT_SIZES: &[u32] = &[32, 64, 128];

pub fn decode_webp(bytes: &[u8]) -> Result<RgbaImage, image::ImageError> {
    let img = image::load_from_memory_with_format(bytes, ImageFormat::WebP)?;
    Ok(img.to_rgba8())
}

pub fn resize_square(src: &RgbaImage, target: u32) -> RgbaImage {
    image::imageops::resize(src, target, target, image::imageops::FilterType::Lanczos3)
}

pub fn encode_webp(img: &RgbaImage, quality: u8) -> Result<Vec<u8>, image::ImageError> {
    let mut out = Vec::with_capacity((img.width() * img.height() / 4) as usize);
    let encoder = image::codecs::webp::WebPEncoder::new_lossless(image::ExtendedColorType::Rgba8);
    encoder.write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
        &mut std::io::Cursor::new(&mut out),
    )?;
    // quality param is informational for lossless; if lossy needed, use:
    // WebPEncoder::new_with_quality(...)
    Ok(out)
}

pub fn generate_variants(source: &[u8]) -> Result<Vec<(u32, Vec<u8>)>, image::ImageError> {
    let img = decode_webp(source)?;
    VARIANT_SIZES
        .iter()
        .map(|&size| {
            let resized = resize_square(&img, size);
            encode_webp(&resized, 85).map(|bytes| (size, bytes))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_image(size: u32) -> RgbaImage {
        // Solid red square with a white center for visual debugging
        let mut img = RgbaImage::new(size, size);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgba([255, 0, 0, 255]);
        }
        let center = size / 2;
        for y in center.saturating_sub(2)..center + 2 {
            for x in center.saturating_sub(2)..center + 2 {
                img.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
        img
    }

    #[test]
    fn resize_square_preserves_aspect() {
        let src = make_test_image(256);
        let out = resize_square(&src, 64);
        assert_eq!(out.width(), 64);
        assert_eq!(out.height(), 64);
        // Center pixel should be white (still in bounds after resize)
        let center = out.get_pixel(32, 32);
        assert!(center.0[0] > 200 && center.0[1] > 200 && center.0[2] > 200);
    }

    #[test]
    fn generate_variants_produces_three_sizes() {
        let src_img = make_test_image(256);
        let mut webp_bytes = Vec::new();
        let encoder = image::codecs::webp::WebPEncoder::new_lossless(image::ExtendedColorType::Rgba8);
        encoder.write_image(
            src_img.as_raw(),
            src_img.width(),
            src_img.height(),
            image::ExtendedColorType::Rgba8,
            &mut std::io::Cursor::new(&mut webp_bytes),
        ).unwrap();

        let variants = generate_variants(&webp_bytes).unwrap();
        assert_eq!(variants.len(), 3);
        let sizes: Vec<u32> = variants.iter().map(|(s, _)| *s).collect();
        assert_eq!(sizes, vec![32, 64, 128]);
        for (size, bytes) in &variants {
            assert!(!bytes.is_empty(), "variant {} produced empty bytes", size);
            // Sanity: decoded size matches
            let decoded = decode_webp(bytes).unwrap();
            assert_eq!(decoded.width(), *size);
            assert_eq!(decoded.height(), *size);
        }
    }

    #[test]
    fn decode_webp_rejects_invalid_bytes() {
        let result = decode_webp(b"not an image");
        assert!(result.is_err());
    }
}
```

Create `crates/v1/api/src/image/mod.rs`:

```rust
pub mod avatar_resize;
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api image::avatar_resize --no-run 2>&1 | tail -20
```

Expected: compilation error (missing `image` crate or wrong API).

- [ ] **Step 4: Fix compilation if image API differs**

If `WebPEncoder::new_lossless` signature differs in the installed `image` version, adjust. The actual API as of `image` 0.25:

```rust
use image::ImageEncoder;
let encoder = image::codecs::webp::WebPEncoder::new_lossless(image::ExtendedColorType::Rgba8);
encoder.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8, &mut std::io::Cursor::new(&mut out))?;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api image::avatar_resize
```

Expected: `3 passed; 0 failed`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/image/ crates/v1/api/Cargo.toml
git commit -m "feat(v1): add avatar image resize module (32/64/128 variants)"
```

---

## Task 1.3: auth-guard require_owner helper (TDD)

**Files:**
- Create: `crates/v1/api/src/auth/mod.rs`
- Create: `crates/v1/api/src/auth/guard.rs`
- Modify: `crates/v1/api/src/lib.rs` (re-export)
- Test: inline `#[cfg(test)]` in `guard.rs`

- [ ] **Step 1: Write failing test**

Create `crates/v1/api/src/auth/guard.rs`:

```rust
use uuid::Uuid;

use crate::error::ApiHttpError;
use crate::handlers::common::Actor;

pub fn require_owner(actor: &Actor, path_kind: i16, path_id: Uuid) -> Result<(), ApiHttpError> {
    if actor.owner_kind != path_kind || actor.owner_id != path_id {
        return Err(ApiHttpError::forbidden("NOT_OWNER"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::common::ActorKind;

    fn actor(owner_kind: i16, owner_id: Uuid) -> Actor {
        Actor {
            owner_kind,
            owner_id,
            kind: ActorKind::User,
            actor_id: owner_id,
        }
    }

    #[test]
    fn require_owner_passes_when_match() {
        let id = Uuid::new_v4();
        let a = actor(0, id);
        assert!(require_owner(&a, 0, id).is_ok());
    }

    #[test]
    fn require_owner_rejects_kind_mismatch() {
        let id = Uuid::new_v4();
        let a = actor(0, id);
        let err = require_owner(&a, 1, id).unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Forbidden));
    }

    #[test]
    fn require_owner_rejects_id_mismatch() {
        let a = actor(0, Uuid::new_v4());
        let other = Uuid::new_v4();
        let err = require_owner(&a, 0, other).unwrap_err();
        assert!(matches!(err.kind(), ApiHttpErrorKind::Forbidden));
    }
}
```

Note: The `Actor` struct must expose `owner_kind: i16` (not `kind: ActorKind` for owner-side). If the existing struct doesn't, extend it (see Task 1.4).

Create `crates/v1/api/src/auth/mod.rs`:

```rust
pub mod guard;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api auth::guard --no-run 2>&1 | tail -20
```

Expected: compilation error (Actor struct fields don't match).

- [ ] **Step 3: Extend Actor struct**

In `crates/v1/api/src/handlers/common.rs`, locate the `Actor` struct (currently `Actor { owner_id, kind: ActorKind, actor_id }` per exploration). Add `owner_kind: i16`:

```rust
#[derive(Debug, Clone, Copy)]
pub struct Actor {
    pub owner_kind: i16,
    pub owner_id: Uuid,
    pub kind: ActorKind,
    pub actor_id: Uuid,
}

impl Actor {
    pub fn new_user(owner_id: Uuid, actor_id: Uuid) -> Self {
        Self {
            owner_kind: 0,
            owner_id,
            kind: ActorKind::User,
            actor_id,
        }
    }
}
```

Update `actor_of()` to take owner_kind:

```rust
pub fn actor_of(_state: &AppState, owner_kind: i16, owner_id: Uuid, actor_id: Uuid) -> Actor {
    Actor {
        owner_kind,
        owner_id,
        kind: ActorKind::User,
        actor_id,
    }
}
```

Update `authenticate()` to extract `owner_kind` from `v1_owner_user.kind` (default 0 if not present) and return `(owner_kind, owner_id, actor_id)`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api auth::guard
```

Expected: `3 passed; 0 failed`.

- [ ] **Step 5: Run full test suite to verify no regression**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api --lib
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/auth/ crates/v1/api/src/handlers/common.rs
git commit -m "feat(v1): add require_owner authz guard, extend Actor with owner_kind"
```

---

## Task 1.4: S3 client wrapper (TDD)

**Files:**
- Create: `crates/v1/storage/src/avatar_s3.rs`
- Modify: `crates/v1/storage/src/lib.rs`
- Test: integration test in `crates/v1/api/tests/s3_smoke.rs` (uses LocalStack OR mocks with `aws-sdk-s3` via `aws_config::BehaviorVersion`)

Note: For testability without a real S3, this task uses dependency injection. The S3 client is constructed once in `AppState` and passed in. Tests mock by providing a custom trait implementation.

- [ ] **Step 1: Define AvatarStorage trait**

Create `crates/v1/storage/src/avatar_s3.rs`:

```rust
use async_trait::async_trait;
use aws_sdk_s3::presigning::PresigningConfig;
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use crate::error::StorageError;

#[async_trait]
pub trait AvatarStorage: Send + Sync {
    async fn presign_put_source(
        &self,
        upload_id: Uuid,
        ttl: Duration,
    ) -> Result<(String, DateTime<Utc>), StorageError>;

    async fn head_source(
        &self,
        upload_id: Uuid,
    ) -> Result<Option<(i64, String)>, StorageError>;

    async fn copy_to_committed(
        &self,
        upload_id: Uuid,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
    ) -> Result<(), StorageError>;

    async fn get_committed_source(
        &self,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
    ) -> Result<Vec<u8>, StorageError>;

    async fn put_variant(
        &self,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
        size: u32,
        bytes: &[u8],
    ) -> Result<(), StorageError>;

    async fn delete_pending(&self, upload_id: Uuid) -> Result<(), StorageError>;
}

pub struct S3AvatarStorage {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3AvatarStorage {
    pub fn new(client: aws_sdk_s3::Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

#[async_trait]
impl AvatarStorage for S3AvatarStorage {
    async fn presign_put_source(
        &self,
        upload_id: Uuid,
        ttl: Duration,
    ) -> Result<(String, DateTime<Utc>), StorageError> {
        let key = format!("pending/{upload_id}/source.webp");
        let presigned = self.client
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .content_type("image/webp")
            .presigned(PresigningConfig::expires_in(ttl)?)
            .await?;
        Ok((presigned.uri().to_string(), Utc::now() + ttl))
    }

    async fn head_source(
        &self,
        upload_id: Uuid,
    ) -> Result<Option<(i64, String)>, StorageError> {
        let key = format!("pending/{upload_id}/source.webp");
        match self.client.head_object().bucket(&self.bucket).key(&key).send().await {
            Ok(out) => Ok(Some((out.content_length().unwrap_or(0), out.content_type().unwrap_or("").to_string()))),
            Err(e) => {
                if e.as_service_error().map(|s| s.is_not_found()).unwrap_or(false) {
                    Ok(None)
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn copy_to_committed(
        &self,
        upload_id: Uuid,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
    ) -> Result<(), StorageError> {
        let dest = format!("committed/{owner_kind}/{owner_id}/r{revision}/source.webp");
        let src = format!("{}/pending/{upload_id}/source.webp", self.bucket);
        self.client.copy_object()
            .bucket(&self.bucket)
            .key(&dest)
            .copy_source(src)
            .send().await?;
        Ok(())
    }

    async fn get_committed_source(
        &self,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
    ) -> Result<Vec<u8>, StorageError> {
        let key = format!("committed/{owner_kind}/{owner_id}/r{revision}/source.webp");
        let out = self.client.get_object()
            .bucket(&self.bucket)
            .key(&key)
            .send().await?;
        let bytes = out.body.collect().await?;
        Ok(bytes.into_bytes().to_vec())
    }

    async fn put_variant(
        &self,
        owner_kind: i16,
        owner_id: Uuid,
        revision: i64,
        size: u32,
        bytes: &[u8],
    ) -> Result<(), StorageError> {
        let key = format!("committed/{owner_kind}/{owner_id}/r{revision}/variants/{size}.webp");
        self.client.put_object()
            .bucket(&self.bucket)
            .key(&key)
            .content_type("image/webp")
            .body(bytes.to_vec().into())
            .send().await?;
        Ok(())
    }

    async fn delete_pending(&self, upload_id: Uuid) -> Result<(), StorageError> {
        let key = format!("pending/{upload_id}/source.webp");
        self.client.delete_object().bucket(&self.bucket).key(&key).send().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-memory mock for unit tests
    pub struct InMemoryAvatarStorage {
        pub objects: std::sync::Mutex<std::collections::HashMap<String, (Vec<u8>, String)>>,
    }

    impl InMemoryAvatarStorage {
        pub fn new() -> Self {
            Self { objects: std::sync::Mutex::new(Default::default()) }
        }
    }

    #[async_trait]
    impl AvatarStorage for InMemoryAvatarStorage {
        async fn presign_put_source(&self, upload_id: Uuid, _ttl: Duration) -> Result<(String, DateTime<Utc>), StorageError> {
            Ok((format!("https://mock-s3/pending/{upload_id}/source.webp?sig=test"), Utc::now() + _ttl))
        }
        async fn head_source(&self, upload_id: Uuid) -> Result<Option<(i64, String)>, StorageError> {
            let key = format!("pending/{upload_id}/source.webp");
            Ok(self.objects.lock().unwrap().get(&key).map(|(b, c)| (b.len() as i64, c.clone())))
        }
        async fn copy_to_committed(&self, upload_id: Uuid, owner_kind: i16, owner_id: Uuid, revision: i64) -> Result<(), StorageError> {
            let src = format!("pending/{upload_id}/source.webp");
            let dest = format!("committed/{owner_kind}/{owner_id}/r{revision}/source.webp");
            let mut store = self.objects.lock().unwrap();
            let entry = store.remove(&src).ok_or_else(|| StorageError::NotFound)?;
            store.insert(dest, entry);
            Ok(())
        }
        async fn get_committed_source(&self, owner_kind: i16, owner_id: Uuid, revision: i64) -> Result<Vec<u8>, StorageError> {
            let key = format!("committed/{owner_kind}/{owner_id}/r{revision}/source.webp");
            self.objects.lock().unwrap().get(&key).map(|(b, _)| b.clone()).ok_or(StorageError::NotFound)
        }
        async fn put_variant(&self, owner_kind: i16, owner_id: Uuid, revision: i64, size: u32, bytes: &[u8]) -> Result<(), StorageError> {
            let key = format!("committed/{owner_kind}/{owner_id}/r{revision}/variants/{size}.webp");
            self.objects.lock().unwrap().insert(key, (bytes.to_vec(), "image/webp".to_string()));
            Ok(())
        }
        async fn delete_pending(&self, upload_id: Uuid) -> Result<(), StorageError> {
            let key = format!("pending/{upload_id}/source.webp");
            self.objects.lock().unwrap().remove(&key);
            Ok(())
        }
    }

    #[tokio::test]
    async fn in_memory_mock_roundtrips() {
        let storage = InMemoryAvatarStorage::new();
        let upload_id = Uuid::new_v4();
        let owner = Uuid::new_v4();

        // presign returns mock URL
        let (url, _) = storage.presign_put_source(upload_id, Duration::minutes(15)).await.unwrap();
        assert!(url.contains(&upload_id.to_string()));

        // simulate PUT
        storage.objects.lock().unwrap().insert(
            format!("pending/{upload_id}/source.webp"),
            (vec![1, 2, 3], "image/webp".to_string()),
        );

        // head returns the bytes
        let (size, ctype) = storage.head_source(upload_id).await.unwrap().unwrap();
        assert_eq!(size, 3);
        assert_eq!(ctype, "image/webp");

        // copy + variants
        storage.copy_to_committed(upload_id, 0, owner, 1).await.unwrap();
        storage.put_variant(0, owner, 1, 32, b"variant-bytes").await.unwrap();
        storage.delete_pending(upload_id).await.unwrap();

        // pending is empty
        assert!(storage.head_source(upload_id).await.unwrap().is_none());
    }
}
```

Add to `crates/v1/storage/src/lib.rs`:

```rust
pub mod avatar_s3;
pub use avatar_s3::{AvatarStorage, S3AvatarStorage};
```

Add `async-trait` to `crates/v1/storage/Cargo.toml`:

```toml
[dependencies]
async-trait = "0.1"
aws-sdk-s3 = "1.40"
aws-config = "1.1"
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-storage avatar_s3
```

Expected: `1 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/storage/src/avatar_s3.rs crates/v1/storage/src/lib.rs crates/v1/storage/Cargo.toml
git commit -m "feat(v1): add AvatarStorage trait + S3 impl + InMemory mock"
```

---

# PHASE 2 — Backend Handler Implementation

## Task 2.1: create_upload handler (TDD)

**Files:**
- Modify: `crates/v1/api/src/handlers/upload_avatar.rs`
- Test: `crates/v1/api/tests/upload_avatar_e2e.rs` (new)

- [ ] **Step 1: Write failing integration test**

Create `crates/v1/api/tests/upload_avatar_e2e.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use v1_api::build_test_router;
use v1_api::AppState;
use v1_storage::avatar_s3::InMemoryAvatarStorage;

async fn build_test_state() -> AppState {
    // Connect to test DB, create test user with owner_id, build state with InMemoryAvatarStorage
    // This is the standard pattern from existing tests; copy from crates/v1/api/tests/list_tiles_view_model.rs:65-100
    todo!("Use existing test bootstrap pattern from list_tiles_view_model.rs")
}

#[tokio::test]
async fn create_upload_requires_auth() {
    let state = build_test_state().await;
    let app = build_test_router(state);
    let res = app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/v1/uploads/avatar")
            .header("Content-Type", "application/json")
            .body(Body::from(json!({
                "target_kind": 0,
                "target_id": "00000000-0000-0000-0000-000000000000",
                "content_type": "image/webp",
                "byte_size": 1234,
            }).to_string()))
            .unwrap()
    ).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_upload_rejects_target_id_mismatch() {
    // Bootstrap test state with owner X, then send request with target_id = Y (different owner)
    // Expected: 403 NOT_OWNER
    todo!()
}

#[tokio::test]
async fn create_upload_rejects_non_webp_content_type() {
    todo!()
}

#[tokio::test]
async fn create_upload_rejects_oversized_byte_size() {
    todo!()
}

#[tokio::test]
async fn create_upload_happy_path_returns_201_with_presigned_url() {
    let state = build_test_state().await;
    let app = build_test_router(state.clone());
    let owner_id = /* get current test user owner_id */;
    let res = app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/v1/uploads/avatar")
            .header("Authorization", format!("Bearer <test-token-for-{owner_id}>"))
            .header("Content-Type", "application/json")
            .body(Body::from(json!({
                "target_kind": 0,
                "target_id": owner_id,
                "content_type": "image/webp",
                "byte_size": 1234,
            }).to_string()))
            .unwrap()
    ).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), 4096).await.unwrap()
    ).unwrap();
    assert!(body["upload_id"].is_string());
    assert!(body["presigned_put_url"].as_str().unwrap().contains("source.webp"));
    assert!(body["claim_token"].as_str().is_some());
}
```

- [ ] **Step 2: Implement create_upload with auth + validation**

In `crates/v1/api/src/handlers/upload_avatar.rs`, replace the `create_upload` function body with:

```rust
use crate::auth::guard::require_owner;
use crate::security::claim_token::{sign_claim, ClaimPayload};
use crate::handlers::common::Actor;
use axum::extract::State;
use axum::Extension;
use chrono::{Duration, Utc};
use uuid::Uuid;

pub async fn create_upload(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Json(req): Json<CreateUploadRequest>,
) -> Result<(StatusCode, Json<UploadCreatedView>), ApiHttpError> {
    // Feature flag
    if !state.feature_flags.avatar_enabled {
        return Err(ApiHttpError::service_unavailable("FEATURE_DISABLED"));
    }

    // 1. require_owner
    require_owner(&actor, req.target_kind, req.target_id)?;

    // 2. content_type validation
    if req.content_type != "image/webp" {
        return Err(ApiHttpError::unsupported_media_type("UNSUPPORTED_CONTENT_TYPE"));
    }

    // 3. byte_size cap (2 MB)
    const MAX_SIZE: i64 = 2 * 1024 * 1024;
    if req.byte_size <= 0 || req.byte_size > MAX_SIZE {
        return Err(ApiHttpError::payload_too_large());
    }

    // 4. presign PUT
    let upload_id = Uuid::new_v4();
    let ttl = Duration::minutes(15);
    let (presigned_put_url, expires_at) = state.avatar_storage
        .presign_put_source(upload_id, ttl)
        .await
        .map_err(ApiHttpError::from)?;

    // 5. sign claim token
    let payload = ClaimPayload {
        upload_id,
        target_kind: req.target_kind,
        target_id: req.target_id,
        byte_size: req.byte_size,
        content_type: req.content_type,
        expires_at,
    };
    let claim_token = sign_claim(&payload, &state.hmac_secret);

    Ok((StatusCode::CREATED, Json(UploadCreatedView {
        upload_id,
        presigned_put_url,
        expires_at,
        claim_token,
    })))
}
```

- [ ] **Step 3: Add AppState fields**

In `crates/v1/api/src/lib.rs` (or wherever `AppState` is defined):

```rust
pub struct AppState {
    // ... existing fields ...
    pub avatar_storage: Arc<dyn v1_storage::avatar_s3::AvatarStorage>,
    pub hmac_secret: Vec<u8>,
    pub feature_flags: FeatureFlags,
}

#[derive(Debug, Clone)]
pub struct FeatureFlags {
    pub avatar_enabled: bool,
}
```

- [ ] **Step 4: Wire test state**

In `build_test_state()` helper inside the test file, construct AppState with `InMemoryAvatarStorage`, a test HMAC secret, and `feature_flags.avatar_enabled = true`. Use the existing pattern from `list_tiles_view_model.rs`.

- [ ] **Step 5: Run tests**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api --test upload_avatar_e2e
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/handlers/upload_avatar.rs crates/v1/api/src/lib.rs crates/v1/api/tests/upload_avatar_e2e.rs
git commit -m "feat(v1): implement create_upload with auth, validation, presigned URL"
```

---

## Task 2.2: commit_upload handler (TDD)

**Files:**
- Modify: `crates/v1/api/src/handlers/upload_avatar.rs`
- Modify: `crates/v1/storage/src/owner.rs` (new functions)
- Test: extend `crates/v1/api/tests/upload_avatar_e2e.rs`

- [ ] **Step 1: Write failing tests**

Append to `crates/v1/api/tests/upload_avatar_e2e.rs`:

```rust
#[tokio::test]
async fn commit_upload_rejects_invalid_claim_token() {
    todo!()
}

#[tokio::test]
async fn commit_upload_rejects_expired_claim() {
    todo!()
}

#[tokio::test]
async fn commit_upload_returns_503_when_source_missing() {
    todo!()
}

#[tokio::test]
async fn commit_upload_rejects_size_mismatch() {
    todo!()
}

#[tokio::test]
async fn commit_upload_happy_path_updates_avatar_url_and_emits_outbox() {
    let state = build_test_state().await;
    let owner_id = /* get current test user owner_id */;

    // 1. create_upload
    let create_res = /* POST /v1/uploads/avatar with valid request */;
    let create_body: serde_json::Value = /* parse */;
    let upload_id = create_body["upload_id"].as_str().unwrap().to_string();
    let claim_token = create_body["claim_token"].as_str().unwrap().to_string();

    // 2. simulate PUT by injecting into InMemoryAvatarStorage
    let pending_key = format!("pending/{upload_id}/source.webp");
    /* put a valid WebP source via state.avatar_storage internals (test-only) */

    // 3. commit_upload
    let commit_res = /* POST /v1/uploads/avatar/{upload_id}/commit with claim_token */;
    assert_eq!(commit_res.status(), StatusCode::OK);

    // 4. verify profile.avatar_url updated
    let profile = /* GET /v1/owners/0/{owner_id}/profile */;
    assert!(profile["avatar_url"].as_str().unwrap().contains(&upload_id.replace('-', "")));
    assert!(profile["avatar_url"].as_str().unwrap().ends_with("/source.webp"));
    assert_eq!(profile["revision"].as_i64().unwrap(), /* initial_revision + 1 */);

    // 5. verify variants exist in storage
    /* assert InMemoryAvatarStorage has 3 variants at r1/variants/{32,64,128}.webp */

    // 6. verify OutboxEvent::ProfileUpdated was emitted
    /* SELECT * FROM v1_outbox_event WHERE kind = 'ProfileUpdated' */
}
```

- [ ] **Step 2: Implement storage functions**

In `crates/v1/storage/src/owner.rs`:

```rust
pub async fn get_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kind: i16,
    id: Uuid,
) -> Result<Option<OwnerRow>, sqlx::Error> {
    let row = sqlx::query_as!(
        OwnerRow,
        r#"SELECT kind, id, display_name, avatar_url, bio, accent_color, revision
           FROM v1_owner WHERE kind = $1 AND id = $2 FOR UPDATE"#,
        kind,
        id
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row)
}

pub async fn update_avatar_url(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kind: i16,
    id: Uuid,
    avatar_url: &str,
    new_revision: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"UPDATE v1_owner SET avatar_url = $1, revision = $2, updated_at = NOW()
           WHERE kind = $3 AND id = $4"#,
        avatar_url,
        new_revision,
        kind,
        id
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 3: Implement commit_upload**

In `crates/v1/api/src/handlers/upload_avatar.rs`, replace `commit_upload` with:

```rust
pub async fn commit_upload(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(upload_id): Path<Uuid>,
    Json(req): Json<CommitUploadRequest>,
) -> Result<Json<UploadCommittedView>, ApiHttpError> {
    if !state.feature_flags.avatar_enabled {
        return Err(ApiHttpError::service_unavailable("FEATURE_DISABLED"));
    }

    // 1. verify claim_token
    let claims = crate::security::claim_token::verify_claim(&req.claim_token, &state.hmac_secret)?;
    if claims.upload_id != upload_id {
        return Err(ApiHttpError::unauthorized("INVALID_CLAIM"));
    }

    // 2. require_owner
    require_owner(&actor, claims.target_kind, claims.target_id)?;

    // 3. S3 HEAD
    let head = state.avatar_storage
        .head_source(upload_id)
        .await
        .map_err(ApiHttpError::from)?
        .ok_or_else(|| ApiHttpError::service_unavailable("UPLOAD_NOT_FOUND"))?;

    // 4. size + content_type check
    if head.0 != claims.byte_size {
        return Err(ApiHttpError::bad_request("SIZE_MISMATCH"));
    }
    if head.1 != claims.content_type {
        return Err(ApiHttpError::bad_request("CONTENT_TYPE_MISMATCH"));
    }

    // 5. begin transaction
    let mut tx = state.pool.begin().await.map_err(ApiHttpError::from)?;

    // 6. get current owner with FOR UPDATE
    let current = v1_storage::owner::get_for_update(&mut tx, claims.target_kind, claims.target_id)
        .await
        .map_err(ApiHttpError::from)?
        .ok_or_else(|| ApiHttpError::not_found("OWNER_NOT_FOUND"))?;
    let new_rev = current.revision + 1;

    // 7. copy to committed
    state.avatar_storage
        .copy_to_committed(upload_id, claims.target_kind, claims.target_id, new_rev)
        .await
        .map_err(ApiHttpError::from)?;

    // 8. fetch source bytes for variant generation
    let source_bytes = state.avatar_storage
        .get_committed_source(claims.target_kind, claims.target_id, new_rev)
        .await
        .map_err(ApiHttpError::from)?;

    // 9. generate variants
    let variants = crate::image::avatar_resize::generate_variants(&source_bytes)
        .map_err(|e| ApiHttpError::internal(&format!("RESIZE_FAILED: {e}")))?;

    // 10. upload variants
    for (size, bytes) in &variants {
        state.avatar_storage
            .put_variant(claims.target_kind, claims.target_id, new_rev, *size, bytes)
            .await
            .map_err(ApiHttpError::from)?;
    }

    // 11. update avatar_url
    let avatar_url = format!(
        "https://cdn.tastile.app/avatar/v1/committed/{}/{}/r{}/source.webp",
        claims.target_kind, claims.target_id, new_rev
    );
    v1_storage::owner::update_avatar_url(&mut tx, claims.target_kind, claims.target_id, &avatar_url, new_rev)
        .await
        .map_err(ApiHttpError::from)?;

    // 12. emit OutboxEvent
    v1_storage::outbox::enqueue(&mut tx, v1_storage::outbox::OutboxEvent::ProfileUpdated {
        owner_kind: claims.target_kind,
        owner_id: claims.target_id,
        avatar_url: Some(avatar_url.clone()),
        revision: new_rev,
        at: Utc::now(),
    })
    .await
    .map_err(ApiHttpError::from)?;

    // 13. delete pending
    state.avatar_storage.delete_pending(upload_id).await.map_err(ApiHttpError::from)?;

    tx.commit().await.map_err(ApiHttpError::from)?;

    Ok(Json(UploadCommittedView {
        owner_kind: claims.target_kind,
        owner_id: claims.target_id,
        scope_kind: None,
        scope_id: None,
        avatar_url,
    }))
}
```

Note: `get_committed_source` is added to the `AvatarStorage` trait in Task 1.4 (next to `presign_put_source`, `head_source`, etc.) and implemented in both `S3AvatarStorage` (via `GetObject` call) and `InMemoryAvatarStorage` (returns the just-copied bytes from internal map).

- [ ] **Step 4: Run tests**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api --test upload_avatar_e2e
```

Expected: all 10 tests (5 from Task 2.1 + 5 from Task 2.2) pass.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/handlers/upload_avatar.rs crates/v1/storage/src/owner.rs crates/v1/api/src/handlers/upload_avatar.rs
git commit -m "feat(v1): implement commit_upload with HEAD verify, variant gen, OutboxEvent"
```

---

## Task 2.3: owner.rs authz fix + @Public marker (TDD)

**Files:**
- Modify: `crates/v1/api/src/handlers/owner.rs`
- Test: `crates/v1/api/tests/owner_profile_authz.rs` (new)

- [ ] **Step 1: Write failing tests**

Create `crates/v1/api/tests/owner_profile_authz.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;
use v1_api::build_test_router;

#[tokio::test]
async fn get_profile_is_public() {
    // No auth header → 200
    todo!()
}

#[tokio::test]
async fn patch_profile_requires_auth() {
    // No auth header → 401
    todo!()
}

#[tokio::test]
async fn patch_profile_rejects_other_owner() {
    // Bootstrap user X, PATCH with user Y's token and Y's id in path → 403
    todo!()
}

#[tokio::test]
async fn patch_profile_returns_409_on_stale_revision() {
    // PATCH with expected_revision = current_revision - 1 → 409
    todo!()
}

#[tokio::test]
async fn patch_profile_happy_path_updates_avatar_url() {
    todo!()
}
```

- [ ] **Step 2: Update get_profile to be @Public**

In `crates/v1/api/src/handlers/owner.rs`:

```rust
pub async fn get_profile(
    State(state): State<AppState>,
    Path((kind, id)): Path<(i16, Uuid)>,
) -> Result<Json<ProfileView>, ApiHttpError> {
    // No auth required (other users' avatars are public)
    let row = v1_storage::owner::get(&state.pool, kind, id)
        .await
        .map_err(ApiHttpError::from)?
        .ok_or_else(|| ApiHttpError::not_found("OWNER_NOT_FOUND"))?;
    Ok(Json(ProfileView::from(row)))
}
```

- [ ] **Step 3: Update patch_profile to use require_owner**

```rust
pub async fn patch_profile(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path((kind, id)): Path<(i16, Uuid)>,
    Json(req): Json<PatchProfileRequest>,
) -> Result<Json<ProfileView>, ApiHttpError> {
    if !state.feature_flags.avatar_enabled && req.avatar_url.is_some() {
        return Err(ApiHttpError::service_unavailable("FEATURE_DISABLED"));
    }

    require_owner(&actor, kind, id)?;

    let mut tx = state.pool.begin().await.map_err(ApiHttpError::from)?;
    let current = v1_storage::owner::get_for_update(&mut tx, kind, id)
        .await
        .map_err(ApiHttpError::from)?
        .ok_or_else(|| ApiHttpError::not_found("OWNER_NOT_FOUND"))?;

    if let Some(expected) = req.expected_revision {
        if expected != current.revision {
            return Err(ApiHttpError::conflict("STALE_REVISION", json!({
                "current": ProfileView::from(current.clone())
            })));
        }
    }

    let new_rev = current.revision + 1;
    v1_storage::owner::update_profile(
        &mut tx, kind, id,
        req.display_name.as_deref(),
        req.avatar_url.as_deref(),
        req.bio.as_deref(),
        req.accent_color.as_deref(),
        new_rev,
    ).await.map_err(ApiHttpError::from)?;

    v1_storage::outbox::enqueue(&mut tx, v1_storage::outbox::OutboxEvent::ProfileUpdated {
        owner_kind: kind,
        owner_id: id,
        avatar_url: req.avatar_url.clone().or(current.avatar_url.clone()),
        revision: new_rev,
        at: Utc::now(),
    }).await.map_err(ApiHttpError::from)?;

    tx.commit().await.map_err(ApiHttpError::from)?;

    let updated = v1_storage::owner::get(&state.pool, kind, id)
        .await
        .map_err(ApiHttpError::from)?
        .ok_or_else(|| ApiHttpError::internal("OWNER_DISAPPEARED"))?;

    Ok(Json(ProfileView::from(updated)))
}
```

- [ ] **Step 4: Run tests**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test -p v1-api --test owner_profile_authz
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/handlers/owner.rs crates/v1/api/tests/owner_profile_authz.rs
git commit -m "fix(v1): make get_profile @Public, enforce require_owner on patch_profile"
```

---

## Task 2.4: register routes in build_test_router + main.rs (TDD)

**Files:**
- Modify: `crates/v1/api/src/lib.rs`
- Modify: `crates/v1/api/src/main.rs` (or wherever the prod router is)

- [ ] **Step 1: Add routes to test router**

In `crates/v1/api/src/lib.rs`:

```rust
pub fn build_test_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/tiles", get(handlers::read::list_tiles))
        .route("/v1/owners/{kind}/{id}/profile", get(handlers::owner::get_profile).patch(handlers::owner::patch_profile))
        .route("/v1/uploads/avatar", post(handlers::upload_avatar::create_upload))
        .route("/v1/uploads/avatar/{upload_id}/commit", post(handlers::upload_avatar::commit_upload))
        .route("/v1/openapi.json", get(openapi::openapi_json))
        .with_state(state)
}
```

- [ ] **Step 2: Mirror in prod router**

Apply the same `.route(...)` chain to the production router in `crates/v1/api/src/main.rs` (or wherever it lives — likely under `bin/v1-api.rs`).

- [ ] **Step 3: Run full test suite**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
cargo test --workspace
```

Expected: all tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add crates/v1/api/src/lib.rs crates/v1/api/src/main.rs
git commit -m "feat(v1): register avatar endpoints in test + prod routers"
```

---

# PHASE 3 — S3 + CloudFront Infrastructure

## Task 3.1: Foundation CFN updates

**Files:**
- Modify: `deploy/aws/foundation/foundation.yaml`

- [ ] **Step 1: Read current foundation.yaml structure**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
grep -n "Resources:" deploy/aws/foundation/foundation.yaml
grep -n "CognitoUserPool:" deploy/aws/foundation/foundation.yaml
```

Note the structure for inserting new resources.

- [ ] **Step 2: Add AvatarBucket + AvatarOAI + AvatarDistribution + BucketPolicy**

Insert before the final `Outputs:` block:

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

  AvatarBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref AvatarBucket
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Sub "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${AvatarOAI}"
            Action: s3:GetObject
            Resource: !Sub "${AvatarBucket.Arn}/*"

  AvatarDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Comment: !Sub "${ProjectName}-${EnvironmentName}-avatars"
        Enabled: true
        PriceClass: PriceClass_100
        Origins:
          - DomainName: !GetAtt AvatarBucket.RegionalDomainName
            Id: avatar-s3
            S3OriginConfig:
              OriginAccessIdentity: !Sub "origin-access-identity/cloudfront/${AvatarOAI}"
        DefaultCacheBehavior:
          TargetOriginId: avatar-s3
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD]
          CachedMethods: [GET, HEAD]
          Compress: true
          DefaultTTL: 86400
          MaxTTL: 604800
        ViewerCertificate:
          CloudFrontDefaultCertificate: true
        Aliases: []  # Use default *.cloudfront.net URL until cdn.tastile.app cert is provisioned (Phase 5)
```

Note: We're using the default CloudFront URL (`https://d111111abcdef8.cloudfront.net`) for now. The `cdn.tastile.app` alias with ACM cert is deferred to a follow-up because it requires cross-stack cert import.

- [ ] **Step 3: Update avatar_url to use configurable CDN base**

In `commit_upload`, use `state.avatar_cdn_base` (default `"https://cdn.tastile.app"`, overridable via env):

```rust
// In AppState, add:
pub avatar_cdn_base: String,  // e.g. "https://cdn.tastile.app" or staging CloudFront domain

// In commit_upload:
let avatar_url = format!(
    "{}/avatar/v1/committed/{}/{}/r{}/source.webp",
    state.avatar_cdn_base, claims.target_kind, claims.target_id, new_rev
);
```

Default in `AppState::from_env()`:

```rust
avatar_cdn_base: std::env::var("TASTILE_AVATAR_CDN_BASE")
    .unwrap_or_else(|_| "https://cdn.tastile.app".to_string()),
```

- [ ] **Step 4: Update deployment script (staging only — until cdn.tastile.app alias is provisioned)**

In `scripts/v1/deploy-foundation.ps1`, after stack update on **staging** environment only, append the CloudFront default domain to the env file:

```powershell
if ($EnvironmentName -eq "staging") {
    $avatarCdn = (aws cloudformation describe-stacks --stack-name $stackName --query "Stacks[0].Outputs[?OutputKey=='AvatarCdnDomain'].OutputValue" --output text)
    Add-Content -Path "/etc/tastile/tastile.env" -Value "TASTILE_AVATAR_CDN_BASE=https://$avatarCdn"
}
```

For **production**, omit the env var and let the default `https://cdn.tastile.app` apply (requires `cdn.tastile.app` Route53 alias + ACM cert provisioned as a separate Phase 5 task).

Add the output declaration:

```yaml
Outputs:
  # ... existing outputs ...
  AvatarCdnDomain:
    Value: !GetAtt AvatarDistribution.DomainName
    Export:
      Name: !Sub "${ProjectName}-${EnvironmentName}-avatar-cdn"
```

- [ ] **Step 5: Validate CFN template**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
aws cloudformation validate-template --template-body file://deploy/aws/foundation/foundation.yaml
```

Expected: no error.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git add deploy/aws/foundation/foundation.yaml scripts/v1/deploy-foundation.ps1 crates/v1/api/src/handlers/upload_avatar.rs crates/v1/api/src/lib.rs
git commit -m "feat(v1): add S3 + CloudFront infra for avatars, TASTILE_AVATAR_CDN_BASE env"
```

---

# PHASE 4 — Web /api/me BFF

## Task 4.1: getAccountOwnerId helper

**Files:**
- Modify: `tastile-web/src/lib/cognito/account-session.ts`
- Test: co-located `.test.ts`

- [ ] **Step 1: Add uuid library**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
bun add uuid @types/uuid
```

- [ ] **Step 2: Write failing test**

Create `tastile-web/src/lib/cognito/account-session.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { getAccountOwnerId } from "./account-session";

vi.mock("next/headers", () => ({
    cookies: vi.fn(),
}));

import { cookies } from "next/headers";

describe("getAccountOwnerId", () => {
    it("returns UUIDv5 derived from sub claim", async () => {
        const sub = "abc-123-sub";
        vi.mocked(cookies).mockReturnValue({
            get: (name: string) => name === "id_token" ? { value: makeIdToken({ sub }) } : undefined,
        } as any);

        const ownerId = await getAccountOwnerId();
        expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("returns null when no cookie", async () => {
        vi.mocked(cookies).mockReturnValue({ get: () => undefined } as any);
        const ownerId = await getAccountOwnerId();
        expect(ownerId).toBeNull();
    });
});
```

- [ ] **Step 3: Implement getAccountOwnerId**

In `tastile-web/src/lib/cognito/account-session.ts`:

```typescript
import { v5 as uuidv5 } from "uuid";

const NAMESPACE_OID = "b3b8c4e0-3d8a-4f3a-9d4a-1e2f3c4d5e6f"; // Must match Rust NAMESPACE_OID

export async function getAccountOwnerId(): Promise<string | null> {
    const sub = await getAccountUserSub();
    if (!sub) return null;
    return uuidv5(sub, NAMESPACE_OID);
}

export async function getAccountUserClaims(): Promise<{ email?: string; email_verified?: boolean; sub?: string } | null> {
    const claims = parseIdTokenClaims(await getAccountIdToken());
    return claims;
}
```

- [ ] **Step 4: Run tests**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
bun run test -- --run src/lib/cognito/account-session
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
git add src/lib/cognito/account-session.ts src/lib/cognito/account-session.test.ts package.json bun.lockb
git commit -m "feat(web): add getAccountOwnerId via UUIDv5(sub, NAMESPACE_OID)"
```

---

## Task 4.2: /api/me route

**Files:**
- Create: `tastile-web/src/app/api/me/route.ts`
- Test: `tastile-web/src/app/api/me/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `tastile-web/src/app/api/me/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/cognito/account-session", () => ({
    getAccountOwnerId: vi.fn(),
    getAccountUserClaims: vi.fn(),
}));

vi.mock("@/lib/api/core-client", () => ({
    getCoreClient: vi.fn(),
}));

import { GET } from "./route";
import { getAccountOwnerId, getAccountUserClaims } from "@/lib/cognito/account-session";
import { getCoreClient } from "@/lib/api/core-client";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/me", () => {
    it("returns 401 when not authenticated", async () => {
        vi.mocked(getAccountOwnerId).mockResolvedValue(null);
        const res = await GET();
        expect(res.status).toBe(401);
    });

    it("returns user profile when authenticated", async () => {
        const ownerId = "11111111-1111-1111-1111-111111111111";
        vi.mocked(getAccountOwnerId).mockResolvedValue(ownerId);
        vi.mocked(getAccountUserClaims).mockResolvedValue({
            email: "user@example.com",
            email_verified: true,
            sub: "abc-sub",
        });
        vi.mocked(getCoreClient).mockReturnValue({
            getOwnerProfile: vi.fn().mockResolvedValue({
                display_name: "Alice",
                avatar_url: "https://cdn.tastile.app/avatar/v1/...",
                bio: null,
                accent_color: null,
                revision: 1,
            }),
        } as any);

        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.owner_id).toBe(ownerId);
        expect(body.display_name).toBe("Alice");
        expect(body.avatar_url).toContain("cdn.tastile.app");
        expect(body.email_verified).toBe(true);
    });
});
```

- [ ] **Step 2: Implement /api/me route**

Create `tastile-web/src/app/api/me/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getAccountOwnerId, getAccountUserClaims } from "@/lib/cognito/account-session";
import { getCoreClient } from "@/lib/api/core-client";

export const dynamic = "force-dynamic";

export async function GET() {
    const ownerId = await getAccountOwnerId();
    if (!ownerId) {
        return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const claims = await getAccountUserClaims();
    const profile = await getCoreClient().getOwnerProfile(0, ownerId);

    return NextResponse.json({
        owner_id: ownerId,
        email: claims?.email ?? null,
        email_verified: claims?.email_verified ?? false,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        accent_color: profile.accent_color,
        revision: profile.revision,
    });
}
```

- [ ] **Step 3: Run tests**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
bun run test -- --run src/app/api/me
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
git add src/app/api/me/ package.json bun.lockb
git commit -m "feat(web): add /api/me BFF returning owner_id + profile"
```

---

## Task 4.3: ENDPOINTS table additions

**Files:**
- Modify: `tastile-web/src/lib/api/endpoints.ts`
- Test: `tastile-web/src/lib/api/endpoints.test.ts`

- [ ] **Step 1: Verify getOwnerProfile / patchOwnerProfile / createAvatarUpload / commitAvatarUpload don't exist**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
grep -E "getOwnerProfile|patchOwnerProfile|createAvatarUpload|commitAvatarUpload" src/lib/api/endpoints.ts
```

Expected: no output.

- [ ] **Step 2: Add the 4 endpoints**

Append to `tastile-web/src/lib/api/endpoints.ts`:

```typescript
getOwnerProfile: {
    method: "GET",
    path: "/v1/owners/{kind}/{id}/profile",
    tag: "Read",
    summary: "Get owner profile",
    auth: false,
    keywords: ["owner", "profile"],
} as EndpointMeta,
patchOwnerProfile: {
    method: "PATCH",
    path: "/v1/owners/{kind}/{id}/profile",
    tag: "Write",
    summary: "Patch owner profile",
    auth: true,
    keywords: ["owner", "profile"],
} as EndpointMeta,
createAvatarUpload: {
    method: "POST",
    path: "/v1/uploads/avatar",
    tag: "Write",
    summary: "Create avatar upload (presigned URL)",
    auth: true,
    keywords: ["avatar", "upload"],
} as EndpointMeta,
commitAvatarUpload: {
    method: "POST",
    path: "/v1/uploads/avatar/{upload_id}/commit",
    tag: "Write",
    summary: "Commit avatar upload",
    auth: true,
    keywords: ["avatar", "upload", "commit"],
} as EndpointMeta,
```

- [ ] **Step 3: Update endpoints test**

Append to `tastile-web/src/lib/api/endpoints.test.ts`:

```typescript
import { ENDPOINTS } from "./endpoints";

describe("avatar endpoints", () => {
    it("getOwnerProfile is public", () => {
        expect(ENDPOINTS.getOwnerProfile.auth).toBe(false);
        expect(ENDPOINTS.getOwnerProfile.path).toBe("/v1/owners/{kind}/{id}/profile");
    });

    it("createAvatarUpload requires auth", () => {
        expect(ENDPOINTS.createAvatarUpload.auth).toBe(true);
    });

    it("commitAvatarUpload requires auth", () => {
        expect(ENDPOINTS.commitAvatarUpload.auth).toBe(true);
    });

    it("patchOwnerProfile requires auth", () => {
        expect(ENDPOINTS.patchOwnerProfile.auth).toBe(true);
    });
});
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
bun run test -- --run src/lib/api/endpoints
bun run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
git add src/lib/api/endpoints.ts src/lib/api/endpoints.test.ts
git commit -m "feat(web): add 4 avatar endpoints to ENDPOINTS table"
```

---

# PHASE 5 — End-to-End Staging Verification

## Task 5.1: Deploy Phase A to staging

- [ ] **Step 1: Deploy foundation stack (S3 + CloudFront)**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
powershell -File scripts/v1/deploy-foundation.ps1 -EnvironmentName staging
```

Expected: stack update succeeds, AvatarDistribution output present.

- [ ] **Step 2: Build + push v1-api image**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
bun run wslc-build
bun run wslc-deploy-api
```

Expected: image pushed to ECR, container restarted on EC2.

- [ ] **Step 3: Smoke test create_upload**

```bash
curl -s -X POST https://api.tastile.app/v1/uploads/avatar \
    -H "Authorization: Bearer <staging-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"target_kind":0,"target_id":"<owner-id>","content_type":"image/webp","byte_size":1234}'
```

Expected: 201 with presigned URL.

- [ ] **Step 4: Smoke test commit_upload**

Upload a 1x1 WebP to the presigned URL, then commit:

```bash
# Generate 1x1 WebP
printf '\x52\x49\x46\x46\x1a\x00\x00\x00\x57\x45\x42\x50\x56\x50\x38\x20\x0e\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00\x02\x00\x34\x25\xa4\x00\x03\x70\x00\xfe\xfb\x94\x00\x00' > /tmp/tiny.webp

# PUT to presigned URL
curl -s -X PUT --data-binary @/tmp/tiny.webp "<presigned_put_url>"

# Commit
curl -s -X POST https://api.tastile.app/v1/uploads/avatar/<upload_id>/commit \
    -H "Authorization: Bearer <staging-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"claim_token":"<token>"}'
```

Expected: 200 with `{avatar_url: "https://<cloudfront>.cloudfront.net/avatar/v1/committed/0/<id>/r1/source.webp"}`.

- [ ] **Step 5: Verify avatar_url is fetchable via CDN**

```bash
curl -sI "https://<cloudfront-domain>/avatar/v1/committed/0/<id>/r1/source.webp"
```

Expected: HTTP 200, `Content-Type: image/webp`.

- [ ] **Step 6: Verify /api/me returns the avatar_url**

```bash
curl -s https://app.tastile.app/api/me -b "id_token=<jwt>"
```

Expected: response includes `"avatar_url": "https://<cloudfront>.cloudfront.net/avatar/v1/committed/0/<id>/r1/source.webp"`.

- [ ] **Step 7: Open staging in browser, login, check SiteHeader avatar**

Expected: avatar image visible in top-right of dashboard.

- [ ] **Step 8: Commit + push Phase A tags**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-core.wslc-avatar"
git tag v0.x.0-phase-a-avatar-backend
git push origin wslc-avatar --tags

cd "C:/Users/rebui/Desktop/tastile/tastile-web.avatar"
git tag v0.x.0-phase-a-avatar-bff
git push origin avatar-web-phase-a --tags
```

---

# Summary

**Total tasks: 12** (4 infra/util + 4 backend handler + 1 CFN + 3 web)

**Total commits: ~12**

**Phase B (web Avatar component + SiteHeader + ProfilePanel) and Phase C (Android AvatarLoader + AvatarUpload) are deferred** — create follow-up plans after Phase A lands and is verified in staging. Use the spec's §「Web クライアント」and §「Android クライアント」as the source of truth for those phases. Same TDD conventions apply: vitest for web, JUnit4 + Robolectric + MockK for android.

**Rollback plan:** Set `avatar_enabled = false` in `tastile.env`. The `require_owner` enforcement on `patch_profile` can be reverted via PR revert if any web flow breaks.