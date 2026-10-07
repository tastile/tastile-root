# GitHub OIDC dev proof: 準備

この文書は f833da3 時点の準備記録。実 GitHub runner の認証結果と一時fixture削除は [result.md](result.md) を参照。現在の config は inactive。

2026-10-07（日本時間）。正本はctl.github-infisical-development-proof / poc.infisical-workload-auth。

## 観測済み

- architectureモデルをprovider変更前に更新し、generate/render/validateを通した（0errors、既存costadvisory1）。
- 一時identityはorg no-access / REST作成時authMethods空。OIDC添付後のreadbackはoidc-authだけ。Universal Authを作成していない。
- repository ID / owner ID / release ref / event_name / workflow_ref、issuer/subject/audience、TTL/maxTTL300、uses1をreadbackで照合した。
- dev project / devの専用一時folderとrandom32bytes canaryを作成し、describe/readValueだけのproject roleを割り当てた。実値とtokenはInfisical/RAMに限定し、config/metadataはpointer/hashのみ。
- Bun unit7cases / 22assertions / 0failure。拒否結果とnetwork/server failureを区別し、未許可mint hostではrequest bearerを送らない。

## 必須の次の検証

同repo実PRのInfisical exchange拒否、release pushのexchange200/read200/hash一致、同release refの別workflowの拒否を各実GitHubtokenで観測する。現在は全てpendingであり、unit/mockや設定readbackを実認証成功と読み替えない。

configは実probe用にactive。実runnerのmint hostがallowlistと違えばbearer送信前に失敗し、provider hostnameを確認してから修正する。probe完了後はmembership/identity/role/canary/owned folderを削除、不存在を確認してconfigをinactiveへ戻す。既存恒久CI bindingを保存する。staging GCP/missing-secret runtime/production entitlementは別gate。
