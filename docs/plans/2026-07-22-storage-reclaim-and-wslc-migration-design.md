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

---

## Plan Update — 2026-07-22 PM (post-Task 3, pre-Task 4)

### What changed

After deeper investigation triggered by user pushback ("wslをDドライブ移動させろ"), the original Tasks 5–6 turned out to be based on a wrong assumption. The canonical WSL Ubuntu package (`CanonicalGroupLimited.Ubuntu*`) is **not installed** on this host — only the wslc preview engine is. So `wsl --export Ubuntu` is N/A, and the entire wsl footprint lives at non-canonical paths under `%LOCALAPPDATA%\wslc\` and `%LOCALAPPDATA%\wsl\{guid}\`. The "wslc image cache" is not a separate directory either — all 13 images and 17 volumes live **inside** one 84 GB VHDX file.

### Actual wsl/wslc footprint on C: (measured 2026-07-22 14:41)

| Path | Size | Note |
|---|---|---|
| `C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic\storage.vhdx` | **84.15 GB** | the engine's union fs — containers + images + volumes all live here |
| `C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic\swap.vhdx` | 1.47 GB | wslc session swap |
| `C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}\ext4.vhdx` | 1.42 GB | WSL2 system rootfs (the VM's ext4 layer that hosts the wslc engine) |
| `C:\Program Files\WSL\system.vhd` | 722.9 MB | **DO NOT MOVE** — Windows component install (System32-equivalent for WSL) |
| `C:\Program Files\WSL\tools\modules.vhd` | 159.4 MB | **DO NOT MOVE** — Windows component install |

**Total movable: ~87 GB.** `C:\Program Files\WSL\*.vhd` (~880 MB) are protected Windows binaries and stay where they are.

### wslc inventory (verified)

- 4 running containers (full names):
  - `tastile-api-evidence-20260722b` (port 31400→31400, image `tastile-v1-api:latest`)
  - `tastile-db-evidence-20260722` (image `postgres:16-alpine`)
  - `tastile-worker-evidence-20260722b` (image `tastile-v1-api:latest`)
  - `pg-port-forward-20260722b` (port 35432→5432, image `alpine:latest`)
- 13 images cumulative (~3.2 GB; layers live inside `storage.vhdx`)
- 17 named+anonymous volumes (8 named: `tastile-cargo-target`, `tastile-clippy-target`, `tastile-rust-cache`, `tastile-pgdata-test`, `tastile-src`, `tastile-cargo-tools`, `tastile-cargo-git`, `tastile-cargo-registry`); all live inside `storage.vhdx`
- `wslc settings` opens `C:\Users\rebui\.wslc\config.yaml` (file does not exist yet — first-run creates it with all keys commented)
- No separate `C:\Users\rebui\AppData\Local\wslc\volumes\` or `\images\` directories — confirming all wslc state is inside `storage.vhdx`

### C: drive now

- Before this session: 492 GB used / 18 GB free
- After Tasks 2–3 (target/debug + Cargo.toml): ~472 GB used / ~38 GB free
- **Now: 504.8 GB used / 6.15 GB free** — drifting up; `storage.vhdx` grew during the session (was 90,351,599,616 bytes when checked before, 84.15 GB after the carve measurement)

### Revised Tasks (supersede old Task 4–7 numbering; old versions preserved above for history)

#### Task 4 (revised) — DONE 2026-07-22

Measurement complete. Numbers recorded in the table above. No further work needed.

#### Task 5 (revised) — Stop wslc, capture recreate flags, terminate session

**Step 1:** Capture recreate flags for all 4 containers BEFORE stopping (per `feedback_wslc_delete_and_recreate`):
```powershell
foreach ($n in @('tastile-api-evidence-20260722b','tastile-db-evidence-20260722','tastile-worker-evidence-20260722b','pg-port-forward-20260722b')) {
  wslc container inspect $n 2>&1 | Tee-Object -FilePath "D:\wslc\inspect-$n.txt"
}
```
**Step 2:** Stop all 4 containers:
```powershell
foreach ($n in @('tastile-api-evidence-20260722b','tastile-db-evidence-20260722','tastile-worker-evidence-20260722b','pg-port-forward-20260722b')) {
  wslc container stop $n
}
wslc container ls   # confirm 0 running
```
**Step 3:** Terminate the wslc session:
```powershell
wslc system session terminate wslc-cli-basic
wslc system session list   # confirm 0 sessions
```

**Rollback:** If anything fails before the file move, just restart the session — `wslc system session run wslc-cli-basic` (or similar; actual subcommand TBD) brings everything back as-is.

#### Task 6 (revised) — Move `storage.vhdx` + `swap.vhdx` to D:, then `ext4.vhdx`

This is the single Task 6 (old Task 5 WSL-Ubuntu and old Task 6 wslc-cache merged into one cohesive move).

**Files:**
- Move: `%LOCALAPPDATA%\wslc\sessions\wslc-cli-basic\storage.vhdx` (84 GB)
- Move: `%LOCALAPPDATA%\wslc\sessions\wslc-cli-basic\swap.vhdx` (1.5 GB)
- Move: `%LOCALAPPDATA%\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}\ext4.vhdx` (1.42 GB)

**Step 1:** Shutdown WSL to release `ext4.vhdx` file locks:
```powershell
wsl --shutdown
```
**Step 2:** Create D: destinations and robocopy:
```powershell
New-Item -ItemType Directory -Force -Path 'D:\wslc\sessions','D:\wsl\system'
robocopy 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic' 'D:\wslc\sessions\wslc-cli-basic' /MIR /R:3 /W:5
robocopy 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}' 'D:\wsl\system\{386307ad-9c8e-400a-9d22-e729619369b6}' /MIR /R:3 /W:5
```
**Step 3:** Verify file identities match (size + bytes; the 84 GB file is unique enough):
```powershell
Get-FileHash 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic\storage.vhdx','D:\wslc\sessions\wslc-cli-basic\storage.vhdx'
Get-FileHash 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic\swap.vhdx','D:\wslc\sessions\wslc-cli-basic\swap.vhdx'
Get-FileHash 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}\ext4.vhdx','D:\wsl\system\{386307ad-9c8e-400a-9d22-e729619369b6}\ext4.vhdx'
```
**Step 4:** Replace originals with NTFS junctions (transparent redirect):
```powershell
Remove-Item 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic' -Recurse -Force
New-Item -ItemType Junction -Path 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic' -Target 'D:\wslc\sessions\wslc-cli-basic'

