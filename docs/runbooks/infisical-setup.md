# Infisical workspace setup and cutover

This runbook configures the Infisical project required by ADR-0012. Do not remove old secret stores until the live cutover checklist is complete.

## Project contract

One self-hosted Infisical project is the target for Tastile. Its public HTTPS hostname must be a generic hostname on a domain owned by the user and must not contain `tastile`, because the instance is not Tastile-specific. Its domain and project ID are mandatory in every CLI and CI integration; missing values must fail closed instead of falling back to Infisical Cloud. Environment slugs are `dev`, `staging`, and `prod`, corresponding to development, staging, and production.

| Repository | Base secret path | Examples |
|---|---|---|
| tastile-core | `/tastile/core` | API/worker runtime, DB application role, web bridge, deployment probes |
| tastile-web | `/tastile/web` | BetterAuth, OAuth, SES, Stripe, Cloudflare Worker runtime |
| tastile-android | `/tastile/android` | publishable build configuration, release signing, Play publishing |
| tastile-desktop | `/tastile/desktop` | private core checkout and R2 release publishing |
| tastile-brands | `/tastile/brands` | no secret values currently identified; keep the path reserved |

Use a child path for platform credentials where an identity needs narrower access, such as `/tastile/web/cloudflare` or `/tastile/android/release`. Local and remote jobs must select identical paths for the same environment. `preview` deployments use the `staging` secret environment with a dedicated child path.

## Machine identities

Create one GitHub OIDC machine identity per repository and GitHub deployment environment. Bind the subject to the exact repository and GitHub environment (`repo:tastile/<repo>:environment:<development|staging|production>`). Map GitHub's `development` / `production` names to Infisical slugs `dev` / `prod`. Grant only that environment's service path and required integration child paths. Add the following non-secret GitHub Environment variables to each applicable repository:

- `INFISICAL_IDENTITY_ID`: machine identity ID for that GitHub environment.

Do not configure Universal Auth client secrets for GitHub Actions.

On each EC2 instance, configure an AWS IAM machine identity for Infisical, bind it to the instance role ARN, and grant only the matching service path/environment. Instance role trust and permissions must be reviewed separately; never add a static Infisical token to EC2.

## Developer setup

Install the official Infisical CLI, authenticate to the self-hosted domain, and use explicit `--domain`, `--projectId`, `--env`, and `--path` selectors. Never rely on the CLI's Cloud default. Normal app commands must not require a local `.env*`, `.dev.vars`, `local.properties`, or `gradle.properties` containing secrets.

Some tools require a dotenv file on disk. Restore one explicitly from the workspace root after authenticating:

```powershell
pwsh -NoProfile -File .\scripts\restore-infisical-env.ps1 -Repository web -Environment development
```

The script writes the selected web environment to its ignored `.env.development`, `.env.staging`, or `.env.production` file. For core, Android, and desktop it writes an ignored `.env` snapshot. It fetches only from the fixed `/tastile/<repository>` path and the configured self-hosted project; it never prints secret values and refuses to replace an existing file unless `-Force` is supplied. Review the consumer before using an on-disk snapshot: Android/desktop build and runtime workflows should continue to inject values with Infisical CLI because they do not load dotenv files automatically. Use `-ValidateOnly` to check local selectors without fetching secrets. Add `-RemoveAfterRestore` for a fetch-and-validate check that removes the generated file immediately afterward. Remove generated snapshots after use.

The connected server identifies itself as Infisical `v0.165.15 Free`, and its UI gates folder-level access controls behind a paid entitlement. Infisical's self-hosted activation guide says paid features require a license key in the server's `LICENSE_KEY` environment variable. A Cloud plan purchase or upgrade does not configure this separate server. Do not change project roles or delete legacy sources until the self-hosted license/configuration is confirmed and path-scoped access works. All 12 newly created GitHub OIDC identities remain No Access.

## 現在の移行状態 (2026-09-24)

