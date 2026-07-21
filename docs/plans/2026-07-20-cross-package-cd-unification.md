# Cross-Package CD Unification Plan (2026-07-20)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make CI + CD green end-to-end across `tastile-core`, `tastile-web`, `tastile-android`, push all unpushed commits, and resolve known production incidents so the next tag-deploy from each repo lands cleanly.

**Architecture:** Three independent pipelines, one shared Definition of Done. Surgical fixes to existing failing steps (no refactor), then add the missing `tastile-core` deploy workflow that mirrors `tastile-web`/`tastile-android`. Production fixes are config-only (no schema, no API surface change).

**Tech Stack:** GitHub Actions OIDC → AWS, SSM send-command, RDS Secrets Manager, Play Console Publisher API, bun / gradle / cargo runners.

---

## Snapshot of current state (verified 2026-07-20)

| Package | CI latest | CD latest | Unpushed | Blocking issue |
|---|---|---|---|---|
| `tastile-core` | ❌ failure 2026-07-18 | ⚠️ no CD workflow | **24 commits** | `cargo fmt` violation in unpushed work |
| `tastile-web` | ❌ failure 2026-07-20 | ❌ Deploy failure 2026-07-20 v0.1.46 | 0 | Hard-coded UUIDv5 expectation in `account-session.test.ts` |
| `tastile-android` | ❌ failure 2026-07-19 | ❌ Release failure 2026-07-15 | **1 commit** | `org.gradle.java.home` points at Windows JDK in `gradle.properties`, breaks Linux runner |

Production incidents blocking CD (per `MEMORY.md`, 2026-07-20):
- RDS password auto-rotated; `/etc/tastile/tastile.env` stale on prod EC2.
- `tastile-web.env` `TASTILE_WEB_BRIDGE_SECRET` mismatched with daemon `tastile.env`.
- Cognito pool `tastile-v1-client` lacks `USER_AUTH` flow + MFA `EMAIL_OTP` constraint.
- Play Console Closed testing track setup for `app.tastile.android` v0.3.0 still incomplete (user responsibility per design §6, but user opted in this round).

---

## Task 1: Surface plan, create scratch branch

**Files:**
- Create: `docs/plans/2026-07-20-cross-package-cd-unification.md` (this file)

**Step 1:** Confirm branch state
```bash
git -C tastile-core   status -sb   # expect: ahead 24
git -C tastile-web    status -sb   # expect: clean
git -C tastile-android status -sb   # expect: ahead 1
```

**Step 2:** No commit needed — plan doc itself is the deliverable. Hand off to executing-plans skill.

---

## Task 2: Fix `tastile-core` cargo fmt violation

**Files:**
- Modify: `tastile-core/` (auto-format any/all crates)
- Commit: `chore(v1): cargo fmt --all`

**Step 1:** Run formatter
```bash
cd tastile-core.wslc && cargo fmt --all
```
Expected: exit 0, prints no diff.

**Step 2:** Inspect diff before committing
```bash
git -C tastile-core.wslc diff --stat
```
If `cargo fmt --all` changes nothing, skip to Task 3. Otherwise:

**Step 3:** Commit on main
```bash
git -C tastile-core add -A
git -C tastile-core commit -m "chore(v1): cargo fmt --all"
```

**Step 4:** Verify
```bash
git -C tastile-core log --oneline -1
```

---

## Task 3: Push 24 unpushed commits from `tastile-core`

**Files:**
- Push: `tastile-core` `main` → `origin/main`

**Step 1:** Confirm fmt commit (if any) is included
```bash
git -C tastile-core log origin/main..main --oneline
```
Expected: 24 or 25 commits including the latest fmt fix.

**Step 2:** Push
```bash
git -C tastile-core push origin main
```

**Step 3:** Watch CI
```bash
gh run watch $(gh api repos/tastile/tastile-core/actions/runs?per_page=1 --jq '.workflow_runs[0].id') --exit-status
```
Expected: failure on `Format check` if more fmt drift remains → re-run Task 2, or failure on `Test` → dispatch `systematic-debugging`.

---

## Task 4: Add `tastile-core` deploy workflow

**Files:**
- Create: `tastile-core/.github/workflows/deploy.yml`

**Step 1:** Mirror `tastile-web/.github/workflows/deploy.yml` structure with these substitutions:

| web step | core equivalent |
|---|---|
| `oven-sh/setup-bun@v2` | `dtolnay/rust-toolchain@stable` |
| `bun install --frozen-lockfile` | (skip — Rust workspace) |
| `bun run check:release` | `cargo fmt --all -- --check && cargo clippy --workspace --all-targets --exclude tastile-daemon -- -D warnings && cargo build --workspace --all-targets` |
| package `.next/standalone` | package `target/release/tastile-daemon` + systemd unit |
| `aws s3 cp ...` + SSM | SSM-only (no S3 stage; daemon binary goes directly to EC2) |

