# Versioning Structure Restructure Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove v1 from file names and code identifiers so the codebase can evolve to v2, v3... without renaming files.

**Architecture:** Version is a runtime configuration concern, not a code naming concern. Files, binaries, and modules are named generically. Version selection happens at the routing layer (URL path), config layer (env vars), and infrastructure layer (compose files).

**Tech Stack:** Rust (axum), TypeScript (Next.js), PostgreSQL (sqlx migrations), Docker Compose, PowerShell scripts

---

## Guiding Principle

**Version goes in the path, not the name.**

| Current (Bad) | Target (Good) |
|---|---|
| `v1_api.rs` binary | `api` binary |
| `TASTILE_V1_DATABASE_URL` env var | `TASTILE_DATABASE_URL` env var |
| `v1-endpoints.ts` file | `endpoints.ts` file (in v1-versioned directory if needed) |
| `build-command-v1.ts` file | `build-command.ts` file |
| `submit-v1.ts` file | `submit.ts` file |
| `v1-smoke.ps1` script | `smoke.ps1` script |

**What stays versioned (correct):**
- `crates/v1/` directory — this IS the version boundary
- `migrations/v1/` directory — schema is version-specific
- `/v1/` URL path — this IS API versioning
- `api_version: "v1"` in plugin manifests — contract versioning
- `docker-compose.v1.yml` — deployment is version-specific
- `Dockerfile.v1` — build is version-specific (but binary names inside are generic)

---

## Task 1: Rename v1 Rust binaries to generic names

**Files:**
- Modify: `tastile-core/crates/v1/api/Cargo.toml`
- Modify: `tastile-core/crates/v1/worker/Cargo.toml`
- Modify: `tastile-core/crates/v1/api/src/main.rs` (if it references binary name)
- Modify: `tastile-core/Dockerfile.v1` (update `--bin` flags and CMD)
- Modify: `tastile-core/docker-compose.v1.yml` (update command override)

**Step 1: Read current binary declarations**

```bash
# Check current [[bin]] sections
rg -n "\[\[bin\]\]" tastile-core/crates/v1/api/Cargo.toml tastile-core/crates/v1/worker/Cargo.toml
rg -n "name.*=.*v1" tastile-core/crates/v1/api/Cargo.toml tastile-core/crates/v1/worker/Cargo.toml
```

**Step 2: Rename binaries in Cargo.toml**

In `tastile-core/crates/v1/api/Cargo.toml`, change `name = "v1_api"` to `name = "api"`.
In `tastile-core/crates/v1/worker/Cargo.toml`, change `name = "v1_worker"` to `name = "worker"`.

**Step 3: Update Dockerfile.v1**

```dockerfile
# Change:
RUN cargo build --release --bin v1_api --bin v1_worker -p domain -p storage -p api -p worker
CMD ["/app/target/release/v1_api"]

# To:
RUN cargo build --release --bin api --bin worker -p domain -p storage -p api -p worker
CMD ["/app/target/release/api"]
```

**Step 4: Update docker-compose.v1.yml**

```yaml
# Change command override:
command: ["/app/target/release/v1_worker"]

# To:
command: ["/app/target/release/worker"]
```

**Step 5: Update docker-compose.v1.verify.yml**

Same command override change.

**Step 6: Verify build**

```bash
cd tastile-core && cargo check -p api -p worker
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename v1 binaries to generic names (api, worker)"
```

---

## Task 2: Rename v1 environment variables to generic names

**Files:**
- Modify: `tastile-core/crates/v1/api/src/main.rs` (env var reads)
- Modify: `tastile-core/crates/v1/worker/src/main.rs` (env var reads)
- Modify: `tastile-core/crates/v1/storage/src/*.rs` (if they read DB URL from env)
- Modify: `tastile-core/docker-compose.v1.yml` (env var definitions)
- Modify: `tastile-core/docker-compose.v1.verify.yml` (env var definitions)
- Modify: `tastile-core/scripts/v1-smoke.ps1` (env var references)
- Modify: `tastile-core/scripts/v1-live-conflict-check.ps1` (env var references)

