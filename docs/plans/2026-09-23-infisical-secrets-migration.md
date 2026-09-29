# Infisical secrets migration design

> This is the initial design and migration history, not the current runbook.
> ADR-0012 supersedes its SOPS/KMS handling. Use
> [`docs/runbooks/infisical-setup.md`](../runbooks/infisical-setup.md) and
> GitHub issue #35 for current state and remaining actions. Do not use this
> document's dated inventories or draft-PR status as current evidence.

## Goal

Make Infisical the canonical store for Tastile application, CI, signing, and deployment secrets across the workspace. Local and remote runs for a given service/environment must use the exact same Infisical project, environment, and path. Remove local secret files and per-system secret stores as authoritative sources; deployment platforms may hold synchronized runtime copies only where required by the platform.

## Initial footprint (2026-09-23)

- Workspace root: SOPS/KMS decryption scripts and Terraform KMS/IAM resources; the root harness describes committed `.env.*.sops` plus SSM/Secrets Manager runtime delivery.
- `tastile-web`: tracked SOPS-encrypted development/production env files, SOPS age keys in GitHub Actions, quality/release workflows, and Cloudflare Worker deploy workflows.
- `tastile-core`: production and staging deploy workflows read runtime configuration from AWS Secrets Manager / SSM; EC2 runs the API and web services. AWS SSM remains useful as a deployment transport and is not itself a secret store.
- `tastile-android`: GitHub Actions secrets supply verification configuration, Android signing material, and Google Play service-account credentials.
- `tastile-desktop`: SOPS decryption workflow, local `.env.example`, GitHub release secrets for Cloudflare R2 publishing, and a GitHub token for the sibling core checkout.
- `tastile-brands`: no matching application secret-management workflow found in the initial inventory.
- A prior attempt removed six local `.env*` source files after an import operation, but no per-environment key parity or consumer validation was preserved. Treat their source deletion as unverified and the target as incomplete; recover missing values from their authoritative upstream stores. This does not authorize deletion of SOPS ciphertext, GitHub/AWS/platform copies, or any remaining source before its target and consumer checks pass.

## Approved target

1. **Canonical store:** use one Infisical project per environment (`tastile-dev`, `tastile-staging`, `tastile-prod`) because this self-hosted Free instance does not provide folder-level ACLs. Each project uses the corresponding `dev`, `staging`, or `prod` slug and stable service paths such as `/tastile/core` and `/tastile/web`. The shell/root repository has no runtime project or secrets.
2. **Developer machines:** Infisical CLI user login; every dev/test/build command runs through `infisical run` with an explicit project, environment, and path. A tool that requires dotenv on disk may use a permission-restricted, ignored file generated from Infisical after authentication; delete it after use. No local-only secret overrides. Remove SOPS decryption and committed ciphertext after the remote project has been populated and consumers pass.
3. **GitHub Actions:** use one OIDC machine identity per environment project. The self-hosted UI cannot restrict these identities by path, so Viewer grants access to all paths in that environment project and must not cross environment boundaries. Replace secret values with Infisical fetches; keep public resource identifiers as GitHub variables. AWS deployment access continues to use GitHub OIDC → AWS IAM.
4. **AWS EC2 runtime:** use short-lived AWS IAM machine identity auth from the instance profile. Core systemd services retrieve Core and DB project values through separate identities; Web retrieves `/tastile/web`. Remove app-secret SSM parameters, Secrets Manager copies, and `EnvironmentFile`s after live cutover. Keep SSM Run Command as deployment transport.
5. **Cloudflare Workers:** Infisical is the source of truth; deployment jobs fetch the exact matching environment/path through OIDC and update Worker runtime secrets as a synchronized deployment sink. Cloudflare retains runtime copies because Workers must receive their bindings; deployment must fail if sync is stale or incomplete.
6. **Android:** local verification and CI use the same development environment/path. CI fetches signing key/passwords and Play service-account material just in time from Infisical. No app runtime credential is embedded in the APK; public client IDs and service URLs remain build configuration.
7. **Desktop:** local builds and release workflows use the same environment/path for release publishing credentials. No runtime secret is embedded in desktop artifacts.
8. **RDS credentials:** keep application database credentials in isolated prod/staging DB runtime projects with matching EC2 AWS Auth identities; do not grant GitHub identities DB project access. Provision least-privilege DB roles and verify rotation before removing old sources. Do not copy AWS-managed RDS master credentials into application paths.

## Boundaries

- Keep AWS OIDC roles, SSM Run Command, S3 artifact transport, Cloudflare/Google deployment APIs, and non-secret IDs/configuration where required. These are access/deployment mechanisms, not canonical secret stores.
- Do not echo or commit secret values. Secret migration must transfer values directly from the existing source to Infisical without printing them.
- Do not revoke old stores or delete ciphertext until Infisical authentication, all target environments, and service/deploy consumers have been verified. Then remove the old copies and access policies.
- Preserve existing uncommitted changes in `tastile-web` and untracked skill files in `tastile-android`.

## Confirmed user constraints and remaining external setup

The user confirmed that the scope is all repositories and that local and remote
consumers must use one remote source after Infisical authentication. The
environment set is development / staging / production, and copies required by
runtime platforms are removed only after live cutover checks.

The prior Infisical Cloud project was used as a migration source. On
2026-09-24, the self-hosted instance was reachable at
`https://secrets.rebuildup.dev` and the local CLI user session was authenticated.
On 2026-09-25, dev restore checks passed for core (8 keys), web (15), Android
(4), and desktop (6). Core prod (8), Web staging/prod (13/33), and Android prod
(9) also restored successfully. The four child `.env.example` files were then
regenerated from development exports with the same key names and blank values;
generated dotenv files were removed. Web local tests (154 files / 1172 tests)
and an Infisical-backed production build passed.

Draft PRs are published for the root setup (#36), Core runtime (#142), and Web
migration (#147). The migration is not complete: their external OIDC/runtime
checks and cutovers have not passed, and the production/staging DB paths plus
several service environment paths remain empty. GitHub still reports the Web
`sops-decrypt` and one-shot `patch-stripe-env` workflows as active on its default
branch, and `SOPS_AGE_KEY_*` repository secrets remain. The user authorized
adding both DB runtime identities to their matching Core projects. After
re-login, both project access dialogs returned `No options`; the identities
are project-managed and cannot be reassigned via the current UI. No SOPS keys,
old secret copies, or AWS application secrets have been deleted. Do not treat
the migration as complete until each remaining consumer in the runbook has
passed.

Latest value-free reconciliation against the legacy self-hosted `tastile`
project confirms identical Core dev/prod (8 keys each), Web dev (15), Android
dev/prod (4/9), and Desktop dev (6) targets. Legacy Core staging, Web staging,
Android staging, and Desktop staging/prod source paths are empty. Web prod has
23 source keys and 33 target keys; the target contains ten additional keys, and
the shared `TASTILE_WEB_BRIDGE_SECRET` differs. Keep the target value pending
consumer/rotation verification and retain the old project. The migration helper
now permits a value-checked source subset during `-VerifyOnly`, but imports
still refuse non-empty targets.
