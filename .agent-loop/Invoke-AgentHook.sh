#!/usr/bin/env bash
set -euo pipefail

# Invoke-AgentHook.sh — Bash adapter for agent pre-commit review.
# Reads PreToolUse JSON from stdin, validates input, and invokes the review engine.
#
# Usage: echo '{"tool_input":{"command":"git commit ..."},"cwd":"/path"}' | bash Invoke-AgentHook.sh <caller>
# Exit 0 = allow, exit 2 = deny (stderr = reason)

CALLER="${1:-}"
if [[ "$CALLER" != "claude" && "$CALLER" != "codex" && "$CALLER" != "opencode" ]]; then
  echo "Invoke-AgentHook.sh requires a claude, codex, or opencode caller argument" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read stdin
RAW="$(cat)"

if [[ -z "$RAW" ]]; then
  echo "Tastile review hook received no input" >&2
  exit 2
fi

# Parse JSON
COMMAND="$(echo "$RAW" | bun -e "
const fs = require('fs');
let input;
try { input = JSON.parse(fs.readFileSync(0,'utf8')); } catch { process.exit(2); }
if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') process.exit(2);
const cmd = input.tool_input?.command;
if (typeof cmd !== 'string' || !cmd.trim()) process.exit(2);
const cwd = input.cwd;
if (typeof cwd !== 'string' || !cwd.trim()) process.exit(2);
try { const s = require('fs').statSync(cwd); if (!s.isDirectory()) process.exit(2); } catch { process.exit(2); }
process.stdout.write(JSON.stringify({command: cmd, cwd: cwd}));
" 2>/dev/null)" || {
  echo "Tastile review hook received invalid or unexpected input" >&2
  exit 2
}

CMD="$(echo "$COMMAND" | bun -e "const d=require('fs').readFileSync(0,'utf8'); const o=JSON.parse(d); process.stdout.write(o.command);")"
CWD="$(echo "$COMMAND" | bun -e "const d=require('fs').readFileSync(0,'utf8'); const o=JSON.parse(d); process.stdout.write(o.cwd);")"

# Invoke the review engine
ENGINE="$SCRIPT_DIR/Invoke-PreCommitReview.sh"
if [[ ! -f "$ENGINE" ]]; then
  echo "Review engine not found: $ENGINE" >&2
  exit 2
fi

OUTPUT="$(bash "$ENGINE" --caller "$CALLER" --command "$CMD" --working-directory "$CWD" --workspace-root "$SCRIPT_DIR/.." 2>&1)"
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  exit 0
fi

# Extract reason from JSON output (last line that is valid JSON with a reason)
REASON="Tastile pre-commit review denied this command"
REASON_EXTRACTED=false
while IFS= read -r line; do
  if echo "$line" | grep -q '"allow":false'; then
    EXTRACTED=$(echo "$line" | bun -e "
const fs = require('fs');
const d = fs.readFileSync(0,'utf8').trim();
try {
  const obj = JSON.parse(d);
  if (obj.reason) { process.stdout.write(obj.reason); }
} catch {}
" 2>/dev/null)
    if [[ -n "$EXTRACTED" ]]; then
      REASON="$EXTRACTED"
      REASON_EXTRACTED=true
      break
    fi
  fi
done <<< "$OUTPUT"

echo "$REASON" >&2
exit 2
