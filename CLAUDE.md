# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in the
`tastile-root` workspace. For package-specific guidance, read the `CLAUDE.md` /
`AGENTS.md` of the package you intend to touch (see Routing below).

---

## Workspace shape (read first)

`tastile-root` is a **shell repository** that holds sibling child repositories as
directories. Each child (`tastile-core/`, `tastile-web/`, `tastile-android/`,
`tastile-desktop/`, `tastile-brands/`) is an **independent Git repository** with
its own history, branches, and `CLAUDE.md`. They are listed in `.gitignore` at
this root so commits here do not bleed into child repos.

Do not assume a single workspace tool can build or test all packages. Each
package has its own toolchain and verification scripts.

---

## Canonical source of truth

| Concern | Canonical location |
| --- | --- |
| Whole-project policy, scope, infra, auth, routing | `docs/HARNESS.md` |
| Workspace-level decisions log | `docs/decisions.md` |
| Domain model, invariants, AT, read model, API surface | `tastile-core/v1/*.md` (16 files) |
| Backend implementation harness (Phase gates, DO/DON'T, build/test) | `tastile-core/CLAUDE.md` + `tastile-core/HARNESS.md` |
| Web client harness | `tastile-web/CLAUDE.md` |
| Desktop client (Windows) harness | `tastile-desktop/CLAUDE.md` |
| Android client harness | `tastile-android/README.md` (no `CLAUDE.md` yet) |
| Brand assets | `tastile-brands/` — **copy, never reference by relative path** |

The **v1 spec at `tastile-core/v1/` is the single source of truth for the
domain**. Old v7 vocabulary (`TickOutput`, `Arbiter`, `Materializer`,
`v7_tiles`, `6軸 enum`, etc.) is banned — see `tastile-core/CLAUDE.md`
"やってはいけないこと". `docs/archive/` is immutable.

---

## Routing table

| Task | Open | Work in |
| --- | --- | --- |
| Project-wide question, infra, deployment | `docs/HARNESS.md` | this repo |
| Domain / API / schema change | `tastile-core/v1/02`, `v1/10`, `v1/14` | `tastile-core/` |
| Backend Rust change (handler, store, worker) | `tastile-core/CLAUDE.md`, `tastile-core/HARNESS.md` | `tastile-core/` |
| Plan a v1 feature | write `tastile-core/docs/plans/YYYY-MM-DD-<topic>.md` | `tastile-core/` |
| Web UI / Next.js / Stripe webhook | `tastile-web/CLAUDE.md` | `tastile-web/` |
| Desktop (WinUI / .NET) | `tastile-desktop/CLAUDE.md` | `tastile-desktop/` |
| Android (Kotlin / Compose) | `tastile-android/README.md` | `tastile-android/` |
| Logo / brand asset | `tastile-brands/README.md` | `tastile-brands/` |
| Update HARNESS history after a shipped phase | `docs/HARNESS.md` §13 or `tastile-core/HARNESS.md` §5 | this repo / core |

When a task touches **two or more** packages (e.g. web ↔ core API change), read
both `CLAUDE.md` files and the matching `v1/` chapters before editing.

---

## Workspace-wide policies (apply across all packages)

- **Package manager**: `bun` for everything frontend / script-side (`bun install`,
  `bun add`, `bun run`, `bunx`). Never `npm` / `npx`.
- **Goal is no Docker**: dev and prod both run native Linux binaries directly.
  WSL on Windows. CI is `ubuntu-latest`. The migration target is **WSL
  Container (`wslc`)** replacing Docker Desktop — see the section below.
  `Dockerfile.v1` / `docker-compose.v1.yml` still exist in `tastile-core/`
  pending that migration and are **not** removed without a plan.
- **No `enum` types in PostgreSQL**; no JSONB in the source of truth; numeric
  constants only (`smallint` + app-side Registry). Details: `tastile-core/v1/10`.
- **Frontend is a thin client**. Business logic lives only in `tastile-core`.
- **`.env.example` only**. Real `.env` values are local or in GitHub Secrets.
- **Plan → implement**. Code changes are preceded by a plan doc in
  `tastile-core/docs/plans/` (or the equivalent for the package). Do not start
  implementation until the plan exists.

---

## Phase status (snapshot)

v1 era is in progress since 2026-06-24. Phases A–D of `tastile-core` (Tile / Plan
/ Recurring / Placement / Execution + Condition / Decision / Resolution +
Recurring + Nesting & Flow + Metric & DecisionRun) are complete on paper with
178 tests green; v0 cleanup (Phase 5) is deferred until all clients finish
migrating to v1. Web and Android v1 migrations are the current focus; desktop
already runs against the AWS-hosted core via Cognito Hosted UI.

For the live matrix see `docs/decisions.md` (last sweep) and
`tastile-core/HARNESS.md` §5 (per-phase history). Refresh after each shipped
phase.

---

## WSL Container (`wslc`) & Linux builds

There are two distinct things called "wslc" in this workspace — do not confuse.

### `tastile-core.wslc` — WSL-side cargo clone (active, use it)

- A worktree/clone of `tastile-core` living inside WSL Ubuntu, used as the
  path where Rust actually builds and runs `cargo test` on this Windows host.
- Created with `git worktree add ../tastile-core.wslc -b wslc-migration main`
  (see `tastile-core/docs/archive/2026-07-02-wslc-migration-plan.md`).
- **Why it exists**: Windows Defender blocks `cc1.exe` here, so `cargo build`
  for crates with C deps (`ring`, `libsqlite3-sys`) silently fails on the
  Windows side. Inside WSL Ubuntu, `gcc` works and Postgres binds on a TCP
  port WSL can reach directly (no `wslrelay.exe`).
- When you need to run a Rust integration test, do it from this clone, not
  from the Windows-side `tastile-core/`.

### `wslc` — WSL Container preview (in migration, not yet landed)

- Microsoft June 2026 preview feature (`C:\Program Files\WSL\wslc`,
  `wslc 2.9.3.0`) intended to replace Docker Desktop for local dev. Build
  with `wsl --container build -f Containerfile.v1`, run with
  `wsl --container run -d <name> --image <ref>`.
- Current state (2026-07-06): `wslc list` reports 0 containers, but the image
  cache has `tastile-v1-api` (~1.9 GB, built 3 days ago) and `postgres:16-alpine`.
- **Not yet implemented**: `tastile-core/scripts/wslc/` orchestration
  (`bootstrap.{sh,ps1}`, `build.{sh,ps1}`, `up-v1.{sh,ps1}`, etc.). The
  planned deletion of `Dockerfile.v1`, `docker-compose.v1.yml`,
  `.dockerignore`, and the legacy `scripts/_*.log` files has not happened.
- **Hard gate when the migration lands**: `rg -l docker` over tracked files
  must return 0 (design doc: `tastile-core/docs/archive/2026-07-02-wslc-migration-design.md`).
- Until `scripts/wslc/` is in place, treat plain `wsl --exec bash` as the
  local validation path — do not block Phase C' (and later) work on the
  `wslc` migration landing.

### Practical flow today

| Need | Use |
| --- | --- |
| Edit `tastile-core` Rust code | Windows-side `tastile-core/` |
| Run `cargo build` / `cargo test` for `tastile-core` | `tastile-core.wslc` (WSL clone) |
| Start Postgres locally for an integration test | `wsl --exec bash` against the WSL-distro Postgres, or the cached `wslc` `postgres:16-alpine` image manually |
| Verify the API against a running daemon | `wsl --exec bash` until `scripts/wslc/up-v1.{sh,ps1}` exists |
| Ship | CI `ubuntu-latest` is the source of truth, regardless of local path |

---

## Known environmental blockers (this Windows host)

- **Windows Defender blocks `cc1.exe`** — `cargo build` of crates with C deps
  (`ring`, `libsqlite3-sys`) silently fails. CI is the source of truth for
  green/red. For local Rust validation, run `cargo` from inside WSL Ubuntu,
  where `gcc` is reachable and Postgres binds on a TCP port WSL can reach.
- **JDK 11 vs JDK 17** — Android Gradle plugin needs JDK 17 (`class file 61`).
  Set `JAVA_HOME` to JDK 17 before `./gradlew`.
- **AWS state can differ from `.env.local.example`** — treat `aws
  cognito-idp list-user-pools` etc. as truth before baking IDs into a build.

These are local-only caveats. They do not affect what ships.

---

## Style for AI agents in this repo

- Keep root-level edits minimal. Most edits belong in a child repo.
- When writing Markdown that contains backticks via PowerShell, use a here-string
  or `[IO.File]::WriteAllBytes` — `Set-Content` mangles the escape sequences.
- The Codex / MiniMax-M3 model is configured with a low per-turn output cap.
  Multi-KB file writes inside a single tool argument will truncate and break
  the session. Prefer chunked writes (small `apply_patch` / `Edit` calls) over
  one large embedded file.