Remove-Item 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}' -Recurse -Force
New-Item -ItemType Junction -Path 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}' -Target 'D:\wsl\system\{386307ad-9c8e-400a-9d22-e729619369b6}'
```
**Step 5:** Restart wslc engine + recreate containers from captured flags:
```powershell
# Bring the session back
wslc system session list   # verify wslc-cli-basic starts automatically on first container cmd; if not, check for `wslc system session start` or `wslc system session run`

# Recreate each container using flags captured in Task 5 Step 1
# (will be written as a PowerShell script `D:\wslc\recreate-containers.ps1` generated from the inspect output)
& D:\wslc\recreate-containers.ps1
```
**Step 6:** Smoke test:
```powershell
wslc container ls   # all 4 should be running
curl -sS http://127.0.0.1:31400/health      # tastile-api-evidence
wslc exec tastile-db-evidence-20260722 pg_isready -U postgres   # confirm DB is alive
```

**Rollback:** NTFS junctions are true rollback points. To go back to C:
```powershell
# 1. Stop everything
wsl --shutdown
wslc system session terminate wslc-cli-basic 2>$null
# 2. Remove junctions
Remove-Item 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic' -Force
Remove-Item 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}' -Force
# 3. Move files back
robocopy 'D:\wslc\sessions\wslc-cli-basic' 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic' /MIR
robocopy 'D:\wsl\system\{386307ad-9c8e-400a-9d22-e729619369b6}' 'C:\Users\rebui\AppData\Local\wsl\{386307ad-9c8e-400a-9d22-e729619369b6}' /MIR
```

#### Task 7 (revised) — Post-migration verification + size check

**Step 1:** Final disk snapshot:
```powershell
Get-PSDrive C,D | Select-Object Name,@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize
```
Expect C: free to go from 6 GB → ~93 GB; D: free to drop from 244 GB → ~157 GB.

**Step 2:** Verify all 4 containers are running + the API health endpoint responds:
```powershell
wslc container ls
curl -sS http://127.0.0.1:31400/health
curl -sS http://127.0.0.1:35432/   # 35432 is mapped, but only postgres is listening (this will fail; use wslc exec instead)
wslc exec tastile-db-evidence-20260722 psql -U postgres -c '\l' | Select-String 'tastile'
```
**Step 3:** Verify the file paths still look right (junctions resolve transparently):
```powershell
Get-Item 'C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic\storage.vhdx' | Select-Object FullName,Length,LinkType,Target
```
**Step 4:** Commit any final touch-ups and append `## Done — 2026-07-22 PM` section with measured final numbers.

