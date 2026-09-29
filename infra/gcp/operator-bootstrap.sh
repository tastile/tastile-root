#!/usr/bin/env bash
set -euo pipefail

apply=false
if [[ "${1:-}" == "--apply" ]]; then
  apply=true
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 2
fi

region="${TASTILE_GCP_REGION:-asia-northeast1}"
dev_project="${TASTILE_GCP_DEV_PROJECT:-tastile-dev}"
staging_project="${TASTILE_GCP_STAGING_PROJECT:-tastile-staging}"
prod_project="${TASTILE_GCP_PROD_PROJECT:-tastile-prod}"
parent="${TASTILE_GCP_PARENT:-}"

command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 2; }
command -v tofu >/dev/null || { echo "tofu is required" >&2; exit 2; }

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)"
[[ -n "$active_account" ]] || { echo "Run: gcloud auth login" >&2; exit 2; }

if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "Run: gcloud auth application-default login" >&2
  exit 2
fi

billing_account="${TASTILE_GCP_BILLING_ACCOUNT:-}"
if [[ -z "$billing_account" ]]; then
  mapfile -t accounts < <(gcloud billing accounts list --filter=open=true --format='value(name)')
  if [[ "${#accounts[@]}" -ne 1 ]]; then
    echo "Set TASTILE_GCP_BILLING_ACCOUNT. Active billing accounts:" >&2
    printf '  %s\n' "${accounts[@]:-<none>}" >&2
    exit 2
  fi
  billing_account="${accounts[0]#billingAccounts/}"
else
  billing_account="${billing_account#billingAccounts/}"
fi

projects=("$dev_project" "$staging_project" "$prod_project")
echo "operator:       $active_account"
echo "region:         $region"
echo "billing:        $billing_account"
echo "projects:       ${projects[*]}"
echo "parent:         ${parent:-<account/no parent flag>}"
echo "mode:           $([[ "$apply" == true ]] && echo APPLY || echo PREFLIGHT)"

create_project() {
  local project="$1"
  if gcloud projects describe "$project" >/dev/null 2>&1; then
    echo "exists: project $project"
    return
  fi
  echo "missing: project $project"
  [[ "$apply" == true ]] || return

  local args=(projects create "$project" "--name=$project")
  if [[ "$parent" == organizations/* ]]; then
    args+=("--organization=${parent#organizations/}")
  elif [[ "$parent" == folders/* ]]; then
    args+=("--folder=${parent#folders/}")
  elif [[ -n "$parent" ]]; then
    echo "TASTILE_GCP_PARENT must be organizations/<id> or folders/<id>" >&2
    exit 2
  fi
  gcloud "${args[@]}"
}

for project in "${projects[@]}"; do
  create_project "$project"
  if [[ "$apply" == true ]]; then
    gcloud billing projects link "$project" --billing-account "$billing_account"
  else
    gcloud billing projects describe "$project" 2>/dev/null || true
  fi
done

state_bucket="gs://${dev_project}-tastile-tofu-state"
if gcloud storage buckets describe "$state_bucket" >/dev/null 2>&1; then
  echo "exists: state bucket $state_bucket"
elif [[ "$apply" == true ]]; then
  gcloud services enable storage.googleapis.com serviceusage.googleapis.com --project "$dev_project"
  gcloud storage buckets create "$state_bucket"     --project "$dev_project"     --location "$region"     --default-storage-class STANDARD     --uniform-bucket-level-access     --public-access-prevention
  gcloud storage buckets update "$state_bucket" --versioning
else
  echo "missing: state bucket $state_bucket"
fi

budget_name="tastile-prelaunch"
budget_resource="$(gcloud billing budgets list   --billing-account "$billing_account"   --filter="displayName=$budget_name"   --format='value(name)' --limit=1 2>/dev/null || true)"
if [[ -n "$budget_resource" ]]; then
  echo "exists: budget $budget_resource"
elif [[ "$apply" == true ]]; then
  gcloud billing budgets create     --billing-account "$billing_account"     --display-name "$budget_name"     --budget-amount 45USD     --calendar-period month     --filter-projects "projects/$dev_project,projects/$staging_project,projects/$prod_project"     --threshold-rule percent=0.50     --threshold-rule percent=0.90     --threshold-rule percent=1.00
else
  echo "missing: budget $budget_name (45 USD, thresholds 50/90/100%)"
fi

tfvars="$(cd "$(dirname "$0")" && pwd)/foundation/foundation.auto.tfvars.json"
if [[ "$apply" == true ]]; then
  cat >"$tfvars" <<JSON
{
  "projects": {
    "dev": "$dev_project",
    "staging": "$staging_project",
    "production": "$prod_project"
  },
  "region": "$region"
}
JSON
  echo "wrote local (gitignored): $tfvars"
  echo
  echo "Next:"
  echo "  cd infra/gcp/foundation"
  echo "  tofu init -backend-config=bucket=${dev_project}-tastile-tofu-state -backend-config=prefix=foundation"
  echo "  tofu plan"
else
  echo
  echo "No mutation performed. Re-run with --apply after operator review."
fi