**Step 1: Find all env var reads in v1 Rust code**

```bash
rg "TASTILE_V1_" tastile-core/crates/v1/ --no-heading
```

**Step 2: Replace env var names**

In all v1 Rust source files, replace:
- `TASTILE_V1_DATABASE_URL` → `TASTILE_DATABASE_URL`
- `TASTILE_V1_API_HOST` → `TASTILE_API_HOST`
- `TASTILE_V1_API_PORT` → `TASTILE_API_PORT`

Note: The env var names in Rust code should NOT contain v1. The version is implicit because the code lives in `crates/v1/`.

**Step 3: Update docker-compose.v1.yml**

```yaml
environment:
  TASTILE_DATABASE_URL: postgres://tastile:password@db:5432/tastile_db
  TASTILE_API_HOST: 0.0.0.0
  TASTILE_API_PORT: "31400"
```

**Step 4: Update docker-compose.v1.verify.yml**

Same pattern.

**Step 5: Update scripts**

In `v1-smoke.ps1`:
- `$env:TASTILE_V1_SMOKE_DATABASE_URL` → `$env:TASTILE_SMOKE_DATABASE_URL`
- Update the default URL comment if present

In `v1-live-conflict-check.ps1`:
- Replace all `TASTILE_V1_` prefixed env var references

**Step 6: Verify build**

```bash
cd tastile-core && cargo check -p api -p worker -p storage
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: remove v1 prefix from environment variables"
```

---

## Task 3: Rename frontend files to remove v1 suffix

**Files:**
- Rename: `tastile-web/src/lib/api/v1-endpoints.ts` → `tastile-web/src/lib/api/v1/endpoints.ts`
- Rename: `tastile-web/src/lib/api/v1-endpoints.test.ts` → `tastile-web/src/lib/api/v1/endpoints.test.ts`
- Rename: `tastile-web/src/components/tiles/build-command-v1.ts` → `tastile-web/src/components/tiles/build-command.ts` (if no conflict; else merge)
- Rename: `tastile-web/src/components/tiles/build-command-v1.test.ts` → update accordingly
- Rename: `tastile-web/src/components/tiles/submit-v1.ts` → `tastile-web/src/components/tiles/submit.ts`
- Modify: All files that import from the renamed files

**Step 1: Check for naming conflicts**

```bash
ls tastile-web/src/lib/api/
ls tastile-web/src/components/tiles/build-command*
```

Note: `build-command.ts` already exists (the legacy helper). So `build-command-v1.ts` cannot simply become `build-command.ts`. It should either:
- Be merged into `build-command.ts` (if the legacy version is being removed)
- Be placed in `tastile-web/src/lib/api/v1/` as a domain-specific builder

**Step 2: Create v1 API directory and move endpoint files**

```bash
mkdir -p tastile-web/src/lib/api/v1
mv tastile-web/src/lib/api/v1-endpoints.ts tastile-web/src/lib/api/v1/endpoints.ts
mv tastile-web/src/lib/api/v1-endpoints.test.ts tastile-web/src/lib/api/v1/endpoints.test.ts
```

**Step 3: Move v1 tile submit/builder files**

Since `build-command.ts` (legacy) already exists, move the v1 version to the v1 domain area:

```bash
mv tastile-web/src/components/tiles/build-command-v1.ts tastile-web/src/lib/api/v1/build-command.ts
mv tastile-web/src/components/tiles/build-command-v1.test.ts tastile-web/src/lib/api/v1/build-command.test.ts
mv tastile-web/src/components/tiles/submit-v1.ts tastile-web/src/lib/api/v1/submit.ts
```

**Step 4: Update all imports**

Find and update all import paths:

```bash
rg "v1-endpoints" tastile-web/src/ --no-heading -l
rg "build-command-v1" tastile-web/src/ --no-heading -l
rg "submit-v1" tastile-web/src/ --no-heading -l
```

