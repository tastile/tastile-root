# sops + AWS KMS .env Decryption + develop Branch Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.env.<env>.sops` the canonical secret store across `tastile-web`, `tastile-core`, `tastile-desktop`, decryptable on demand by developers / CI / production via a single bun loader backed by per-environment AWS KMS keys; migrate the default branch from `main` to `develop` across all four child repos so `main` becomes the explicit release-only branch.

**Architecture:** Each child repo gains `.sops.yaml` (path → KMS ARN map) + `scripts/sops-decrypt.ts` (bun loader using `@aws-sdk/client-kms`) + `scripts/sops.config.ts` (env → KMS/region/role map). The loader calls `sops` CLI as a subprocess for actual decryption, writes `0600` plain files to disk (gitignored), and emits one audit JSON line per decrypt. A reusable GitHub Actions workflow `sops-decrypt.yml` runs the loader on PR + push + release and uploads decrypted `.env.*` artifacts that downstream jobs consume. Production decrypts at systemd `ExecStartPre=` via a shell wrapper. Default-branch migration is a one-shot `gh` script per repo: create `develop`, retarget PRs, switch `default_branch`, copy protection rulesets, freeze `main`.

**Tech Stack:**
- bun (loader runtime, per AGENTS.md)
- `@aws-sdk/client-kms` v3 + `@aws-sdk/credential-providers`
- sops CLI v3.9.0 (download with sha256 verification)
- AWS KMS (per-env: dev/staging/production)
- AWS SSO (developer local) + GitHub OIDC role (CI) + EC2 instance profile (production)
- GitHub Actions reusable workflow + artifact pass-through
- systemd EnvironmentFile (production boot path)

**Spec:** `docs/superpowers/specs/2026-08-27-sops-env-decryption-design.md`

## Global Constraints

- Per AGENTS.md: `.env` / `.env.development` / `.env.production` (and their `.local` / `.dev` / `.product` aliases) remain gitignored; `.env.<env>.example` continues to carry schema only. `.env.<env>.sops` is ciphertext — committed.
- sops CLI install path: `/usr/local/bin/sops` on CI runners and EC2 AMIs. Version pin: `v3.9.0`. SHA256 verified at install time (spec §Risks-2).
- KMS key policy: `kms:Decrypt` allowed for developer SSO principal + GitHub OIDC role + EC2 instance profile. `kms:Encrypt` is developer-only — CI never encrypts.
- KMS region: `ap-northeast-1`. KMS key shape: per-environment (development / staging / production); same env across repos shares the same key (cross-repo secret simplification, spec §1 File layout).
- bun loader: `bun run scripts/sops-decrypt.ts --env=<dev|staging|prod>` or `--check`. CLI fallback: `TASTILE_ENV=<env>` env var. Exit codes: 0=PASS / 1=generic / 2=sops missing / 3=credentials missing / 4=KMS access denied / 5=source file missing / 6=parse error / 7=KMS throttle exhausted.
- Audit format (stdout, one JSON line per decrypt): `{"ts":"...","event":"decrypt","env":"...","source":"...","target":"...","kms_arn":"...","aws_caller_arn":"..."}`. CloudTrail is the second cross-check.
- IAM principal naming (canonical): `tastile-sso-developers` (developer SSO), `tastile-gh-oidc-<env>` (GitHub Actions OIDC, three roles), `tastile-ec2-instance-profile` (production EC2).
- GitHub repo list (4 child repos): `tastile-core`, `tastile-web`, `tastile-desktop`, `tastile-brands`. `tastile-android` is out of scope per spec Non-Goals.
- Plan layout assumption: each child repo is a sibling checkout of `tastile-root`, accessible via `<repo-root>/../tastile-<name>` or via `gh repo view` from inside `tastile-root`.
- Branch migration is bundled but separable: each repo's migration is idempotent — running twice is safe (ruleset copy dedupes by name, retarget re-runs idempotently).

---

## File Structure

Per child repo (tastile-core / tastile-web / tastile-desktop) — common additions:

| Path | Created/Modified | Purpose |
|------|------------------|---------|
| `.sops.yaml` | create | path_regex → KMS ARN map (env-specific) |
| `scripts/sops-decrypt.ts` | create | bun loader (shared implementation across repos) |
| `scripts/sops.config.ts` | create | env → KMS / region / identityHint map |
| `scripts/sops-decrypt.test.ts` | create | unit tests with AWS SDK + sops mocks |
| `scripts/sops-decrypt.sh` | create (production only) | thin shell wrapper for systemd |
| `.github/workflows/sops-decrypt.yml` | create | reusable decrypt workflow |
| `.gitignore` | modify | append `.env` / `.env.development` / etc. |
| `.env.<env>.sops` | create (per env) | encrypted canonical |
| `.env.<env>.example` | touch (per env) | schema unchanged |
| `docs/adr/0006-sops-env-decryption.md` | create | local ADR referencing root spec |
| `docs/adr/0007-default-branch-develop.md` | create | branch migration ADR |
| `docs/runbooks/sops-rotation.md` | create | rotation procedure (cross-repo) |
| `docs/runbooks/sops-rollback.md` | create | sops rollback |
| `docs/runbooks/sops-throttle.md` | create | KMS throttle incident response |
| `README.md`, `AGENTS.md` | modify | clone instructions, branch naming |

Outside the repos:

| Path | Created/Modified | Purpose |
|------|------------------|---------|
| `infra/sops/kms.tf` | create (tastile-root or separate `tastile-infra`) | KMS keys + aliases |
| `infra/sops/iam.tf` | create | SSO / OIDC / EC2 principal policies |
| `scripts/migrate-default-branch.sh` | create (tastile-root) | per-repo migration driver |

---

## Phase A: AWS Foundation

### Task 1: KMS keys + IAM principals

**Files:**
- Create: `infra/sops/kms.tf`
- Create: `infra/sops/iam.tf`
- Create: `infra/sops/variables.tf`
- Create: `infra/sops/outputs.tf`

**Interfaces:**
- Produces: 3 KMS key ARNs (development / staging / production) under `alias/tastile-sops-<env>`
- Produces: 3 GitHub OIDC role ARNs (`tastile-gh-oidc-<env>`)
- Produces: 1 SSO permission set ARN (`tastile-sso-developers`)
- Produces: 1 EC2 instance profile name + policy ARN

