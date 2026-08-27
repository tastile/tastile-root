# sops + AWS KMS による .env 復号とデフォルトブランチ develop 移行

- **Date**: 2026-08-27
- **Status**: Draft (awaiting user review)
- **Scope**: tastile-root workspace (4 child repos + workspace contract)
- **Bundled**: default branch `main` → `develop` migration

## Context

`AGENTS.md` の規約は「実値は `.env`、`.env.development`、`.env.production` のみへ置き、commit しない。schema は対応する `*.example` に置く」と定めている。現在、production は AWS SSM Parameter Store / Secrets Manager + systemd EnvironmentFile で運用されており、developer 手元と CI は平文 `.env.*` ファイルに依存している (memory: `tastile-web required env vars`, `TASTILE_WEB_BRIDGE_SECRET drift`)。

この差は次の問題を生んでいる:

1. **rotation の遅延** — RDS password は Secrets Manager で自動 rotation されるが (memory: `tastile-v1 RDS host+password`)、app secret (STRIPE / BetterAuth / Apple 等) は手動で `.env.*` を書き換える必要があり、CI artifact 経由で漏れが頻発する。
2. **cross-repo secret の同期負荷** — `TASTILE_WEB_BRIDGE_SECRET` のような cross-repo secret は producer / consumer 双方の `.env.*` に手動で書き込む必要があり、drift しやすい (memory: `TASTILE_WEB_BRIDGE_SECRET drift`)。
3. **branch hygiene** — `main` が default branch のため hot fix と日常開発が同じ branch に混在する。release flow が明示的でない。

本 design は sops + AWS KMS による file-level envelope encryption を dev / CI / production に導入し、AWS SSM / Secrets Manager と並列運用する。さらに bundled scope として default branch を `main` → `develop` へ移行する。

## Goals

- `.env.<env>.sops` を canonical とし、plain text `.env.<env>` は gitignore して loader が起動時に復元する
- AWS KMS を per-environment で分離し、blast radius を env で閉じる
- bun loader を dev / CI / production で統一する (CI は artifact pass-through)
- default branch を `develop` へ移し、`main` を release 専用 branch として位置付ける

## AGENTS.md 規約との整合

- `.env.<env>.sops` は **ciphertext** であり「実値」ではないため commit 可
- `.env.<env>.example` は schema (key 名 + placeholder) のままで commit 継続
- 平文 `.env.<env>` は引き続き gitignore (AGENTS.md 不変条件と一致)
- 本 design 後に AGENTS.md に「暗号化された canonical は `.env.<env>.sops`、loader で復号した plain の `.env.<env>` は一時物として `.tmp/` または gitignore 配下に置く」旨を追記するかは別途 user と判断

## Non-Goals

- AWS SSM Parameter Store / Secrets Manager の撤廃 (production hot path として並列維持)
- KMS key の on-demand rotation policy 自動化 (将来 ADR で扱う)
- `tastile-android` の `.env` 化 (Gradle BuildConfig / `local.properties` 経由のため scope 外)
- `@sops/sdk` (experimental) の採用 — 安定性優先で v1 は `sops` CLI

## In-Scope

- `tastile-core` / `tastile-web` / `tastile-desktop` の `.env.*.sops` 化
- `scripts/sops-decrypt.ts` + `scripts/sops.config.ts` を各 repo に配置
- `.sops.yaml` を各 repo 直下に配置
- GitHub Actions reusable workflow `.github/workflows/sops-decrypt.yml`
- AWS KMS key 3 本 (development / staging / production) と IAM policy
- IAM OIDC role 各 env 用 (developer SSO は既存を流用)
- default branch 移行 (4 child repo)
- CI workflow の branch filter 更新
- ADR を各 repo に `docs/adr/000N-default-branch-develop.md` として作成

## Out-of-Scope

- production deploy 経路の変更 (systemd EnvironmentFile は引き続き AWS SSM が source of truth、`.env.<env>` は補助)
- `tastile-android` の BuildConfig 統合
- KMS key の cross-region replication
- audit log の長期保存 (CloudTrail 既定の 90 日を超える保持は別 ticket)

