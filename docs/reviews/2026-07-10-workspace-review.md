# Tastile Workspace Code Review — 2026-07-10

## Scope

Canonical repositories reviewed:

- `tastile-core`
- `tastile-web`
- `tastile-android`
- `tastile-desktop`
- `tastile-brands`

The root repository supplies the cross-repository harness. Clone/worktree copies such as
`tastile-core.wslc` and `*.avatar` are intentionally excluded. Existing user changes were
treated as owned work and preserved.

## Success criteria

1. Every repository has one deterministic local quality gate.
2. The root can run all gates, keep going after a failure, retry only a bounded number of
   times, persist JSON evidence, and distinguish code failures from missing infrastructure.
3. Security-sensitive identity and secret boundaries fail closed.
4. Release metadata and artifacts are verified against what is actually shipped.
5. A fresh operator can reproduce the loop from `README.md` and `docs/HARNESS.md`.

## Material findings and remediation

### Critical

- **Web identity could be selected from unsigned cookies or decoded, unverified JWT claims.**
  All account, proxy, event, billing, Stripe, callback, email, MFA, and profile paths now use
  a single Cognito access-token verifier backed by `/oauth2/userInfo`; invalid or unavailable
  verification fails closed.
- **A server bridge secret could enter a Web deployment artifact and Android APK.** Web build
  artifacts are scanned before upload, the workflow no longer copies the bridge secret, and
  Android now presents the Cognito access token to a server-side token-mint endpoint instead
  of embedding a server credential.
- **Avatar upload and commit stubs returned fake success.** Authenticated requests now return
  explicit HTTP 501 retryable errors until storage is implemented.

### Important

- **Core's PowerShell gate could report success after a native command failed.** Native exit
  codes are now propagated, tested with a fake Cargo executable, and PostgreSQL absence is
  reported early as BLOCKED (exit 2).
- **AT-012 conflict resolution implemented last-wins behavior for equal key/layer/rank.** The
  resolver now blocks every conflicting override in that bucket; six acceptance tests cover
  the invariant.
- **Web release checks omitted formatter, dependency audit, and a reliably isolated product
  build.** `check:release` now runs Biome, ESLint, TypeScript, unit tests, production audit,
  and a wrapper that temporarily removes local Next.js env files and restores them in `finally`.
- **Web dependencies included known production advisories.** Next.js was updated to 16.2.9
  and the production dependency graph now audits clean.
- **Android CI omitted lint/design/secret guards.** A repository `verify` task now owns those
  checks and CI invokes it; JDK 17/21 is selected by the root harness.
- **Desktop release metadata drifted and the updater required a hash that release output did
  not guarantee.** Version sources are synchronized and release automation compares local,
  published-manifest, and downloaded-installer SHA-256 values.
- **Brands had no executable reproducibility gate.** `bun run verify` regenerates and verifies
  the exact 56 PNG inventory, dimensions, ICO header/count, and a clean generated diff.
- **No workspace-level bounded convergence loop existed.** `scripts/check-workspace.ps1`
  now provides fast/full profiles, keep-going, bounded retries, JSON evidence, repository
  selection, and status-aware exit codes.

## Verification evidence

| Scope | Command | Result |
| --- | --- | --- |
| Root harness contract | `pwsh -NoProfile -File scripts/tests/check-workspace-test.ps1` | PASS |
| Workspace fast | `pwsh -NoProfile -File scripts/check-workspace.ps1 -Profile fast -KeepGoing` | 5/5 PASS |
| Core domain | `cargo test -p domain` | 149/149 PASS |
| Core AT-012 | `cargo test -p domain at_012` | 6/6 PASS |
| Web release | `bun run check:release` | 62 files / 316 tests, audit and production build PASS |
| Android full | `gradlew.bat verify assembleDebug --no-daemon` | 65 tasks PASS |
| Desktop full | `pwsh -NoProfile -File scripts/check.ps1` | 188 tests and two builds PASS |
| Brands | `bun run verify` | PASS |

## Residual blocker and risks

- The current machine has no configured PostgreSQL URL, so the Core **full** workspace gate
  is correctly BLOCKED with exit code 2. Set `TASTILE_DATABASE_URL` or `DATABASE_URL` to an
  isolated reachable test database and rerun the full harness; this is not treated as green.
- Avatar upload remains intentionally unavailable (HTTP 501) until a real storage transaction
  is implemented. The former false-success data-loss behavior is removed.
- This review does not deploy, publish, rotate credentials, or mutate external infrastructure.

## Operator loop

Run the fast profile during development. Before release, run the full profile with a JSON
result path. Fix status `failed`, provision prerequisites for status `blocked`, and rerun.
Stop only when every selected repository reports `passed` or an explicitly owned external
blocker has been recorded with a follow-up owner.