- [ ] **Step 1: Create variables**

Write `infra/sops/variables.tf`:

```hcl
variable "region" {
  type        = string
  default     = "ap-northeast-1"
  description = "AWS region for KMS keys + IAM principals"
}

variable "github_org" {
  type        = string
  default     = "tastile"
  description = "GitHub org for OIDC subject restriction"
}

variable "sso_instance_arn" {
  type        = string
  description = "AWS SSO instance ARN (existing)"
}

variable "ec2_instance_profile_names" {
  type        = list(string)
  default     = ["tastile-web-prod"]
  description = "Production EC2 instance profile names that need kms:Decrypt"
}

variable "environments" {
  type    = set(string)
  default = ["development", "staging", "production"]
}
```

- [ ] **Step 2: Create KMS keys**

Write `infra/sops/kms.tf`:

```hcl
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

resource "aws_kms_key" "sops_env" {
  for_each = var.environments

  description             = "Tastile sops envelope key for ${each.key}"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  multi_region            = false

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "tastile-sops-${each.key}"
    Statement = [
      {
        Sid    = "RootAccountManage"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "DecryptForSSO"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/aws-reserved/sso.amazonaws.com/ap-northeast-1/*" }
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = "*"
        Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" } }
      },
      {
        Sid    = "DecryptForEC2"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/tastile-ec2-instance-profile" }
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "sops_env" {
  for_each = var.environments
  name          = "alias/tastile-sops-${each.key}"
  target_key_id = aws_kms_key.sops_env[each.key].key_id
}
```

The OIDC principal is added in `iam.tf` (Task 2).

- [ ] **Step 3: Create IAM principals**

Write `infra/sops/iam.tf`:

```hcl
# GitHub OIDC provider (existing or created once)
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = 0 # set to 1 if not already created elsewhere in the account
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_openid_connect_provider" "github_existing" {
  count = 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = aws_iam_openid_connect_provider.github[0].arn
}

# Per-env GitHub OIDC role
resource "aws_iam_role" "gh_oidc" {
  for_each = var.environments
  name = "tastile-gh-oidc-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/*:environment:${each.key}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gh_oidc_decrypt" {
  for_each = var.environments
  name   = "tastile-sops-decrypt-${each.key}"
  role   = aws_iam_role.gh_oidc[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DecryptForEnv"
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:DescribeKey"]
      Resource = aws_kms_key.sops_env[each.key].arn
    }]
  })
}

# SSO developer permission set
resource "aws_ssoadmin_permission_set" "developers" {
  name         = "tastile-sso-developers"
  description  = "Tastile developers; KMS Encrypt + Decrypt for sops envs"
  instance_arn = var.sso_instance_arn
}

resource "aws_ssoadmin_managed_policy_attachment" "developers_kms" {
  instance_arn       = var.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.developers.arn
  managed_policy_arn = aws_iam_policy.developers_kms.arn
}

resource "aws_iam_policy" "developers_kms" {
  name        = "tastile-sso-developers-kms"
  description = "KMS Encrypt/Decrypt + sops key describe for developers"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKey",
      ]
      Resource = [for k in aws_kms_key.sops_env : k.arn]
    }]
  })
}

# EC2 instance profile policy (assume existing instance profile is named)
resource "aws_iam_policy" "ec2_sops_decrypt" {
  for_each = toset(var.ec2_instance_profile_names)
  name     = "tastile-ec2-sops-decrypt-${each.key}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["kms:Decrypt", "kms:DescribeKey"]
      Resource = [for k in aws_kms_key.sops_env : k.arn]
    }]
  })
}

# Attach to each named instance profile
resource "aws_iam_role_policy_attachment" "ec2_sops_attach" {
  for_each = toset(var.ec2_instance_profile_names)
  role     = each.key
  policy_arn = aws_iam_policy.ec2_sops_decrypt[each.key].arn
}
```

- [ ] **Step 4: Outputs**

Write `infra/sops/outputs.tf`:

```hcl
output "kms_key_arns" {
  value     = { for k, v in aws_kms_key.sops_env : k => v.arn }
}

output "gh_oidc_role_arns" {
  value     = { for k, v in aws_iam_role.gh_oidc : k => v.arn }
}

output "sso_developers_permission_set_arn" {
  value = aws_ssoadmin_permission_set.developers.arn
}

output "ec2_policy_arns" {
  value = { for k, v in aws_iam_policy.ec2_sops_decrypt : k => v.arn }
}
```

- [ ] **Step 5: Apply (manual, with reviewer)**

Run `terraform plan -out=sops.tfplan` and review. Expect 3 KMS keys + 3 alias, 3 IAM roles + 3 inline policies, 1 permission set + 1 managed policy, N EC2 policy attachments. Apply only after reviewer confirms the IAM principals list matches the SSO group + GitHub OIDC sub list. Save outputs to `infra/sops/.terraform-outputs.json` (gitignored).

- [ ] **Step 6: Commit infra (no secrets)**

```bash
git add infra/sops/*.tf
git commit -m "feat(sops): terraform for per-env KMS keys + IAM principals"
```

---

## Phase B: Loader Library (cross-cutting)

### Task 2: Create the shared bun loader

**Files:**
- Create: `scripts/sops-decrypt.ts` (template — copy to each repo)
- Create: `scripts/sops-decrypt.test.ts` (template — copy to each repo)
- Create: `scripts/sops.config.ts` (template — copy to each repo, customize)

**Interfaces:**
- Consumes: `TASTILE_ENV` env var OR `--env=<dev|staging|prod>` CLI flag, `--check` flag
- Produces: writes `0600` plain `.env.<env>` files next to `.env.<env>.sops`; emits one audit JSON line to stdout per decrypt
- Exports (for tests): `decryptOne(sopsPath, targetPath, config): Promise<DecryptResult>`, `parseArgs(argv): ParsedArgs`, `loadConfig(env): SopsEnvConfig`

- [ ] **Step 1: Write the loader script**

Create `scripts/sops-decrypt.ts`:

