# Tastile — AGENTS.md

This is `tastile-root`, a **shell monorepo** holding independent child repositories:
`tastile-core/` (Rust backend), `tastile-web/` (Next.js), `tastile-android/` (Kotlin),
`tastile-desktop/` (.NET/WinUI), and `tastile-brands/` (assets). Each child is its own
Git repo with its own `CLAUDE.md` / `AGENTS.md`. The child dirs are in `.gitignore`.

## Canonical sources

| Concern | Location |
|---|---|
| Project policy, scope, infra, auth, routing | `docs/HARNESS.md` |
| Workspace decisions log | `docs/decisions.md` |
| Domain model, API surface, invariants | `tastile-core/v1/*.md` |
| Backend build/test/conventions | `tastile-core/CLAUDE.md` + `tastile-core/HARNESS.md` |
| Web client | `tastile-web/CLAUDE.md` |
| Desktop client | `tastile-desktop/CLAUDE.md` |
| Android client | `tastile-android/README.md` |
| Brand assets | `tastile-brands/README.md` — **copy, never reference by relative path** |

## Dev environment

- **Package manager**: `bun` for everything frontend (`bun install`, `bun add`,
  `bun run`, `bunx`). Never `npm` / `npx`.
- **Goal is no Docker**: dev and prod run native Linux binaries (WSL on Windows).
  CI is `ubuntu-latest`. `Dockerfile.v1` / `docker-compose.v1.yml` still exist in
  `tastile-core/` pending WSL Container migration — do not remove.
- **`.env.example` only** — real `.env` values are local or in GitHub Secrets.
- **Frontend is a thin client** — business logic lives only in `tastile-core`.
- **Plan → implement**: write a plan doc in `tastile-core/docs/plans/` (or package
  equivalent) before starting implementation.

## Build & test

Workspace-wide checks (run from this root):

```powershell
# Fast gate (domain unit tests only)
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing

# Full release-quality check
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\artifacts\workspace-check.json
```

Exit codes: `0=all pass`, `1=code/test failure`, `2=BLOCKED (env missing)`.
Add `-MaxAttempts 3` for retry on transient failures.

Per-package (each package has its own toolchain — see its `CLAUDE.md`):

| Package | Fast gate | Full gate |
|---|---|---|
| tastile-core | `cargo test -p domain` (in `tastile-core.wslc`) | `pwsh -NoProfile -File scripts/check.ps1` |
| tastile-web | `bun run check` | `bun run check:release` |
| tastile-android | `.\gradlew.bat verify --no-daemon` | `.\gradlew.bat verify assembleDebug --no-daemon` |
| tastile-desktop | `pwsh -NoProfile -File scripts/check.ps1` | same |

## Conventions

- **No `enum` types in PostgreSQL**; no JSONB in source of truth; numeric
  constants only (`smallint` + app-side Registry). See `tastile-core/v1/10`.
- **v1 vocabulary only** — `TickOutput`, `Arbiter`, `Materializer`, `v7_tiles`,
  `6軸 enum`, etc. are banned. See `tastile-core/CLAUDE.md`.
- **Agent pre-commit review loop**: agent-initiated `git commit` from this root
  goes through an independent CLI agent review before the commit proceeds.
  Format: `git -C tastile-<pkg> commit -m "type: msg"` (direct, no wrappers).
  Details: `.agent-loop/README.md`.

## Pitfalls (this Windows host)

- **Windows Defender blocks `cc1.exe`** — `cargo build` of crates with C deps
  (`ring`, `libsqlite3-sys`) silently fails. Build/test `tastile-core` inside WSL
  Ubuntu via the `tastile-core.wslc` worktree clone. CI (`ubuntu-latest`) is the
  source of truth for green/red.
- **JDK 11 vs JDK 17**: Android Gradle plugin needs JDK 17. Set `JAVA_HOME` to
  JDK 17 before `./gradlew`.
- **AWS state can differ from `.env.local.example`** — query live AWS
  (`aws cognito-idp list-user-pools`, etc.) before baking IDs into builds.
- **WSL Container (`wslc`)**: per-repo `.wslc/` directories auto-extract SDK
  versions from config files. Build with `.wslc/wslc-build.ps1` (or `-WhatIf`
  for dry run).

---

# Large Tool Argument Safety

Some model and proxy configurations may truncate tool calls when a single argument contains several kilobytes of embedded text. Truncation can produce invalid JSON and make the current session unusable.

This section applies only to commands that create or modify files. It does not affect normal tool selection, code search, repository exploration, builds, tests, or other shell commands.

## File editing

* Use `apply_patch` for substantial file creation or modification.
* Avoid placing large file contents directly inside a shell command or another tool argument.
* In particular, do not use large heredocs, `python -c`, `node -e`, or equivalent commands to transmit an entire source file.
* Small, simple writes are acceptable when the complete tool call remains compact.
* For generated files that are too large for one patch, create them incrementally with multiple reasonably sized patches.

## Shell commands

Use ordinary shell commands normally for:

* repository search and inspection
* `rg`, `find`, and similar command-line utilities
* builds and tests
* `git`, `cargo`, and project scripts
* formatting, linting, and code generation

Choose tools based on the task. Do not prefer an MCP tool merely because one is available.

## Failure prevention

Before sending a file-writing tool call, check whether the command embeds a large block of source code or data. If it does, replace it with `apply_patch` or split the change into smaller patches.

Do not discuss this constraint during normal work unless it directly affects the current operation or a related tool call fails.