- Infisical CLI 0.43.133 が利用でき、端末は `https://secrets.rebuildup.dev` の self-hosted instance に Google user login 済み。CLI の `login status` で認証済みを確認した。
- HTTPS と DNS は応答し、self-hosted Infisical 0.165.15 の `Tastile` project (ID: `f2890cb7-599b-4bd6-b7b4-a47aeb9b324b`) を CLI から読める。以前の「外部 HTTPS 不可」「target に値なし」という記録は古い。
- `dev` / `staging` / `prod` と `/tastile/{core,web,android,desktop,brands}` の path は存在する。
- 2026-09-24 の値を表示しない inventory では、core は dev/prod 各8キー、web は dev 15キー、desktop は dev 6キー。staging は全 service path が空で、web prod と brands の全 environment が空。Android は旧 `tastile-android` project の dev 4キー/prod 9キーを canonical path へコピーし、値を完全一致比較済み。
- restore helper は実データで web/dev 15、core dev/prod 各8、Android dev/prod 4/9、desktop/dev 6キーを復元し、各生成ファイルを削除した。secret 値は出力していない。この検証はローカル復元を確認するもので、child 設定・CI・production runtime の切替確認ではない。
- root の `.infisical.json` は self-hosted project ID/domain を指す。child 設定と core/web/desktop の composite action はローカル作業中で未 push、Android 設定は別の legacy project ID を指しており、canonical project への統一は未完了。2026-09-24 に canonical project で core/web/android/desktop × development/staging/production の12 machine identity を作成し、GitHub OIDC subject、audience `https://github.com/tastile`、1時間TTLを設定した。全identityのproject roleは No Access。
- self-hosted server の UI は `v0.165.15 Free` と表示し、folder-level access control を有料機能として制限する。Hetzner 上の Docker Compose deployment を SSH で read-only 確認し、`/srv/infisical/.env` は mode `0600`、Compose の `env_file` 参照はあるが、`.env` と Compose のどちらにも `LICENSE_KEY` は設定されていないことを確認した。Infisical の [self-hosted activation docs](https://infisical.com/docs/self-hosting/ee) は paid features を使うには server の `LICENSE_KEY` 環境変数へ発行済み license key を設定するよう案内する。別契約の Cloud plan はこの server の状態を変更しない。既存 license key の server への設定は、その値の安全な受け渡し経路が確定するまで保留し、12 OIDC identity は No Access のままにする。server files / containers は変更していない。GitHub Environment variables と workflow の切替も未完了。
- Android の `local.properties` には `sdk.dir` だけがあり、アプリ secret は確認されなかった。旧 Android Infisical project の dev 4キー/prod 9キーは `/tastile/android` へ転送し、JSON 全値の完全一致を確認した。複数行の `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` は CLI の file-value syntax で転送し、target と source の9キーすべてを再比較した。旧 project は残し、Android config/CI/署名・Play publishing の読み取りと実動作を確認するまで削除しない。
- web の `.env.development.sops` / `.env.production.sops` は追跡中で、GitHub Secrets に SOPS age keys が残る。端末に age private key はなく、GitHub Secrets の値は workflow 経由以外では読めない。
- GitHub Secrets の値、AWS SSM / Secrets Manager、EC2 EnvironmentFile、Cloudflare Worker/R2 と旧 Infisical Cloud の値は旧 store に残る可能性があり、消去前の consumer inventory と live cutover が必要。
- 既存 consumer と旧 secret store は稼働を維持する。各 path/environment の読み取り、CI、runtime、live deploy/startup が確認できるまで旧 source / ciphertext / copy を削除しない。

## Value migration

1. Migrate remaining GitHub Secrets, SOPS ciphertext, AWS SSM / Secrets Manager values, and platform credentials directly into the matching Infisical environment/path. Keep values out of terminal output, shell arguments, job logs, and files that enter Git.
2. Confirm the same selected keys are readable from a developer CLI session and the matching GitHub OIDC/EC2 machine identity.
3. Run each integration's live deploy/startup check; verify Cloudflare Worker runtime bindings, Android signing + Play upload, desktop R2 upload, database role login, and core/web service startup.
4. Remove SOPS ciphertext and keys, local secret files, GitHub secret values, AWS SSM/Secrets Manager application secret copies, and legacy EnvironmentFiles only after the matching consumer check succeeds.
5. Revoke old decrypt/read permissions and rotate any credentials that were copied to multiple legacy stores.

For values held in another Infisical project, use `scripts/migrate-infisical-secrets.ps1` from the workspace root. It requires explicit source and target selectors, rejects a non-empty target, writes each secret value to a temporary current-user-only file under ignored `.tmp/`, imports each value through the CLI's file-value syntax so multiline values remain intact, suppresses CLI output, compares every key and full value from Infisical JSON exports after import without displaying them, and retains the source. Import is not transactional: run it while no other writer is changing the destination path, and inspect the target before retrying after any error because an import can partially succeed. Example:

```powershell
pwsh -NoProfile -File .\scripts\migrate-infisical-secrets.ps1 `
  -SourceProjectId <legacy-project-id> -SourceEnvironment dev -SourcePath / `
  -TargetEnvironment dev -TargetPath /tastile/android
```

Run one environment/path at a time. Do not use this helper for SOPS/GitHub/AWS sources whose access and integrity have not been established.

## External prerequisites

Self-hosted HTTPS and interactive user login now work. Remaining work includes confirming the self-hosted server's paid license/configuration for folder-level access controls or another approved least-privilege mechanism, GitHub Environment variables, values absent from target paths, secret-safe migration for GitHub/SOPS sources, Android/Cloudflare/platform integrations, and live consumer cutover checks. The current web SOPS age private keys are held only in GitHub Secrets, so migration must run in a controlled job after a scoped write grant is available. Never paste a secret or access token into a repository file or chat.