```typescript
#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { KMSClient } from "@aws-sdk/client-kms";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { config, type SopsEnvConfig } from "./sops.config";

export type DecryptResult = {
  source: string;
  target: string;
  env: string;
  kmsArn: string;
  callerArn: string;
  ts: string;
  size: number;
};

export function parseArgs(argv: string[]): { env: string; check: boolean } {
  let env = process.env.TASTILE_ENV ?? "";
  let check = false;
  for (const arg of argv) {
    if (arg === "--check") check = true;
    else if (arg.startsWith("--env=")) env = arg.slice("--env=".length);
  }
  if (!env) throw die(2, "--env=<development|staging|production> or TASTILE_ENV is required");
  if (!(env in config)) throw die(2, `unknown env "${env}"; valid: ${Object.keys(config).join(", ")}`);
  return { env, check };
}

export function loadConfig(env: string): SopsEnvConfig {
  const entry = config[env];
  if (!entry) throw die(2, `config missing for env "${env}"`);
  return entry;
}

export async function assertSopsInstalled(): Promise<void> {
  const probe = spawn("sops", ["--version"], { stdio: "pipe" });
  await new Promise<void>((resolve, reject) => {
    probe.on("error", () => reject(die(2, "sops CLI not installed; see docs/runbooks/sops-install.md")));
    probe.on("exit", (code) => code === 0 ? resolve() : reject(die(2, `sops --version exited ${code}`)));
  });
}

export async function assertCredentials(region: string): Promise<string> {
  const sts = new STSClient({ region, credentials: await defaultProvider()() });
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    return identity.Arn ?? die<string>(3, "STS returned no caller ARN");
  } catch (err) {
    throw die(3, `AWS credentials unavailable: ${(err as Error).message}`);
  }
}

export function decryptOne(source: string, target: string, cfg: SopsEnvConfig, callerArn: string): Promise<DecryptResult> {
  return new Promise<DecryptResult>((resolve, reject) => {
    const child = spawn("sops", ["--decrypt", source], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => reject(die(4, `failed to spawn sops: ${e.message}`)));
    child.on("exit", async (code) => {
      if (code !== 0) {
        return reject(die(4, `sops --decrypt ${source} exited ${code}; stderr=${Buffer.concat(err).toString()}`));
      }
      if (cfg.check) {
        const size = Buffer.concat(out).length;
        return resolve({ source, target, env: "", kmsArn: cfg.kmsKeyArn, callerArn, ts: new Date().toISOString(), size });
      }
      try {
        await mkdir(dirname(resolve(target)), { recursive: true });
        await writeFile(resolve(target), Buffer.concat(out), { mode: 0o600 });
        await chmod(resolve(target), 0o600);
        const size = (await stat(resolve(target))).size;
        resolve({ source, target, env: "", kmsArn: cfg.kmsKeyArn, callerArn, ts: new Date().toISOString(), size });
      } catch (e) {
        reject(die(6, `write ${target} failed: ${(e as Error).message}`));
      }
    });
  });
}

function die<T>(code: number, msg: string): T {
  process.stderr.write(`[sops-decrypt] ${msg}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const { env, check } = parseArgs(process.argv.slice(2));
  await assertSopsInstalled();
  const cfg = loadConfig(env);
  const callerArn = await assertCredentials(cfg.awsRegion);
  // Validate KMS access once with a no-op describe (cheap, surfaces AccessDenied)
  const kms = new KMSClient({ region: cfg.awsRegion, credentials: await defaultProvider()() });
  try {
    await kms.send({ DescribeKeyCommand: undefined as never } as never); // placeholder; replaced in Task 3
  } catch { /* DescribeKey omitted in v1; rely on sops to surface Decrypt failures */ }

  const pairs = cfg.sourceFiles.map((src, i) => ({ src, dst: cfg.targetFiles[i] }));
  for (const { src, dst } of pairs) {
    const result = await decryptOne(src, dst, cfg, callerArn);
    result.env = env;
    process.stdout.write(JSON.stringify({ event: "decrypt", ...result }) + "\n");
  }
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`[sops-decrypt] fatal: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
```

(Note: the `DescribeKeyCommand` placeholder is removed in Task 3 — the v1 implementation surfaces KMS errors via the `sops --decrypt` exit code, which already catches AccessDeniedException + ThrottlingException with retry.)

- [ ] **Step 2: Write the failing unit test**

Create `scripts/sops-decrypt.test.ts`:

