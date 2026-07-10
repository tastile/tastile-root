# 2026-07-07 — wslc Stack + Schedule Filling Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the wslc container migration for **both** `tastile-core` and `tastile-web`, then verify the v1 schedule filling algorithm end-to-end on the web dashboard.

**Architecture:**
- Core path: `tastile-core.wslc` worktree on `wslc-migration` branch → `Containerfile.v1` + `scripts/wslc/*` → `tastile-v1-api` image → `wslc run` brings up postgres + api + worker on host port `31400`.
- Web path: `tastile-web.wslc` worktree on `wslc-web` branch → multi-stage `Containerfile` (oven/bun build → node:20-slim run) + `scripts/wslc/*` → `tastile-web` image → `wslc run` on host port `3000`, talks to core on `http://localhost:31400`.
- Network: `tastile-net` wslc network so the api/worker containers can reach postgres by name (`tastile-postgres:5432`).
- Persistence: postgres data bind-mounted to `$HOME/.tastile/wslc/postgres-data` on the Windows host.
- Verification: open `http://localhost:3000`, log in via Cognito Hosted UI, navigate to `/dashboard`, observe that the schedule filling algorithm produces Flow Placements in the timeline (acceptance target: 10:00–10:30 study placement per AT-023..029).

**Tech Stack:**
- WSL Container (Microsoft June 2026 preview) — `wslc` v2.9.3.0 CLI (Docker-compatible subcommand syntax: `wslc build/run/list/images/stop/rm/pull/network`)
- Core: `rust:slim-bookworm` base (existing `Dockerfile.v1` content; renamed to `Containerfile.v1`)
- Web: `oven/bun:1.3.10` (build stage) + `node:20-bookworm-slim` (run stage), `output: "standalone"` from `next.config.ts`
- Multi-container orchestration via shell scripts in `scripts/wslc/`
- Cognito Hosted UI for web auth (existing pool `ap-northeast-1_buh6oWoQ2`, client `3f14cs42nkc0v3qf6k57gthlfe`)

**Hard verification gate:**
```bash
# From tastile-core.wslc and tastile-web.wslc both
git ls-files | xargs rg -l -i docker 2>/dev/null | wc -l   # 0
wslc list -a                                              # 4+ containers (postgres, api, worker, web)
wslc images                                               # tastile-v1-api + tastile-web present
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:31400/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login     # 200
```

**Note on syntax:** The 2026-07-02 plan in `tastile-core/docs/archive/2026-07-02-wslc-migration-plan.md` uses `wsl.exe --container <verb>` (an older WSL preview syntax). The **installed wslc v2.9.3.0** uses Docker-compatible subcommands: `wslc build`, `wslc run`, `wslc list`, `wslc images`, `wslc stop`, `wslc rm`, `wslc pull`, `wslc network create`. This plan uses the installed syntax. The archive plan is still the source of truth for **what files to delete and what to create** — this plan just rewrites the **commands** to match the actual CLI.

---

## File Structure

```
C:\Users\rebui\Desktop\tastile\
├── tastile-core.wslc\                         (NEW worktree, branch wslc-migration)
│   ├── Containerfile.v1                        (renamed from Dockerfile.v1)
│   ├── scripts/wslc/                           (NEW directory)
│   │   ├── bootstrap.sh
│   │   ├── build.sh
│   │   ├── up-v1.sh
│   │   ├── up-calendar.sh
│   │   ├── up-verify.sh
│   │   ├── down.sh
│   │   ├── reset.sh
│   │   ├── status.sh
│   │   └── README.md
│   └── (Dockerfile.v1, docker-compose.*.yml, .dockerignore, tastile.service, scripts/_*.log, scripts/live-conflict-check.ps1, scripts/smoke.ps1 (rewritten) — DELETED)
└── tastile-web.wslc\                          (NEW worktree, branch wslc-web)
    ├── Containerfile                           (NEW multi-stage)
    ├── scripts/wslc/                           (NEW directory)
    │   ├── build.sh
    │   ├── up.sh
    │   ├── down.sh
    │   ├── status.sh
    │   └── README.md
    └── (.dockerignore — DELETED)
```

---

# PHASE 0 — Worktree Setup

## Task 0.1: Create `tastile-core.wslc` worktree

**Files:**
- Worktree: `C:\Users\rebui\Desktop\tastile\tastile-core.wslc` (new)
- Branch: `wslc-migration`

- [ ] **Step 1: Verify main is clean**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core
git status --short
```

Expected: no output.

- [ ] **Step 2: Create worktree**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core
git worktree add ../tastile-core.wslc -b wslc-migration main
```

Expected: `Preparing worktree (new branch 'wslc-migration')` then `HEAD is now at <sha>`.

- [ ] **Step 3: Verify branch**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git branch --show-current
```

Expected: `wslc-migration`.

- [ ] **Step 4: Switch all subsequent core commands to the worktree**

Use `C:\Users\rebui\Desktop\tastile\tastile-core.wslc` for the rest of Phase A–G unless noted.

## Task 0.2: Create `tastile-web.wslc` worktree

**Files:**
- Worktree: `C:\Users\rebui\Desktop\tastile\tastile-web.wslc` (new)
- Branch: `wslc-web`

- [ ] **Step 1: Verify main is clean**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web
git status --short
```

Expected: no output.

- [ ] **Step 2: Create worktree**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web
git worktree add ../tastile-web.wslc -b wslc-web main
```

Expected: `Preparing worktree (new branch 'wslc-web')` then `HEAD is now at <sha>`.

- [ ] **Step 3: Verify branch**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git branch --show-current
```

Expected: `wslc-web`.

- [ ] **Step 4: Switch all subsequent web commands to the worktree**

Use `C:\Users\rebui\Desktop\tastile\tastile-web.wslc` for the rest of Phase H.

---

# PHASE A — Core Containerfile rename + Docker artifact deletion

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task A.1: Rename `Dockerfile.v1` → `Containerfile.v1`

