# infra/sops — DORMANT (do not apply)

> **Status: dormant / superseded.** This Terraform was never applied (no state,
> placeholder-free config was never completed) and is **forbidden to apply** as
> of tastile-root#174 (2026-11-25). Secret delivery is owned by **Infisical**
> per ADR-0025 / `docs/HARNESS.md` §6-5.

## Why it must not be applied

- `aws_kms_key.sops_env` creates one customer-managed KMS key per environment
  (development / staging / production). Each key bills **$1/month** plus
  request charges — a paid path that contradicts the ADR-0025 cost boundary
  (additional cloud spend = 0).
- `aws_iam_role.gh_oidc` / `aws_ssoadmin_permission_set` /
  `aws_iam_policy.ec2_sops_decrypt` grant `kms:Decrypt` to CI/developer/EC2
  principals for a secret path that no longer exists.
- `scripts/sops.config.ts` still holds `PLACEHOLDER-*` KMS ARNs, confirming the
  Terraform outputs were never consumed.

## Policy

- **Do not run `terraform apply` / `terraform import` here.** There is no
  backend/state; an apply would create billable resources and IAM surface for
  a dead flow.
- Retained as historical reference only, pending a removal decision tracked
  separately. Deleting the directory is safe at any time — nothing references
  it (verified by `rg sops` across the repo: only docs/runbooks/specs history
  and this directory mention it).
- The companion runtime path (`scripts/sops-decrypt.ts`,
  `scripts/sops.config.ts`, `scripts/sops-decrypt.test.ts`) was removed in the
  same change; see git history for the loader implementation.