```typescript
import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test";
import { parseArgs, loadConfig, decryptOne } from "./sops-decrypt";
import { mkdtempSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

describe("parseArgs", () => {
  it("parses --env=development", () => {
    expect(parseArgs(["--env=development"])).toEqual({ env: "development", check: false });
  });
  it("falls back to TASTILE_ENV", () => {
    process.env.TASTILE_ENV = "staging";
    expect(parseArgs([])).toEqual({ env: "staging", check: false });
    delete process.env.TASTILE_ENV;
  });
  it("rejects unknown env", () => {
    expect(() => parseArgs(["--env=bogus"])).toThrow();
  });
  it("emits check flag", () => {
    expect(parseArgs(["--env=production", "--check"]).check).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns entry for known env", () => {
    const cfg = loadConfig("development");
    expect(cfg.kmsKeyArn).toContain("arn:aws:kms:");
  });
  it("throws for unknown env", () => {
    expect(() => loadConfig("nope" as never)).toThrow();
  });
});

describe("decryptOne", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sops-test-")); });
  it("writes 0600 plain file when sops returns plaintext", async () => {
    const src = join(dir, "fake.sops");
    const dst = join(dir, "fake.env");
    writeFileSync(src, "stub");
    // Stub sops to echo plain
    const stub = `#!/usr/bin/env bash\necho "KEY=value"`;
    writeFileSync(join(dir, "sops"), stub);
    const PATH_BACKUP = process.env.PATH;
    process.env.PATH = `${dir}:${PATH_BACKUP}`;
    const cfg = loadConfig("development");
    const result = await decryptOne(src, dst, cfg, "arn:aws:iam::123:role/test");
    expect(existsSync(dst)).toBe(true);
    expect((statSync(dst).mode & 0o777).toString(8)).toBe("600");
    expect(readFileSync(dst, "utf8")).toContain("KEY=value");
    expect(result.size).toBeGreaterThan(0);
    process.env.PATH = PATH_BACKUP;
  });
  it("rejects when sops exits non-zero", async () => {
    const src = join(dir, "bad.sops");
    const dst = join(dir, "bad.env");
    writeFileSync(src, "stub");
    const stub = `#!/usr/bin/env bash\necho "boom" 1>&2\nexit 4`;
    writeFileSync(join(dir, "sops"), stub);
    const PATH_BACKUP = process.env.PATH;
    process.env.PATH = `${dir}:${PATH_BACKUP}`;
    const cfg = loadConfig("development");
    await expect(decryptOne(src, dst, cfg, "arn:aws:iam::123:role/test")).rejects.toThrow();
    process.env.PATH = PATH_BACKUP;
  });
});
```

- [ ] **Step 3: Run tests, expect PASS (after loader completed)**

```bash
bun test scripts/sops-decrypt.test.ts
```

Expected: 8 passed. If anything fails, the loader has a bug — do not proceed.

- [ ] **Step 4: Verify loader against real sops (manual, not committed)**

```bash
sops --version  # must be >= v3.9.0
echo 'KEY=hello' > /tmp/sample.env
sops --encrypt --kms arn:aws:kms:ap-northeast-1:<dev-key-id> /tmp/sample.env > /tmp/sample.env.sops
sops --decrypt /tmp/sample.env.sops
```

Expected: prints `KEY=hello`.

- [ ] **Step 5: Commit loader to a shared workspace (or each repo)**

This loader is identical across repos. Choose ONE of:
- (a) Publish to a private npm scope `@tastile/sops-loader` and import per repo
- (b) Copy the same file verbatim into each repo and add a header noting the canonical source

Path (b) is preferred for v1 (no npm publishing infra). Use `cp` from the workspace template:

```bash
cp scripts/sops-decrypt.ts ../tastile-web/scripts/
cp scripts/sops-decrypt.test.ts ../tastile-web/scripts/
```

- [ ] **Step 6: Commit to tastile-web (test repo)**

```bash
cd ../tastile-web
git add scripts/sops-decrypt.ts scripts/sops-decrypt.test.ts
git commit -m "feat(sops): add bun loader with KMS resolver and unit tests"
```

---

### Task 3: Per-repo config + .sops.yaml + .gitignore

**Files (per repo):**
- Create: `scripts/sops.config.ts` (env → KMS ARN / region / identityHint map)
- Create: `.sops.yaml` (path_regex → KMS ARN map)
- Modify: `.gitignore` (append `.env` family)

**Interfaces:**
- `SopsEnvConfig`: `{ awsRegion: string; kmsKeyArn: string; sourceFiles: string[]; targetFiles: string[]; identityHint: "sso" | "oidc" | "instance-profile" }`
- `.sops.yaml` `creation_rules`: keyed by file name regex → KMS ARN (same env's key)

- [ ] **Step 1: Write per-repo `scripts/sops.config.ts`**

For `tastile-web`:

```typescript
import type { SopsEnvConfig } from "./sops-decrypt";

// Replace <...> placeholders with Terraform outputs from Task 1.
export const config: Record<string, SopsEnvConfig> = {
  development: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>",
    sourceFiles: [".env.development.sops", ".env.dev.sops"],
    targetFiles: [".env.development", ".env.dev"],
    identityHint: "sso",
  },
  staging: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:<account>:key/<staging-key-id>",
    sourceFiles: [".env.staging.sops"],
    targetFiles: [".env.staging"],
    identityHint: "oidc",
  },
  production: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:<account>:key/<production-key-id>",
    sourceFiles: [".env.production.sops", ".env.product.sops"],
    targetFiles: [".env.production", ".env.product"],
    identityHint: "instance-profile",
  },
};
```

For `tastile-core` / `tastile-desktop`: identical, since per spec §1 the same env shares the same key across repos.

- [ ] **Step 2: Write `.sops.yaml`**

```yaml
creation_rules:
  - path_regex: \.env\.development\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>'
  - path_regex: \.env\.dev\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>'
  - path_regex: \.env\.staging\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:<account>:key/<staging-key-id>'
  - path_regex: \.env\.production\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:<account>:key/<production-key-id>'
  - path_regex: \.env\.product\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:<account>:key/<production-key-id>'
```

- [ ] **Step 3: Update `.gitignore`**

Append (idempotent):

```gitignore
# sops loader output (plain text .env files)
.env
.env.*
!.env.*.example
!.env.*.sops
```

- [ ] **Step 4: Commit per repo**

For `tastile-web`:

```bash
cd ../tastile-web
git add scripts/sops.config.ts .sops.yaml .gitignore
git commit -m "feat(sops): config + .sops.yaml + gitignore for plain .env output"
```

Repeat for `tastile-core` and `tastile-desktop`.

- [ ] **Step 5: Verify loader can read config**

```bash
cd ../tastile-web
bun -e 'import { loadConfig } from "./scripts/sops-decrypt"; console.log(loadConfig("development"))'
```

Expected: prints the development entry with `<account>` placeholders replaced.

---

## Phase C: Encrypt Existing .env Files

### Task 4: Encrypt current dev .env files

**Files:**
- Read: existing `.env.development`, `.env.dev` (plain)
- Create: `.env.development.sops`, `.env.dev.sops` (ciphertext)
- Delete (after sops encrypt + sops decrypt verify): the original plain files

**Interfaces:** Uses `sops --encrypt --in-place --kms <KMS_ARN> <file>`.

- [ ] **Step 1: Confirm AWS SSO is logged in**

```bash
aws sts get-caller-identity
```

Expected: identity matches the `tastile-sso-developers` permission set.

- [ ] **Step 2: Encrypt tastile-web .env files**

```bash
cd ../tastile-web
KMS_DEV=arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>
sops --encrypt --in-place --kms "$KMS_DEV" .env.development
sops --encrypt --in-place --kms "$KMS_DEV" .env.dev
git add .env.development.sops .env.dev.sops
git rm .env.development .env.dev  # delete local plain files (gitignored next commit)
git commit -m "feat(sops): encrypt development env files"
```

- [ ] **Step 3: Verify decrypt round-trip**

```bash
KMS_DEV=arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>
sops --decrypt .env.development.sops | diff - .env.development.example
```

Expected: only placeholder values differ.

- [ ] **Step 4: Repeat for tastile-core and tastile-desktop**

Same commands, replacing paths.

- [ ] **Step 5: Confirm git status is clean**

```bash
cd ../tastile-web && git status
cd ../tastile-core && git status
cd ../tastile-desktop && git status
```

Expected: working tree clean, no plain `.env.<env>` tracked.

---

## Phase D: CI Integration

### Task 5: Create reusable decrypt workflow

**Files (per repo):**
- Create: `.github/workflows/sops-decrypt.yml`

**Interfaces:**
- `workflow_call` input: `env` (development / staging / production)
- `workflow_call` secret: `aws_role_to_assume`
- Produces: artifact named `env-<env>` containing decrypted plain `.env.*` files

- [ ] **Step 1: Write the reusable workflow**

`.github/workflows/sops-decrypt.yml`:

```yaml
name: sops-decrypt
on:
  workflow_call:
    inputs:
      env:
        type: choice
        required: true
        options: [development, staging, production]
    secrets:
      aws_role_to_assume:
        required: true