**Files:**
- Rename: `Dockerfile.v1` → `Containerfile.v1`

- [ ] **Step 1: Move file**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git mv Dockerfile.v1 Containerfile.v1
```

- [ ] **Step 2: Verify**

```bash
ls Containerfile.v1
```

Expected: file present.

- [ ] **Step 3: Verify no `docker` reference in the new file**

```bash
rg -i docker Containerfile.v1
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git add Containerfile.v1
git commit -m "chore(build): rename Dockerfile.v1 to Containerfile.v1"
```

## Task A.2: Delete docker-compose and Dockerfile variants

**Files (deleted):**
- `Dockerfile.v0-deprecated`
- `Dockerfile.beta.v0-deprecated`
- `docker-compose.v1.yml`
- `docker-compose.v0-deprecated.yml`
- `docker-compose.calendar.yml`
- `docker-compose.v1.verify.yml`
- `docker-compose.override.yml`

- [ ] **Step 1: Verify which files exist before deletion**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
ls Dockerfile.v0-deprecated Dockerfile.beta.v0-deprecated \
   docker-compose.v1.yml docker-compose.v0-deprecated.yml \
   docker-compose.calendar.yml docker-compose.v1.verify.yml \
   docker-compose.override.yml 2>&1
```

Expected: most are missing. Track which actually exist on disk.

- [ ] **Step 2: Stage existing deletions**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -f Dockerfile.v0-deprecated Dockerfile.beta.v0-deprecated \
        docker-compose.v1.yml docker-compose.v0-deprecated.yml \
        docker-compose.calendar.yml docker-compose.v1.verify.yml \
        docker-compose.override.yml 2>&1 | tee /tmp/rm-list.txt
```

Expected: one `rm '<file>'` line per existing file (skip those that don't exist).

- [ ] **Step 3: Verify all staged**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git status --short
```

Expected: lines starting with `D  ` for each deleted file.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git commit -m "chore(build): delete docker-compose files and v0-deprecated Dockerfile variants

Removes the local-dev orchestration that depended on Docker Desktop.
Replaced by scripts/wslc/ in subsequent commits."
```

## Task A.3: Delete `.dockerignore`

**Files (deleted):** `tastile-core/.dockerignore`

- [ ] **Step 1: Remove and stage**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -f .dockerignore
git commit -m "chore(build): delete .dockerignore"
```

## Task A.4: Delete `tastile.service` (v0-era systemd unit)

**Files (deleted):** `tastile.service`

- [ ] **Step 1: Check existence**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
ls tastile.service 2>&1
```

- [ ] **Step 2: If exists, delete and commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -f tastile.service
git commit -m "chore(build): delete legacy tastile.service systemd unit"
```

(If not present, skip this task.)

## Task A.5: Delete docker-dependent shell scripts and log artifacts

**Files (deleted):** `scripts/multi_user_simulation.sh`, `scripts/single_user_validation.sh`, `scripts/test_pg16_migration.sh`, `scripts/_docker_build.log`, `scripts/_docker_up.log`, `scripts/_build.log`, `scripts/_build_api.log`, `scripts/_build_stderr.log`, `scripts/_build_stdout.log`, `scripts/_diag_spec.js`, `scripts/_diag_spec.out.txt`

- [ ] **Step 1: Remove tracked files and stage**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -f scripts/multi_user_simulation.sh scripts/single_user_validation.sh \
        scripts/test_pg16_migration.sh \
        scripts/_docker_build.log scripts/_docker_up.log 2>&1
git status --short
```

Expected: `D  ` lines for each tracked file that existed.

- [ ] **Step 2: Remove untracked log/spec artifacts in scripts/**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rm -f scripts/_build.log scripts/_build_api.log scripts/_build_stderr.log \
      scripts/_build_stdout.log scripts/_diag_spec.js scripts/_diag_spec.out.txt
git status --short scripts/
```

Expected: no untracked files in `scripts/`.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git commit -m "chore(build): delete docker-dependent shell scripts and log artifacts"
```

## Task A.6: Delete docker-dependent PowerShell scripts

**Files (deleted):** `scripts/live-conflict-check.ps1`

- [ ] **Step 1: Remove and commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -f scripts/live-conflict-check.ps1
git commit -m "chore(build): delete live-conflict-check.ps1 (was docker-based)"
```

---

# PHASE B — Core `scripts/wslc/` orchestration

(All work in `tastile-core.wslc` on `wslc-migration` branch. Uses installed `wslc` v2.9.3.0 subcommand syntax.)

## Task B.1: Create `scripts/wslc/bootstrap.sh`

**Files:**
- Create: `scripts/wslc/bootstrap.sh`

- [ ] **Step 1: Create directory**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
mkdir -p scripts/wslc
```

- [ ] **Step 2: Write file**

Write `scripts/wslc/bootstrap.sh`:

```bash
#!/usr/bin/env bash
# One-time: validate WSL Container, prepare data dirs + network.
set -euo pipefail

if ! command -v wslc >/dev/null 2>&1; then
  echo "ERROR: wslc CLI not found in PATH. Install Microsoft June 2026 preview."
  exit 1
fi

mkdir -p "$HOME/.tastile/wslc/postgres-data" \
         "$HOME/.tastile/wslc/postgres-data-calendar" \
         "$HOME/.tastile/wslc/postgres-data-verify"

if ! wslc network ls 2>/dev/null | grep -q '^tastile-net$'; then
  wslc network create tastile-net
fi

# Pull postgres image if not cached
if ! wslc images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q '^postgres:16-alpine$'; then
  echo "Pulling postgres:16-alpine..."
  wslc pull postgres:16-alpine
fi

echo "wslc ready. Network 'tastile-net' + data dirs prepared."
```

- [ ] **Step 3: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/bootstrap.sh
git add scripts/wslc/bootstrap.sh
git commit -m "chore(build): add scripts/wslc/bootstrap.sh"
```

