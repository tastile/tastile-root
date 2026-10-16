#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cargo/bin:$PATH
cd /workspace/g19-image-rollback-input
export RUSTFLAGS='-C debuginfo=0 -C strip=debuginfo -C link-arg=-fuse-ld=mold -C link-arg=-Wl,--no-keep-memory'
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2
export AWS_REGION=ap-northeast-1 AWS_EC2_METADATA_DISABLED=true
export PGPASSWORD=tastile
unset PORT TASTILE_API_PORT TASTILE_BYPASS_AUTH

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y cmake curl jq mold pkg-config postgresql-client
rm -rf /var/lib/apt/lists/*
jq -e '.schema == "tastile-core-image-rollback-input-v1" and (.candidate_sha | test("^[0-9a-f]{40}$")) and (.baseline_sha | test("^[0-9a-f]{40}$")) and (.image | test("^asia-northeast1-docker.pkg.dev/tastile-dev/tastile/core@sha256:[0-9a-f]{64}$")) and ((.binaries|keys)==["api","migrate_run","worker"])' binding.json >/dev/null
expected_image='asia-northeast1-docker.pkg.dev/tastile-dev/tastile/core@sha256:90d936ea5fb8d8f6adb3ab229fb665e22f3ae5c6d487a357d80aa3104cc94ac0'
[[ "$expected_image" =~ ^asia-northeast1-docker.pkg.dev/tastile-dev/tastile/core@sha256:[0-9a-f]{64}$ ]] || { echo 'Approved image digest must be frozen before submission' >&2; exit 2; }
jq -e --arg image "$expected_image" '
  .candidate_sha == "9b097f4e9a93e1c1451686a80c021864c549733c"
  and .baseline_sha == "9b3f8b5363af52a12ab5912318cfdabe5af8728d"
  and .build_id == "2946e861-89e5-4ab7-9cc6-4abc92b1280b"
  and .build_source_generation == "1792128577279167"
  and .build_source_archive_sha256 == "993d7a1d65401b85041a166e68f06be6a5b4c3c848e0078d34df95b83a0b5d14"
  and .image == $image
  and .image_manifest_digest == ($image | split("@")[1])
' binding.json >/dev/null
for role in api migrate_run worker; do
  digest=$(jq -r --arg role "$role" '.binaries[$role].sha256' binding.json)
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ -f "$role" && ! -L "$role" && -x "$role" ]]
  printf '%s  %s\n' "${digest#sha256:}" "$role" | sha256sum --check
done
for item in baseline.tar verify-source-tile.sh; do
  case "$item" in
    baseline.tar) digest=$(jq -r '.baseline_archive_sha256' binding.json);;
    verify-source-tile.sh) digest=$(jq -r '.smoke_sha256' binding.json);;
  esac
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
  printf '%s  %s\n' "${digest#sha256:}" "$item" | sha256sum --check
done
[[ ! -e baseline && ! -L baseline && ! -e baseline-target && ! -L baseline-target ]]
mkdir -m 700 baseline
tar -xf baseline.tar -C baseline
export CARGO_TARGET_DIR=/workspace/g19-image-rollback-input/baseline-target
cargo build --manifest-path baseline/crates-v1/Cargo.toml --locked -p api -p worker --jobs 2
echo 'BASELINE_INDEPENDENT_BUILD_OK'

database="root50_image_${BUILD_ID//-/}_$RANDOM"
[[ "$database" =~ ^root50_image_[0-9a-f]{32}_[0-9]+$ ]]
created=0
candidate_pid=''
baseline_api_pid=''
baseline_worker_pid=''
stop() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid"; wait "$pid" || true; fi
}
cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT
  stop "$candidate_pid" || cleanup_status=1
  stop "$baseline_worker_pid" || cleanup_status=1
  stop "$baseline_api_pid" || cleanup_status=1
  if [[ "$created" == 1 ]]; then
    psql -h tastile-ci-postgres -U tastile -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $database" || cleanup_status=1
    remaining=$(psql -h tastile-ci-postgres -U tastile -d postgres -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_database WHERE datname='$database'") || cleanup_status=1
    [[ "$remaining" == 0 ]] || cleanup_status=1
    printf 'OWNED_ROLLBACK_DATABASES_REMAINING=%s\n' "$remaining"
  fi
  printf 'IMAGE_ROLLBACK_EXIT=%s CLEANUP_EXIT=%s\n' "$status" "$cleanup_status"
  if [[ "$status" == 0 && "$cleanup_status" != 0 ]]; then status=1; fi
  exit "$status"
}
trap cleanup EXIT
psql -h tastile-ci-postgres -U tastile -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database"
created=1
export TASTILE_DATABASE_URL="postgres://tastile:tastile@tastile-ci-postgres:5432/$database"
export DATABASE_URL="$TASTILE_DATABASE_URL"
TASTILE_DATABASE__MAX_CONNECTIONS=2 ./migrate_run
echo 'EXACT_IMAGE_MIGRATOR_OK'
bridge="image-rollback-$RANDOM-$$"
start_api() {
  TASTILE_ENV=development TASTILE_DATABASE__MAX_CONNECTIONS=4 TASTILE_API_HOST=127.0.0.1 \
    TASTILE_API_PORT="$2" TASTILE_ALLOWED_ORIGINS=http://127.0.0.1 \
    TASTILE_WEB_BRIDGE_SECRET="$bridge" RUST_LOG=warn "$1" >"$3" 2>&1 &
  started_pid=$!
}
ready() {
  for attempt in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:$2/v1/ready" >/dev/null; then return 0; fi
    kill -0 "$1" 2>/dev/null || { tail -n 30 "$3"; return 1; }
    sleep 1
  done
  tail -n 30 "$3"
  return 1
}
start_api ./api 35401 candidate-api.log
candidate_pid="$started_pid"
ready "$candidate_pid" 35401 candidate-api.log
stop "$candidate_pid"
candidate_pid=''
echo 'EXACT_IMAGE_API_READY_OK'
start_api ./baseline-target/debug/api 35402 baseline-api.log
baseline_api_pid="$started_pid"
ready "$baseline_api_pid" 35402 baseline-api.log
TASTILE_ENV=development TASTILE_DATABASE__MAX_CONNECTIONS=4 RUST_LOG=info \
  ./baseline-target/debug/worker >baseline-worker.log 2>&1 &
baseline_worker_pid=$!
for attempt in $(seq 1 60); do
  if grep -q 'worker booted' baseline-worker.log; then break; fi
  kill -0 "$baseline_worker_pid" 2>/dev/null || { tail -n 30 baseline-worker.log; exit 1; }
  sleep 1
done
grep -q 'worker booted' baseline-worker.log
TASTILE_API_URL=http://127.0.0.1:35402 TASTILE_WEB_BRIDGE_SECRET="$bridge" \
  TASTILE_WEB_SESSION_USER=image-rollback-smoke bash ./verify-source-tile.sh
echo 'PASS: exact OCI migrator/API and independent baseline API/worker SourceTile write/materialize/read/reflow/list'
