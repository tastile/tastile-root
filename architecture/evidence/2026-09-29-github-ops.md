# Evidence: GitHub delivery and operations state (2026-09-29)

> Read-only snapshot collected with `gh` (account rebuildup, org tastile). Live state is owned by GitHub
> (fd.work-state / fd.deployed-state); this file only records what was observed on 2026-09-29.

## Billing (org `tastile`, Free plan, 1 seat)

- Budgets: Actions **$2 hard cap** (block on reach); Codespaces / Packages / LFS $0.
- September 2026 gross usage: Linux 6,411 min, Windows 577 min, macOS 22 min, storage 1,848 GB-h; net spend ≈ $2.00.
- The cap was reached on 2026-09-26 (1,399 minutes that day). Only private repositories are billed:
  tastile-core used 2,148 Linux + 95 Windows minutes; tastile-blogs 26 minutes.
- Linux minutes by month: Jun 807, Jul 1,721, Aug 2,117, Sep 6,411.
- Legacy endpoint `/orgs/tastile/settings/billing/actions` returns 410; `/organizations/tastile/settings/billing/usage` works.

## Workflow outcomes (success / total, recent runs)

| repository | workflow | success | notes |
| --- | --- | --- | --- |
| core | CI | 59 / 215 | successful median ≈ 20 min; every run since 2026-09-26 17:06 UTC fails in ≈ 4 s with 0 steps ("Actions budget is preventing further use") |
| core | Deploy staging | 6 / 29 | successful median ≈ 43 min |
| core | Deploy (production) | 3 / 12 | last success 2026-08-22; median ≈ 45 min |
| core | Verify Infisical OIDC | 3 / 25 | |
| web | Deploy | 0 / 11 | tag vs package.json version mismatch; SSM exit 2; wait-for-deployment |
| web | Cloudflare preview / staging | 0 / 11, 0 / 12 | mostly cancelled waiting for environment approval |
| web | Verify Infisical OIDC | 4 / 18 | |
| web | quality | 58 / 72 | median 190 s; recent failures `bun install --frozen-lockfile` |
| web | release-source check | 11 / 37 | fails on Dependabot branches (branch naming rule) |
| android | Verify | 84 / 190 | median ≈ 11 min; lint + emulator canary failures |
| android | Release | 4 / 34 | v0.6.0 Play upload: "Version code 33 has already been used" |
| desktop | CI | 102 / 149 | median ≈ 4.5 min |
| desktop | Release | 6 / 22 | 2026-09-27 R2 upload `digest-mismatch` |
| desktop | sops-decrypt | 0 / 33 | legacy |
| cli | ci | 19 / 20 | median 89 s |
| root | quality gate | 53 / 61 | median 15 s |
| openapi | openapi-validate | 0 / 3 | Redocly `no-empty-servers`, `operation-summary` |

## Versioning observed

core v1.0.1 (tags v0.5.0–v0.6.0 without releases), web v1.0.2 / v1.0.3 / v1.0.4 (all 2026-09-27), cli v1.0.0,
openapi v1.0.1 (tags only), android v0.6.0 (plus malformed `vv0.2.9`), desktop v0.6.0.0 (four-part mixed with
three-part), root v0.1.45, brands none.

## Protection

- tastile-core: branch protection / rulesets unavailable (403, private repo on Free plan) — **main unprotected**.
- tastile-web: classic protection (0 approvals, conversation resolution, no force push), all merge methods allowed.
- android / desktop / openapi: rulesets (no deletion / force-push, PR required, merge commits only).

## Open infrastructure issues (titles abbreviated)

- core: #189 deploy without Actions, #186 v1.0.2 readiness, #185 / #159 delivery secrets migration, #174 Actions failures,
  #152 RDS credential to Infisical, #150 production HTTP 500 (deliveries read), #141 Infisical OIDC, #137 AWS staging.
- web: #161 deploy hardening, #142 Infisical OIDC / SOPS removal, #140 Better Auth fail-closed, #132 Workers preview / staging,
  #131 tag script vs squash merges, #128 proxy resolves to localhost, #126 version SoT.
- root: #34 Cloudflare / AWS split + staging, #35 Infisical cleanup, #44 move OpenAPI / secrets ownership to child repositories.
- android: #10 signed distribution; desktop: #26 downloads to R2, #41 R2 object drift.

## Other

- Projects v2 could not be read (token lacks `read:project`); status is visible only via `status:*` labels.
- tastile-ios / tastile-mac: 1 KB placeholder repositories (initial commit only).