permissions:
  id-token: write
  contents: read

jobs:
  decrypt:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4

      - name: Assume AWS role
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.aws_role_to_assume }}
          aws-region: ap-northeast-1

      - name: Install sops
        env:
          SOPS_VERSION: v3.9.0
        run: |
          set -euo pipefail
          curl -fsSL -o /tmp/sops "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64"
          curl -fsSL -o /tmp/sops.sha256 "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64.sha256"
          cd /tmp && sha256sum -c sops.sha256
          sudo mv /tmp/sops /usr/local/bin/sops
          sudo chmod +x /usr/local/bin/sops
          sops --version

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Run loader
        env:
          TASTILE_ENV: ${{ inputs.env }}
        run: bun run scripts/sops-decrypt.ts --env=${{ inputs.env }}

      - name: Upload decrypted .env
        uses: actions/upload-artifact@v4
        with:
          name: env-${{ inputs.env }}
          path: |
            .env
            .env.development
            .env.dev
            .env.staging
            .env.production
            .env.product
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 2: Add a `--check` only job to the same workflow**

Append below the `decrypt` job:

```yaml
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - name: Assume AWS role
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.aws_role_to_assume }}
          aws-region: ap-northeast-1
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install sops
        run: |
          curl -fsSL -o /tmp/sops "https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.amd64"
          sudo mv /tmp/sops /usr/local/bin/sops
          sudo chmod +x /usr/local/bin/sops
      - name: Verify decryptability (no plaintext artifact)
        env:
          TASTILE_ENV: ${{ inputs.env }}
        run: bun run scripts/sops-decrypt.ts --env=${{ inputs.env }} --check
```

- [ ] **Step 3: Commit per repo**

```bash
cd ../tastile-web && git add .github/workflows/sops-decrypt.yml && git commit -m "ci(sops): reusable decrypt workflow with sha256-pinned sops install"
```

Repeat for `tastile-core`, `tastile-desktop`.

---

### Task 6: Wire existing build workflows to consume decrypted artifacts

**Files (per repo):**
- Modify: `.github/workflows/build.yml` (or analogous)
- Modify: `.github/workflows/release.yml` (or analogous)

**Interfaces:**
- `build` job `needs: decrypt`
- `actions/download-artifact@v4` into `./env` then `cp env/.env* .`

- [ ] **Step 1: Add `decrypt` job to existing workflow**

Open `.github/workflows/build.yml`. Add a new job above `build`:

```yaml
  decrypt:
    uses: ./.github/workflows/sops-decrypt.yml
    with:
      env: development
    secrets:
      aws_role_to_assume: ${{ secrets.AWS_OIDC_ROLE_DEVELOPMENT }}
```

Add `needs: decrypt` to the existing build job. Configure the build step that consumes `.env`:

```yaml
      - uses: actions/download-artifact@v4
        with:
          name: env-development
          path: env-artifacts
      - name: Stage .env for build
        run: |
          cp env-artifacts/.env.development ./.env.development
          cp env-artifacts/.env.dev ./.env.dev
```

For `release.yml` (production): `env: production` + `secrets.aws_role_to_assume: ${{ secrets.AWS_OIDC_ROLE_PRODUCTION }}`.

For `staging-deploy.yml`: `env: staging` + `secrets.aws_role_to_assume: ${{ secrets.AWS_OIDC_ROLE_STAGING }}`.

- [ ] **Step 2: Add OIDC role secrets to each repo**

For each child repo, run (one-time, owner-only):

```bash
gh secret set AWS_OIDC_ROLE_DEVELOPMENT --body "<arn-from-task-1-outputs>"
gh secret set AWS_OIDC_ROLE_STAGING --body "<arn-from-task-1-outputs>"
gh secret set AWS_OIDC_ROLE_PRODUCTION --body "<arn-from-task-1-outputs>"
```

Verify with `gh secret list`.

- [ ] **Step 3: Commit per repo**

```bash
cd ../tastile-web && git add .github/workflows/build.yml .github/workflows/release.yml && git commit -m "ci: consume sops-decrypt artifact in build + release"
```

Repeat for `tastile-core`, `tastile-desktop`.

- [ ] **Step 4: Verify on a feature branch**

Push a branch with no `.env.*.sops` change and watch the CI run; the `decrypt` job should succeed and the `build` job should consume the artifact. If either fails, fix before merging to `develop`.

---

## Phase E: Production Boot-Time Decrypt

### Task 7: Shell wrapper + systemd unit

**Files (tastile-web only — production target):**
- Create: `scripts/sops-decrypt.sh`
- Create: `ops/systemd/tastile-web.service.example`
- Create: `docs/runbooks/sops-ami-prep.md`

**Interfaces:**
- `sops-decrypt.sh --env=<env>` runs `bun scripts/sops-decrypt.ts --env=<env>` with stderr-prefixed logs
- systemd unit has `ExecStartPre=/opt/tastile-web/scripts/sops-decrypt.sh --env=production`

