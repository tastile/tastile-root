# Infisical workspace setup and cutover

This runbook configures the Infisical project required by ADR-0012. Do not remove old secret stores until the live cutover checklist is complete.

## Project contract

The self-hosted Infisical instance uses one project per environment because the current Free plan does not expose folder-level ACLs. Each consuming child repository records the project IDs and machine identity IDs in its own `.infisical.json`; root has no Infisical project configuration because it has no runtime environment. Clients must use the matching project ID, environment slug, and service path and fail closed instead of falling back to Infisical Cloud. The projects are `tastile-dev` (`949b4193-a226-4620-8371-726a37c7195b`), `tastile-staging` (`44081e84-5983-4cc2-9fc9-dca5363005e1`), and `tastile-prod` (`ab532e90-acde-40e6-a206-3976743e5da5`). Use matching environment slugs `dev`, `staging`, and `prod` inside the corresponding project. The public HTTPS hostname must be a generic hostname on a domain owned by the user and must not include `tastile`.

| Repository | Base secret path | Examples |
|---|---|---|
| tastile-core | `/tastile/core` | API/worker runtime, DB application role, web bridge, deployment probes |
| tastile-web | `/tastile/web` | BetterAuth, OAuth, SES, Stripe, Cloudflare Worker runtime |
| tastile-android | `/tastile/android` | publishable build configuration, release signing, Play publishing |
| tastile-desktop | `/tastile/desktop` | R2 release publishing |
| tastile-brands | `/tastile/brands` | no secret values currently identified; keep the path reserved |

Use a child path for platform credentials where an identity needs narrower access, such as `/tastile/web/cloudflare` or `/tastile/android/release`. Local and remote jobs must select identical paths for the same environment. `preview` deployments use the `staging` secret environment with a dedicated child path.

## Machine identities

