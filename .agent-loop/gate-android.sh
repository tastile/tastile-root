#!/usr/bin/env bash
# gate-android.sh — Bash adapter for tastile-android pre-commit fast gate.
#
# The snapshot extracted from `git archive HEAD` does NOT include
# `local.properties` (gitignored), nor the cross-repo `openapi/openapi.yaml`
# (lives in the workspace-shell submodule, not in tastile-android/). Without
# these, `gradlew verify` fails fast — even though the live repo can build.
#
# This wrapper:
#  1. Copies the live repo's `local.properties` (sdk.dir) into the snapshot.
#  2. Copies the workspace `openapi/openapi.yaml` into the snapshot at the
#     path that app/build.gradle.kts's `openapi.input=../../openapi/openapi.yaml`
#     resolves to (i.e. snapshot/openapi/openapi.yaml).
#  3. Invokes the canonical `gradlew.bat verify --no-daemon`.
#
# The script is invoked with cwd = snapshotPath (set by Invoke-PreCommitReview).
# The repo paths are hardcoded to the user's known workspace; adjust if the
# user's path differs.

# Tee output to a debug file the user can inspect after the gate runs.
LOG_FILE="C:/Users/rebui/Desktop/tastile/.tmp/gate-android.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "==== gate-android started at $(date -Iseconds) ===="

# Ensure cygpath, cp, mkdir are reachable. When bash is spawned via
# Process.Start from PowerShell, the inherited PATH is minimal and may not
# include Git's POSIX utilities.
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/mingw64/bin:/c/Windows/System32:/c/Windows:${PATH:-}"

REPO_ROOT="/c/Users/rebui/Desktop/tastile"
REPO_LOCAL="$REPO_ROOT/tastile-android/local.properties"
REPO_OPENAPI_DIR="$REPO_ROOT/openapi"
SNAPSHOT_OPENAPI_DIR="./openapi"

echo "gate-android: pwd=$(pwd)"
echo "gate-android: argv0=$0"

if [ ! -f "$REPO_LOCAL" ]; then
  echo "gate-android: source local.properties not found: $REPO_LOCAL" >&2
  exit 1
fi
if [ ! -f "$REPO_OPENAPI_DIR/openapi.yaml" ]; then
  echo "gate-android: source openapi.yaml not found: $REPO_OPENAPI_DIR/openapi.yaml" >&2
  exit 1
fi

cp -f "$REPO_LOCAL" "./local.properties" || { echo "gate-android: cp local.properties failed" >&2; exit 1; }
echo "gate-android: copied local.properties into snapshot"

mkdir -p "$SNAPSHOT_OPENAPI_DIR" || { echo "gate-android: mkdir openapi failed" >&2; exit 1; }
cp -f "$REPO_OPENAPI_DIR/openapi.yaml" "$SNAPSHOT_OPENAPI_DIR/openapi.yaml" || { echo "gate-android: cp openapi.yaml failed" >&2; exit 1; }
echo "gate-android: copied openapi.yaml into snapshot"

# Resolve the absolute Windows path of the copied openapi.yaml. In the live
# repo, app/build.gradle.kts reads `openapi.input=../../openapi/openapi.yaml`,
# which resolves relative to app/. The snapshot extracts at <temp>/.../snapshot/
# so `../../` walks into the temp container, not the snapshot itself. Override
# the gradle property to the absolute path of the snapshot-copied file so the
# OpenAPI generator reads from inside the snapshot.
SNAPSHOT_ABS_PATH=$(cygpath -w "$(pwd)")
OPENAPI_WIN_PATH="${SNAPSHOT_ABS_PATH}\\openapi\\openapi.yaml"
echo "gate-android: openapi.input=$OPENAPI_WIN_PATH"

# gradlew.bat is the canonical entry point on Windows. Invoke it directly via
# bash — bash can execute .bat files via its built-in win32 path handling.
exec ./gradlew.bat verify --no-daemon -Popenapi.input="$OPENAPI_WIN_PATH"