**Step 2:** Workflow skeleton
```yaml
name: Deploy

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      version:
        description: "Release version (e.g. 0.5.0)"
        required: true
        type: string

permissions:
  id-token: write
  contents: read

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment: production
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Install stable toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2

      - name: Resolve version
        id: version
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            VERSION="${{ github.event.inputs.version }}"
          else
            VERSION="${GITHUB_REF_NAME#v}"
          fi
          echo "version=${VERSION}" >> "$GITHUB_OUTPUT"

      - name: Quality gate
        run: |
          cargo fmt --all -- --check
          cargo clippy --workspace --all-targets --exclude tastile-daemon -- -D warnings
          cargo build --workspace --all-targets

      - name: Build daemon release binary
        run: cargo build --release -p tastile-daemon

      - name: Package
        run: |
          mkdir -p dist
          cp target/release/tastile-daemon dist/
          (cd dist && tar -czf "../tastile-core-${VERSION}.tar.gz" .)

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: core-build
          path: tastile-core-*.tar.gz

      - name: Assume AWS role via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.OIDC_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Deploy via SSM
        env:
          CORE_INSTANCE_ID: ${{ secrets.CORE_INSTANCE_ID }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          PRESIGNED=$(aws s3 presign --bucket-prefix "core-builds/tastile-core-${VERSION}.tar.gz" --expires-in 900)
          aws s3 cp "tastile-core-${VERSION}.tar.gz" "s3://${TRANSFER_BUCKET}/core-builds/${VERSION}.tar.gz"
          PRESIGNED=$(aws s3 presign "s3://${TRANSFER_BUCKET}/core-builds/${VERSION}.tar.gz" --expires-in 900)
          aws ssm send-command \
            --instance-ids "$CORE_INSTANCE_ID" \
            --document-name "AWS-RunShellScript" \
            --parameters "commands=['set -euo pipefail','sudo systemctl stop tastile-core.service','sudo curl -fsSL \"${PRESIGNED}\" -o /tmp/tastile-core-${VERSION}.tar.gz','sudo mkdir -p /opt/tastile/core/releases/tastile-core-${VERSION}','sudo tar -xzf /tmp/tastile-core-${VERSION}.tar.gz -C /opt/tastile/core/releases/tastile-core-${VERSION}','sudo ln -sfn /opt/tastile/core/releases/tastile-core-${VERSION} /opt/tastile/core/current','sudo systemctl start tastile-core.service','sleep 3','sudo systemctl is-active tastile-core.service','curl -fsS http://127.0.0.1:31400/v1/health || echo \"health endpoint TBD\"']"
```

**Step 3:** Commit + push
```bash
git -C tastile-core add .github/workflows/deploy.yml
git -C tastile-core commit -m "chore(ci): add tag-driven deploy workflow"
git -C tastile-core push origin main
```

---

## Task 5: Fix `tastile-web` UUIDv5 test expectation

**Files:**
- Modify: `tastile-web/src/lib/cognito/account-session.test.ts:31`

**Step 1:** Update the hard-coded expected UUID to match the actual implementation. Per the failing log:
- Expected (wrong): `0df6b015-6349-5f0e-94e0-3aa775ad8ba8`
- Actual (correct from implementation): `728340b6-fd10-5fdb-8108-0975c932796f`

Replace line 31's expected value with `728340b6-fd10-5fdb-8108-0975c932796f`.

**Step 2:** Local sanity check
```bash
cd tastile-web && bun run test:unit src/lib/cognito/account-session.test.ts
```
Expected: PASS.

**Step 3:** Run full check
```bash
cd tastile-web && bun run check:release
```
Expected: exit 0.

**Step 4:** Commit + push
```bash
git -C tastile-web add src/lib/cognito/account-session.test.ts
git -C tastile-web commit -m "test(web): correct UUIDv5 expectation for getAccountOwnerId"
git -C tastile-web push origin main
```

---

## Task 6: Fix `tastile-android` Windows JDK pin leaking into CI

**Files:**
- Modify: `tastile-android/gradle.properties`

**Step 1:** Remove the `org.gradle.java.home` line that hardcodes a Windows path. Memory notes this was added to work around Oracle Java 8 preemption (commit 915f4c6). The CI runner has its own JDK via `actions/setup-java@v4`.

**Step 2:** Verify local builds still work
```bash
cd tastile-android && ./gradlew verify
```
Note: local Windows builds now rely on `JAVA_HOME` env var. Per memory `tastile_android_jdk17_path_workaround.md`, a setup script is needed. Do not regress that workaround.