## Confirmed Decisions

| # | 項目 | 選択 |
|---|---|---|
| 1 | 目的 | 並列運用 (sops ∥ AWS SSM/Secrets Manager) |
| 2 | 鍵 backend | AWS KMS |
| 3 | scope | 4 child repo × 全 `.env.*` を暗号化 (full) |
| 4 | loader | bun script 統一 (dev/CI/production) |
| 5 | CI 統合 | artifact pass-through |
| 6 | branch 移行 | 新規 branch + retarget PR + protection copy + main freeze |
| 7 | KMS key 形状 | per-environment (dev / staging / production) |
| 8 | bundled scope | main → develop デフォルトブランチ移行 |
| 9 | file 形式 | file-level envelope (Candidate A) |

## Design

### 1. Architecture & File Layout

#### 全体像

```
AWS KMS (per-env: dev/staging/prod)
  → KMS Decrypt
bun loader (scripts/sops-decrypt.ts)
  → KMS ARN 解決 (scripts/sops.config.ts)
  → .env.<env>.sops → .env.<env> へ復号 (gitignore)
アプリ起動側 (Next.js / cargo / Electron / systemd EnvironmentFile)
  → 既存の `.env.*` reader で読む (loader は dotenv の chain を変えない)
```

`AWS SSM Parameter Store` + `Secrets Manager` は production 専用の hot path として並列維持。systemd `EnvironmentFile=` は両方の source を受け取れる。

#### File layout (各 child repo 共通)

| Path | commit | 生成元 | 用途 |
|---|---|---|---|
| `.env.<env>.example` | ✅ | hand | schema (key 名 + placeholder 値) |
| `.env.<env>.sops` | ✅ | `sops --encrypt` | **暗号化された實値** (canonical) |
| `.env.<env>` | ❌ gitignore | loader | loader が復号して書き出す plain text |
| `.sops.yaml` | ✅ | hand | repo 内の暗号化対象 file / KMS key 設定 |
| `scripts/sops-decrypt.ts` | ✅ | hand | bun loader |
| `scripts/sops.config.ts` | ✅ | hand | env → KMS key ARN / AWS region / role 設定 |
| `.gitignore` 追記 | ✅ | hand | `.env` / `.env.development` / `.env.production` / `.env.dev` / `.env.product` |

KMS key は **per-environment** (dev / staging / production)。同じ env を使う repo は同じ key を共有 (cross-repo secret 復号を容易にする)。

`.sops.yaml` 例:

```yaml
creation_rules:
  - path_regex: \.env\.dev\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:111111111111:key/<dev-key-id>'
  - path_regex: \.env\.product\.sops$
    kms: 'arn:aws:kms:ap-northeast-1:111111111111:key/<prod-key-id>'
```

### 2. Loader + KMS Resolver

#### `scripts/sops.config.ts`

```typescript
import type { SopsEnvConfig } from "./sops-decrypt";

export const config: Record<string, SopsEnvConfig> = {
  development: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn:
      "arn:aws:kms:ap-northeast-1:111111111111:key/<development-key-id>",
    sourceFiles: [".env.development.sops", ".env.dev.sops"],
    targetFiles: [".env.development", ".env.dev"],
    identityHint: "sso",
  },
  staging: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn:
      "arn:aws:kms:ap-northeast-1:111111111111:key/<staging-key-id>",
    sourceFiles: [".env.staging.sops"],
    targetFiles: [".env.staging"],
    identityHint: "oidc",
  },
  production: {
    awsRegion: "ap-northeast-1",
    kmsKeyArn:
      "arn:aws:kms:ap-northeast-1:111111111111:key/<production-key-id>",
    sourceFiles: [".env.production.sops", ".env.product.sops"],
    targetFiles: [".env.production", ".env.product"],
    identityHint: "instance-profile",
  },
};
```

#### `scripts/sops-decrypt.ts`

責務:

