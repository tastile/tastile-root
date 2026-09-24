# Infisical secrets migration design

## Goal

Make Infisical the canonical store for Tastile application, CI, signing, and deployment secrets across the workspace. Local and remote runs for a given service/environment must use the exact same Infisical project, environment, and path. Remove local secret files and per-system secret stores as authoritative sources; deployment platforms may hold synchronized runtime copies only where required by the platform.

## Current footprint

- Workspace root: SOPS/KMS decryption scripts and Terraform KMS/IAM resources; the root harness describes committed `.env.*.sops` plus SSM/Secrets Manager runtime delivery.
- `tastile-web`: tracked SOPS-encrypted development/production env files, SOPS age keys in GitHub Actions, quality/release workflows, and Cloudflare Worker deploy workflows.
- `tastile-core`: production and staging deploy workflows read runtime configuration from AWS Secrets Manager / SSM; EC2 runs the API and web services. AWS SSM remains useful as a deployment transport and is not itself a secret store.
- `tastile-android`: GitHub Actions secrets supply verification configuration, Android signing material, and Google Play service-account credentials.
- `tastile-desktop`: SOPS decryption workflow, local `.env.example`, GitHub release secrets for Cloudflare R2 publishing, and a GitHub token for the sibling core checkout.
- `tastile-brands`: no matching application secret-management workflow found in the initial inventory.
- A prior attempt removed six local `.env*` source files after an import operation, but no per-environment key parity or consumer validation was preserved. Treat their source deletion as unverified and the target as incomplete; recover missing values from their authoritative upstream stores. This does not authorize deletion of SOPS ciphertext, GitHub/AWS/platform copies, or any remaining source before its target and consumer checks pass.

## Proposed target

1. **Canonical store:** one Infisical project with environment slugs `dev`, `staging`, and `prod` (development, staging, production). Use stable service/integration paths, for example `/tastile/core`, `/tastile/web`, `/tastile/android/release`, and `/tastile/desktop/release`. Local dev and remote dev CI/runtime use the same `dev` environment/path; staging and production use their matching environment/path. Environment-specific values remain distinct where endpoints, database accounts, or providers differ.
2. **Developer machines:** Infisical CLI user login; every dev/test/build command runs through `infisical run` with an explicit project, environment, and path. A tool that requires dotenv on disk may use a permission-restricted, ignored file generated from Infisical after authentication; delete it after use. No local-only secret overrides. Remove SOPS decryption and committed ciphertext after the remote project has been populated and consumers pass.
3. **GitHub Actions:** workload identity federation using GitHub OIDC machine identities, scoped by repository, workflow/environment, and secret path. Replace GitHub Actions secret values with Infisical fetches. Keep only non-secret resource identifiers as GitHub variables. AWS deployment access continues to use GitHub OIDC → AWS IAM; that is workload authorization, not secret storage.
4. **AWS EC2 runtime:** AWS IAM machine identity auth from the instance profile; systemd starts services through `infisical run`, with no static Infisical token or secret-valued `EnvironmentFile`. Remove SSM Parameter Store / Secrets Manager copies of app secrets. Keep SSM Run Command as deployment transport. Runtime fetches the same environment/path as local and CI. Secret rotation takes effect on service restart unless a separate supported refresh mechanism is selected.
5. **Cloudflare Workers:** Infisical is the source of truth; deployment jobs fetch the exact matching environment/path through OIDC and update Worker runtime secrets as a synchronized deployment sink. Cloudflare retains runtime copies because Workers must receive their bindings; deployment must fail if sync is stale or incomplete.
6. **Android:** local verification and CI use the same development environment/path. CI fetches signing key/passwords and Play service-account material just in time from Infisical. No app runtime credential is embedded in the APK; public client IDs and service URLs remain build configuration.
7. **Desktop:** local builds and release workflows use the same environment/path for release publishing credentials. No runtime secret is embedded in desktop artifacts.
8. **RDS credentials:** store application database credentials in Infisical and provision/rotate the corresponding DB role from a controlled workflow. Remove AWS Secrets Manager as the credential source after verifying current production and staging RDS setup and rotation behavior.

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
2026-09-24, the self-hosted project was reachable at
`https://secrets.rebuildup.dev` and the local CLI user session was authenticated.
The `dev`, `staging`, and `prod` environments and the five service paths exist.
A value-name-only inventory found core dev/prod (8 keys each), web dev (15),
and desktop dev (6); staging is empty across services, as are web prod and all
Android environments. The web SOPS ciphertext and its GitHub age keys, other
GitHub/AWS/platform values, runtime cutovers, and legacy store removal remain
unresolved. Do not treat the migration as complete until the runbook checklist
has passed for every consumer.
