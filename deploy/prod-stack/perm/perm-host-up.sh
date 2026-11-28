#!/usr/bin/env bash
# perm-host-up.sh — bring up the tastile-perm stack and refresh the
# Windows loopback portproxy rules (root#143 auto-recovery, root#155 B1).
#
# Runs INSIDE the dedicated WSL2 distro (`tastile-perm`). Invoke from
# Windows at user logon via Task Scheduler:
#
#   schtasks /create /tn "TastilePermUp" /sc onlogon /f ^
#     /tr "wsl -d tastile-perm -u root -- /root/tastile/tastile-root/deploy/prod-stack/perm/perm-host-up.sh"
#
# Idempotent: safe to run repeatedly. The portproxy connectaddress tracks
# the current WSL IPv4 because WSL2 reassigns it across restarts.
set -euo pipefail

DistroIp="$(hostname -I | awk '{print $1}')"
if [ -z "${DistroIp}" ]; then
  echo "perm-host-up: no IPv4 address on distro interface" >&2
  exit 1
fi

# docker.service is systemd-managed; starting the distro boots it, but a
# manual run on an already-running distro may still find it down.
if ! docker info >/dev/null 2>&1; then
  systemctl start docker
fi

# Refresh loopback portproxy: web 13120->3120, api 13140->31470.
# netsh.exe runs on the Windows host through WSL interop.
netsh.exe interface portproxy delete v4tov4 listenport=13120 listenaddress=127.0.0.1 >/dev/null 2>&1 || true
netsh.exe interface portproxy delete v4tov4 listenport=13140 listenaddress=127.0.0.1 >/dev/null 2>&1 || true
netsh.exe interface portproxy add v4tov4 listenport=13120 listenaddress=127.0.0.1 \
  connectaddress="${DistroIp}" connectport=3120 protocol=tcp >/dev/null
netsh.exe interface portproxy add v4tov4 listenport=13140 listenaddress=127.0.0.1 \
  connectaddress="${DistroIp}" connectport=31470 protocol=tcp >/dev/null

# Wait for API readiness inside the distro (the portproxy publishes the
# same service on the Windows side; WSL loopback is a separate namespace).
deadline=$((SECONDS + 180))
until curl -fsS -m 5 http://127.0.0.1:31470/v1/health >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "perm-host-up: api health check timed out" >&2
    exit 1
  fi
  sleep 5
done

echo "perm-host-up: ok (distro ip ${DistroIp}, api health 200 on :31470)"
