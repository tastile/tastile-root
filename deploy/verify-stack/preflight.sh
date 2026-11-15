#!/usr/bin/env bash
# Preflight for the verification stack (root#105).
# Resolve and enforce Compose isolation before checking disk and Docker resources.
#
# Verify stacks build Rust images inside Docker. On 2026-11-13 the host disk
# filled during verification work and Docker Desktop lost its image/volume
# store, forcing a full rebuild. Run this before `docker compose up --build`
# and during long verification campaigns.
#
# Usage:
#   bash preflight.sh                 # report only; exit 1 if isolation or disk check fails
#   bash preflight.sh --prune-stopped # also remove EXITED verify containers
#   bash preflight.sh --prune-images  # also remove unused tastile-core-verify:* tags
#
# Never removes volumes, operational stacks, or non-verify images.
# Threshold override: TASTILE_VERIFY_MIN_FREE_GIB=<GiB>

set -euo pipefail

MIN_FREE_GIB="${TASTILE_VERIFY_MIN_FREE_GIB:-15}"
PREFIX="${TASTILE_VERIFY_PREFIX:-tastile-verify}"
IMAGE_REPO="tastile-core-verify"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Docker's `name` filter and `grep -E` both treat the pattern as a regex.
# Escape PREFIX so e.g. `verify.prod` cannot match `verifyXprod-*` and delete
# another project's stopped containers.
PREFIX_REGEX=$(printf '%s' "$PREFIX" | sed 's/[][\\.*^$/]/\\&/g')

fail_isolation() {
  echo "FAIL: verification-stack isolation: $*" >&2
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI is required to resolve the verification Compose configuration" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to inspect the resolved Compose configuration" >&2
  exit 2
fi

# Resolve the same Compose files and interpolation that `docker compose up`
# will use. A placeholder keeps this read-only preflight from reading or
# printing a user's bridge secret.
if ! compose_config=$(cd "$SCRIPT_DIR" && TASTILE_WEB_BRIDGE_SECRET=preflight-only docker compose config --format json); then
  echo "unable to resolve the verification Compose configuration" >&2
  exit 2
fi

if ! api_mapping=$(printf '%s\n' "$compose_config" | jq -ce '[.services.api.ports[]? | select((.target | tostring) == "31400")] | select(length == 1) | .[0]'); then
  fail_isolation "expected exactly one API mapping to container port 31400"
fi
if ! db_mapping=$(printf '%s\n' "$compose_config" | jq -ce '[.services.db.ports[]? | select((.target | tostring) == "5432")] | select(length == 1) | .[0]'); then
  fail_isolation "expected exactly one database mapping to container port 5432"
fi

api_host_port=$(printf '%s\n' "$api_mapping" | jq -er '.published | tostring') || fail_isolation "API host port is unresolved"
api_host_ip=$(printf '%s\n' "$api_mapping" | jq -er '.host_ip // ""') || fail_isolation "API host address is unresolved"
db_host_port=$(printf '%s\n' "$db_mapping" | jq -er '.published | tostring') || fail_isolation "database host port is unresolved"
db_host_ip=$(printf '%s\n' "$db_mapping" | jq -er '.host_ip // ""') || fail_isolation "database host address is unresolved"

if [[ ! "$api_host_port" =~ ^[0-9]+$ ]]; then
  fail_isolation "API host port must resolve to a numeric port"
fi
if [[ ! "$db_host_port" =~ ^[0-9]+$ ]]; then
  fail_isolation "database host port must resolve to a numeric port"
fi
if [[ "$api_host_ip" != "127.0.0.1" ]]; then
  fail_isolation "API must be published on 127.0.0.1 only"
fi
if [[ "$db_host_ip" != "127.0.0.1" ]]; then
  fail_isolation "database must be published on 127.0.0.1 only"
fi
case "$api_host_port" in
  31400|31401) fail_isolation "API host port $api_host_port is reserved for the operational API" ;;
esac
case "$db_host_port" in
  5432|5433) fail_isolation "database host port $db_host_port is reserved for operational PostgreSQL" ;;
esac

configured_api_port=$(printf '%s\n' "$compose_config" | jq -er '.services.api.environment.TASTILE_API_PORT | strings') || fail_isolation "container API port is unresolved"
if [[ "$configured_api_port" != "31400" ]]; then
  fail_isolation "container API must listen on port 31400"
fi

verify_database_url() {
  local service="$1"
  local variable="$2"
  local value="$3"
  local authority

  if [[ "$value" != *"://"* ]]; then
    fail_isolation "$service $variable must use the compose database at db:5432"
  fi
  authority="${value#*://}"
  authority="${authority%%[/?#]*}"
  authority="${authority##*@}"
  if [[ "$authority" != "db:5432" ]]; then
    fail_isolation "$service $variable must use the compose database at db:5432"
  fi
}

for service in api worker; do
  for variable in TASTILE_DATABASE_URL DATABASE_URL; do
    if ! database_url=$(printf '%s\n' "$compose_config" | jq -er ".services.${service}.environment.${variable} | strings"); then
      fail_isolation "$service $variable is missing from the resolved Compose configuration"
    fi
    verify_database_url "$service" "$variable" "$database_url"
  done

  if ! delivery_provider=$(printf '%s\n' "$compose_config" | jq -er ".services.${service}.environment.TASTILE_DELIVERY_PROVIDER | strings"); then
    fail_isolation "$service TASTILE_DELIVERY_PROVIDER is missing from the resolved Compose configuration"
  fi
  if [[ "$delivery_provider" != "fake" ]]; then
    fail_isolation "$service TASTILE_DELIVERY_PROVIDER must be fake"
  fi
done

echo "VERIFICATION-ONLY ATTESTATION: API 127.0.0.1:${api_host_port}->container:31400; DB 127.0.0.1:${db_host_port}->container:5432; delivery=fake; database=db:5432."

avail_kib=$(df -k "$SCRIPT_DIR" | awk 'NR==2 {print $4}')
avail_gib=$((avail_kib / 1024 / 1024))

echo "== disk =="
echo "available: ${avail_gib} GiB (threshold ${MIN_FREE_GIB} GiB)"
df -h "$SCRIPT_DIR" | awk 'NR==2 {print "filesystem: " $1 " used " $3 "/" $2 " (" $5 ")"}'

echo
echo "== docker =="
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon unreachable" >&2
  exit 2
fi
docker system df || true
echo
echo "verify containers (${PREFIX}-*):"
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -E "^${PREFIX_REGEX}-" || echo "  (none)"
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
      stopped=$(docker ps -aq --filter "name=^${PREFIX_REGEX}-" --filter status=exited)
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
        | { grep "^${IMAGE_REPO}:" || true; } \
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
