#!/usr/bin/env bash
# perm-keepalive.sh — keep the tastile-perm WSL2 distro alive (root#143,
# root#155 B1).
#
# WSL2 powers off a distro shortly after its last `wsl` client session
# ends, even while systemd services and docker containers keep running
# inside it (observed: systemd-logind "The system will power off now"
# ~90s after session close, followed by full containerd/docker restart).
# An in-distro systemd unit alone cannot prevent this — a persistent
# `wsl` session on the Windows side is required.
#
# Install inside the distro:
#   install -m 0755 perm-keepalive.sh /usr/local/bin/tastile-perm-keepalive
#
# Run from Windows at user logon via Task Scheduler (holds the session
# open for the whole logon session):
#
#   schtasks /create /tn "TastilePermanentBackend" /sc onlogon /f ^
#     /tr "wsl -d tastile-perm -u root -- /usr/local/bin/tastile-perm-keepalive"
#
# The loop also restarts docker.service if it stops while the session
# is alive (defense in depth alongside `restart: unless-stopped`).
set -uo pipefail
exec > /var/log/tastile-perm-keepalive.log 2>&1
echo "keepalive start $(date -Is)"
while true; do
  if ! systemctl is-active --quiet docker; then
    systemctl start docker
    echo "docker restarted $(date -Is)"
  fi
  sleep 60
done
