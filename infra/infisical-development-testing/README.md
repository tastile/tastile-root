# Infisical 開発・検証限定 overlay

ADR-0022 / `ctl.infisical-development-testing` に従う、v0.165.15固定image向けの評価用改変。
`guard.mjs` はorg/project/flagを限定する。`patch.mjs` はbase moduleのSHA256と2箇所のgateを
検証して、既存permission guard後のcustom role作成/更新へ例外を挿入する。
identity project membershipの割当/更新も、別moduleの固定SHA256と2箇所のgateを検証し、
同一org/project条件で限定する。organization membershipの割当は対象外。
global plan、license key、paid feature flag、secretのpermission enforcementは変更しない。

```powershell
bun test infra/infisical-development-testing/guard.test.ts
```

base imageはdigestで固定し、helperを `/backend/dist/services/role/tastile-development-testing-guard.mjs`
へcopyする。構築imageは自前ホスト内のみで保持し、registryへ公開しない。
既存DB/Redis volumeを維持し、変更前image/composeとroot限定DB backupを保存する。

rollbackは当該評価identityのproject membershipを削除してから、journal記録の
`devtest-tastile-` roleをAPIで削除する。既存role/assignmentを保存し、評価role/assignmentが0件に
なったことを確認してからbase image/composeへ戻す。code rollbackだけでは権限は消えない。

実APIでdev/stagingのcreate/update、prod/org/foreign/権限なしcallerの拒否、
CI専用path read、他path/env/write/production read拒否を確認する。
このoverlayは開発・検証用途に限り、production paid RBAC導入の証跡には使用しない。