## Task B.2: Create `scripts/wslc/build.sh`

**Files:**
- Create: `scripts/wslc/build.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/build.sh`:

```bash
#!/usr/bin/env bash
# Build the api/worker image via wslc.
# Produces a local OCI image named tastile-v1-api; never pushed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "== wslc build (core) =="
wslc build \
  -f tastile-core/Containerfile.v1 \
  -t tastile-v1-api \
  ./tastile-core

echo "Build complete. Image: tastile-v1-api (local)."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/build.sh
git add scripts/wslc/build.sh
git commit -m "chore(build): add scripts/wslc/build.sh"
```

## Task B.3: Create `scripts/wslc/up-v1.sh`

**Files:**
- Create: `scripts/wslc/up-v1.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/up-v1.sh`:

```bash
#!/usr/bin/env bash
# Bring up the v1 dev stack: postgres + api + worker on host port 31400.
set -euo pipefail

DATA_DIR="$HOME/.tastile/wslc/postgres-data"

if ! wslc network ls 2>/dev/null | grep -q '^tastile-net$'; then
  wslc network create tastile-net
fi

if ! wslc images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q '^postgres:16-alpine$'; then
  wslc pull postgres:16-alpine
fi

echo "== 1) Postgres =="
wslc run -d --name tastile-postgres --network tastile-net \
  -v "$DATA_DIR":/var/lib/postgresql/data \
  -p 5432:5432 \
  -e POSTGRES_USER=tastile \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=tastile_db \
  postgres:16-alpine

echo "== 2) api =="
wslc run -d --name tastile-v1-api --network tastile-net \
  -p 31400:31400 \
  -e TASTILE_DATABASE_URL=postgres://tastile:password@tastile-postgres:5432/tastile_db \
  -e TASTILE_API_HOST=0.0.0.0 \
  -e TASTILE_API_PORT=31400 \
  -e TASTILE_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 \
  -e RUST_LOG=info,storage=debug \
  tastile-v1-api

echo "== 3) worker =="
wslc run -d --name tastile-v1-worker --network tastile-net \
  -e TASTILE_DATABASE_URL=postgres://tastile:password@tastile-postgres:5432/tastile_db \
  -e RUST_LOG=info,storage=debug \
  tastile-v1-api /app/target/release/worker

echo "Stack up. Run scripts/wslc/status.sh to verify."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/up-v1.sh
git add scripts/wslc/up-v1.sh
git commit -m "chore(build): add scripts/wslc/up-v1.sh (postgres + api + worker)"
```

## Task B.4: Create `scripts/wslc/up-calendar.sh`

**Files:**
- Create: `scripts/wslc/up-calendar.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/up-calendar.sh`:

```bash
#!/usr/bin/env bash
# Bring up the calendar dev stack: postgres + api on port 31400 (calendar schema).
set -euo pipefail

DATA_DIR="$HOME/.tastile/wslc/postgres-data-calendar"

if ! wslc network ls 2>/dev/null | grep -q '^tastile-net$'; then
  wslc network create tastile-net
fi

if ! wslc images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q '^postgres:16-alpine$'; then
  wslc pull postgres:16-alpine
fi

echo "== 1) Postgres =="
wslc run -d --name tastile-postgres-calendar --network tastile-net \
  -v "$DATA_DIR":/var/lib/postgresql/data \
  -p 5432:5432 \
  -e POSTGRES_USER=tastile \
  -e POSTGRES_PASSWORD=tastile \
  -e POSTGRES_DB=tastile \
  postgres:16-alpine

echo "== 2) api =="
wslc run -d --name tastile-v1-api-calendar --network tastile-net \
  -p 31400:31400 \
  -e TASTILE_DATABASE_URL=postgres://tastile:tastile@tastile-postgres-calendar:5432/tastile \
  -e TASTILE_API_HOST=0.0.0.0 \
  -e TASTILE_API_PORT=31400 \
  -e TASTILE_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 \
  -e RUST_LOG=info,api=debug,storage=debug \
  tastile-v1-api

echo "Calendar stack up."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/up-calendar.sh
git add scripts/wslc/up-calendar.sh
git commit -m "chore(build): add scripts/wslc/up-calendar.sh"
```

## Task B.5: Create `scripts/wslc/up-verify.sh`

**Files:**
- Create: `scripts/wslc/up-verify.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/up-verify.sh`:

```bash
#!/usr/bin/env bash
# Verification stack: postgres + api on host port 31401 + worker (sibling port).
set -euo pipefail

DATA_DIR="$HOME/.tastile/wslc/postgres-data-verify"

if ! wslc network ls 2>/dev/null | grep -q '^tastile-net$'; then
  wslc network create tastile-net
fi

if ! wslc images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q '^postgres:16-alpine$'; then
  wslc pull postgres:16-alpine
fi

echo "== 1) Postgres =="
wslc run -d --name tastile-postgres-verify --network tastile-net \
  -v "$DATA_DIR":/var/lib/postgresql/data \
  -p 5432:5432 \
  -e POSTGRES_USER=tastile \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=tastile_db \
  postgres:16-alpine

echo "== 2) api (port 31401) =="
wslc run -d --name tastile-v1-api-verify --network tastile-net \
  -p 31401:31400 \
  -e TASTILE_DATABASE_URL=postgres://tastile:password@tastile-postgres-verify:5432/tastile_db \
  -e TASTILE_API_HOST=0.0.0.0 \
  -e TASTILE_API_PORT=31400 \
  -e RUST_LOG=info,storage=debug \
  tastile-v1-api

echo "== 3) worker =="
wslc run -d --name tastile-v1-worker-verify --network tastile-net \
  -e TASTILE_DATABASE_URL=postgres://tastile:password@tastile-postgres-verify:5432/tastile_db \
  -e RUST_LOG=info,storage=debug \
  tastile-v1-api /app/target/release/worker

echo "Verify stack up."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/up-verify.sh
git add scripts/wslc/up-verify.sh
git commit -m "chore(build): add scripts/wslc/up-verify.sh (port 31401)"
```

