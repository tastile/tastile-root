# ADR-0012: Infisical is the workspace secrets source of truth

- Status: Accepted
- Date: 2026-09-23
- Scope: tastile-root, tastile-core, tastile-web, tastile-android, tastile-desktop, tastile-brands

## Context

Secrets are currently spread across root SOPS/KMS tooling, web and desktop SOPS ciphertext, developer `.env*` / `local.properties` files, GitHub Actions secrets, AWS SSM Parameter Store / Secrets Manager, EC2 `EnvironmentFile`s, and Cloudflare Worker/R2 configuration. This allows local and remote runs to silently use different values and makes rotation require updating several copies.

The user requires one remote source of truth and the same secrets to be available locally and remotely after authenticating to Infisical.

## Decision

1. The user's self-hosted Infisical instance is the canonical source for all Tastile repository secrets and runtime configuration that must remain private. It uses a single Infisical project with environment slugs `dev`, `staging`, and `prod` (development, staging, production) and stable service paths (`/tastile/core`, `/tastile/web`, `/tastile/android`, `/tastile/desktop`, `/tastile/brands`, plus narrowly scoped integration paths). Its public HTTPS hostname is a generic host owned by the user and must not include `tastile`.
2. Every local command and remote workload selects the same explicit project, environment, and service path. A given service/environment has one value set. Local `.env*`, `local.properties`, checked-in ciphertext, and `*.example` env templates are not sources or fallback stores. A tool that requires a dotenv file may use a temporary, permission-restricted file generated from Infisical after authentication; delete it after use. Non-secret public build configuration may remain in source or platform variables; required keys are enforced by application validation and documented in the service's Infisical path contract.
3. Developer machines authenticate interactively with Infisical CLI. Application commands use `infisical run` and fail closed when authentication or secret retrieval fails.
4. GitHub Actions authenticate to Infisical with GitHub OIDC machine identities restricted by repository, workflow/environment, and secret path. No Infisical client secret, SOPS key, signing material, provider credential, or app secret is stored in GitHub Actions. GitHub's short-lived `GITHUB_TOKEN` remains an execution-provided token. AWS deployment authorization continues to use GitHub OIDC roles.
5. EC2 services authenticate with AWS IAM machine identities from instance profiles and fetch their configuration from Infisical at service start. Secret values are not provisioned to EC2 via SSM parameters, SSM command payloads, or persistent `EnvironmentFile`s. AWS SSM may continue as an authenticated deployment/control channel. If Infisical cannot be reached, service startup fails rather than using stale local copies.
6. Platforms that require secrets to be installed as runtime bindings (Cloudflare Workers, Android release signing, Google Play upload, and Cloudflare R2 publishing) receive narrowly scoped values from Infisical during the authenticated job/deploy. Such values are deployment/runtime replicas only; Infisical remains the sole editable source and workflows must overwrite or validate the target on every relevant deploy.
7. RDS application credentials are held only in Infisical and applied to the matching database role through a controlled deployment/rotation path. AWS-managed RDS master credentials are not copied into the application secret path. Remove AWS Secrets Manager use only after production and staging DB role rotation and recovery are operational.
8. Values are migrated directly into Infisical without emitting them to logs, commits, or artifacts. Old stores, ciphertext, and access policies are removed only after an environment-by-environment live read/deploy/startup check succeeds.

## Consequences

- Local and remote runs for the same environment are consistent, and all application secrets have one audited edit/rotation point.
- Every developer must install Infisical CLI, authenticate, and select an authorized environment. Local builds and application starts require network access to Infisical; no offline secret fallback is supported.
- Infisical project ID and machine identity IDs are non-secret references and may be committed or stored as GitHub variables. They must be provisioned before integrations can pass.
- The self-hosted instance's canonical HTTPS hostname and project ID must be explicitly configured; clients and actions must pass them and fail closed when they are absent. They must never silently default to Infisical Cloud.
- Cloudflare and release platforms necessarily receive temporary or runtime copies. Their values can be stale until the sync workflow completes, so every change must trigger or include a sync and report its status.
- Secret changes on EC2 take effect when services restart unless a later approved refresh mechanism is implemented.
- This ADR changes workspace env policy and supersedes root HARNESS §6-4's SOPS/KMS + SSM/Secrets Manager model and root ADR-0006's SOPS/KMS-specific decision. ADR-0006 remains a historical record; its access design is retired after cutover.

## Migration completion criteria

- All five repositories and deployment workflows use explicit Infisical project/environment/path selection.
- Local dev/test/build/release commands that need secrets use authenticated Infisical injection and have no `.env` or platform-specific secret fallback.
- GitHub Actions, EC2, Cloudflare, Android release, desktop release, RDS app role, and database tooling read from Infisical or receive a verified synchronized value from it.
- SOPS/KMS code, age keys, committed ciphertext, runtime SSM/Secrets Manager app-secret copies, local secret files, and long-lived GitHub secret copies are removed after successful live migration checks.
- No secret value is present in source, docs, job logs, output artifacts, or process arguments.
