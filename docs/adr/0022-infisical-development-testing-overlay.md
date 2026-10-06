---
id: adr.root.0022
status: Accepted
date: 2026-10-06
scope: Infisical development and staging evaluation
relates: [adr.root.0012, adr.root.0015, adr.root.0020]
---

# ADR-0022: Infisical の開発・検証限定 RBAC 改変

## Context

ユーザーは自前ホストの改変によって開発・検証を進めるよう指示した。
稼働imageはInfisical v0.165.15。該当versionの `backend/src/ee/LICENSE.md` は、
開発・検証目的のcopy/modifyをsubscriptionなしで許可する例外を明記している。
従前の「すべてのPoCで正規LICENSE_KEY待ち」という判断を訂正する。

出典: https://github.com/Infisical/infisical/blob/v0.165.15/backend/src/ee/LICENSE.md

## Decision

- dev/stagingのfolder scope、workload authentication、deny経路の評価に限り、
  自前ホストのcustom project role作成/更新とidentityへのproject role割当/更新のplan gateを限定的に変更する。
- 厳密なflag値1、認証済organization一致、project scope、dev/stagingの固定allowlistをすべて要求する。
  non-secret bindingと禁止production projectの正本は `ctl.infisical-development-testing`。
- 既存actor permission guardを先に実行し、各secretのpermission enforcementを保持する。
  organization role、production/foreign project、他organizationには例外を適用しない。
- global plan、LICENSE_KEY、subscription status、他のpaid featureは変更しない。
  imageは固定base digestの私有評価用overlayとして自前ホスト内だけに置く。
- 3 project設計とInfisical唯一のsecret SoTを維持する。新secret storeやproduction replicaを作らない。
- 作成roleは `devtest-tastile-` prefixとし、role/identity/membership IDとmutationをjournalに記録する。
  既存role/assignmentは評価前snapshotで識別し、変更しない。

## Rollback

コードだけを戻してもcustom roleと割当はDBに残る。評価callerを停止・無効化し、
この評価で作成したidentityのproject membershipをAPIで削除してから、記録したroleをAPIで削除する。
評価prefixのroleとその割当が0件であることを確認し、元の固定image/compose設定へ戻す。
既存role/assignmentは保存し、public health・既存secret consumerのreadinessを確認する。
変更前compose、image digest、暗号化DB backupは自前ホストのroot限定保管にし、Gitへ送らない。

## Verification and scope

flagの欠損/別値、organization scope、production/foreign project、foreign organization、
権限のないcaller、create/updateの拒否を検証する。許可identityは `/tastile/ci` readだけ成功し、
他path・他environment・write・production project readを拒否することを実APIで観測する。
grant後のcleanupとassignment/roleゼロ確認も評価する。

開発・検証の改変許可をproduction用途の許可として扱わない。production paid RBAC導入は
正規license/合意した条件を別途必要とし、正式見積の未取得費用を0扱いしない。
PoCとm2全体は実証結果がそろうまで完了扱いにしない。