Update each file's imports to use the new paths.

**Step 5: Verify TypeScript compilation**

```bash
cd tastile-web && npx tsc --noEmit
```

**Step 6: Run tests**

```bash
cd tastile-web && npx vitest run
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: move v1 frontend files to versioned directory structure"
```

---

## Task 4: Rename scripts to remove v1 prefix

**Files:**
- Rename: `tastile-core/scripts/v1-smoke.ps1` → `tastile-core/scripts/smoke.ps1`
- Rename: `tastile-core/scripts/v1-live-conflict-check.ps1` → `tastile-core/scripts/live-conflict-check.ps1`
- Rename: `tastile-core/scripts/_diag_v1_spec.js` → `tastile-core/scripts/_diag_spec.js`
- Rename: `tastile-core/scripts/_diag_v1_spec.out.txt` → `tastile-core/scripts/_diag_spec.out.txt`
- Modify: Any references to these script names in docs, CI, or other scripts

**Step 1: Find references to old script names**

```bash
rg "v1-smoke" tastile-core/ --no-heading -l
rg "v1-live-conflict" tastile-core/ --no-heading -l
rg "_diag_v1_spec" tastile-core/ --no-heading -l
```

**Step 2: Rename files**

```bash
mv tastile-core/scripts/v1-smoke.ps1 tastile-core/scripts/smoke.ps1
mv tastile-core/scripts/v1-live-conflict-check.ps1 tastile-core/scripts/live-conflict-check.ps1
mv tastile-core/scripts/_diag_v1_spec.js tastile-core/scripts/_diag_spec.js
mv tastile-core/scripts/_diag_v1_spec.out.txt tastile-core/scripts/_diag_spec.out.txt
```

**Step 3: Update internal references in scripts**

In `smoke.ps1`, update the cargo example name if it references `v1_api_smoke`:
```powershell
# Check if the example binary name needs updating
rg "v1_api_smoke" tastile-core/
```

If `v1_api_smoke` is a Cargo example, rename it to `api_smoke` in the v0 `tastile-api/Cargo.toml` as well.

**Step 4: Update any docs referencing these scripts**

```bash
rg "v1-smoke\|v1-live-conflict\|_diag_v1_spec" tastile-core/docs/ --no-heading -l
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove v1 prefix from scripts"
```

---

## Task 5: Update Cargo example binary names

**Files:**
- Modify: `tastile-core/crates/v0/tastile-api/Cargo.toml` (rename `v1_api_smoke` example)
- Rename: `tastile-core/crates/v0/tastile-api/examples/v1_api_smoke.rs` → `api_smoke.rs`
- Modify: `tastile-core/crates/v0/tastile-storage/Cargo.toml` (rename v1 test binaries if declared)

**Step 1: Find all v1-named binaries and examples**

```bash
rg "name.*=.*v1" tastile-core/crates/ --include "*.toml" --no-heading
rg "\[\[example\]\]" tastile-core/crates/ -A2 --include "*.toml" --no-heading
```

**Step 2: Rename examples**

In `tastile-core/crates/v0/tastile-api/Cargo.toml`, find:
```toml
[[example]]
name = "v1_api_smoke"
```
Change to:
```toml
[[example]]
name = "api_smoke"
```

**Step 3: Rename the example file**

```bash
mv tastile-core/crates/v0/tastile-api/examples/v1_api_smoke.rs tastile-core/crates/v0/tastile-api/examples/api_smoke.rs
```

**Step 4: Update test binary references if any**

Check `tastile-core/crates/v0/tastile-storage/` for v1-named test binaries.

**Step 5: Verify build**

```bash
cd tastile-core && cargo check
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: rename v1 example binaries to generic names"
```

---

## Task 6: Clean up internal v1 references in code (non-path, non-directory)

**Files:**
- Various Rust source files with `v1_` prefixed function/struct names
- Various TypeScript files with `V1` prefixed identifiers

**Step 1: Find v1-prefixed identifiers in Rust code**

