# GitHub OIDC の一時 dev 検証

正本は `architecture/model/security.yaml` の `ctl.github-infisical-development-proof` と `poc.infisical-workload-auth`。この実装は GitHub 経路の実認証と拒否を検証する。

`config.json` は非秘密 pointer と canary の SHA-256 のみ。canaryはcryptographic random32bytes以上で生成し、推測可能な固定値を使わない。実値は Infisical の dev project / dev / `/tastile/oidc-g4-proof/OIDC_PROOF_CANARY` に一時保存する。

## 契約

- trusted direct workflow の `workflow_ref`、repository ID / owner ID、release branch、event、issuer、audience、subject を exact に固定する。reusable workflow 専用の `job_workflow_ref` を使わない。
- RESTでのidentity作成はauthMethodsが空。Universal Authが無いことをreadbackし、存在する場合だけ除去する。OIDCだけが付いていることを確認してから project membership を割り当てる。org no-access、指定 canary の read/describe、TTL/max300s、uses1。
- release push は token exchange200 と1回の canary read200/hash一致を確認する。同repo PRと別workflowは新しい GitHub ID tokenを取得し、exchange401/403を確認する。GitHubのtoken発行失敗、Infisical500、予期しないexchange200は拒否成功に数えない。
- response token / secret value は RAM だけ。log/artifact は許可 claim subset、source SHA、HTTP status、結果だけ。HTTP redirectを追わず、各requestを15sで制限する。
- mint hostはexact allowlist。初回実PRのGitHub jobで観測した `run-actions-2-azure-eastus.actions.githubusercontent.com` / `run-actions-3-azure-eastus.actions.githubusercontent.com` と既知の `vstoken.actions.githubusercontent.com` を使う。実runnerで差があればbearerを送る前に失敗し、hostnameだけをreceiptへ記録する。実providerの根拠を確認してからallowlistを更新する。
- `enabled:false` は撤去済みの明示状態。結果は `inactive` であり、認証成功・拒否の証跡に数えない。

## 検証と撤去

`bun test infra/infisical-workload-proof/probe.test.ts` は secret非出力、error/denial区別、project境界、redirect拒否と inactive を確認する。実 GitHub/Infisical の結果を別途取得するまで PoC 成功を主張しない。

実 probe の後に一時 membership / identity / role / canary / owned folder を削除して不存在を確認し、configをinactiveへ戻す。既存の恒久CIidentityは対象外。未知の値がfolderへ追加されていた場合は削除せず状態を記録する。staging workload / missing-secret runtime / production entitlement は別gate。
