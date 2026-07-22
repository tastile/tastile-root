# Storage Reclaim + WSL/wslc → D: Drive Migration (2026-07-22)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reclaim C: drive space (currently 18 GB free / 492 GB used) by (a) shrinking `tastile-core` Rust build profile + Cargo.toml dependencies, and (b) relocating the WSL Ubuntu distribution + wslc image cache / persistent containers to D: drive (244 GB free).

**Architecture:** Two parallel work streams, both surgical, both reversible. (a) is in-tree: `tastile-core/Cargo.toml` profile + feature changes plus a one-shot `cargo clean` of stale Windows-side `target/`. (b) is operational: `wsl --export`/`--unregister`/`--import` plus wslc config for cache relocation. The two streams are independent; the only shared risk is running both at the same time, which we will not do.

**Tech Stack:** Rust 1.95.0 stable, cargo, wslc (Microsoft June 2026 preview, `C:\Program Files\WSL\wslc.exe`), wsl Ubuntu distro, PowerShell + bash.

---

## Snapshot of current state (verified 2026-07-22)

| Location | Size | Note |
|---|---|---|
| C: drive | 492 GB used / 18 GB free | **tight** |
| D: drive | 755 GB used / 244 GB free | target |
| `tastile-core/target/debug/` | 23 GB | Windows-side failed-build remnants (Defender blocks `cc1.exe`; per `feedback_windows_defender_blocks_cc1`) |
| `~/.cargo/registry/` (C:) | 3.9 GB | cache 288 MB / src 1.7 GB / index 1.5 GB |
| `~/.rustup/toolchains/` (C:) | 8.7 GB | 6 toolchains: 1.42.0, 1.70.0, 1.95.0, nightly, stable-gnu, stable-msvc |
| `~/.cargo` + `~/.rustup` (WSL Ubuntu) | TBD | WSL distro listing garbled on this terminal; size to be measured during Task C1 |
| wslc containers (running) | — | `tastile-api-evidence` (31400), `tastile-db-evidence` (postgres:16-alpine), `tastile-worker-evidence`, `pg-port-forward-2026` (35432) |
| wslc image cache | ~2 GB | `tastile-v1-api:latest` (~1.9 GB) + `postgres:16-alpine` (~150 MB) |

**Scope guardrails (decided with user 2026-07-22):**
- "wsl container" = wslc image cache + persistent containers + WSL Ubuntu distro (all of it → D:)
- "core rust build deps reduction" = profile 調整 + Cargo.toml feature 削減 (NOT move target/, NOT cargo clean by itself)

The 23 GB `target/debug/` cleanup is included as a one-shot side effect of "the Windows-side target is dead weight" — explicitly approved by user this session.

---

## Task 1: Write this design doc + commit

**Files:**
- Create: `docs/plans/2026-07-22-storage-reclaim-and-wslc-migration-design.md` (this file)

**Step 1:** Commit the design on `main` (no worktree per `feedback_no_worktree_default`):
```bash
cd C:/Users/rebui/Desktop/tastile
git add docs/plans/2026-07-22-storage-reclaim-and-wslc-migration-design.md
git commit -m "docs(plan): 2026-07-22 storage reclaim + WSL/wslc → D: drive"
```

**Step 2:** Hand off to executing-plans skill. Stop here; do not start implementation until user says go.

---

## Task 2: Slim `[profile.dev]` + remove dead Windows-side `target/`

**Files:**
- Modify: `tastile-core/Cargo.toml` (workspace root)
- Delete: `tastile-core/target/` (Windows-side, 23 GB)

**Step 1:** Add to `tastile-core/Cargo.toml` (after existing `[workspace.dependencies]` block):
```toml
[profile.dev]
debug = 0
incremental = true
codegen-units = 256
lto = false

[profile.dev.package."*"]
debug = 1
```

Rationale: `debug = 0` strips dep-side debug info on stable (large win, no nightly needed). `debug = 1` on workspace crates preserves stack-trace usability for our own code. `codegen-units = 256` maximizes parallelism.

**Step 2:** Verify `cargo check` still passes inside WSL:
```bash
wsl --exec bash -c 'cd ~/tastile-core.wslc && cargo check --workspace --all-targets 2>&1 | tail -20'
```
Expect: "Finished `dev` profile [unoptimized + debuginfo] target(s)" and zero errors.

**Step 3:** Clean Windows-side `target/` (Defender-blocked artifacts; not needed):
```bash
cd C:/Users/rebui/Desktop/tastile/tastile-core
git clean -fdx target/
# Or if git-clean refuses (e.g., tracked file slipped in): rm -rf target/debug
```

**Step 4:** Verify reclaimed space:
```bash
powershell -NoProfile -Command "Get-PSDrive C | Select-Object Used,Free"
```

**Step 5:** Commit:
```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-core/Cargo.toml
git commit -m "chore(v1): slim [profile.dev] to debug=0 + codegen-units=256"
```

**Rollback:** `git revert <sha>` restores both Cargo.toml and the next build regenerates target/.

---

## Task 3: Slim Cargo.toml dependencies (audit-driven)