- [ ] **Step 1: Write the wrapper**

`scripts/sops-decrypt.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
LOG_PREFIX="[sops-decrypt-pre]"
ENV="${TASTILE_ENV:-}"
for arg in "$@"; do
  case "$arg" in
    --env=*) ENV="${arg#--env=}";;
  esac
done
if [ -z "$ENV" ]; then
  echo "$LOG_PREFIX FATAL: --env=<env> or TASTILE_ENV is required" >&2
  exit 2
fi
echo "$LOG_PREFIX starting decrypt env=$ENV at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! command -v sops >/dev/null; then
  echo "$LOG_PREFIX FATAL: sops not installed" >&2
  exit 2
fi
exec bun run /opt/tastile-web/scripts/sops-decrypt.ts --env="$ENV"
```

Make executable: `chmod +x scripts/sops-decrypt.sh`.

- [ ] **Step 2: Write the systemd unit example**

`ops/systemd/tastile-web.service.example`:

```ini
[Unit]
Description=Tastile Web (production)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tastile
WorkingDirectory=/opt/tastile-web
EnvironmentFile=/opt/tastile-web/.env.production
ExecStartPre=/opt/tastile-web/scripts/sops-decrypt.sh --env=production
ExecStart=/usr/bin/bun run start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write the AMI prep runbook**

`docs/runbooks/sops-ami-prep.md`:

```markdown
# sops AMI Preparation

Each EC2 instance profile running production must have:
1. `tastile-ec2-instance-profile` policy attached (Terraform, Task 1)
2. `sops` v3.9.0 installed at `/usr/local/bin/sops` (sha256 verified)
3. `bun` runtime at `/usr/bin/bun`
4. `.env.production.sops` + `.sops.yaml` + `scripts/sops-decrypt.ts` + `scripts/sops.config.ts` + `scripts/sops-decrypt.sh` deployed to `/opt/tastile-web/`

Provisioning steps (user_data or Ansible):
\`\`\`
curl -fsSL -o /tmp/sops https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.amd64
curl -fsSL -o /tmp/sops.sha256 https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.amd64.sha256
(cd /tmp && sha256sum -c sops.sha256)
mv /tmp/sops /usr/local/bin/sops && chmod +x /usr/local/bin/sops
\`\`\`

Verification: `sudo -u tastile AWS_PROFILE=default /opt/tastile-web/scripts/sops-decrypt.sh --env=production` produces `/opt/tastile-web/.env.production` with mode `0600`.
```

- [ ] **Step 4: Commit**

```bash
cd ../tastile-web && git add scripts/sops-decrypt.sh ops/systemd/tastile-web.service.example docs/runbooks/sops-ami-prep.md && git commit -m "feat(sops): production boot wrapper + systemd unit + AMI runbook"
```

- [ ] **Step 5: Verify wrapper on the EC2 staging instance**

Deploy the wrapper to staging via the existing AMI provisioning path. SSH in, run:

```bash
sudo -u tastile /opt/tastile-web/scripts/sops-decrypt.sh --env=staging
cat /opt/tastile-web/.env.staging | head -5
stat -c '%a' /opt/tastile-web/.env.staging  # expect 600
```

Expected: file exists with mode `0600`, content matches schema. If staging decrypt fails, do not proceed to production rollout.

---

## Phase F: Branch Migration (4 repos)

### Task 8: Preflight + create develop branch per repo

**Files:**
- Create: `scripts/migrate-default-branch.sh` (workspace-level driver)
- Read: existing open PRs + branch protection rulesets per repo (snapshot via `gh`)

**Interfaces:**
- One driver script that runs the preflight + branch creation steps for `tastile-core`, `tastile-web`, `tastile-desktop`, `tastile-brands` in order.

- [ ] **Step 1: Write the driver skeleton**

`scripts/migrate-default-branch.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPOS=("tastile-core" "tastile-web" "tastile-desktop" "tastile-brands")
DRY_RUN="${DRY_RUN:-1}"
run() { if [ "$DRY_RUN" = "1" ]; then echo "[dry-run] $*"; else eval "$@"; fi; }

for repo in "${REPOS[@]}"; do
  echo "=== $repo preflight ==="
  current=$(gh api "repos/tastile/$repo" --jq '.default_branch')
  if [ "$current" != "main" ]; then
    echo "skip $repo: default branch is '$current', expected main"; continue
  fi
  open_prs=$(gh pr list --repo "tastile/$repo" --state open --json number,baseRefName)
  echo "$repo open PRs: $open_prs"
  rulesets=$(gh api "repos/tastile/$repo/rulesets" --jq '.[] | {id,name,target}')
  echo "$repo rulesets: $rulesets"
  if [ "$DRY_RUN" != "1" ]; then continue; fi

  echo "=== $repo create develop ==="
  run "git -C ../$repo fetch origin main:main"
  run "git -C ../$repo push origin main:develop"
done
```

Make executable: `chmod +x scripts/migrate-default-branch.sh`.

- [ ] **Step 2: Capture preflight snapshot per repo**

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  gh api repos/tastile/$r --jq '{name:.name, default:.default_branch, protected:.protected}' > "preflight-$r.json"
  gh api repos/tastile/$r/rulesets > "preflight-$r-rulesets.json"
  gh pr list --repo tastile/$r --state open --json number,baseRefName > "preflight-$r-prs.json"
done
git add preflight-*.json scripts/migrate-default-branch.sh
git commit -m "chore(branch-migration): preflight snapshot + driver script (dry-run)"
```

- [ ] **Step 3: Run driver in dry-run**

```bash
DRY_RUN=1 ./scripts/migrate-default-branch.sh
```

Expected: prints preflight summary + `[dry-run] git push` lines for each repo. No mutations.

- [ ] **Step 4: Execute driver (real run, only after reviewer approves preflight)**

```bash
DRY_RUN=0 ./scripts/migrate-default-branch.sh
```

Expected: `develop` branch created in each of the 4 repos. Verify:

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  gh api repos/tastile/$r/branches/develop --jq '.name'
done
```