## Task B.6: Create `scripts/wslc/down.sh`

**Files:**
- Create: `scripts/wslc/down.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/down.sh`:

```bash
#!/usr/bin/env bash
# Stop all Tastile wslc containers. Data is preserved (postgres bind mounts survive).
set -euo pipefail

CONTAINERS=(
  tastile-postgres
  tastile-v1-api
  tastile-v1-worker
  tastile-postgres-calendar
  tastile-v1-api-calendar
  tastile-postgres-verify
  tastile-v1-api-verify
  tastile-v1-worker-verify
)

for c in "${CONTAINERS[@]}"; do
  if wslc list -q 2>/dev/null | grep -q "^$c\$"; then
    echo "Stopping $c..."
    wslc stop "$c" >/dev/null 2>&1 || true
  fi
done

echo "All containers stopped. Data preserved."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/down.sh
git add scripts/wslc/down.sh
git commit -m "chore(build): add scripts/wslc/down.sh"
```

## Task B.7: Create `scripts/wslc/reset.sh`

**Files:**
- Create: `scripts/wslc/reset.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/reset.sh`:

```bash
#!/usr/bin/env bash
# DESTRUCTIVE: remove all Tastile wslc containers + delete data dirs.
set -euo pipefail

read -p "This will DELETE all Tastile containers and data. Type 'reset' to continue: " answer
if [[ "$answer" != "reset" ]]; then
  echo "Aborted."
  exit 1
fi

CONTAINERS=(
  tastile-postgres
  tastile-v1-api
  tastile-v1-worker
  tastile-postgres-calendar
  tastile-v1-api-calendar
  tastile-postgres-verify
  tastile-v1-api-verify
  tastile-v1-worker-verify
)

for c in "${CONTAINERS[@]}"; do
  if wslc list -a -q 2>/dev/null | grep -q "^$c\$"; then
    echo "Removing $c..."
    wslc stop "$c" >/dev/null 2>&1 || true
    wslc rm -f "$c" >/dev/null 2>&1 || true
  fi
done

rm -rf "$HOME/.tastile/wslc/postgres-data" \
       "$HOME/.tastile/wslc/postgres-data-calendar" \
       "$HOME/.tastile/wslc/postgres-data-verify"

if wslc network ls 2>/dev/null | grep -q '^tastile-net$'; then
  wslc network rm tastile-net
fi

echo "Reset complete. Re-run bootstrap.sh before up-*.sh."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/reset.sh
git add scripts/wslc/reset.sh
git commit -m "chore(build): add scripts/wslc/reset.sh (DESTRUCTIVE)"
```

## Task B.8: Create `scripts/wslc/status.sh`

**Files:**
- Create: `scripts/wslc/status.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/status.sh`:

```bash
#!/usr/bin/env bash
# Show state of every Tastile wslc container.
set -euo pipefail

CONTAINERS=(
  tastile-postgres
  tastile-v1-api
  tastile-v1-worker
  tastile-postgres-calendar
  tastile-v1-api-calendar
  tastile-postgres-verify
  tastile-v1-api-verify
  tastile-v1-worker-verify
)

echo "Tastile wslc containers:"
for c in "${CONTAINERS[@]}"; do
  if wslc list -a -q 2>/dev/null | grep -q "^$c\$"; then
    if wslc list -q 2>/dev/null | grep -q "^$c\$"; then
      state="running"
    else
      state="stopped"
    fi
  else
    state="not created"
  fi
  printf "  %-35s %s\n" "$c" "$state"
done
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
chmod +x scripts/wslc/status.sh
git add scripts/wslc/status.sh
git commit -m "chore(build): add scripts/wslc/status.sh"
```

## Task B.9: Create `scripts/wslc/README.md`

**Files:**
- Create: `scripts/wslc/README.md`

- [ ] **Step 1: Write file**

Write `scripts/wslc/README.md`:

```markdown
# scripts/wslc/

Local-dev orchestration for Tastile via **WSL Container** (Microsoft
June 2026 preview, `wslc` v2.9.3.0). Replaces the previous Docker /
docker-compose setup.

## Prerequisites

- Windows 11 with WSL2 enabled
- `wslc` CLI installed and on PATH (`wslc --version` reports 2.9.3.0+)
- Ubuntu WSL distro installed (any recent release)

## Quick start

```bash
./bootstrap.sh    # one-time: pull postgres image, create data dirs + 'tastile-net' network
./build.sh        # builds the api/worker image (local; never pushed)
./up-v1.sh        # starts postgres + api + worker
./status.sh       # shows container states
./down.sh         # stops everything (data preserved)
./reset.sh        # DESTRUCTIVE: removes containers + data + network
```

## Stacks

| Script | Containers | Host port | Use |
| --- | --- | --- | --- |
| `up-v1.sh` | postgres + api + worker | 31400 | v1 dev (default) |
| `up-calendar.sh` | postgres + api | 31400 | calendar dev (separate DB) |
| `up-verify.sh` | postgres + api + worker | 31401 | verification (sibling port) |

## Network

All stacks share a `tastile-net` wslc network so containers can resolve
each other by name (e.g. the api container connects to
`postgres://tastile:password@tastile-postgres:5432/tastile_db`).

## Persistence

Postgres data is bind-mounted to `$HOME/.tastile/wslc/postgres-data[-calendar|-verify]`
on the Windows host. `down.sh` stops containers but keeps the data;
`reset.sh` deletes it.
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git add scripts/wslc/README.md
git commit -m "chore(build): add scripts/wslc/README.md"
```

---

# PHASE C — Rewrite `scripts/smoke.ps1`

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task C.1: Rewrite `scripts/smoke.ps1`

**Files:**
- Modify: `scripts/smoke.ps1`

- [ ] **Step 1: Read current smoke.ps1**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
wc -l scripts/smoke.ps1
cat scripts/smoke.ps1
```