**Files:**
- Modify: `tastile-core/Cargo.toml` (`[workspace.dependencies]`)
- May modify: `tastile-core/crates/v1/{api,worker,cli,storage,domain}/Cargo.toml`

**Step 1:** Add udeps + machete if not in cache:
```bash
wsl --exec bash -c 'cargo install --locked cargo-udeps cargo-machete 2>&1 | tail -5'
```

**Step 2:** Audit workspace (per crate):
```bash
wsl --exec bash -c '
  cd ~/tastile-core.wslc
  for c in crates/v1/domain crates/v1/storage crates/v1/api crates/v1/worker crates/v1/cli; do
    echo "=== $c ==="
    cargo +stable udeps --all-targets --package $(basename $c) 2>&1 | grep -E "unused|note:" | head -20
  done
'
```

**Step 3:** Top candidates (do not change without udeps/machete confirmation):
- `tokio` from `["full"]` → `["rt-multi-thread","macros","signal","sync","time","net"]` (only if `process`/`fs` confirmed unused)
- `reqwest` — only if no caller actually issues HTTP; v1 bridge uses `axum` server-side
- `chrono-tz` — only if no tz conversion in api/worker
- `anyhow` — likely removable from library crates; keep in `cli` if used

**Step 4:** Apply each removal one at a time. Run `cargo check --workspace --all-targets` after each. If red, revert that one removal and continue.

**Step 5:** Commit per feature removal (small commits per `feedback_surgical_changes`):
```bash
git add tastile-core/Cargo.toml
git commit -m "chore(v1): drop unused <dep-name> from workspace deps"
```

**Rollback:** `git revert` per commit, or `git reset --hard` if all in one branch.

---

## Task 4: Measure WSL Ubuntu + wslc image cache size pre-migration

**Step 1:** Get WSL distro name via UTF-8-safe path (terminal output was garbled in session):
```bash
powershell -NoProfile -Command "wsl -l -v | Out-String"
```

**Step 2:** Measure WSL Ubuntu footprint:
```bash
wsl --exec bash -c '
  du -sh /root/.cargo /root/.rustup 2>/dev/null
  du -sh /root/.cargo/registry 2>/dev/null
  du -sh ~/tastile-core.wslc 2>/dev/null
  du -sh ~/tastile-core.wslc/target 2>/dev/null
  df -h /
'
```

**Step 3:** Measure wslc image cache location + size:
```bash
powershell -NoProfile -Command "
  Get-ChildItem -Recurse -Force \$env:LOCALAPPDATA\wslc -ErrorAction SilentlyContinue |
    Where-Object { \$_.PSIsContainer } |
    ForEach-Object { '{0:N1} MB  {1}' -f ((Get-ChildItem \$_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB), \$_.FullName } |
    Sort-Object { [double]((\$_.Split()[0])) } -Descending | Select-Object -First 10
"
```

**Step 4:** Record numbers in this file (post-comment) before proceeding to Task 5.

---

## Task 5: Migrate WSL Ubuntu distribution to D:

**Step 1:** Stop all wslc containers first (they share the WSL VM):
```bash
wslc container stop tastile-api-evidence
wslc container stop tastile-db-evidence
wslc container stop tastile-worker-evidence
wslc container stop pg-port-forward-2026
wslc container ls   # confirm all stopped
```

**Step 2:** Shutdown WSL cleanly:
```bash
wsl --shutdown
```

**Step 3:** Export current distro:
```bash
mkdir -p D:/WSL
wsl --export Ubuntu D:/WSL/ubuntu-backup-20260722.tar
ls -lh D:/WSL/ubuntu-backup-20260722.tar
```

**Step 4:** Unregister the old distro (this deletes the .vhdx; backup above is now the only copy):
```bash
wsl --unregister Ubuntu
```

**Step 5:** Re-import on D::
```bash
mkdir -p D:/WSL/Ubuntu
wsl --import Ubuntu D:/WSL/Ubuntu D:/WSL/ubuntu-backup-20260722.tar
```

**Step 6:** Restore default user (imported distros default to root):
```bash
# Determine the original UID from the backup:
wsl --exec bash -c 'id rebuildup' 2>/dev/null || echo "user rebuildup not present yet"
# Add the [user] section to /etc/wsl.conf pointing at the original default
wsl --exec bash -c '
  cat >> /etc/wsl.conf <<EOF

[user]
default = rebuildup
EOF
  cat /etc/wsl.conf
'
# Restart so the default user takes effect
wsl --shutdown
wsl --exec bash -c 'whoami'   # expect: rebuildup
```

**Step 7:** Verify Rust toolchain survived the move:
```bash
wsl --exec bash -c 'cargo --version && rustc --version && which cargo'
```

**Step 8:** Verify `tastile-core.wslc` worktree is intact:
```bash
wsl --exec bash -c 'cd ~/tastile-core.wslc && git status -sb && git log --oneline -3'
```