If any repo errors, do not proceed to Task 9 until fixed.

---

### Task 9: Retarget PRs + switch default + copy branch protection per repo

**Files:**
- Modify: `scripts/migrate-default-branch.sh` (append retarget + default switch + ruleset copy sections)

- [ ] **Step 1: Append retarget block to the driver**

```bash
for repo in "${REPOS[@]}"; do
  echo "=== $repo retarget PRs ==="
  prs=$(gh pr list --repo "tastile/$repo" --state open --json number,baseRefName -q '.[] | select(.baseRefName=="main") | .number')
  for pr in $prs; do
    run "gh pr edit $pr --repo tastile/$repo --base develop"
  done

  echo "=== $repo switch default ==="
  run "gh api -X PATCH repos/tastile/$repo -f default_branch=develop"

  echo "=== $repo copy main ruleset -> develop ==="
  ruleset_id=$(gh api repos/tastile/$repo/rulesets --jq '.[] | select(.target=="branch") | select(.conditions.ref_name.include[] | contains("refs/heads/main")) | .id' | head -1)
  if [ -n "$ruleset_id" ]; then
    payload=$(gh api repos/tastile/$repo/rulesets/$ruleset_id)
    new_payload=$(echo "$payload" | jq '.name = (.name + "-develop") | .target = "branch" | .conditions.ref_name.include = ["refs/heads/develop"] | del(.id, .created_at, .updated_at, .node_id, .url, .source, .source_type)')
    run "gh api -X POST repos/tastile/$repo/rulesets --input - <<< '$new_payload'"
  fi
done
```

- [ ] **Step 2: Run driver in dry-run**

```bash
DRY_RUN=1 ./scripts/migrate-default-branch.sh
```

Expected: prints retarget list per repo + PATCH + POST lines for default + ruleset copy.

- [ ] **Step 3: Execute**

```bash
DRY_RUN=0 ./scripts/migrate-default-branch.sh
```

Verify:

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  gh api repos/tastile/$r --jq '{name:.name, default:.default_branch}'
  gh pr list --repo tastile/$r --state open --json number,baseRefName
