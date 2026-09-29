#!/usr/bin/env bash
set -euo pipefail

apply=false
if [[ "${1:-}" == "--apply" ]]; then
  apply=true
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 2
fi

project="${TASTILE_GCP_DEV_PROJECT:-tastile-dev}"
secret="${TASTILE_GCP_WIF_PROBE_SECRET:-poc-wif-probe}"

command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }

if ! gcloud secrets describe "$secret" --project "$project" >/dev/null 2>&1; then
  echo "missing Secret Manager metadata: projects/$project/secrets/$secret" >&2
  echo "Apply infra/gcp/foundation first." >&2
  exit 2
fi

existing="$(gcloud secrets versions list "$secret"   --project "$project"   --filter='state=ENABLED'   --format='value(name)'   --limit=1 2>/dev/null || true)"

if [[ -n "$existing" ]]; then
  echo "enabled probe version already exists: $secret"
  exit 0
fi

echo "missing: enabled probe secret version"
if [[ "$apply" != true ]]; then
  echo "No mutation performed. Re-run with --apply after operator review."
  exit 0
fi

# The disposable value is streamed directly into Secret Manager and never
# written to a file, repository, OpenTofu state, or command output.
openssl rand -hex 32 |
  gcloud secrets versions add "$secret"     --project "$project"     --data-file=-     >/dev/null

echo "created: one enabled probe version (value not displayed)"