1. CLI 引数 `--env=<dev|staging|prod>` または `TASTILE_ENV` env var を受け取り、`config` から該当 env を引く
2. AWS SDK for JavaScript v3 (`@aws-sdk/client-kms`) で `KMSClient` を作成、default credential provider chain を使う
3. `sops` CLI を child process として spawn
4. `.env.*.sops` を読み、復号結果を `.env.*` へ書き出す (mode 0600)
5. 復号成功時に stdout へ audit log (`{ timestamp, env, keyArn tail, source, target }`) を出力
6. 失敗時は非 0 exit + 人間可読 error (どの source / target / KMS call が失敗したか)
7. `--check` モード (decrypt せず復号可能性だけ検証) を CI dry-run で使う

依存関係:

- bun (workspace 規約)
- `@aws-sdk/client-kms` (各 repo の `package.json` へ追加)
- `sops` CLI (CI runner / dev image / EC2 AMI に install)

#### IAM principals と KMS key policy

| Principal | env | 取得方法 | 用途 |
|---|---|---|---|
| developer (local) | development | AWS SSO (`aws sso login`) | 手元 decrypt |
| GitHub Actions OIDC role | development / staging / production | workflow 冒頭 `aws-actions/configure-aws-credentials` | CI decrypt job |
| EC2 instance profile | production | IMDS | production decrypt (systemd 起動時) |

KMS key policy は以下を allow:

- `kms:Decrypt` を developer SSO principal + GitHub OIDC role + EC2 instance profile に対して
- `kms:Encrypt` は developer IAM user / SSO role のみ (CI には付与しない)
- `kms:DescribeKey` を audit / verification 用に付与
- 将来 `kms:RotateKeyOnDemand` は別 ADR で管理

#### 暗号化 workflow (v1)

- developer 手元で `sops --encrypt --in-place --kms<KMS_ARN> .env.<env>` を実行
- encrypt 結果は PR として review されて merge (`.env.<env>.sops` の diff だけで変更箇所が分かる)
- KMS Encrypt 権限は developer IAM user / SSO role にのみ付与、CI には渡さない

### 3. CI Integration + Rotation Procedure

#### GitHub Actions workflow

reusable workflow `.github/workflows/sops-decrypt.yml`:

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
jobs:
  decrypt:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Assume AWS role
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.aws_role_to_assume }}
          aws-region: ap-northeast-1
      - name: Install sops
        run: |
          curl -LO https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.amd64
          sudo mv sops-v3.9.0.linux.amd64 /usr/local/bin/sops
          sudo chmod +x /usr/local/bin/sops
          sops --version
      - name: Run loader
        env:
          TASTILE_ENV: ${{ inputs.env }}
        run: bun run scripts/sops-decrypt.ts --env=${{ inputs.env }}
      - name: Upload decrypted .env
        uses: actions/upload-artifact@v4
        with:
          name: env-${{ inputs.env }}
          path: |
            .env.development
            .env.dev
            .env.production
            .env.product
            .env.staging
          retention-days: 1
          if-no-files-found: error
```

呼び出し側 (例: `.github/workflows/build.yml`):

```yaml
jobs:
  decrypt:
    uses: ./.github/workflows/sops-decrypt.yml
    with:
      env: development
    secrets:
      aws_role_to_assume: ${{ secrets.AWS_OIDC_ROLE_DEVELOPMENT }}

  build:
    needs: decrypt
    # ... 既存 build step、actions/download-artifact で env-development を ./ へ展開
