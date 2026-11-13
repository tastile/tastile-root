#!/usr/bin/env bash
# Preflight for the verification stack (root#105).
#
# Verify stacks build Rust images inside Docker. On 2026-11-13 the host disk
# filled during verification work and Docker Desktop lost its image/volume
# store, forcing a full rebuild. Run this before `docker compose up --build`
# and during long verification campaigns.
#
# Usage:
#   bash preflight.sh                 # report only; exit 1 if below threshold
#   bash preflight.sh --prune-stopped # also remove EXITED verify containers
#   bash preflight.sh --prune-images  # also remove unused tastile-core-verify:* tags
#
# Never removes volumes, operational stacks, or non-verify images.
# Threshold override: TASTILE_VERIFY_MIN_FREE_GIB=<GiB>

set -euo pipefail

MIN_FREE_GIB="${TASTILE_VERIFY_MIN_FREE_GIB:-15}"
PREFIX="${TASTILE_VERIFY_PREFIX:-tastile-verify}"
IMAGE_REPO="tastile-core-verify"

avail_kib=$(df -k "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" | awk 'NR==2 {print $4}')
avail_gib=$((avail_kib / 1024 / 1024))

echo "== disk =="
echo "available: ${avail_gib} GiB (threshold ${MIN_FREE_GIB} GiB)"
df -h "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" | awk 'NR==2 {print "filesystem: " $1 " used " $3 "/" $2 " (" $5 ")"}'

echo
echo "== docker =="
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon unreachable" >&2
  exit 2
fi
docker system df || true
echo
echo "verify containers (${PREFIX}-*):"
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -E "^${PREFIX}-" || echo "  (none)"
echo
echo "${IMAGE_REPO} images:"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep "^${IMAGE_REPO}:" || echo "  (none)"

if (( avail_gib < MIN_FREE_GIB )); then
  echo >&2
  echo "FAIL: only ${avail_gib} GiB free; verify builds need headroom." >&2
  echo "Free space or raise TASTILE_VERIFY_MIN_FREE_GIB deliberately." >&2
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
    --prune-stopped)
      stopped=$(docker ps -aq --filter "name=^${PREFIX}-" --filter status=exited)
      if [[ -n "$stopped" ]]; then
        # shellcheck disable=SC2086
        docker rm $stopped
      else
        echo "no exited ${PREFIX}-* containers"
      fi
      ;;
    --prune-images)
      # Remove verify image tags not referenced by any container. Tagged
      # images only; volumes and other repositories are untouched.
      used=$(docker ps -a --format '{{.Image}}' | sort -u)
      docker images --format '{{.Repository}}:{{.Tag}}' \
        | grep "^${IMAGE_REPO}:" \
        | while read -r tag; do
            if ! printf '%s\n' "$used" | grep -qx "$tag"; then
              docker rmi "$tag" || true
            fi
          done
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

echo
echo "OK: ${avail_gib} GiB free"
