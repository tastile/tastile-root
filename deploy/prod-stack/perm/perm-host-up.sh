#!/usr/bin/env bash
# perm-host-up.sh — bring up the tastile-perm stack (root#143 auto-recovery,
# root#155 B1).
#
# Runs INSIDE the dedicated WSL2 distro (`tastile-perm`). Invoke from
# Windows at user logon via Task Scheduler:
#
#   schtasks /create /tn "TastilePermUp" /sc onlogon /f ^
#     /tr "wsl -d tastile-perm -u root -- /root/tastile/tastile-root/deploy/prod-stack/perm/perm-host-up.sh"
#
# Idempotent: safe to run repeatedly.
#
# Publishing model: api/web/caddy bind 127.0.0.1 inside the distro and
# WSL2 localhost forwarding exposes them on the Windows host loopback —
# no portproxy rules are required. Legacy portproxy rules (13120/13140)
# from the earlier 0.0.0.0-binding design are removed here if present.
set -euo pipefail

# docker.service is systemd-managed; starting the distro boots it, but a
# manual run on an already-running distro may still find it down.
if ! docker info >/dev/null 2>&1; then
  systemctl start docker
fi

# Remove stale loopback portproxy rules (superseded by WSL localhost
# forwarding). netsh.exe runs on the Windows host through WSL interop.
netsh.exe interface portproxy delete v4tov4 listenport=13120 listenaddress=127.0.0.1 >/dev/null 2>&1 || true
netsh.exe interface portproxy delete v4tov4 listenport=13140 listenaddress=127.0.0.1 >/dev/null 2>&1 || true

# Wait for API readiness inside the distro.
deadline=$((SECONDS + 180))
until curl -fsS -m 5 http://127.0.0.1:31470/v1/health >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "perm-host-up: api health check timed out" >&2
    exit 1
  fi
  sleep 5
done

echo "perm-host-up: ok (api health 200 on :31470, web on :3120, caddy https on :443)"