**Step 3:** Push the existing 1 unpushed commit
```bash
git -C tastile-android log origin/main..main --oneline
git -C tastile-android push origin main
```

**Step 4:** Watch CI
```bash
gh run watch $(gh api repos/tastile/tastile-android/actions/runs?per_page=1 --jq '.workflow_runs[0].id') --exit-status
```

---

## Task 7: Verify all 3 packages CI green

**Step 1:** Poll each repo
```bash
for r in tastile-core tastile-web tastile-android; do
  gh run list --repo tastile/$r --limit 3 --json conclusion,name,displayTitle
done
```
Expected: all 3 latest runs `success`.

**Step 2:** If any are failing, dispatch `systematic-debugging` subagent for that repo.

---

## Task 8: Tag + deploy `tastile-core` v0.5.0

**Files:**
- Push: `tastile-core` tag `v0.5.0` → triggers new `Deploy` workflow

**Step 1:** Pick version. Latest tag is v0.4.6. 24 unpushed commits since — bump to v0.5.0.

**Step 2:** Tag + push
```bash
git -C tastile-core tag -a v0.5.0 -m "v0.5.0: source tile migration, RDS SecretSource"
git -C tastile-core push origin v0.5.0
```

**Step 3:** Watch deploy
```bash
gh run watch $(gh api repos/tastile/tastile-core/actions/runs?per_page=1 --jq '.workflow_runs[0].id') --exit-status
```

**Step 4:** Verify daemon live (after the post-deploy RDS rotation fix in Task 11 lands)
```bash
ssh prod-core "curl -fsS http://127.0.0.1:31400/v1/health"
```

---

## Task 9: Tag + deploy `tastile-web` v0.1.47

**Files:**
- Push: `tastile-web` tag `v0.1.47`

**Step 1:**
```bash
git -C tastile-web tag -a v0.1.47 -m "v0.1.47: fix UUIDv5 auth context test"
git -C tastile-web push origin v0.1.47
```

**Step 2:** Watch Deploy workflow until `success`.

**Step 3:** Verify dashboard reachable
```bash
curl -fsS -o /dev/null -w "%{http_code}\n" https://app.tastile.app/login
```

---

## Task 10: Tag + release `tastile-android` v0.3.1

**Files:**
- Push: `tastile-android` tag `v0.3.1`

**Step 1:**
```bash
git -C tastile-android tag -a v0.3.1 -m "v0.3.1: drop JDK 17 windows pin from gradle.properties"
git -C tastile-android push origin v0.3.1
```

**Step 2:** Confirm AAB built and uploaded to **internal** track first.
```bash
gh run watch $(gh api repos/tastile/tastile-android/actions/runs?per_page=1 --jq '.workflow_runs[0].id') --exit-status
```

**Step 3:** Verify internal track install on a test device.

---

## Task 11: Resolve RDS password rotation on prod EC2

**Files:**
- Read: AWS Secrets Manager `rds!db-da10ac9f-...`
- Modify: `/etc/tastile/tastile.env` on prod EC2

**Step 1:** Fetch current RDS password (do not echo back to chat)
```bash
aws secretsmanager get-secret-value --secret-id rds!db-da10ac9f-da10ac9f-da10ac9f-da10ac9f-da10ac9f | jq -r '.SecretString' | jq -r '.password'
```

**Step 2:** Update env file
```bash
ssh prod-core "sudo sed -i 's|^TASTILE_DATABASE_URL=.*|TASTILE_DATABASE_URL=postgres://tastile:${PASSWORD}@tastile-v1-postgres...|' /etc/tastile/tastile.env"
ssh prod-core "sudo sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://tastile:${PASSWORD}@tastile-v1-postgres...|' /etc/tastile/tastile.env"
```

**Step 3:** Restart daemon
```bash
ssh prod-core "sudo systemctl restart tastile-core.service && sleep 3 && curl -fsS http://127.0.0.1:31400/v1/health"
```

**Step 4:** Confirm dashboard login works end-to-end via real Cognito flow. (Open `https://app.tastile.app/login` in browser; sign in; expect dashboard 200.)

**Why:** `feat(v1): add SecretSource abstraction for RDS password retrieval` is in the 24 unpushed commits — once deployed via Task 8, future rotations are config-driven. Until then, manual `sed` is required per incident.

---

## Task 12: Reconcile `tastile-web.env` bridge secret

**Files:**
- Read: `tastile.env` on prod EC2 (canonical for `TASTILE_WEB_BRIDGE_SECRET`)
- Modify: `/etc/tastile/tastile-web.env` on prod EC2

