#!/usr/bin/env bash
# gate-desktop.sh — Bash adapter for tastile-desktop pre-commit fast gate.
#
# The original gate command is `pwsh -NoProfile -File scripts/check.ps1 -SkipDesktopBuild`.
# The shared engine has a pwsh->bash fallback that runs gate-root.sh for any pwsh gate
# when gate-root.sh is present, which is correct for the root repo but wrong for child
# repos. Routing desktop through this bash wrapper bypasses the buggy fallback and
# lets us invoke pwsh with the original arguments verbatim. When pwsh is unavailable
# we fall back to gate-root.sh (workspace structure validation) so the gate still
# produces a meaningful signal.
set -euo pipefail

if command -v pwsh >/dev/null 2>&1; then
  exec pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/check.ps1 -SkipDesktopBuild
fi

exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-root.sh"
