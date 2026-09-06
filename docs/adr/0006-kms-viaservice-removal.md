# ADR-0006: Remove `kms:ViaService` condition from SOPS KMS key policy

- 日付: 2026-09-05 (retroactive — landed 2026-08-27 as commit `882541b`)
- 状態: Accepted
- 対象: `infra/sops/kms.tf` (Terraform, SOPS envelope key policy for `development` / `staging` / `production`)

## Context

`scripts/sops-decrypt.ts` (the SOPS envelope loader) decrypts `.env.<env>.sops`
files directly from the runner's AWS identity. Per
[`docs/superpowers/specs/2026-08-27-sops-env-decryption-design.md`](../../superpowers/specs/2026-08-27-sops-env-decryption-design.md)
§「IAM principals と KMS key policy」, three principal categories must be able to
call `kms:Decrypt` against the SOPS envelope key:

1. developer local — AWS SSO (`aws sso login`)
2. GitHub Actions OIDC role (CI decrypt job)
3. EC2 instance profile (production decrypt at systemd boot)

Before commit `882541b`, the `DecryptForSSO` statement in `infra/sops/kms.tf`
attached the following IAM condition:

```hcl
Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" } }
```

The `kms:ViaService` condition restricts `kms:Decrypt` to calls that AWS routes
through a specific service (here `s3.<region>.amazonaws.com`). That is the
intended pattern for KMS-encrypted S3 objects: S3 calls KMS on the user's
behalf, and the condition confirms the request actually came from S3. It is
**not** intended for direct `kms:Decrypt` calls from SSO / OIDC / EC2 roles.

With the condition attached, SSO direct `kms:Decrypt` calls failed with
`AccessDenied` because the request's `kms:ViaService` evaluates to `direct`
(or `kms.<region>.amazonaws.com` for the KMS endpoint), neither of which
equals `s3.<region>.amazonaws.com`. The condition silently defeated the
SOPS design's primary contract — SSO developers could not decrypt `.env.*.sops`
locally even though the spec section §「IAM principals と KMS key policy」lists
them as the first principal category. The same condition would have blocked
GitHub Actions OIDC and EC2 instance profile calls if exercised through the
key policy path that the SOPS loader uses.

## Decision

Remove the one-line `Condition = { StringEquals = { "kms:ViaService" = ... } }`
block from the `DecryptForSSO` statement in `infra/sops/kms.tf`. Allow
`kms:Decrypt` and `kms:DescribeKey` for the SSO principal without the
`kms:ViaService` restriction, matching the design spec §「IAM principals と
KMS key policy」 contract (line 179):

> `kms:Decrypt` を developer SSO principal + GitHub OIDC role + EC2 instance
> profile に対して

The corresponding `DecryptForEC2` statement never had a `kms:ViaService`
condition, so EC2 identity-direct decrypt was already correct; this ADR
aligns the SSO statement with it.

The removed condition remains implicit through the **KMS key policy itself**:
each `Statement` in `kms.tf` enumerates the principals that may use the key.
`kms:ViaService` is a coarse-grained access-control guard useful when KMS is
called only via an integrating AWS service; the SOPS design explicitly uses
direct `kms:Decrypt`, so the guard does not apply.

## Consequences

### Positive

- SSO direct `kms:Decrypt` succeeds, matching the design contract.
- The key policy stays the **principal allowlist** (SSO / EC2 IAM role ARNs);
  coarse-grained IAM-side `Condition` blocks are no longer mixed in.
- `scripts/sops-decrypt.ts` can be exercised locally (`aws sso login` →
  `bun scripts/sops-decrypt.ts`) without bypassing the key policy.
- Auditable: `scripts/sops-decrypt.ts` already emits the `kms_arn` and
  `aws_caller_arn` for each call, so a CloudTrail + audit log cross-check can
  confirm only the three intended principal categories reach `kms:Decrypt`.

### Trade-off

- Any IAM principal that lands inside the SSO permission boundary
  (`role/aws-reserved/sso.amazonaws.com/ap-northeast-1/*`) can now call
  `kms:Decrypt` against the SOPS envelope key directly, not only via S3.
  This is the intended design surface; if SSO permission set tightening is
  later required, it belongs in the SSO permission set definitions, not in
  the KMS key policy.

### Mitigations (existing, no new change)

- The KMS key policy itself restricts which principals may use each key
  (`DecryptForSSO` and `DecryptForEC2` Statements, plus `RootAccountManage`).
  The IAM role boundary is the SSO permission set scope.
- `kms:Encrypt` is **not** granted to any of the SOPS loader principals
  (per spec §「暗号化 workflow (v1)」 line 188 — encrypt is developer-only).
  A decrypted principal still cannot re-encrypt arbitrary content under the
  same key.

### Re-evaluation trigger

- If CloudTrail shows `kms:Decrypt` from an SSO principal outside the SOPS
  loader workflow (e.g. console-driven decrypt of arbitrary ciphertext),
  tighten the SSO permission set first; do not re-introduce
  `kms:ViaService` (it would also block legitimate direct decrypt).
- If `kms:Encrypt` is ever needed by CI / OIDC (currently developer-only),
  file a separate ADR.

## References

- Commit: [`882541b`](https://github.com/rebuildup/tastile/commit/882541b) —
  `fix(sops): remove kms:ViaService condition blocking SSO direct KMS calls`
  (2026-08-27, 1 file changed, 1 deletion(-)).
- File: [`infra/sops/kms.tf`](../../../infra/sops/kms.tf) — current state
  after the removal (no `Condition` block in `DecryptForSSO`).
- Spec: [`docs/superpowers/specs/2026-08-27-sops-env-decryption-design.md`](../../superpowers/specs/2026-08-27-sops-env-decryption-design.md)
  §「IAM principals と KMS key policy」 (lines 169–182), §「暗号化 workflow (v1)」
  (lines 184–188).
- Runbook: [`docs/runbooks/sops-rollback.md`](../../runbooks/sops-rollback.md) —
  covers KMS Decrypt revocation path (§3). A one-line note about the
  `kms:ViaService` removal (and that re-introducing it would re-block SSO
  direct decrypt) could be appended to this runbook by a follow-up workstream
  — out of scope for this ADR.
- Loader: `scripts/sops-decrypt.ts` (Bun, `@aws-sdk/client-kms`) — the
  consumer that exercises the SSO direct decrypt path.

## Related ADRs

- ADR-0001 (Accepted, 2026-08-09): project-local AI agent toolchain — sets
  the convention that security-impacting changes ship behind an ADR.
- ADR-0005 (Accepted, 2026-08-23): Skills / Codex role canonical reference —
  establishes the Skills/MCP catalog that the SOPS loader tooling sits under.

## Retroactive note

This ADR was filed retroactively. Commit `882541b` shipped on 2026-08-27
without an ADR, which is a violation of `AGENTS.md` §「常時適用する不変条件」
("design / specification がある変更は、最終状態の design をユーザーと確定して
から 実装する。履歴は ADR に置く。"). The code review flagged the missing ADR
on 2026-09-05; this document restores the design history so subsequent
reviewers do not re-litigate the condition removal.