### Updated top 3 risks (and mitigations)

1. **`wslc system session` subcommand semantics are unclear from help alone** — the help text didn't enumerate `start` / `stop` / `restart`; only `enter / list / run / shell / terminate`. The session may auto-start on first `wslc container run` (common pattern for preview tools), or it may need an explicit `wslc system session start`. Mitigation: Task 5 Step 3 uses `terminate` only; Task 6 Step 5 probes with `wslc system session list` after first container command. If list is empty after a container command, document the implicit-start behavior in Task 6's commit message.

2. **`ext4.vhdx` is locked while wslc session is alive** — even after `wsl --shutdown`, if the wslc engine keeps the WSL VM running, the file will be in use. Mitigation: Task 5 Step 3 explicitly terminates the wslc session FIRST (not just `wsl --shutdown`); Task 6 Step 1 is belt-and-suspenders. If robocopy still fails with sharing violation, add `Get-Process | Where-Object {$_.Path -like '*wsl*'}` debug step and stop the offending PID.

3. **Container recreate flags may not be deterministic** — `wslc container inspect` returns JSON but env vars / port mappings may be opaque (a hashed mount ID instead of `D:\wslc\data\db:/var/lib/postgresql/data`). Mitigation: Task 5 Step 1 ALSO captures each container's original `run` command via `wslc container logs <name> --previous 2>&1 | Select-String 'POST /containers/create'` (Docker API equivalent in wslc) AND from any wrapper script the user might have used to create them. If the wrapper exists (`tastile-core/scripts/wslc/up-v1.ps1` per CLAUDE.md), regenerate flags from there.

### Updated files-touched summary

