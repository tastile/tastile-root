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
region="${TASTILE_GCP_REGION:-asia-northeast1}"
trigger="${TASTILE_CORE_CI_TRIGGER:-tastile-core-ci}"
repository="${TASTILE_GCP_CORE_REPOSITORY_RESOURCE:-}"
service_account="projects/$project/serviceAccounts/sa-cloud-build@$project.iam.gserviceaccount.com"

command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 2; }

if [[ -z "$repository" ]]; then
  cat >&2 <<EOF
Set TASTILE_GCP_CORE_REPOSITORY_RESOURCE to the Cloud Build 2nd-gen GitHub
repository resource created through the operator-authorized GitHub App connection.

Expected shape:
  projects/$project/locations/$region/connections/<connection>/repositories/<repository>
EOF
  exit 2
fi

case "$repository" in
  "projects/$project/locations/$region/connections/"*/repositories/*) ;;
  *)
    echo "repository resource must belong to $project / $region: $repository" >&2
    exit 2
    ;;
esac

echo "project:         $project"
echo "region:          $region"
echo "trigger:         $trigger"
echo "repository:      $repository"
echo "service account: $service_account"
echo "build config:    cloudbuild/ci.yaml"

if gcloud builds triggers describe "$trigger"   --project "$project"   --region "$region" >/dev/null 2>&1; then
  echo "exists: Cloud Build trigger $trigger"
  echo "No mutation performed; update intentionally requires an explicit review."
  exit 0
fi

echo "missing: Cloud Build trigger $trigger"
if [[ "$apply" != true ]]; then
  echo "No mutation performed. Re-run with --apply after operator review."
  exit 0
fi

gcloud builds triggers create github   --project "$project"   --region "$region"   --name "$trigger"   --description "Tastile Core real-PostgreSQL CI (ADR-0020)"   --repository "$repository"   --pull-request-pattern '^release-.*$'   --comment-control COMMENTS_DISABLED   --build-config cloudbuild/ci.yaml   --service-account "$service_account"   --include-logs-with-status   --no-require-approval

echo "created: $trigger"
