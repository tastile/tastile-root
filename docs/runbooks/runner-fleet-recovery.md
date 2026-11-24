# Self-hosted GitHub Actions runner fleet — operations & recovery

Host: `devnode-win-uuu-recreated` (Windows host + WSL2 `Ubuntu` distro).
Access: `ssh devnode-win-uuu-recreated` (OpenSSH to Windows, user `rebui`),
then `wsl -d Ubuntu -u root -e bash -s` for root inside WSL.

## Fleet inventory

WSL2 Ubuntu (systemd services, user `basic`, runner dirs `~/actions-runner-*`):

| Service | Runner dir | Repo scope |
| --- | --- | --- |
| `actions.runner.tastile-tastile-core.wsl-ubuntu-tastile-core.service` | `~/actions-runner-core` | tastile-core |
| `...tastile-android...` | `~/actions-runner-android` | tastile-android |
| `...tastile-web...` | `~/actions-runner-web` | tastile-web |
| `...tastile-desktop...` | `~/actions-runner-desktop` | tastile-desktop |
| `...tastile-openapi...` | `~/actions-runner-openapi` | tastile-openapi |
| `...tastile-brands...` | `~/actions-runner-brands` | tastile-brands |

Windows host: 2 runners (`win-devnode-tastile-core`,
`win-devnode-tastile-desktop` visible via `gh api .../actions/runners`),
WMI-launched `Runner.Listener`/`runsvc` processes under user `rebuildup`.
NOT Windows services — see "Windows runners" below.

Toolchain inside WSL (provisioned once, shared by all runners):
docker.io 29.x (shared daemon, containerd image store, systemd cgroup
driver), Node 22, JDK 21, Android SDK (`ANDROID_HOME`/`ANDROID_SDK_ROOT` in
the android runner `.env`), Rust via rustup for user `basic`, `mold`.

## Resource limits (applied 2026-11-24/25 JST)

Host: 23 GiB RAM, 8 vCPU, 4 GiB swap.

- `/etc/systemd/system/ci.slice`: `MemoryMax=16G`, `CPUQuota=600%` —
  aggregate ceiling for all six runner services.
- Per-runner drop-ins `<unit>.d/10-hardening.conf`: `Slice=ci.slice`,
  `CPUQuota=100–150%`, `MemoryMax` core 8G / android 10G / web 4G /
  desktop 4G / brands 4G / openapi 3G, `Restart=always RestartSec=10`.
- `/etc/systemd/system/ci-containers.slice`: `MemoryMax=8G`,
  `CPUQuota=300%`. Slice naming makes it a CHILD of `ci.slice`, so all CI
  (runner jobs + containers) shares the 16G/600% envelope.
- `/etc/systemd/system/docker.service.d/10-ci-cgroup-parent.conf`:
  `ExecStart=/usr/bin/dockerd -H fd:// --containerd=... 
  --cgroup-parent=ci-containers.slice` (NO leading slash — `/ci-containers.slice`
  silently does not apply). Verified: containers land in
  `ci.slice/ci-containers.slice/docker-*.scope`.
- `/etc/systemd/system/docker.service.d/20-ci-cpu.conf`: `CPUQuota=200%`
  (daemon only; containers are no longer under docker.service).

IMPORTANT cgroup facts (verified on host):
- Job containers are `system.slice/docker-<id>.scope` by default — they are
  NOT under `docker.service` or `containerd.service`. Limiting those
  services does nothing for containers; `--cgroup-parent` is the mechanism.
- Restarting `docker.service` does NOT kill running containers (they are
  containerd tasks). Restarting `containerd.service` is NOT needed and was
  deliberately not done.

Inspect: `systemctl show <unit> -p MemoryMax -p CPUQuotaPerSecUSec -p Slice`;
`systemctl show ci.slice -p MemoryCurrent`. Tune drop-ins, `daemon-reload`,
restart idle runners one at a time. Busy runners pick up `Slice=` on their
next restart; `set-property --runtime` covers MemoryMax/CPUQuota live.

## Cache / artifact hygiene

`ci-hygiene.timer` enabled, weekly Sun 04:00 (`Persistent=true`) →
`/usr/local/sbin/ci-hygiene.service` → `/usr/local/sbin/ci-hygiene.sh`:

- `docker system prune -af --filter until=72h` + `docker volume prune -f`
  (validated: reclaimed 769 MB of orphaned volumes on first run).
- Deletes `target/`, `node_modules/`, `.next/`, `DerivedData/` older than
  7 days inside `_work`, SKIPPING runner dirs with an active `Runner.Worker`.
- Deletes `_work/_temp` files older than 1 day.

Manual: `systemctl start ci-hygiene.service`; logs `journalctl -u
ci-hygiene.service`. `_work` totals ~27 GB across the six runners
(Rust `target/` dirs dominate; core alone ~7 GB).

## Secret separation — known residual risks

- All six WSL runners execute repo CI code as user `basic`, which has
  `NOPASSWD: ALL` sudo (`/etc/sudoers.d/90-basic-nopasswd`) — REQUIRED by
  current workflows (`apt-get install mold/postgresql-client`,
  `sudo install` toolchain binaries, `sudo rm -rf` of unused toolchains,
  udev rules for KVM). Any CI job can sudo anything in WSL.
- `basic` is also in the `docker` group (root-equivalent) — unavoidable
  while jobs use `docker run`/service containers.