- [ ] **Step 2: Overwrite to use wslc stack instead of docker**

Write `scripts/smoke.ps1`:

```powershell
# Tastile v1 smoke test against a running wslc stack.
# Prereq: ./scripts/wslc/up-v1.sh has been run; api is on localhost:31400.
$ErrorActionPreference = "Stop"

$api = "http://127.0.0.1:31400"

Write-Host "== 1) /health =="
$h = Invoke-RestMethod -Method Get -Uri "$api/health" -TimeoutSec 5
Write-Host "  $h"

Write-Host "== 2) /v1/timeline (smoke GET) =="
$code = (Invoke-WebRequest -Method Get -Uri "$api/v1/timeline" -TimeoutSec 5).StatusCode
Write-Host "  HTTP $code"
if ($code -ne 200 -and $code -ne 401) {
    throw "Unexpected status: $code"
}

Write-Host "Smoke OK."
```

- [ ] **Step 3: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git add scripts/smoke.ps1
git commit -m "chore(build): rewrite smoke.ps1 to target wslc stack"
```

---

# PHASE D — Core docs sanitization (remove "docker" strings)

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task D.1: Sanitize `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Find docker mentions**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker .env.example
```

- [ ] **Step 2: For each hit, edit by hand to replace "docker" with "wslc" or context-appropriate wording (e.g. "wslc stack", "WSL Container").** (No code to show; do this manually.)

- [ ] **Step 3: Verify**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -i docker .env.example
```

Expected: no output.

- [ ] **Step 4: Stage (commit happens in Task D.7 as one combined commit)**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git add .env.example
```

## Task D.2: Sanitize `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find docker mentions**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker CLAUDE.md
```

- [ ] **Step 2: For each hit, edit by hand.** Replace "docker compose" with "WSL Container", "docker" with "wslc", etc. Preserve all other content.

- [ ] **Step 3: Verify + stage**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -i docker CLAUDE.md
git add CLAUDE.md
```

Expected: no output.

## Task D.3: Sanitize `HARNESS.md` and `AGENTS.md`

**Files:**
- Modify: `HARNESS.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Find docker mentions**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker HARNESS.md AGENTS.md
```

- [ ] **Step 2: Edit each hit by hand.** Same rules as D.2.

- [ ] **Step 3: Verify + stage**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -i docker HARNESS.md AGENTS.md
git add HARNESS.md AGENTS.md
```

Expected: no output.

## Task D.4: Sanitize `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1–3: same as D.3 for `README.md`.**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker README.md
# (edit)
rg -i docker README.md
git add README.md
```

## Task D.5: Sanitize `crates/v1/HARNESS.md`

**Files:**
- Modify: `crates/v1/HARNESS.md`

- [ ] **Step 1–3: same flow for `crates/v1/HARNESS.md`.**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker crates/v1/HARNESS.md
# (edit)
rg -i docker crates/v1/HARNESS.md
git add crates/v1/HARNESS.md
```

## Task D.6: Sanitize `docs/plans/2026-07-02-v1-completion.md` and `docs/v1/PRODUCTION_READINESS.md`

**Files:**
- Modify: `docs/plans/2026-07-02-v1-completion.md`
- Modify: `docs/v1/PRODUCTION_READINESS.md`

- [ ] **Step 1–3: same flow for both files.**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -n -i docker docs/plans/2026-07-02-v1-completion.md docs/v1/PRODUCTION_READINESS.md
# (edit)
rg -i docker docs/plans/2026-07-02-v1-completion.md docs/v1/PRODUCTION_READINESS.md
git add docs/plans/2026-07-02-v1-completion.md docs/v1/PRODUCTION_READINESS.md
```

## Task D.7: Commit all of Phase D in one commit

- [ ] **Step 1: Single commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git commit -m "chore(docs): sanitize docker references from core docs

Removes the literal 'docker' string from .env.example, CLAUDE.md,
HARNESS.md, AGENTS.md, README.md, crates/v1/HARNESS.md,
docs/plans/2026-07-02-v1-completion.md, and
docs/v1/PRODUCTION_READINESS.md.

Local-dev guidance rewritten to point at scripts/wslc/up-*.sh
(WSL Container); historical mentions rewritten as 'originally
Docker, now wslc' where context demands it.

rg -i docker over these files: 0 hits."
```

---

# PHASE E — Core archive + agent-handoff deletion

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task E.1: Delete `docs/archive/` directory

**Files (deleted):** `docs/archive/` (whole tree)

- [ ] **Step 1: Verify the archive contains the wslc plan we just consumed**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
ls docs/archive/2026-07-02-wslc-migration-plan.md 2>&1
```

Expected: file exists.

- [ ] **Step 2: Remove and stage**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git rm -rf docs/archive
git status --short docs/
```

Expected: no entries under `docs/`.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git commit -m "chore(archive): delete docs/archive/ (plan content now lives in main plan docs)"
```

(Note: this is destructive to historical context. The original `2026-07-02-wslc-migration-plan.md` content is preserved in `docs/superpowers/plans/2026-07-07-wslc-stack-and-schedule-fill-verification.md` and in git reflog if rollback is needed.)

## Task E.2: Delete `docs/agent-handoff/`

**Files (deleted):** `docs/agent-handoff/` (whole tree)

- [ ] **Step 1: List and remove**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
ls docs/agent-handoff 2>&1
git rm -rf docs/agent-handoff
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git commit -m "chore(archive): delete docs/agent-handoff/"
```

---

# PHASE F — CI rg-docker check

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task F.1: Add rg docker check to CI quality job

**Files:**
- Modify: `.github/workflows/*.yml` (the quality / lint workflow)

- [ ] **Step 1: List CI workflows**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
ls .github/workflows/ 2>&1
```

- [ ] **Step 2: Find the quality job (likely `quality.yml` or `lint.yml`)**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
rg -l 'cargo fmt|cargo clippy' .github/workflows/
```