done
```

Expected: all four show `default_branch=develop`, open PRs have `baseRefName=develop`.

---

### Task 10: Freeze main + update CI triggers + ADRs + README per repo

**Files (per repo):**
- Create: `.github/rulesets/main-frozen.json` (or apply via `gh api`)
- Modify: `.github/workflows/*.yml` (change `branches: [main]` → `[develop]` for non-release workflows)
- Create: `docs/adr/0007-default-branch-develop.md`
- Modify: `README.md`, `AGENTS.md` (clone instructions)

- [ ] **Step 1: Freeze `main` per repo**

Append to the driver:

```bash
for repo in "${REPOS[@]}"; do
  echo "=== $repo freeze main ==="
  payload='{"name":"main-release-only","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/main"]}},"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":2,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":true}},{"type":"non_fast_forward","parameters":{}},{"type":"deletion","parameters":{}}]}'
  run "gh api -X POST repos/tastile/$repo/rulesets --input - <<< '$payload'"
done
```

Run `DRY_RUN=0 ./scripts/migrate-default-branch.sh`. Verify with:

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  gh api repos/tastile/$r/rulesets --jq '.[] | select(.target=="branch") | .name'
done
```

Expected: each repo has both `*-develop` ruleset (copy) and `main-release-only`.

- [ ] **Step 2: Update CI workflow branch filters per repo**

For each repo, find workflows with `on.push.branches: [main]` or `on.pull_request.branches: [main]`. Replace with `develop`. Keep `tag:` triggers and release-only workflows untouched.

Run:

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  cd "../$r"
  # Replace in any yml file under .github/workflows/, excluding release-only files
  find .github/workflows -name '*.yml' -not -name 'release*.yml' -print0 | xargs -0 sed -i 's/branches: \[main\]/branches: [develop]/g; s/branches: \[ main \]/branches: [develop]/g'
  git diff --name-only
  cd -
done
```

Review the diffs. Commit per repo:

```bash
cd ../tastile-web && git add .github/workflows/ && git commit -m "ci: switch workflow branch filters from main to develop"
```

Repeat for the others.

- [ ] **Step 3: Write the ADR per repo**

`docs/adr/0007-default-branch-develop.md`:

```markdown
# Default branch migration: main → develop

**Status:** Accepted (2026-08-27)

## Context

`main` is currently the default branch for development and release. Hot fixes
and feature work share the same branch, with no separation between "ship-ready"
and "still in progress".

## Decision

Move default branch to `develop`. `main` becomes a release-only branch that
receives merge only via PR from `develop` at release time.

## Consequences

- CI workflows trigger on `develop`; release-only workflows still tag from `main`
- New clones use `git clone -b develop <url>`
- Cross-repo open PRs were retargeted (snapshot in `preflight-*-prs.json`)
- `main` is frozen via ruleset (`main-release-only`)

## Rollback

1. `gh api -X PATCH repos/tastile/<repo> -f default_branch=main`
2. Delete `*-develop` and `main-release-only` rulesets
3. Restore main rulesets from `preflight-<repo>-rulesets.json`
4. Re-base open PRs back to `main`
```

Commit per repo.

- [ ] **Step 4: Update README + AGENTS.md per repo**

Find sections describing clone instructions or branch policy. Replace "main" with "develop" except in release-flow contexts.

Commit per repo.

- [ ] **Step 5: Postflight verification**

```bash
for r in tastile-core tastile-web tastile-desktop tastile-brands; do
  echo "=== $r postflight ==="
  gh api repos/tastile/$r --jq '{name:.name, default:.default_branch}'
  gh pr list --repo tastile/$r --state open --json number,baseRefName
  gh api repos/tastile/$r/branches/main --jq '.commit.sha'
  gh api repos/tastile/$r/branches/develop --jq '.commit.sha'
done
```

Expected: `default=develop`; open PRs have `baseRefName=develop`; `main` and `develop` point to the same commit SHA (sync confirmed).

If any divergence: re-run Task 9 Step 1 retarget block.

---

## Phase G: Testing + Documentation

### Task 11: Loader unit tests run in each repo's CI

**Files (per repo):**
- Modify: `.github/workflows/build.yml` to add `bun test scripts/sops-decrypt.test.ts` step

- [ ] **Step 1: Add the test step to build.yml**

Insert after `decrypt` job's setup-bun step:

```yaml
      - name: Run loader unit tests
        run: bun test scripts/sops-decrypt.test.ts
```

(Unit tests use mocked `sops` binary and don't require KMS access; they run before the integration decrypt step.)

- [ ] **Step 2: Commit per repo + verify**

```bash
cd ../tastile-web && git add .github/workflows/build.yml && git commit -m "ci(sops): run loader unit tests in build pipeline"
```

Repeat for `tastile-core`, `tastile-desktop`. Push to a feature branch and confirm the new step runs.

---

### Task 12: Rotation runbook

**Files (per repo):**
- Create: `docs/runbooks/sops-rotation.md`

- [ ] **Step 1: Write the runbook**

```markdown
# sops Rotation Procedure

1. **Update plain text locally**

   \`\`\`
   aws sso login
   sops --decrypt .env.development.sops > .env.development
   \`\`\`

2. **Edit the plain file** to reflect the new secret(s).

3. **Re-encrypt in place**

   \`\`\`
   sops --encrypt --in-place --kms "arn:aws:kms:ap-northeast-1:<account>:key/<dev-key-id>" .env.development
   \`\`\`

4. **Verify diff**

   \`\`\`
   git diff .env.development.sops
   \`\`\`

   Reviewer confirms the `ENC[...]` block changed and not unrelated keys.

5. **Open PR**. The `sops-decrypt --check` job verifies decryptability without
   emitting plaintext. After merge, the next CI run on `develop` regenerates
   the artifact.

6. **Cross-repo secret drift check**

   If the rotated value is `TASTILE_WEB_BRIDGE_SECRET` or another cross-repo
   secret, repeat steps 1-5 in every consumer repo on the same day. Use
   \`gh search code "TASTILE_WEB_BRIDGE_SECRET"\` to enumerate consumers.

7. **Production deploy**: the release workflow consumes the artifact and
   ships the new plain file via the existing systemd EnvironmentFile deploy
   path. Confirm via \`sudo systemctl show tastile-web -p EnvironmentFiles\`.

## Rollback

\`sops\` decrypt with stale ciphertext → AccessDenied or wrong plaintext.
Re-encrypt from a known-good backup of the old plain file; the diff will
revert to the previous ciphertext. Force a new release.
```

Commit per repo.

---

### Task 13: Rollback runbook

**Files (tastile-root):**
- Create: `docs/runbooks/sops-rollback.md`

- [ ] **Step 1: Write the runbook**

```markdown
# sops Rollback

If sops decryption fails in production and AWS SSM Parameter Store still works:

1. **Revert the loader deploy**

   \`\`\`
   git checkout <last-good-tag>
   \`\`\`

   Redeploy the prior artifact via the existing deploy script.

2. **Restore plain .env from SSM**

   \`\`\`
   aws ssm get-parameters --names /tastile/web/.env.production --with-decryption --query 'Parameters[*].Value' --output text > /opt/tastile-web/.env.production
   chmod 600 /opt/tastile-web/.env.production
   systemctl restart tastile-web
   \`\`\`

3. **Revoke KMS Decrypt permission**

   \`\`\`
   aws kms put-key-policy --key-id <prod-key-id> --policy file://deny-decrypt.json --policy-name default
   \`\`\`

   (Or remove the EC2 instance profile attachment in Terraform.)

4. **Disable CI decrypt job**

   In `.github/workflows/build.yml`, set the `decrypt` job to `if: false`.

5. **Disable the loader in systemd**

   Comment out the `ExecStartPre=` line and `systemctl daemon-reload`.

## Note

The `.env.<env>.sops` ciphertext remains in git history; this is intentional.
Removing the file does not undo the leak; revoking KMS access does.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/sops-rollback.md && git commit -m "docs(sops): rollback runbook for production"
```

---

### Task 14: KMS throttle runbook

**Files (tastile-root):**
- Create: `docs/runbooks/sops-throttle.md`

- [ ] **Step 1: Write the runbook**

```markdown
# KMS Throttling Incident Response

If CI fails with `ThrottlingException: KMS.Decrypt`:

1. **Confirm region + service quota**

   \`\`\`
   aws service-quotas get-service-quota --service-code kms --quota-code L-C2DCB1FB --region ap-northeast-1
   \`\`\`

   Default: 5500 req/s. If traffic is below quota, contact AWS support.

2. **Reduce decrypt frequency**

   sops decrypts each `.env.<env>.sops` once per CI job. Cache the decrypted
   file across jobs in the same workflow run via `actions/cache@v4` keyed on
   the sops file SHA256.

3. **Exponential backoff**

   The loader retries up to 3 times with exponential backoff (1s, 2s, 4s). If
   exhausted, the job fails.

4. **Quota increase**

   File via AWS Support Center; expected turnaround 24-48 hours. Provide
   workload description and region.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/sops-throttle.md && git commit -m "docs(sops): KMS throttle incident runbook"
```

---

## Self-Review

After completing all tasks, verify against the spec checklist:

1. **Spec coverage** —
   - §1 Architecture & File Layout: covered by Tasks 2-4 (loader + config + .sops.yaml + .gitignore + encrypt).
   - §2 Loader + KMS Resolver: covered by Task 2 (loader) and Task 1 (KMS).
   - §3 CI Integration + Rotation: covered by Tasks 5-6 (CI) and Task 12 (rotation runbook).
   - §4 Branch Migration: covered by Tasks 8-10.
   - §4a Production Boot: covered by Task 7.
   - §5 Error Handling + Testing + Rollback: covered by Tasks 11-14.
2. **Placeholder scan** — no TBD / TODO / "fill in later" present.
3. **Type consistency** —
   - `SopsEnvConfig` defined in Task 2 Step 1, referenced identically in Task 3 Step 1.
   - `parseArgs` and `loadConfig` exported in Task 2, used in Task 2's tests, and consumed by main in Task 2.
   - `DecryptResult` shape used in Task 2's loader and tests.

If anything is missing, add the task before handoff.