```bash
rg "fn v1_|struct v1_|mod v1_|pub fn.*v1|pub struct.*v1" tastile-core/crates/v1/ --no-heading
rg "v1_api|v1_worker" tastile-core/crates/ --no-heading -l
```

**Step 2: Find v1-prefixed identifiers in TypeScript code**

```bash
rg "V1Client|postV1Command|getV1Read|makeV1Client|submitCreateTileV1|buildCreateTileCommandV1" tastile-web/src/ --no-heading -l
```

**Step 3: Rename identifiers**

For each v1-prefixed identifier, rename to the generic version:
- `V1Client` → `ApiClient`
- `postV1Command` → `postCommand`
- `getV1Read` → `getRead`
- `makeV1Client` → `makeClient`
- `submitCreateTileV1` → `submitCreateTile`
- `buildCreateTileCommandV1` → `buildCreateTileCommand`

Note: Only do this for identifiers that are about the API protocol, not for things like `V1_001__base.sql` (migration files) which are correctly versioned.

**Step 4: Update all call sites**

```bash
rg "V1Client|postV1Command|getV1Read|makeV1Client|submitCreateTileV1|buildCreateTileCommandV1" tastile-web/src/ --no-heading
```

Update each file.

**Step 5: Verify TypeScript compilation and tests**

```bash
cd tastile-web && npx tsc --noEmit && npx vitest run
```

**Step 6: Verify Rust build**

```bash
cd tastile-core && cargo check
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: remove v1 prefix from code identifiers"
```

---

## Task 7: Update documentation references

**Files:**
- Various docs under `tastile-core/docs/`
- Various docs under `docs/`
- `tastile-core/v1/README.md` (the spec — probably should keep v1 references here since it IS the v1 spec)

**Step 1: Find docs referencing v1 file/binary names**

```bash
rg "v1_api\.rs|v1_worker\.rs|v1-endpoints\.ts|build-command-v1\.ts|submit-v1\.ts|v1-smoke\.ps1|v1-live-conflict" tastile-core/docs/ docs/ --no-heading -l
```

**Step 2: Update references to use new names**

For each doc that references old file names, update to the new names.

**Step 3: Keep v1 spec docs untouched**

The `tastile-core/v1/` directory contains the v1 specification. These should keep v1 references because they ARE describing the v1 architecture. Only update references that point to renamed files.

**Step 4: Commit**

```bash
git add -A && git commit -m "docs: update file references after v1 naming cleanup"
```

---

## Summary: What Changes vs What Stays

| Category | Changes | Stays |
|---|---|---|
| **Rust binaries** | `v1_api` → `api`, `v1_worker` → `worker` | — |
| **Env vars** | `TASTILE_V1_DATABASE_URL` → `TASTILE_DATABASE_URL` | — |
| **Frontend files** | `v1-endpoints.ts` → `v1/endpoints.ts` | — |
| **Frontend files** | `build-command-v1.ts` → `v1/build-command.ts` | — |
| **Frontend files** | `submit-v1.ts` → `v1/submit.ts` | — |
| **Scripts** | `v1-smoke.ps1` → `smoke.ps1` | — |
| **Code identifiers** | `V1Client` → `ApiClient`, etc. | — |
| **Directory structure** | — | `crates/v1/`, `migrations/v1/`, `src/lib/domain/v1/` |
| **URL paths** | — | `/v1/tiles`, `/v1/placements`, etc. |
| **Docker files** | — | `Dockerfile.v1`, `docker-compose.v1.yml` |
| **Plugin contract** | — | `api_version: "v1"` |
| **Migration files** | — | `V001__v1_tile.sql`, etc. |
| **Spec documents** | — | `tastile-core/v1/*.md` |

After this restructure, adding v2 means:
1. Create `crates/v2/` with new domain/storage/api/worker
2. Add `migrations/v2/` with new schema
3. Add `/v2/` routes in the new `api` binary
4. Create `docker-compose.v2.yml` with v2 config
5. **No file renaming needed** — the generic names work for any version