Create one GitHub OIDC machine identity for each Infisical environment, bound to the four explicit Tastile repository names and the matching GitHub environment (`development`, `staging`, or each repository's production environment). Assign the identity only to its matching environment project. During the approved migration window, the identities have the Member role to import and verify secrets; downgrade all three to the built-in read-only Viewer role after the values are verified. This grants shared access to all four repositories' paths inside that environment; never assign an identity to another environment project. Add the following non-secret GitHub repository variables to each applicable repository for migration workflows:

- `INFISICAL_IDENTITY_ID_DEV`, `INFISICAL_IDENTITY_ID_STAGING`, `INFISICAL_IDENTITY_ID_PROD`: machine identity IDs.
- `INFISICAL_PROJECT_ID_DEV`, `INFISICAL_PROJECT_ID_STAGING`, `INFISICAL_PROJECT_ID_PROD`: matching project IDs.
- `INFISICAL_DOMAIN`: the self-hosted Infisical HTTPS URL.

Do not configure Universal Auth client secrets for GitHub Actions.

On each EC2 instance, configure an AWS IAM machine identity for Infisical, bind it to the instance role ARN, and grant only the matching service path/environment. Instance role trust and permissions must be reviewed separately; never add a static Infisical token to EC2.

## Developer setup

Install the official Infisical CLI and authenticate to the self-hosted domain. The restore and migration helpers read project IDs from the target child repository's `.infisical.json`, create a short-lived CLI configuration in ignored `.tmp/`, then pass explicit `--domain`, `--env`, and `--path` selectors. Never rely on the CLI's Cloud default or an implicit project selector. Normal app commands must not require a local `.env*`, `.dev.vars`, `local.properties`, or `gradle.properties` containing secrets.

Some tools require a dotenv file on disk. Restore one explicitly from the workspace root after authenticating:

```powershell
pwsh -NoProfile -File .\scripts\restore-infisical-env.ps1 -Repository web -Environment development
```

The script writes the selected web environment to its ignored `.env.development`, `.env.staging`, or `.env.production` file. For core, Android, and desktop it writes an ignored `.env` snapshot. Secret exports and schema-sync JSON files are kept under the workspace root `.tmp/`, protected to the current OS user, and deleted after use. After restoring, the script calls `scripts/sync-infisical-env-example.ps1` with the same repository and environment; it rewrites that repository's tracked `.env.example` with exactly the restored key names and blank values. It never copies secret values to the example or prints them. The restore script fetches only from the fixed `/tastile/<repository>` path and the matching environment project; it refuses to replace an existing dotenv file unless `-Force` is supplied. Review the consumer before using an on-disk snapshot: Android/desktop build and runtime workflows should continue to inject values with Infisical CLI because they do not load dotenv files automatically. Use `-ValidateOnly` to check local selectors without fetching secrets. Add `-RemoveAfterRestore` for a fetch-and-validate check that removes the generated dotenv file after refreshing `.env.example` from that same Infisical environment. Remove generated snapshots after use.

The connected server identifies itself as Infisical `v0.165.15 Free`, and its UI gates folder-level access controls behind a paid entitlement. Infisical's self-hosted activation guide says paid features require a license key in the server's `LICENSE_KEY` environment variable. A Cloud plan purchase or upgrade does not configure this separate server. The user does not know where to obtain an existing license key, so the migration uses environment-specific projects and does not depend on that paid feature. Before CI can read secrets, assign one identity per environment the read-only Viewer role in only that environment project and verify OIDC subjects. Do not delete legacy sources before target values and CI/runtime behavior are verified.

## 現在の移行状態 (2026-09-26)

- self-hosted Infisical の dev / staging / prod project と、Core / Web / Android / Desktop の `.infisical.json` は存在する。Root 自体にruntime secretsはなく、Infisical project設定も `.env.example` も置かない。各 child の GitHub OIDC identity は対応projectだけを読み取る。Core と Web のruntime identityは環境別projectでViewer、DB runtime identityは専用DB projectのViewerでAWS Authのみを使用する。
- restore helper で開発環境の schema を再生成し、Core 9 / Web 15 / Android 4 / Desktop 6 のキー名が空値で一致することを確認した。各環境からの `-RemoveAfterRestore` 検証後、生成したdotenv fileはすべて削除した。Core / Web / Android / Desktop の release branch では、それぞれ1つだけ `.env.example` が残り、SOPSファイルはない。
- Web release branch の GitHub OIDC fetch matrix は dev / staging / prod すべて成功し、production secrets を使ったbuildも成功した。Android release branch のproduction OIDC検証は成功した。Core release branch のproduction OIDC検証は成功。Core staging deploy run `36186349841` は、staging deploy roleへap-northeast-1限定の `ec2:DescribeInstances` と `rds:DescribeDBInstances` を追加した後、quality gate / rollback compatibility / binary build / AWS OIDC / isolated target verification を通過したが、artifact upload 中に公開 ECR pull rate limitで失敗した。artifact upload自体と、後続のhost deploy / Infisical smoke-secret fetch / API検証は未実行。Core PR #149 がrunner AWS CLIへ切り替え、未対応時のfail-closed checkを追加中。staging cutoverは新しいrelease runの全検証が成功するまで未完了とする。
- Desktop の `scripts/check.ps1` は225/225 testsを含む全gateに成功し、branch `30` のcommit `134048dfb6605bbf54518fdb475bb845d1bf08f9` に対するGitHub CI run `36192904147` の `unit-tests` と `desktop-build`、独立reviewも成功した。PR #36 (merge commit `7b394cdcbb6fcd44a4369d7e2fafe307c28a8eff`) をrelease branchへ統合し、remote `release-0-7-0` には `CORE_REPO_READ_TOKEN` / SOPS / Core checkout参照がない。Desktop buildはself-containedのため、このtokenをInfisicalへ複製しない。default `main` には旧CI consumerが残るのでGitHub secretは保持する。Desktop R2 publishingのInfisical OIDC live uploadは未確認。
- 既定branchにはまだ旧SOPSが残る。Root `main` はSOPS helper / Terraform / runbook / `.env.example`、Web `main` は `.sops.yaml`、2つの暗号化dotenv、workflow、scripts / runbook、Desktop `main` は `.sops.yaml`、workflow、scripts / runbookを追跡している。Core `main` には `.env.dev.example` と `.env.product.example` が残り、Android `main` にSOPSまたはenv schema fileはない。Root PR #36 はrelease branch向けでReady、CIと独立reviewは成功しており、merge待ち。4 childのSOPS removal / Infisical restore変更はそれぞれrelease branchに統合済みだが、main integrationとdefault branch上の削除は未完了。SOPSは今後の取得・復号・runtime経路に使わない。
- Webの `SOPS_AGE_KEY_*` を含む旧GitHub Secrets、Cloudflare preview/staging credentials、Desktopのproduction publishing credentials、Core/Webの旧deploy identifiersとbridge copiesは残っている。AWSにはapplication用Secrets Manager/SSM copiesが残る。現行RDS管理master secretsはRDS管理対象なので削除対象に含めない。各old copyは、そのconsumerのInfisical切替とlive確認後にのみ削除する。
- `/tastile/db` にprod / staging用DB URLを登録し、現行RDS endpoint/databaseへの接続とnon-admin runtime roleの権限を確認した。Core prodにはdelivery probe tokenを登録済み。Core stagingのdeployとAPI応答、Web / Android / Desktopの対応するproduction runtime・publishing経路、Web Cloudflare Worker、Desktop R2への実動作はまだ完了していない。
- 現在のdefault-branch release PRはrelease gateでDraftのまま。Root #31はR02 / R04 / R05 / R06 / R07、独立RC判定、人間の公開承認を必須としている。移行PRの存在やrelease branch CIだけでは、これらのgateを代替しない。各child release branchのmain統合、全runtime / platform live cutover、old-store削除は引き続き必要。

## 追記：移行状態 (2026-09-26 16:45 UTC; SoT集約は root Issue #35)

- staging ECR rate-limit blockerは解消済みでblockerから除外する。Core staging Deploy run `36212632469` は merge SHA `8c44688` で end-to-end SUCCESS (quality / rollback / build / OIDC / isolated target / upload / host deploy / smoke fetch / API検証)。brands config mismatchも解消済み (brands Issue #3 / PR #4 closed、3-project `.infisical.json` で一致)。
- Web OIDC matrix run `36216564098` は dev / staging / prod すべて SUCCESS。Core OIDC run `36216478463`、Android OIDC run `36213081307` も SUCCESS。Web deploy run `36218050244` のSSM quoting bugは修正merge済み (Web PR #151) で当該runはobsolete。fresh prod deploy (tag/dispatchのみ) とstaging OIDC run `36228615924` の人間承認が残る。
- Core prod deliveries-500はapp bug疑い (Core #150) でrerun停止。delivery 4-keyは `/tastile/core` に未登録のまま (Core #159) で、live migrationはDraft承認PR Core #169 (sentinel) の人間承認待ち。`TASTILE_DELIVERY_KEY` はrotateしない。Core PR #155 (RDS app-role cutover impl) はmerge済み。DB cutover本体 (Core #152 / PR #171) はChatGPT側の作業域でoff limits。
- 注意: release-1-0-1 head `b162c9d` (PR #170 merge後) で Deploy staging run `36254160103` がstep実行なしでFAILED、Verify OIDC run `36254160147` が prod-secret presence stepでFAILED (delivery 4-key欠落と整合)。current headではstaging/OIDC greenを主張できない。ownerのrerun/再検証が必要。
- Root PR #36 / #41 / #42 は `release-0-6-0` へmerge済み (ticket→release統合のみ)。release→main統合と公開承認は人間のみ。legacy store削除は本sweepではゼロ (consumer live proofを満たしたscopeなし)。

## 履歴：移行状態 (2026-09-24; superseded)

- Infisical CLI 0.43.133 が利用でき、端末は `https://secrets.rebuildup.dev` の self-hosted instance に Google user login 済み。CLI の `login status` で認証済みを確認した。
- HTTPS と DNS は応答し、self-hosted Infisical 0.165.15 の `Tastile` project (ID: `f2890cb7-599b-4bd6-b7b4-a47aeb9b324b`) を CLI から読める。以前の「外部 HTTPS 不可」「target に値なし」という記録は古い。
- `dev` / `staging` / `prod` と `/tastile/{core,web,android,desktop,brands}` の path は存在する。
- 2026-09-24 の値を表示しない inventory では、core は dev/prod 各8キー、web は dev 15/prod 23キー、Android は dev 4/prod 9キー、desktop は dev 6キー。全 service の staging と desktop prod は空で、brands の全 environment も空。Android の legacy `tastile-android` project から元の Tastile project へコピーした dev 4/prod 9キーは、source と全値一致を確認済み。web prod の23キーは target inventory で確認したが、SOPS source との比較はまだ。
- 環境別projectの追加後、元の Tastile project から core dev/prod 8/8、web 15/23、Android 4/9、desktop dev 6キーを移行し、各 key と全 secret 値の完全一致を確認した。source projectは残したまま。
- 復元helperを環境別project向けに更新し、core/web/Android prod と全4 service dev からの実復元を検証した。生成 `.env` は各回削除し、各 repo の `.env.example` はdev用の空値schemaへ再生成した (core 8、web 15、Android 4、desktop 6 keys)。secret値は表示していない。この確認はlocal restore/schemaまでで、GitHub CI・production runtimeのcutover確認ではない。
- 旧 workflow inventory では GitHub Environment 名が core `staging` / `production`、web `preview` / `staging` / `production`、Android `android-release`、desktop `production` に分かれており、新しい `dev` / `staging` / `prod` の共有OIDC subjectとは一致しない。GitHub Environment variables とworkflowは未切替で、現在CIからは新 projectを読めない。
- self-hosted server の UI は `v0.165.15 Free` と表示し、folder-level access control を有料機能として制限する。Hetzner 上の Docker Compose deployment を SSH で read-only 確認し、`/srv/infisical/.env` は mode `0600`、Compose の `env_file` 参照はあるが、`.env` と Compose のどちらにも `LICENSE_KEY` は設定されていないことを確認した。Infisical の [self-hosted activation docs](https://infisical.com/docs/self-hosting/ee) は paid features を使うには server の `LICENSE_KEY` 環境変数へ発行済み license key を設定するよう案内する。別契約の Cloud plan はこの server の状態を変更しない。既存 license key を入手できないため、選択済みのFree対応環境別project設計へ変更した。既存の12 OIDC identitiesは旧Tastile projectでNo Accessのまま、新projectへはまだ割り当てていない。workflow cutover前にsubjectとproject権限を一致させて確認する。server files / containers は変更していない。
- Android の `local.properties` には `sdk.dir` だけがあり、アプリ secret は確認されなかった。旧 Android Infisical project の dev 4キー/prod 9キーは `/tastile/android` へ転送し、JSON 全値の完全一致を確認した。複数行の `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` は CLI の file-value syntax で転送し、target と source の9キーすべてを再比較した。旧 project は残し、Android config/CI/署名・Play publishing の読み取りと実動作を確認するまで削除しない。
- Web のremote default branchではSOPS ciphertextと `sops-decrypt` workflowがまだ追跡/有効で、GitHub Secretsには3つの `SOPS_AGE_KEY_*` が残る。新しいbranchではSOPS実行経路を削除済みだが、PRをdefault/release branchへ取り込んでconsumerを止めるまで旧 keys/ciphertextを削除しない。SOPSを使った追加復号・実行はしない。
- GitHub Secrets の値、AWS SSM / Secrets Manager、EC2 EnvironmentFile、Cloudflare Worker/R2 と旧 Infisical Cloud の値は旧 store に残る可能性があり、消去前の consumer inventory と live cutover が必要。
- 既存 consumer と旧 secret store は稼働を維持する。各 path/environment の読み取り、CI、runtime、live deploy/startup が確認できるまで旧 source / ciphertext / copy を削除しない。

## Value migration

1. Import remaining values from readable GitHub / AWS / platform sources into the matching Infisical environment/path using a controlled workflow. Do not invoke SOPS or treat encrypted SOPS files as a migration source; replace unavailable legacy-only values with newly rotated credentials from their issuing provider. Keep values out of terminal output, shell arguments, job logs, and files that enter Git.
2. Confirm the same selected keys are readable from a developer CLI session and the matching GitHub OIDC/EC2 machine identity.
3. Run each integration's live deploy/startup check; verify Cloudflare Worker runtime bindings, Android signing + Play upload, desktop R2 upload, database role login, and core/web service startup.
4. Remove SOPS ciphertext and keys, local secret files, GitHub secret values, AWS SSM/Secrets Manager application secret copies, and legacy EnvironmentFiles only after the matching consumer check succeeds.
5. Revoke old decrypt/read permissions and rotate any credentials that were copied to multiple legacy stores.

For values held in another Infisical project, use `scripts/migrate-infisical-secrets.ps1` from the workspace root. It requires explicit source and target selectors, rejects a non-empty target, writes each secret value to a temporary current-user-only file under ignored `.tmp/`, imports each value through the CLI's file-value syntax so multiline values remain intact, suppresses CLI output, compares every key and full value from Infisical JSON exports after import without displaying them, and retains the source. Add `-VerifyOnly` to compare an already populated destination without writing. Import is not transactional: run it while no other writer is changing the destination path, and inspect the target before retrying after any error because an import can partially succeed. Example:

```powershell
pwsh -NoProfile -File .\scripts\migrate-infisical-secrets.ps1 `
  -SourceProjectId <legacy-project-id> -SourceEnvironment dev -SourcePath / `
  -TargetEnvironment dev -TargetRepository android -TargetPath /tastile/android
```

Run one environment/path at a time. Do not use this helper for SOPS/GitHub/AWS sources whose access and integrity have not been established.

## External prerequisites

Self-hosted HTTPS and interactive user login work. GitHub OIDC exchange and secret reads have passed for Web dev / staging / prod, Android prod, and Core prod. Core staging run `36186349841` failed during artifact upload because the public ECR image pull was rate-limited; host deploy, Infisical fetch, and API verification were skipped. Core PR #149 replaces that image dependency; rerun staging after it lands. Desktop PR #36 removed the Core checkout credential consumer from `release-0-7-0`; default `main` still contains it. Do not copy `CORE_REPO_READ_TOKEN` to Infisical; delete the GitHub copy after main removes the consumer. Remaining work includes completing the Core staging deploy/API check, migrating any remaining platform values from readable source stores, completing each live consumer cutover, removing obsolete GitHub / AWS / Cloudflare copies, deleting all tracked SOPS files and SOPS age keys after main integration, and downgrading temporary import identities to Viewer. Never paste a secret or access token into a repository file or chat.