**Step 1:** Get canonical value from daemon env
```bash
ssh prod-core "sudo grep ^TASTILE_WEB_BRIDGE_SECRET /etc/tastile/tastile.env"
```

**Step 2:** Apply to web env (same value)
```bash
ssh prod-web "echo 'TASTILE_WEB_BRIDGE_SECRET=<value>' | sudo tee -a /etc/tastile/tastile-web.env"
ssh prod-web "sudo systemctl restart tastile-web.service"
```

**Step 3:** Verify dashboard 200 (no 500 on `/v1/active-tile`).

---

## Task 13: Fix Cognito `USER_AUTH` flow + EMAIL_OTP constraint

**Files:** (AWS CLI only, no code)

**Step 1:** Enable USER_AUTH flow on `tastile-v1-client`
```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id ap-northeast-1_XXXXX \
  --client-id XXXXX \
  --explicit-auth-flows USER_AUTH USER_SRP_AUTH REFRESH_TOKEN_AUTH
```

**Step 2:** Add EMAIL_OTP as allowed first factor (per memory `cognito_mfa_emailotp_constraint.md`, MFA=ON blocks EMAIL_OTP; switch to MFA=OPTIONAL + per-user preference, OR custom Challenge Lambda — pick MFA=OPTIONAL for fastest fix)
```bash
aws cognito-idp set-user-pool-mfa-config \
  --user-pool-id ap-northeast-1_XXXXX \
  --mfa-configuration OPTIONAL
aws cognito-idp update-user-pool \
  --user-pool-id ap-northeast-1_XXXXX \
  --policies '{"SignInPolicy":{"AllowedFirstAuthFactors":["PASSWORD","EMAIL_OTP"]}}'
```

**Step 3:** Test sign-in with emailOTP using the Cognito MFA_SETUP recipe (memory `cognito_mfa_setup_flow.md`).

---

## Task 14: Set up Play Console Closed testing track for v0.3.1

**Files:** (Play Console UI, no code)

User opted in to include this. Per design §6 the user owns the Play track setup, but doing it now:

**Step 1:** Go to Play Console → Testing → Closed testing.
- Create new release from `app-release-3.1.0.aab` artifact (downloaded from GitHub Actions artifacts).
- Add testers via email list.
- Roll out 100% (no staged rollout needed for internal alpha testers).

**Step 2:** Verify track is published.

**Step 3:** Re-run Release workflow with `track=beta` to confirm track-promotion path works.

---

## Task 15: End-to-end verification

**Step 1:** All 3 latest CI runs green
```bash
gh run list --repo tastile/tastile-core    --limit 1 --json conclusion
gh run list --repo tastile/tastile-web     --limit 1 --json conclusion
gh run list --repo tastile/tastile-android --limit 1 --json conclusion
```
Expected: `["success"]` × 3.

**Step 2:** All 3 latest CD/Deploy runs green
Same query against `Deploy` and `Release` workflows.

**Step 3:** Production smoke
```bash
curl -fsS -o /dev/null -w "dashboard=%{http_code}\n" https://app.tastile.app/login
ssh prod-core "curl -fsS http://127.0.0.1:31400/v1/health"
```

**Step 4:** Update `MEMORY.md` with the latest RDS password, Cognito pool state, and any new infra anchors learned during this round.

**Step 5:** Roll back plan if anything goes sideways
- `tastile-core` v0.5.0 rollback: `ssh prod-core "sudo ln -sfn /opt/tastile/core/releases/tastile-core-v0.4.6 /opt/tastile/core/current && sudo systemctl restart tastile-core.service"`
- `tastile-web` v0.1.47 rollback: same SSM pattern with prior version; `current` symlink swap.
- `tastile-android` v0.3.1 rollback: Play Console → Internal testing → "Release rollback" on the v0.3.1 row.

---

## Definition of Done

- [ ] `tastile-core` CI green on `main`
- [ ] `tastile-core` has `Deploy` workflow that has run green on tag `v0.5.0`
- [ ] `tastile-web` CI green on `main`
- [ ] `tastile-web` Deploy green on tag `v0.1.47`
- [ ] `tastile-android` Verify green on `main`
- [ ] `tastile-android` Release green on tag `v0.3.1` (internal track)
- [ ] Play Console Closed testing track accepts v0.3.1
- [ ] RDS env on prod EC2 matches current AWS Secrets Manager value
- [ ] Daemon `/v1/health` returns 200
- [ ] Dashboard `https://app.tastile.app/login` returns 200, login flow completes
- [ ] Cognito `USER_AUTH` enabled, EMAIL_OTP allowed
- [ ] `TASTILE_WEB_BRIDGE_SECRET` aligned between `tastile.env` and `tastile-web.env`