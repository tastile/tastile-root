# ADR-0006: Remove `kms:ViaService` condition from the SOPS KMS key policy (superseded)

- Date: 2026-09-05 (retroactive record of the 2026-08-27 change)
- Status: Superseded by [ADR-0012](./0012-infisical-secrets-source-of-truth.md)
- Historical scope: the former SOPS envelope KMS key policy

> This ADR records a retired implementation decision. It is not an operational
> guide. Do not restore the SOPS loader, ciphertext, KMS resources, or decrypt
> permissions described here. Current secret storage and recovery follow
> ADR-0012 and [the Infisical runbook](../runbooks/infisical-setup.md).

## Historical context

In August 2026, the workspace used SOPS-encrypted dotenv files with a KMS
envelope key. Developer SSO, GitHub Actions OIDC, and EC2 roles called KMS
directly to decrypt those files. A `kms:ViaService = s3.<region>.amazonaws.com`
condition therefore rejected legitimate direct calls.

## Historical decision

Commit [`882541b`](https://github.com/rebuildup/tastile/commit/882541b)
removed that condition from the then-existing SSO statement. The rationale was
that `kms:ViaService` is suitable for KMS calls made through S3, while the
retired SOPS workflow used direct `kms:Decrypt` calls. This decision changed
the behavior of the old key policy only; it does not authorize any current
secret access.

## Current status

ADR-0012 replaces the SOPS/KMS secret-management model with self-hosted
Infisical. The migration removes the old loader, ciphertext, KMS/Terraform
resources, and related operational instructions after consumer cutover. Use
the Infisical runbook for the current migration state and recovery procedure.

## Related decisions

- [ADR-0012: Infisical as the source of truth for secrets](./0012-infisical-secrets-source-of-truth.md)
- [ADR-0007: Release branch and ticket workflow](./0007-release-branch-and-ticket-workflow.md)