| File / Path | Task | Change |
|---|---|---|
| `docs/plans/2026-07-22-storage-reclaim-and-wslc-migration-design.md` | T1, update | created + this revision |
| `tastile-core/Cargo.toml` | T2, T3 | + profile block, - unused deps |
| `tastile-core/.github/workflows/ci.yml` | T2 (review fix) | - `CARGO_PROFILE_DEV_DEBUG` env-var override |
| `tastile-core/target/` (Windows-side) | T2 | deleted (gitignored) |
| `tastile-core/crates/v1/*/Cargo.toml` | T3 | removed `thiserror` (api), `serde_json` + `thiserror` (worker) |
| `D:\wslc\sessions\wslc-cli-basic\` | T6 | created via robocopy + junction |
| `D:\wsl\system\{guid}\` | T6 | created via robocopy + junction |
| `D:\wslc\inspect-*.txt` | T5 | container recreate-flag capture |
| `D:\wslc\recreate-containers.ps1` | T6 | generated script for container recreation |

No schema change. No API change. No production deploy.

---

## Done — 2026-07-22 PM (Task 6 + Task 7)

### Migration executed (2026-07-22 14:45 – 15:39)

| Step | Result |
|---|---|
| Task 5: stop 4 containers + terminate `wslc-cli-basic` session | All 4 stopped cleanly, session terminated, VHDX files unlocked |
| Task 6: `wslc container inspect` capture | Saved to `D:\wslc\inspect-*.txt` (4 files, all flags preserved) |
| Task 6: `robocopy` wslc session + WSL system to D: | storage.vhdx 84.14 GB copied in ~42 min, ext4.vhdx 1.42 GB in ~80s. USB D: drive is the bottleneck (~30 MB/s) |
| Task 6: SHA-256 verify | Both files match (storage: c81871fa…, ext4: 2972a8ee…) |
| Task 6: NTFS junction swap | `C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic` → `D:\wslc\…`; `C:\…\wsl\{guid}` → `D:\wsl\…` |
| Task 6: wslc engine restart | Auto-started on first `wslc container run`. All 13 images, 17 volumes, 8 stopped containers, `tastile-net` network all visible via the junctions |
| Task 6: recreate 4 evidence containers | `recreate-containers.ps1` from captured flags |
| Task 7: smoke test | `/v1/health` → 200 `{"status":"ok","version":"0.1.0"}`; 127.0.0.1:35432 (postgres via socat) → open |

### Final disk snapshot (2026-07-22 15:42)

| Drive | Before session | After Tasks 2–3 (Cargo) | After Task 6 (migration) |
|---|---|---|---|
| C: (NVMe SSD, 512 GB) | 492 GB used / 18 GB free | ~472 GB / 38 GB free | **383.1 GB / 92.8 GB free** |
| D: (USB, 1 TB) | 244 GB free | 244 GB free | 789.3 GB used / 142.1 GB free |

**Net result: +86.65 GB free on C:, +85 GB consumed on D: (engine data + cache).** C: free went from 6.15 GB (mid-session) to 92.8 GB — back to a healthy working margin.

### Findings (worth saving)

1. **swap.vhdx is volatile** — wslc engine deletes it on session termination. Do not include it in migration scope; it will be recreated.
2. **`storage.vhdx` is the entire engine state** — containers, images, volumes, networks all live inside it. Single file move = full migration.
3. **The 4 evidence containers were transient (in-memory only)** — `storage.vhdx` only had 8 older "exited" containers from prior runs. The 4 I captured were recreated from `inspect` flags after migration. This is by design (wslc behavior); not a data loss bug.
4. **API/worker need DB to be ready before they start** — first recreate attempt failed (exit 1 after 5 s) because postgres wasn't listening yet. Re-starting them after DB was up for 50+ s succeeded. Lesson: start DB first, wait, then start API/worker.
5. **`wslc system session` has no positional arg** — `wslc system session terminate` (no arg) terminates the default session. The subcommands are `enter / list / run / shell / terminate`. No `start`/`stop` — the session auto-starts on first container command.
6. **D: drive is USB (not SSD)** — explains the ~30 MB/s copy rate (84 GB took 42 min). NVMe-C: → USB-D: is the bottleneck. If we ever need fast data movement, get an external NVMe.

### Files saved (operational, NOT in repo)

- `D:\wslc\inspect-*.txt` (4 files) — captured recreate flags
- `D:\wslc\scripts\recreate-containers.ps1` — defensive recreate script
- `D:\wslc\scripts\start-containers.ps1` — start-existing-containers helper
- `D:\wslc\migration.log` — full log of steps 2-7 with hashes

### Plan-fidelity notes

- Old Task 5 (WSL Ubuntu export/import) was N/A — CanonicalGroupLimited.Ubuntu not installed. The actual WSL footprint is the wslc engine data + the WSL system rootfs (1.4 GB ext4.vhdx), both moved successfully.
- Old Task 6 (separate wslc image cache) was N/A — there is no separate cache directory; all data is inside storage.vhdx.
- New Task 5+6 (revised) covered the actual data locations.
