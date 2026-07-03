# Decisions

## 2026-06-19 — zero-warning sweep status

Snapshot of `main` branch quality gates across all 4 Tastile packages.

| Check | tastile-core (Rust) | tastile-desktop (.NET) | tastile-web (Next.js) | tastile-android (Kotlin) |
| --- | --- | --- | --- | --- |
| `git log -1` (HEAD on main) | `9ad0e89` | `dd60b03` | `3adff0c` | `fc5bc06` |
| Build | ✗ env blocker (MinGW gcc) | ✓ 0 warn / 0 err (default + win-x64) | ✓ exit 0 | ✗ JDK class file mismatch (61 vs 55) |
| Test | ✗ (cannot run; build fails) | ✓ 156 pass / 0 fail | ✓ 32 files / 159 tests, no stderr noise | ✗ (build fails) |
| Lint / typecheck | ✗ (build fails) | ✓ via check.ps1 | ✓ biome exit 0, tsc exit 0 | ✗ (build fails) |
| Knip / dead-code | n/a | n/a | ✓ exit 0 | n/a |

### What works
- **tastile-desktop**: full pipeline green (156/156 unit tests pass, default + win-x64 builds clean, TimelineWindow connector wiring validated). Commit `06a8035` then `dd60b03`.
- **tastile-web**: biome + tsc + vitest (159/159) + knip + next build all exit 0. Commit `3adff0c` (`chore(web): zero-warning biome/typecheck/knip/build/test`).

### Blocked — environmental, not code
- **tastile-core**: `cargo build` fails on `ring-0.17.14` and `libsqlite3-sys-0.28.0` because `gcc.exe` itself crashes silently (exit 1, no stderr, no output `.o`). The detection step `gcc -E detect_compiler_family.c` returns 1, and the real compile of `curve25519.c` also returns 1. cc-rs reports "command did not execute successfully" but gcc itself prints nothing. Symptom matches a broken MSYS2/MinGW runtime (DLL missing or quarantine-stripped). Reinstall of MinGW 15.2.0 at `C:\ProgramData\mingw64\mingw64\` is required; this cannot be fixed via Cargo.toml changes. Last known-good cargo output predates this environment break — recursion fix `9ad0e89` is committed.
- **tastile-android**: gradle daemon reports `dagger/hilt/android/plugin/HiltGradlePlugin has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version of the Java Runtime only recognizes class file versions up to 55.0`. Running JDK is 11 (class 55), Hilt plugin needs JDK 17 (class 61). Build env must be switched to JDK 17 (project already configures JDK 17 in build.gradle but gradle wrapper is loading JDK 11). Last known-good android commit `fc5bc06` was verified under JDK 17.

### Rollback
- All committed cleanup is revertible via `git reset --hard <prev-head>` on each package's `main`. No destructive ops performed during this sweep.

### Next 3 improvements
1. Repair MinGW toolchain on this host (or pin a working rustup sysroot) so core cargo build/test can run.
2. Pin gradle wrapper to require JDK 17 (currently uses `JAVA_HOME` which resolves to JDK 11 in some shells).
3. Add a top-level `scripts/check-all.ps1` that fans out to each package's check script and surfaces exit codes — one command to gate the whole monorepo.
