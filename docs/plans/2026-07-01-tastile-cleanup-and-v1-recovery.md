# Tastile Cleanup And V1 Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean the project, remove legacy contradictions, and establish a v1-only backend with thin web/Android/Desktop clients.

**Architecture:** v1 API is the single backend. Clients authenticate with Cognito for user login and Tastile API tokens for API access. Legacy v0 and compatibility paths are deleted or isolated to explicit test harnesses.

**Tech Stack:** Rust/Axum/SQLx/Postgres for v1 API, Next.js/TypeScript for web, Android Kotlin/Compose, WinUI/.NET for Desktop, PowerShell + `claude -p` for non-interactive task dispatch.

---

### Task 1: Repository Cleanup Inventory

**Files:**
- Read: `C:\Users\rebui\Desktop\tastile\docs\agent-handoff\PROJECT-TRUTH.md`
- Read: all repo `git status --short`
- Create or update: `docs/agent-handoff/cleanup-inventory.md`

**Steps:**
1. For each git repo (`tastile-core`, `tastile-web`, `tastile-android`, `tastile-desktop`, `tastile-brands`), classify changed/untracked files as keep, delete, archive, or needs-review.
2. Delete root `AuthKey_A5BF4N56SH.p8`.
3. Do not delete `.env` files. Verify they are ignored and examples exist.
4. Run each repo's cheap check where available: `cargo check -p api`, `bun run typecheck`, `dotnet test`, `./gradlew test`.
5. Record failures and exact commands in `cleanup-inventory.md`.

### Task 2: Auth Boundary Design And First Fixes

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/common.rs`
- Modify: `tastile-web/src/app/api/auth/session/route.ts`
- Update tests in matching test files.

**Steps:**
1. Add tests proving production rejects `x-owner-id` fallback unless an explicit non-production test flag is set.
2. Remove JSON exposure of Cognito `idToken` and `refreshToken` from `/api/auth/session`.
3. Document the two auth concerns in repo docs.
4. Run targeted Rust and web tests, then `bun run typecheck`.

### Task 3: Calendar V1 Contract

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/events.rs`
- Modify: `tastile-core/crates/v1/storage/src/events_repo.rs`
- Modify: `tastile-web/src/lib/hooks/calendar/use-events.ts`
- Modify: `tastile-web/src/lib/upstream/events.ts`

**Steps:**
1. Decide whether occurrences are served by `/v1/timeline` only or a secured `/v1/events/occurrences` facade.
2. Add tests proving a user sees only accessible placements.
3. Replace removed `/v1/events` CRUD calls with v1 tile/placement operations.
4. Verify calendar create, recurring materialization, read, and edit flows.

### Task 4: Web Typecheck And V1 Tile UI

**Files:**
- Modify: `tastile-web/tsconfig.json` or e2e test typings.
- Modify: v1 tile creation/edit components under `tastile-web/src/components`.

**Steps:**
1. Make `bun run typecheck` pass without weakening app strictness.
2. Remove stale tests or update stale imports.
3. Map v1 schema concepts to user-facing controls; do not expose internal IDs as required input.
4. Add focused tests for tile creation payloads.

### Task 5: Android Thin Client Recovery

**Files:**
- Modify: `tastile-android/app/src/main/**`

**Steps:**
1. Disable token backup and move token storage to encrypted storage.
2. Replace broken/local assumptions with v1 API calls.
3. Implement the same core flows as web: auth, token management, calendar/tile create, list, edit.
4. Add unit tests for API client request construction and auth behavior.

### Task 6: Desktop Thin Client And Updater

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/AppUpdateService.cs`
- Modify: desktop API client endpoint mappings.

**Steps:**
1. Add manifest `sha256` support and verify the downloaded installer before execution.
2. Align desktop endpoint usage to v1-only API.
3. Add tests for hash mismatch and success.

