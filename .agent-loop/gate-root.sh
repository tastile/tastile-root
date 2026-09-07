#!/usr/bin/env bash
set -euo pipefail

# gate-root.sh — Bash port of the root workspace fast gate.
# Validates that staged .agent-loop/ JSON and script changes still parse.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG_PATH="$ROOT/.agent-loop/repositories.json"
SCHEMA_PATH="$ROOT/.agent-loop/review-result.schema.json"
CHECKPOINT_SCHEMA_PATH="$ROOT/.agent-loop/checkpoint.schema.json"
AGENT_RESULT_SCHEMA_PATH="$ROOT/.agent-loop/agent-result.schema.json"

OK=true

# Test JSON file validity
test_json_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Required JSON file is missing: $path" >&2
    OK=false
    return
  fi
  if ! bun -e "JSON.parse(require('fs').readFileSync('$path','utf8'))" 2>/dev/null; then
    echo "Invalid JSON in $path" >&2
    OK=false
  fi
}

# Test shell script syntax
test_shell_syntax() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    return
  fi
  if ! bash -n "$path" 2>/dev/null; then
    echo "Shell syntax error in $path" >&2
    OK=false
  fi
}

test_json_file "$CATALOG_PATH"
test_json_file "$SCHEMA_PATH"
test_json_file "$CHECKPOINT_SCHEMA_PATH"
test_json_file "$AGENT_RESULT_SCHEMA_PATH"

# Validate shell scripts
for script in "$ROOT/.agent-loop/Invoke-PreCommitReview.sh" "$ROOT/.agent-loop/Invoke-AgentHook.sh"; do
  if [[ -f "$script" ]]; then
    test_shell_syntax "$script"
  fi
done

# Run agent environment gate if present
AGENT_ENV_GATE="$ROOT/scripts/check-agent-environment.ps1"
if [[ -f "$AGENT_ENV_GATE" ]]; then
  if command -v pwsh &>/dev/null; then
    if ! pwsh -NoProfile -File "$AGENT_ENV_GATE"; then
      OK=false
    fi
  else
    # Try bash version if available
    AGENT_ENV_GATE_SH="$ROOT/scripts/check-agent-environment.sh"
    if [[ -f "$AGENT_ENV_GATE_SH" ]]; then
      if ! bash "$AGENT_ENV_GATE_SH"; then
        OK=false
      fi
    fi
  fi
fi

if [[ "$OK" != "true" ]]; then
  exit 1
fi
exit 0
