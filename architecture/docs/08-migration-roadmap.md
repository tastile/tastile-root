# 08 Migration roadmap

正本: `model/roadmap.yaml`。一覧: [generated/roadmap.md](../generated/roadmap.md)。

順序は 2026-09-28 の意図 (observable behaviour を freeze → infra 移行 → target runtime 前提で secret を完成 → staging 検証 →
production cutover → soak → 一般公開告知) に従う。公開後に移行すると session・data・scheduler・通知・停止・rollback を守りながら
になり、今より難しいからである。

| milestone | 内容 | exit (gate) | authority |
| --- | --- | --- | --- |
| ms.m0-sot | 本 SoT | architecture:validate PASS、core#199 | — |
| ms.m1-freeze | behaviour freeze、Core の壊れた 3 test を修正 | core full gate green (実 PG) | — |
| ms.m2-foundation | GCP projects、billing、budget、Artifact Registry、Cloud Build、GCP WIF、Infisical workload identities、IaC | poc.infisical-workload-auth、poc.cloud-build-ci | operator |
| ms.m3-core-staging | Core image、migrate job、pool config、IMDS 除去、drain worker + 1分 sweep、prompt 導出変更、R2 media、FCM | poc.cloud-run-core、poc.worker-drain、poc.restore-drill | — |
| ms.m4-web-staging | Web on Cloud Run、JWT assertion、edge router、Resend、preview retire | poc.web-cloud-run、poc.jwt-assertion、poc.email-provider | — |
| ms.m5-clients | connect flow、Desktop bearer 修正、通知予定 read model、contract pin 統一、root openapi 削除 | 実 device / 実 Windows smoke | — |
| ms.m6-cutover | AWS → GCP (dump / restore、DNS)、AWS は 7 日停止保持 | production smoke、journal | operator |
| ms.m7-soak | 14 日 SLO evidence、14日実費からの月額 extrapolation、production restore drill | slo.* pre-launch、pre-launch cost budget | — |
| ms.m8-decommission | AWS と legacy secret path を削除し、Infisicalを唯一のeditable secret SoTとして残す | kpi.secret-stores = 1 | operator |
| ms.m9-public-announcement | 一般公開告知 | operator の記録された判断 | operator |

## 実施時の注意

- 各 milestone の作業は repository ごとの Issue (Issue 番号 branch) として起票する。roadmap は Issue の代わりにならない
  (fd.work-state は GitHub)。
- PoC の結果は `model/pocs.yaml` の criterion に observed / result を入れ、evidence file を追加する。
  passed でない PoC に依存する判断を確定事項として書かない。
- current AWS の staging / production でtarget移行に不要な改修 (AWS staging 構築、SSM deploy hardening) は
  cutover で捨てるため、production 障害対応を除き新規に行わない (core#137、#141、#152、#185、#189、web#132、#142、#161、root#34、#35 は
  本 roadmap に吸収して再評価する)。