- [ ] **Step 3: Add the rg gate as a new step in that job, before `cargo fmt --all -- --check`:**

Add these lines to the relevant job in the chosen workflow file:

```yaml
      - name: Verify no docker references in tracked files
        run: |
          if [ "$(git ls-files | xargs rg -l -i docker 2>/dev/null | wc -l)" -ne 0 ]; then
            echo "ERROR: 'docker' string still present in tracked files:"
            git ls-files | xargs rg -l -i docker 2>/dev/null
            exit 1
          fi
```

- [ ] **Step 4: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git add .github/workflows/
git commit -m "ci: add rg docker gate to quality job"
```

---

# PHASE G — Core final verification + PR

(All work in `tastile-core.wslc` on `wslc-migration` branch.)

## Task G.1: Run final verification

- [ ] **Step 1: Hard gate**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git ls-files | xargs rg -l -i docker 2>/dev/null | tee /tmp/docker-hits.txt
echo "Hit count: $(wc -l < /tmp/docker-hits.txt)"
```

Expected: `Hit count: 0`.

- [ ] **Step 2: Local CI sanity**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Expected: all clean. (If `cargo` is blocked by Windows Defender per memory `project_windows_defender_blocks_cc1.md`, run this from the WSL-side clone at `~/tastile-core.wslc` instead.)

- [ ] **Step 3: No commit; report results**

## Task G.2: Merge `wslc-migration` to main

- [ ] **Step 1: Push branch**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-core.wslc
git push -u origin wslc-migration
```

- [ ] **Step 2: Open PR, get review, merge to main**

(Use `superpowers:requesting-code-review` before merge.)

---

# PHASE H — Web containerization

(All work in `tastile-web.wslc` on `wslc-web` branch.)

## Task H.1: Create `Containerfile` (multi-stage)

**Files:**
- Create: `Containerfile`

- [ ] **Step 1: Write file**

Write `Containerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
# Tastile web — multi-stage build: oven/bun (build) → node:20-slim (run).

# ----- build stage -----
FROM oven/bun:1.3.10 AS build
WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build standalone output (next.config.ts has output: "standalone")
COPY . .
RUN bun run build

# ----- run stage -----
FROM node:20-bookworm-slim AS run
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next standalone bundles the minimal server; we still copy public + static
# separately (next.config.ts does not auto-trace them).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Verify no docker reference**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
rg -i docker Containerfile
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git add Containerfile
git commit -m "chore(build): add multi-stage Containerfile (bun build → node:20-slim run)"
```

## Task H.2: Delete `.dockerignore`

**Files (deleted):** `.dockerignore`

- [ ] **Step 1: Remove and commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git rm -f .dockerignore
git commit -m "chore(build): delete .dockerignore"
```

## Task H.3: Create `scripts/wslc/build.sh`

**Files:**
- Create: `scripts/wslc/build.sh`

- [ ] **Step 1: Create directory and write file**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
mkdir -p scripts/wslc
```

Write `scripts/wslc/build.sh`:

```bash
#!/usr/bin/env bash
# Build the web image via wslc.
# Produces a local OCI image named tastile-web; never pushed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "== wslc build (web) =="
wslc build \
  -f tastile-web/Containerfile \
  -t tastile-web \
  ./tastile-web

