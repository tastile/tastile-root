# Infisical workspace setup and cutover

This runbook configures the Infisical project required by ADR-0012. Do not remove old secret stores until the live cutover checklist is complete.

## Project contract

The self-hosted Infisical instance uses one project per environment because the current Free plan does not expose folder-level ACLs. Each consuming child repository records the project IDs and machine identity IDs in its own `.infisical.json`; root has no Infisical project configuration because it has no runtime environment. Clients must use the matching project ID, environment slug, and service path and fail closed instead of falling back to Infisical Cloud. The projects are `tastile-dev` (`949b4193-a226-4620-8371-726a37c7195b`), `tastile-staging` (`44081e84-5983-4cc2-9fc9-dca5363005e1`), and `tastile-prod` (`ab532e90-acde-40e6-a206-3976743e5da5`). Use matching environment slugs `dev`, `staging`, and `prod` inside the corresponding project. The public HTTPS hostname must be a generic hostname on a domain owned by the user and must not include `tastile`.

| Repository | Base secret path | Examples |
|---|---|---|
| tastile-core | `/tastile/core` | API/worker runtime, DB application role, web bridge, deployment probes |
| tastile-web | `/tastile/web` | BetterAuth, OAuth, SES, Stripe, Cloudflare Worker runtime |
| tastile-android | `/tastile/android` | publishable build configuration, release signing, Play publishing |
| tastile-desktop | `/tastile/desktop` | private core checkout and R2 release publishing |
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

## 現在の移行状態 (2026-09-25)

- self-hosted Infisical の環境別 project と各 repository の `.infisical.json` は存在する。Core/Web runtime identities は環境別 Core project で Viewer、DB runtime identities は別の DB project で AWS Auth のみ、同 project で Viewer。
- ユーザーはprod/staging両DB identityを対応する環境Core projectにもViewerとして追加することを承認した。再ログイン後、prod/staging両方の `Assign Existing` のidentity候補が `No options` と確認できた。既存DB identitiesは `Project` 管理であり別projectへ割当不可。新しいidentityは作成していない。現在の分離構成を維持し、Core runtime identityがCore project、DB runtime identityが専用DB projectを読む。
- Root restore helper で dev の core 8 / web 15 / Android 4 / desktop 6 keys を一時復元し、各 `.env.example` を更新した後、生成 `.env` を削除した。Core prod 8、Web staging 13 / prod 33、Android prod 9 も復元・削除を確認した。ただし Web staging の13 keys は Core 用の旧DB設定を含み、Web runtime に必要な BetterAuth 設定が欠けるため、Web staging の準備完了を意味しない。Core staging は bridge のみ、Android staging、desktop staging/prod は空。
- 旧 self-hosted `tastile` project との値を表示しない再照合では、core dev/prod (移行前各8 keys)、web dev (15)、Android dev/prod (4/9)、desktop dev (6) のsource key/value一致を確認した。core staging、web staging、Android staging、desktop staging/prod の旧 source path は空だった。Web prod の旧 source は23 keys、環境別 target は33 keysで、10 keys は target のみ。prod Web target の `TASTILE_WEB_BRIDGE_SECRET` は現行 AWS `tastile/v1/web-bridge` と完全一致し、Core prod に登録して再照合した。staging Web/Core bridge は一致、dev Web/Core bridge は新しい共通値にローテーションして再照合した。旧 source の値は consumer 切替まで保持している。
- Web local Infisical launcher は dev 15 keys を注入し、必須値の存在確認に成功。Web `bun run check` は154 files / 1172 tests pass、`bun run build:infisical` はprodの33 secretsでproduction build pass。GitHub OIDC、Cloudflare、EC2 runtimeのlive検証は未完了。
- Root #36、Core #142、Web #147 の Draft PR はremoteに公開済み。Web PRはSOPS workflow/ciphertext/loader削除を含むが、default branchでは `sops-decrypt` と `patch-stripe-env` workflowがまだactive。PR checksはpassしているがOIDC fetchとruntime cutoverは未検証。
- GitHub metadata inventoryではWeb repo secretに3つの `SOPS_AGE_KEY_*` が残るほか、Core/Web deploy identifiersやbridge secretのlegacy repository secretsも残る。これらは新workflowを対象branchで動作確認してから削除する。Web Cloudflare preview/staging secretsとCloudflare deploy workflowのInfisical切替も未完了。
- Core staging `/tastile/core` は bridge のみ。prod DB runtime project の `/tastile/db/TASTILE_DATABASE_URL` は Core prod の既存値から安全にコピーし、移行先の完全一致を確認した。staging DB runtime project は path 作成済みで値は未登録。prod/stagingのCore/DB runtime cutoverとDB application role loginは未検証。RootのGitHub #36はmigration codeをremoteへpush済み。Core #142、Web #147などの移行差分は子repo worktreeに未commit変更として残る。
- GitHub Web deploy workflow用のAWS role/region/bucket/instance IDは公開variablesに設定済み。旧GitHub/AWS/Cloudflare/EC2 copiesは対応consumerのcutover確認まで保持する。PR作成済みだがmerge、runtime deploy、old storeの削除は未完了。

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

1. Migrate remaining GitHub Secrets, SOPS ciphertext, AWS SSM / Secrets Manager values, and platform credentials directly into the matching Infisical environment/path. Keep values out of terminal output, shell arguments, job logs, and files that enter Git.
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

Self-hosted HTTPS and interactive user login work. The three environment OIDC identities exist, Universal Auth has been removed from them, and GitHub repository variables contain their public IDs and project IDs. Live GitHub OIDC exchanges and secret imports are not yet verified. Remaining work includes importing values absent from target paths, migrating GitHub/SOPS/AWS/platform sources, updating runtime workflows to the new project identities, live consumer cutover checks, and downgrading the migration identities from Member to Viewer. The current web SOPS age private keys remain in GitHub Secrets and must be used only by a controlled migration job. Never paste a secret or access token into a repository file or chat.
