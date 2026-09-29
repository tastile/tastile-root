# Tastile infrastructure

Tastile の target infrastructure 実装。architecture の正本は `architecture/model/*.yaml` と root ADR-0014〜0020 であり、
この directory はその **real-resource implementation** を持つ。

## Boundary

- `gcp/operator-bootstrap.sh`: operator authority が必要な初回だけの bootstrap。
  GCP project / billing link / OpenTofu state bucket / pre-launch budget を作る。
- `gcp/foundation/`: OpenTofu 管理。API、service account、Artifact Registry、GitHub OIDC WIF、private Core CI dispatcher の基盤。
- Cloud Run / Cloud SQL / service-specific secrets は ms.m3 / ms.m4 で environment stack として追加する。
- secret **value** は repository / tfvars / OpenTofu state に入れない。

## Apply order

1. `gcloud auth login` と `gcloud auth application-default login`
2. `TASTILE_GCP_BILLING_ACCOUNT` を指定するか、active billing account が1個だけであることを確認
3. `infra/gcp/operator-bootstrap.sh` で read-only preflight。請求先の通貨が JPY 以外なら `TASTILE_GCP_BUDGET_AMOUNT` を指定する
4. operator が内容を確認して `infra/gcp/operator-bootstrap.sh --apply`
5. script が生成した `infra/gcp/foundation/foundation.auto.tfvars.json` を使って `tofu init / plan`
6. plan review 後だけ `tofu apply`

Core private CI は Cloud Build GitHub connection を作らず、Infisical-backed GitHub App dispatcher を使う (ADR-0015、ADR-0020)。
production/staging mutation は operator authority。