```

#### Cross-repo secret

`TASTILE_WEB_BRIDGE_SECRET` のような cross-repo secret は **producer / consumer 双方の `.env.<env>.sops` に同じ値を含める**。両方を同じ env の KMS key で encrypt することで、復号側も同じ KMS Decrypt 権限で読める。

- producer (`tastile-web`) の `.env.development.sops`: `TASTILE_WEB_BRIDGE_SECRET=ENC[...]`
- consumer (`tastile-core`) の `.env.dev.sops`: `TASTILE_WEB_BRIDGE_SECRET=ENC[...]`
- 両方を同じ development KMS key で encrypt

運用ルール: `docs/runbooks/sops-rotation.md` に「cross-repo secret は producer repo が canonical、変更 PR は consumer repo へも同時に出す」と記載。

#### Rotation procedure

1. developer が手元で `.env.<env>` を更新 (plain)
2. `sops --encrypt --in-place --kms<KMS_ARN> .env.<env>` で `.env.<env>.sops` を再生成
3. PR を作成、reviewer は `.env.<env>.sops` の diff で secret 値変更を確認
4. CI: PR で `--check` モード loader が走り「decrypt 可能」を確認 (本番値を取り出さない)
5. merge 後、default branch (新 default は `develop`) で decrypt job が artifact を upload
6. production は systemd `EnvironmentFile` 更新のため deploy job が新しい `.env` を EC2 へ送り、systemd が再起動

### 4. Branch Migration (main → develop)

#### 目的

default branch を `main` から `develop` へ移し、production 昇格用の `main` は明示的に release branch として運用する。

#### 手順 (4 child repo 共通、`gh` で 1 repo ずつ実行)

1. **preflight**: 各 repo の `gh api repos/{owner}/{repo}` で default branch が `main` であることを確認、open PR / protected branch 設定を snapshot
2. **新 branch 作成**: `git fetch origin main:main && git checkout main && git push origin main:develop`
3. **PR retarget**: open PR を一括 retarget。`gh pr list --state open --json number,baseRefName` → 1 PR ずつ `gh pr edit <n> --base develop`
4. **default 切替**: `gh api -X PATCH repos/{owner}/{repo} -f default_branch=develop`
5. **branch protection 複製**: develop 用 ruleset を GitHub API で作成。`main` 既存 ruleset を取得 → `target` を `develop` に変えて新規作成
6. **main freeze**: `main` branch に push できないよう ruleset 更新 (`required pull request: true, required_approving_review_count: 2`, **allow force push: false, allow deletions: false**)。release 時のみ `main` への PR を `develop` 経由で通す
7. **CI workflow 更新**: `.github/workflows/*.yml` の `on.push.branches: [main]` を `[develop]` に、`on.pull_request.branches: [main]` を `[develop]` に書き換え。release 用 workflow は `main` 維持
8. **ADR 追記**: 各 repo に `docs/adr/000N-default-branch-develop.md` を作成。理由 / 手順 / rollback plan を記述
9. **README / AGENTS.md 更新**: clone 手順、branch 命名、release flow の記述を `develop` ベースに
10. **postflight**: `gh pr list --state open` で retarget 漏れ確認、`git log --oneline -1 main` と `develop` が同じ commit を指していることを確認

#### 影響範囲と rollback

| 影響 | 対応 | rollback |
|---|---|---|
| open PR の base | retarget to develop | `gh pr edit <n> --base main` で戻す |
| branch protection | develop に同一 ruleset 作成 | ruleset 削除 + main を default に戻す |
| GitHub Actions triggers | `branches: [develop]` へ書き換え | `branches: [main]` に戻す commit |
| ローカル clone | `git clone -b develop <url>` がデフォルト | `git checkout main` で対応 |
| ADR の branch 参照 | 新 ADR で履歴管理 | 旧 ADR 撤回 + 新 ADR を deprecated 化 |
| CloudFlare / deploy tag 選択ロジック | `main` を production の source-of-truth として維持 | CI は default branch を参照しているため確認必要 |

#### `main` の今後

- sops loader の KMS key とは独立。loader は default branch に依存せず、env で復号 key を選ぶ
- `main` は **production release 専用 branch**。release tag (`v0.x.y`) を打つ直前に develop から cherry-pick または merge で同期
- 通常の開発作業 (feature branch → develop → release 時 main 同期) のフロー

### 4a. Production Boot-Time Decrypt (systemd)

`.env.<env>.sops` は repo に commit されるが、`.env.<env>` (plain) は gitignore で EC2 上にも commit されない。production では systemd が **boot 時に loader を実行** し `.env.production` を生成する。

systemd unit 例 (`/etc/systemd/system/tastile-web.service`):

```ini
[Service]
Type=simple
User=tastile
WorkingDirectory=/opt/tastile-web
EnvironmentFile=/opt/tastile-web/.env.production
ExecStartPre=/opt/tastile-web/scripts/sops-decrypt.sh --env=production
ExecStart=/usr/bin/bun run start
Restart=on-failure
```

`scripts/sops-decrypt.sh` は `scripts/sops-decrypt.ts` を EC2 上で bun runtime から呼び出す薄い shell wrapper。`/opt/tastile-web` には `.env.production.sops` (ciphertext) と `.sops.yaml` (KMS key ARN 設定) が deploy artifact として配置される。

- EC2 instance profile に `kms:Decrypt` 権限が付与されていることを preflight で確認
- `ExecStartPre` が失敗すると systemd がサービス起動を中断し、AWS SSM Parameter Store からの値復元 fallback が走る (runbook 参照)
- boot 完了後 `.env.production` は filesystem に残り続け、起動の度に再復号される。decrypt 結果の cache は行わない (rotation を即反映するため)

AWS SSM / Secrets Manager との関係:

- AWS SSM は `CLOUD_API_BASE` / `RUST_API_URL` 等の **sops scope 外** の値を引き続き systemd EnvironmentFile 経由で配信
- `.env.production` (sops復号) と systemd の AWS SSM 由来値が衝突した場合、systemd は後勝ち (後の EnvironmentFile が上書き)。これを避けるため、`.sops.yaml` で encrypt する key を application secret (STRIPE_*, BETTER_*, GOOGLE_*, APPLE_*, BRIDGE_SECRET, RDS password 等) に限定し、infra URL 類は AWS SSM 側に残す

### 5. Error Handling + Testing + Rollback

#### Failure modes

| Failure | 検出 | loader の挙動 | CI 挙動 | 手動復旧 |
|---|---|---|---|---|
| `sops` binary 不在 | `command -v sops` | exit 2 + "sops not installed; see runbook" | job 失敗 | install 手順 docs |
| AWS credentials 不在 | `STS.GetCallerIdentity` (loader 冒頭で呼ぶ) | exit 3 + "AWS credentials not configured" | job 失敗 | `aws sso login` / IAM role 確認 |
| KMS key policy で deny | `KMSClient.decrypt` が `AccessDeniedException` | exit 4 + KMS ARN を表示 | job 失敗 | KMS key policy 修正 / principal 追加 |
| KMS API throttle | `KMSClient.decrypt` が `ThrottlingException` | loader relies on sops internal AWS-SDK retry (default ~3 attempts, exponential backoff); loader itself has no retry code | sops 内 retry 失敗で exit non-zero → job 失敗 | 連続失敗なら key policy 確認 / step 2 の cache を併用 |
| `.env.<env>.sops` 不在 | loader が source file 未発見 | exit 5 + 該当 path 一覽 | job 失敗 | decrypt job の `inputs.env` 確認 |
| decrypt 結果が空 / parse error | loader が `.env` parser で key 0 個 | exit 6 + decrypt 結果 size | job 失敗 | `.env.<env>` の中身確認 |
| KMS Encrypt 権限不足 (developer local) | `sops --encrypt` が `AccessDeniedException` | shell exit code 透過 | N/A | IAM user / SSO role に KMS Encrypt 追加 |

#### Audit logging

loader は各復号で **stdout に 1 行 JSON** を出力:

```json
{"ts":"2026-08-27T10:00:00Z","event":"decrypt","env":"development","source":".env.development.sops","target":".env.development","kms_arn":"arn:aws:kms:ap-northeast-1:...:key/...","aws_caller_arn":"arn:aws:sts::...:assumed-role/..."}
```

CI では GitHub Actions log に出る (artifact には含めない)。AWS CloudTrail 側にも KMS Decrypt call の記録が残るため cross-check 可能。

#### Testing strategy

| Test | 目的 | 頻度 | 場所 |
|---|---|---|---|
| loader unit test (`bun test scripts/sops-decrypt.test.ts`) | AWS SDK mock + `sops` mock で正常系 / 各 failure mode を再現 | PR ごと | 各 repo CI |
| `--check` mode CI job | `.env.<env>.sops` が復号可能であることを確認 (本番値は artifact に保存しない) | PR ごと | decrypt reusable workflow 内に step 追加 |
| integration test (週次) | staging KMS key + staging credential で `.env.staging` を実際に decrypt → cargo test / bun run build | 週次 + main マージ前 | staging CI |
| manual rotation drill | 1 secret を rotate して end-to-end を通す (PR → merge → decrypt → artifact → build → deploy) | 四半期 | runbook に手順化 |
| rollback drill | sops 復号を切って AWS SSM / Secrets Manager のみで production が動くことを確認 | 四半期 + sops incident 後 | runbook |

#### Rollback plan (sops 全体)

1. loader を旧版へ戻す (旧 commit を deploy tag として打ち直す)
2. `.env.<env>` を AWS SSM Parameter Store から `aws ssm get-parameters --query 'Parameters[*].Value'` で復元し、systemd EnvironmentFile を上書き
3. systemd restart
4. KMS key の Decrypt 権限を revoke (incident response)
5. CI の decrypt job を skip し、AWS からの取得 workflow へ一時切替 (reusable workflow を `if: false` で disable)

`.env.<env>.sops` の commit 自体は無害 (暗号文) なので、緊急時に repo から消さず KMS 側だけで遮断できる。

#### Rollback plan (branch migration)

1. `gh api -X PATCH repos/{owner}/{repo} -f default_branch=main` で default を戻す
2. develop の branch protection を削除
3. main の保護を復元 (preflight snapshot から)
4. open PR の base を retarget し直す
5. CI workflow の `branches:` を `main` へ戻す commit
6. ADR を撤回 (`Status: Deprecated`)

## Risks

1. **KMS API quota** — region 全体で `KMS Decrypt` が throttle すると CI 全体が止まる。CI region 選定 (ap-northeast-1) と service quota (default 5500 req/s) は十分余裕があるが、incident response として KMS quota 増を AWS サポートに申請する path を runbook に残す。
2. **sops binary 脆弱性** — `sops` CLI は Go 製だが release を supply chain 検証する手段 (sha256 + signature) を CI install step に追加する。
3. **cross-repo rotation drift** — `TASTILE_WEB_BRIDGE_SECRET` のような cross-repo secret は同期更新が必要。runbook に「producer repo が canonical、変更 PR は consumer repo へも同時」を明記するが、人手のため drift の可能性は残る。**長期**: producer repo の webhook で consumer repo の `*.sops` を自動再暗号化する仕組みを別 ADR で検討。
4. **branch 移行時の CI matrix 不整合** — `on.push.branches: [main]` を `[develop]` へ書き換える際、release 用 workflow (tag trigger) は `main` 維持を忘れやすい。preflight で list し、postflight で trigger 履歴を確認する。
5. **EC2 instance profile の KMS Decrypt 権限漏れ** — production decrypt で EC2 が KMS Decrypt を呼べないと systemd 起動が失敗する。production 切替前に dry-run test を staging で通す。

## References

- AGENTS.md (workspace canonical contract): `C:/Users/rebui/Desktop/tastile/AGENTS.md`
- 関連 memory:
  - `AWS-only, no Supabase` — KMS 利用は既存 AWS スタックと整合
  - `tastile-web required env vars` — systemd EnvironmentFile の現状
  - `TASTILE_WEB_BRIDGE_SECRET drift` — 同期問題の直接の動機
  - `tastile-v1 RDS host+password` — Secrets Manager 自動 rotation との並列維持
  - `CI is the gate, not just deploy step` — CI decrypt job の位置付け
  - `Docs in child repos not root` — 実装時の runbook は `tastile-{web,core,desktop}/docs/runbooks/` 配下
- 既存 spec の参考: `docs/superpowers/specs/2026-08-25-p1-ds-token-plumbing-design.md`

## Open Questions

(現時点で none — すべての clarifying question は確定済み)