**Rollback:** Old `.vhdx` is gone but the `.tar` export is preserved at `D:/WSL/ubuntu-backup-20260722.tar`. To go back to C:, `wsl --unregister Ubuntu` then `wsl --import Ubuntu <old-C-path> D:/WSL/ubuntu-backup-20260722.tar`. Keep the `.tar` for 7 days.

---

## Task 6: Migrate wslc image cache to D:

**Step 1:** Check current wslc config (location of cache and data dirs):
```bash
wslc config show 2>&1 || wslc --help 2>&1 | head -50
# Also look for a config file:
ls -la ~/.wslc/ 2>/dev/null
ls -la $LOCALAPPDATA/wslc/ 2>/dev/null
```

**Step 2:** Identify cache + persistent-volume mount points:
- Image cache: typically under `%LOCALAPPDATA%\wslc\` (verify in Step 1)
- Persistent volumes: passed as `-v D:\wslc\data\<name>:/data` at container create time; these are bind mounts and already on D: if created that way (verify with `wslc container inspect <name>`)

**Step 3:** Set new cache directory via wslc config (exact key TBD by Step 1 output):
```bash
wslc config set cache-dir D:/wslc/cache   # or whichever key Step 1 reveals
```

**Step 4:** If wslc has no config-based relocation, do a file-level move (only if no daemon is running):
```bash
wslc daemon stop 2>&1 || wsl --shutdown
mkdir -p D:/wslc/cache
# Use robocopy to preserve ACLs; /MIR mirrors
robocopy "C:/Users/rebui/AppData/Local/wslc/cache" "D:/wslc/cache" /MIR /R:3 /W:5
# Junction the old path to the new path
rmdir "C:/Users/rebui/AppData/Local/wslc/cache"
mklink /J "C:/Users/rebui/AppData/Local/wslc/cache" "D:/wslc/cache"
```

**Step 5:** Restart wslc daemon + verify:
```bash
wslc daemon start 2>&1 || wslc list   # whichever is correct
wslc list
```

**Step 6:** Bring up the 4 evidence containers from existing images:
```bash
# Re-create with bind-mount volumes on D: (per memory: wslc delete-and-recreate, not update)
wslc container run -d --name tastile-db-evidence --image postgres:16-alpine -v D:/wslc/data/db:/var/lib/postgresql/data -p 5432:5432 -e POSTGRES_PASSWORD=...
# Repeat for api, worker, pg-port-forward using exact same env + port flags as before
# (capture the original flags from `wslc container inspect <name>` before deleting in Task 5)
```

**Step 7:** Smoke test:
```bash
curl -s http://127.0.0.1:31400/health   # tastile-api-evidence
wslc exec tastile-db-evidence pg_isready -U postgres
```

**Rollback:** Junction in Step 4 is a true rollback point — `rmdir` the junction (does not touch D:), confirm `wslc` re-creates the cache on the original path.

---

## Task 7: Post-migration verification + size check

**Step 1:** Run a representative `cargo test` from the WSL clone to confirm in-place build still works:
```bash
wsl --exec bash -c 'cd ~/tastile-core.wslc && cargo test --workspace --no-run 2>&1 | tail -10'
```

**Step 2:** Final size snapshot:
```bash
powershell -NoProfile -Command "Get-PSDrive C,D | Select-Object Name,Used,Free"
```

**Step 3:** Commit any final touch-ups (e.g., updated `wslc` config notes) and append a `## Done — YYYY-MM-DD` section to this file with measured numbers.

---

## Top 3 risks (and mitigations)

1. **Default user broken after `wsl --import`** — `wsl --import` always lands at root. /etc/wsl.conf `[user] default = rebuildup` is mandatory before next launch; without it, all `wsl --exec` calls run as root and break the `~/tastile-core.wslc/` path. Mitigation: Step 6 of Task 5 explicitly sets it + verifies `whoami`.

2. **wslc config relocation has no documented flag** — Task 6 Step 1 inspects actual config; if `wslc config set cache-dir` does not exist, fall back to NTFS junction (Step 4), which is reversible. Mitigation: junction is the documented escape hatch.

3. **wslc persistent container data loss if `-v` flags not preserved** — bind-mount sources are external to the image, but if a container used anonymous wslc-managed volume (no `-v`), that volume dies with the container. Mitigation: Task 6 Step 6 captures `wslc container inspect` output **before** any delete, and recreates with identical flags. For the 4 evidence containers, the memory `feedback_bridge_owner_provisioning_20260721` implies the API/DB/worker all have D: bind mounts already — confirm during execution.

---

## Files touched (summary)

| File | Task | Change |
|---|---|---|
| `docs/plans/2026-07-22-storage-reclaim-and-wslc-migration-design.md` | T1 | created |
| `tastile-core/Cargo.toml` | T2, T3 | + profile block, - unused deps |
| `tastile-core/target/` (Windows-side) | T2 | deleted (gitignored) |
| `tastile-core/crates/v1/*/Cargo.toml` | T3 | only if a dep is local-only |
| (D: drive) `D:/WSL/Ubuntu/ext4.vhdx` | T5 | created via re-import |
| (D: drive) `D:/wslc/cache/` | T6 | created via junction or wslc config |

No schema change. No API change. No production deploy.