- `basic`'s home contains personal credentials readable by CI jobs:
  `~/.git-credentials` (GitHub PAT), `~/.ssh/`, `~/.infisical/`,
  `~/infisical-keyring/`, `~/.claude.json`, `~/.emulator_console_auth_token`,
  keystore backup `~/rebuild.up.up@gmail.com--*.bak.*`.
- Runner `.credentials*`/`.env`/`token-*` files were world-readable (644);
  fixed to 600 on 2026-11-24. Stale `~/token-*` registration-token files
  remain (expired, but chmod'd).
- `_work` contains only checkouts + `.env.example` files; Actions cleans
  job temp dirs. No secrets persisted on disk beyond the above.
- Full fix requires per-repo runner users or containerized runners —
  deferred, see "Future hardening".

## Docker port-collision fix (workflow patches pending)

All WSL runners share ONE dockerd; GitHub `services:` port publishing is
host-level, so two concurrent jobs publishing `5432:5432` collide.
Affected workflows:

- `tastile-core/.github/workflows/ci.yml` (`quality` job)
- `tastile-web/.github/workflows/pr-smoke.yml` (`cli-auth-postgres` job)
- `tastile-web/.github/workflows/quality.yml` (`cli-auth-postgres` job)

Prepared patches — ephemeral host port `ports: ["5432"]` +
`${{ job.services.postgres.ports['5432'] }}` injected via `$GITHUB_ENV`,
plus `PGPORT` for the `pg_isready` wait loops (core only):

- `.tmp/runner-hardening/core-ci.patch`
- `.tmp/runner-hardening/web-pr-smoke.patch`
- `.tmp/runner-hardening/web-quality.patch`

These must go through each repo's normal Issue-branch → Draft PR flow.
Until merged, a 5432 collision fails the second job fast (docker port bind
error) — annoying but not a security issue.

Residual: any FUTURE workflow publishing a fixed host port can collide
again. Convention: never publish fixed host ports on self-hosted runners;
use ephemeral ports (`ports: ["<container-port>"]`) or job-private networks.

## Windows host runners

- Two runners are WMI-launched `Runner.Listener`/`runsvc` processes under
  user `rebuildup` — NOT Windows services, NO auto-start.
- After a Windows reboot they stay down until started manually (requires
  `rebuildup` login). No service/SYSTEM auto-start is configured — known
  limitation. Candidate fix: Task Scheduler "At startup" task running the
  runner `run.cmd` as `rebuildup`.
- Keep Windows runner `.credentials` ACL'd to `rebuildup`; do not place
  runner dirs in synced/backup paths.

## Reinstalling a WSL runner

1. Registration token (expires 1 h):

   ```bash
   gh api -X POST repos/tastile/<repo>/actions/runners/registration-token --jq .token
   ```

2. As `basic` in WSL:

   ```bash
   cd ~ && mkdir actions-runner-<repo> && cd actions-runner-<repo>
   # fetch latest actions-runner linux-x64 tarball, extract
   ./config.sh --url https://github.com/tastile/<repo> \
     --token <TOKEN> --name "tastile-<repo>.wsl-ubuntu-tastile-<repo>" \
     --labels self-hosted,linux,x64 --work _work --unattended
   sudo ./svc.sh install basic
   sudo ./svc.sh start
   ```

   Runner name must match the existing convention so repo `runs-on:` labels
   keep matching. Check `gh api repos/tastile/<repo>/actions/runners` for
   current labels before reinstalling.

3. Verify online via the same `gh api` call.

## WSL provisioning checklist (fresh distro)

- `apt install docker.io`; `systemctl enable --now docker containerd`.
- Add `basic` to `docker` group.
- Node 22, JDK 21 (Temurin), Android SDK + `platform-tools`,
  `ANDROID_HOME`/`ANDROID_SDK_ROOT`.
- Rust via `rustup` for `basic`; `mold` via apt.
- Per-runner `.env`: only `PATH` (+ Android SDK vars). No secrets —
  GitHub injects them per job.
- Re-apply hardening: copy `apply-hardening.sh` + `ci-hygiene.*` from
  `.tmp/runner-hardening/` and run as root (script is idempotent).

## Disaster recovery quick reference

| Failure | Action |
| --- | --- |
| One WSL runner dead | `systemctl restart actions.runner.tastile-<repo>...service`; `journalctl -u <unit>` |
| WSL distro broken | Reprovision per checklist; reinstall runners per above |
| Windows reboot | Log in as `rebuildup`, start the two Windows runners manually |
| Whole host lost | Rebuild Windows + WSL from checklist; runners re-register with fresh tokens; all toolchains are apt/in-repo |
| Docker daemon wedged | `systemctl restart docker` — running containers survive (containerd tasks). Avoid restarting `containerd` while jobs run |
| CI OOM/thrash | Check `systemctl show ci.slice -p MemoryCurrent`; tune drop-ins; `ci-hygiene` timer reclaims space weekly |

## Future hardening (needs user decision)

- Per-repo runner OS users (or rootless/podman per repo) to separate CI
  code execution from `basic`'s personal credentials — requires runner
  re-registration and possibly workflow changes.
- Replace `NOPASSWD: ALL` with a scoped sudoers allowlist once workflows
  stop needing arbitrary sudo.
- Windows runner auto-start via Task Scheduler.
- Merge the three workflow patches above through normal PR flow.