echo "Build complete. Image: tastile-web (local)."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
chmod +x scripts/wslc/build.sh
git add scripts/wslc/build.sh
git commit -m "chore(build): add scripts/wslc/build.sh"
```

## Task H.4: Create `scripts/wslc/up.sh`

**Files:**
- Create: `scripts/wslc/up.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/up.sh`:

```bash
#!/usr/bin/env bash
# Bring up the web container. Assumes tastile-core wslc stack is already
# running on host port 31400 (postgres + api + worker from
# tastile-core/scripts/wslc/up-v1.sh).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load runtime env from .env.dev so non-public vars are set in the container.
# (NEXT_PUBLIC_* were already baked into the image at build time via
# bun run build; we re-export them here only so the container's env
# matches for any runtime code that reads process.env at request time.)
if [[ -f "$REPO_ROOT/tastile-web/.env.dev" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/tastile-web/.env.dev"
  set +a
fi

# Override CLOUD_API_BASE / callback URLs for the container → host loopback.
# The wslc web container reaches the host's port-mapped core via localhost.
export CLOUD_API_BASE="${CLOUD_API_BASE:-http://localhost:31400}"
export TASTILE_USE_RUST_CORE="${TASTILE_USE_RUST_CORE:-1}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export NEXT_PUBLIC_COGNITO_CALLBACK_URL="${NEXT_PUBLIC_COGNITO_CALLBACK_URL:-http://localhost:3000/auth/callback}"
export NEXT_PUBLIC_COGNITO_LOGOUT_URL="${NEXT_PUBLIC_COGNITO_LOGOUT_URL:-http://localhost:3000}"

echo "== web =="
wslc run -d --name tastile-web \
  -p 3000:3000 \
  -e CLOUD_API_BASE="$CLOUD_API_BASE" \
  -e TASTILE_USE_RUST_CORE="$TASTILE_USE_RUST_CORE" \
  -e TASTILE_WEB_BRIDGE_SECRET="$TASTILE_WEB_BRIDGE_SECRET" \
  -e NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  -e NEXT_PUBLIC_COGNITO_CALLBACK_URL="$NEXT_PUBLIC_COGNITO_CALLBACK_URL" \
  -e NEXT_PUBLIC_COGNITO_LOGOUT_URL="$NEXT_PUBLIC_COGNITO_LOGOUT_URL" \
  tastile-web

echo "Web up. Open http://localhost:3000 in a browser."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
chmod +x scripts/wslc/up.sh
git add scripts/wslc/up.sh
git commit -m "chore(build): add scripts/wslc/up.sh"
```

## Task H.5: Create `scripts/wslc/down.sh`

**Files:**
- Create: `scripts/wslc/down.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/down.sh`:

```bash
#!/usr/bin/env bash
# Stop the tastile-web wslc container.
set -euo pipefail

CONTAINER="tastile-web"

if wslc list -q 2>/dev/null | grep -q "^$CONTAINER\$"; then
  echo "Stopping $CONTAINER..."
  wslc stop "$CONTAINER" >/dev/null 2>&1 || true
fi

echo "$CONTAINER stopped."
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
chmod +x scripts/wslc/down.sh
git add scripts/wslc/down.sh
git commit -m "chore(build): add scripts/wslc/down.sh"
```

## Task H.6: Create `scripts/wslc/status.sh`

**Files:**
- Create: `scripts/wslc/status.sh`

- [ ] **Step 1: Write file**

Write `scripts/wslc/status.sh`:

```bash
#!/usr/bin/env bash
# Show state of the tastile-web wslc container.
set -euo pipefail

CONTAINER="tastile-web"

if wslc list -a -q 2>/dev/null | grep -q "^$CONTAINER\$"; then
  if wslc list -q 2>/dev/null | grep -q "^$CONTAINER\$"; then
    state="running"
  else
    state="stopped"
  fi
else
  state="not created"
fi
printf "  %-20s %s\n" "$CONTAINER" "$state"
```

- [ ] **Step 2: Make executable + commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
chmod +x scripts/wslc/status.sh
git add scripts/wslc/status.sh
git commit -m "chore(build): add scripts/wslc/status.sh"
```

## Task H.7: Create `scripts/wslc/README.md`

**Files:**
- Create: `scripts/wslc/README.md`

- [ ] **Step 1: Write file**

Write `scripts/wslc/README.md`:

```markdown
# scripts/wslc/

Local-dev orchestration for `tastile-web` via **WSL Container**
(Microsoft June 2026 preview, `wslc` v2.9.3.0). Assumes the core
stack is already up on host port 31400 (see
`tastile-core/scripts/wslc/up-v1.sh`).

## Prerequisites

- Windows 11 with WSL2 enabled
- `wslc` CLI installed and on PATH
- `tastile-core` wslc stack already running (`tastile-postgres`,
  `tastile-v1-api`, `tastile-v1-worker` reachable on `localhost:31400`)

## Quick start

```bash
./build.sh        # builds the tastile-web image
./up.sh           # starts the web container on host port 3000
./status.sh       # shows container state
./down.sh         # stops the container
```

## Environment

- Reads `tastile-web/.env.dev` for runtime env (CLOUD_API_BASE,
  TASTILE_WEB_BRIDGE_SECRET, NEXT_PUBLIC_* override values).
- `CLOUD_API_BASE` defaults to `http://localhost:31400` (host port
  mapped to the wslc core api container).
- `NEXT_PUBLIC_*` are baked at build time. If you change a
  `NEXT_PUBLIC_*` value, re-run `./build.sh` before `./up.sh`.
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git add scripts/wslc/README.md
git commit -m "chore(build): add scripts/wslc/README.md"
```

## Task H.8: Final web verification + PR

- [ ] **Step 1: Hard gate**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git ls-files | xargs rg -l -i docker 2>/dev/null | wc -l
```

Expected: 0.

- [ ] **Step 2: Push branch + open PR**

```bash
cd C:\Users\rebui\Desktop\tastile\tastile-web.wslc
git push -u origin wslc-web
```

(Use `superpowers:requesting-code-review` before merge.)

---

# PHASE I — Build, run, and verify schedule filling on web dashboard

(All work in the **Windows host** shell at `C:\Users\rebui\Desktop\tastile\`.)

## Task I.1: Bootstrap WSL Container

- [ ] **Step 1: Run bootstrap**

```bash
cd C:\Users\rebui\Desktop\tastile
bash ./tastile-core.wslc/scripts/wslc/bootstrap.sh
```

Expected: `wslc ready. Network 'tastile-net' + data dirs prepared.`

(`bash` prefix needed because Windows cmd doesn't run shebang lines natively; works in Git Bash / WSL bash.)

## Task I.2: Build core image

- [ ] **Step 1: Run build**

```bash
cd C:\Users\rebui\Desktop\tastile
bash ./tastile-core.wslc/scripts/wslc/build.sh
```

Expected: build completes; `tastile-v1-api` appears in `wslc images`.

- [ ] **Step 2: Verify image**

```bash
wslc images
```

Expected: line `tastile-v1-api ...` present.

## Task I.3: Build web image

- [ ] **Step 1: Run build**

```bash
cd C:\Users\rebui\Desktop\tastile
bash ./tastile-web.wslc/scripts/wslc/build.sh
```

Expected: build completes; `tastile-web` appears in `wslc images`.

- [ ] **Step 2: Verify both images**

```bash
wslc images
```

Expected: both `tastile-v1-api` and `tastile-web` listed.

## Task I.4: Start core stack (postgres + api + worker)

- [ ] **Step 1: Run up-v1**

```bash
cd C:\Users\rebui\Desktop\tastile
bash ./tastile-core.wslc/scripts/wslc/up-v1.sh
```

Expected: `Stack up. Run scripts/wslc/status.sh to verify.`

- [ ] **Step 2: Wait ~5s for the api to bind, then verify health**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:31400/health
```

Expected: `HTTP 200`. (If 000/connection-refused, wait 5 more seconds and retry; postgres init can take a few seconds on first start.)

- [ ] **Step 3: Verify status**

```bash
bash ./tastile-core.wslc/scripts/wslc/status.sh
```

Expected: `tastile-postgres`, `tastile-v1-api`, `tastile-v1-worker` all `running`.

## Task I.5: Start web container

- [ ] **Step 1: Run up.sh**

```bash
cd C:\Users\rebui\Desktop\tastile
bash ./tastile-web.wslc/scripts/wslc/up.sh
```

Expected: `Web up. Open http://localhost:3000 in a browser.`

- [ ] **Step 2: Verify web responds**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/login
```

Expected: `HTTP 200` (login page). If the web does a 307 redirect to Cognito, `-w "%{http_code}\n"` on the initial request will show 307 — that's fine, the login page is reachable.

## Task I.6: Open browser and log in (chrome-devtools MCP)

- [ ] **Step 1: List open pages**

Use `mcp__chrome-devtools__list_pages` to confirm a browser session is available.

- [ ] **Step 2: Navigate to web**

```
mcp__chrome-devtools__navigate_page type=url url=http://localhost:3000
```

Expected: redirect to Cognito Hosted UI (pool `tastile-v1-app`).

- [ ] **Step 3: Log in via existing test account**

If a test account exists in `.env.dev` notes or in 1Password, enter credentials at the Cognito Hosted UI. The login redirects back to `http://localhost:3000/auth/callback` and lands on `/dashboard`.

(If no test account is available, follow the user's preferred account-creation flow per `tastile-core/HARNESS.md` §7 — the pool is configured for `EMAIL_OTP` first factor as of 2026-07-06 per memory `project_cognito_emailotp_misconfigured_20260706.md`.)

- [ ] **Step 4: Verify dashboard loads**

Use `mcp__chrome-devtools__take_snapshot` to confirm the dashboard UI rendered (timeline or calendar view present).

## Task I.7: Trigger schedule filling via API (fastest deterministic path)

The schedule filling algorithm needs a recurring tile with a `RecurrenceModel` to produce Flow Placements. The cleanest deterministic path is the same one used in the existing `timeline_curl.txt` evidence:

- [ ] **Step 1: Read the existing curl recipe**

```bash
cd C:\Users\rebui\Desktop\tastile
cat docs/superpowers/plans/evidence/timeline_curl.txt 2>/dev/null | head -100
```

- [ ] **Step 2: Run the curl commands against `http://localhost:31400` (instead of the prod host)**

Replace the host in the curl commands with `http://localhost:31400`. The bearer token comes from the active web session (decode the id_token from the browser's localStorage via `mcp__chrome-devtools__evaluate_script`, or use the test account's id_token if you generated one directly via Cognito).

- [ ] **Step 3: Verify the response contains `source: "Flow Placements"` or equivalent**

Expected: a non-empty `placements` array, including the 10:00–10:30 study placement per AT-028.

## Task I.8: Observe Flow Placements in the dashboard

- [ ] **Step 1: Navigate to the timeline/calendar view**

```
mcp__chrome-devtools__navigate_page type=url url=http://localhost:3000/dashboard/timeline
```

(Or whatever the actual route is — check `tastile-web/src/app/dashboard/` for the canonical route name.)

- [ ] **Step 2: Take a snapshot to confirm Flow Placements are rendered**

Use `mcp__chrome-devtools__take_snapshot` (or `take_screenshot` for visual verification).

- [ ] **Step 3: Verify visually**

Confirm:
- A tile block exists for the 10:00–10:30 study slot
- Its badge / tooltip shows `source: Flow` (or equivalent indicator)
- The block is in the "Today" or target date column

## Task I.9: Save evidence

- [ ] **Step 1: Save the API response + screenshot**

```bash
cd C:\Users\rebui\Desktop\tastile
mkdir -p docs/superpowers/plans/evidence/wslc-stack-20260707
cp /tmp/timeline_curl_wslc.txt docs/superpowers/plans/evidence/wslc-stack-20260707/timeline_curl.txt
cp /tmp/dashboard_screenshot.png docs/superpowers/plans/evidence/wslc-stack-20260707/dashboard.png 2>/dev/null || true
```

- [ ] **Step 2: Write summary**

Write `docs/superpowers/plans/evidence/wslc-stack-20260707/SUMMARY.md`:

```markdown
# wslc stack + schedule filling verification — 2026-07-07

## Stack

- wslc containers running: tastile-postgres, tastile-v1-api, tastile-v1-worker, tastile-web
- API: http://localhost:31400 (200 OK)
- Web: http://localhost:3000 (200 OK)

## Schedule filling

- AT-023..029 storage tests: green (cargo test, prior run)
- Real API curl: returned Flow Placements (see timeline_curl.txt)
- Web dashboard: Flow Placements visible at /dashboard/timeline (see dashboard.png)
- 10:00–10:30 study placement: PRESENT

## Conclusion

Schedule filling algorithm (v1) is verified end-to-end against a wslc
container stack. Algorithm produces the expected Flow Placements
visible in the web dashboard.
```

- [ ] **Step 3: Commit evidence (separate repo: `tastile` root)**

```bash
cd C:\Users\rebui\Desktop\tastile
git add docs/superpowers/plans/evidence/wslc-stack-20260707/
git commit -m "evidence(wslc): 2026-07-07 schedule filling verified on wslc stack"
```

---

# Done criteria

- `tastile-core.wslc` and `tastile-web.wslc` worktrees created on `wslc-migration` and `wslc-web` branches respectively
- `tastile-core/Containerfile.v1` and `tastile-web/Containerfile` exist
- `scripts/wslc/` populated in both worktrees
- `rg -i docker` over both worktrees' tracked files: 0 hits
- `wslc list -a` shows postgres + api + worker + web containers running
- `curl http://localhost:31400/health` returns 200
- `curl http://localhost:3000/login` returns 200
- Web dashboard shows the 10:00–10:30 study Flow Placement
- Evidence saved to `docs/superpowers/plans/evidence/wslc-stack-20260707/`

# Rollback

- `git checkout main` in both worktrees reverts to main.
- `bash ./tastile-core.wslc/scripts/wslc/down.sh` and `bash ./tastile-web.wslc/scripts/wslc/down.sh` stop containers without losing data.
- `bash ./tastile-core.wslc/scripts/wslc/reset.sh` (DESTRUCTIVE) removes all containers + data + network.
- Branches `wslc-migration` and `wslc-web` can be deleted with `git branch -D` if not merged.
