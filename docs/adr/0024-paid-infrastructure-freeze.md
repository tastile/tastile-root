---
id: adr.root.0024
status: Accepted
date: 2026-10-20
tracking: [tastile/tastile-root#102]
scope: all paid infrastructure and the development premise while it is stopped
relates: [adr.root.0014, adr.root.0015, adr.root.0020, adr.root.0023]
---

# ADR-0024: 有料インフラを全停止し、ローカル完結の開発へ縮退する

## Context

operator の預金残高が、現在の固定費ペースでは 2026-11 末まで持たない。他の開発 project も縮小している。
2026-10 の請求は 20 日時点で AWS が約 $114 (RDS 2 台・EC2・data transfer・public IPv4)、GCP は staging Cloud SQL が
常時稼働 (activationPolicy ALWAYS) で、毎分の CI dispatcher Scheduler も有効だった。Cloudflare の従量課金は $0 だった。
beta に実 user はおらず、保持すべき production data はない (operator 判断)。

## Decision

2026-10-20 に operator 権限で次を実施した。詳細は `docs/journal/*/2026-10-20.jsonl`。

- **AWS (account 900977801015) は全削除。** RDS `tastile-v1-postgres` / `tastile-staging-postgres` は final snapshot と
  automated backup を残さずに削除した。手動 RDS snapshot、EC2 4 台、EIP、EBS volume と snapshot、CloudFormation
  `tastile-foundation` / `tastile-staging-foundation` (VPC、CloudFront、Cognito、avatar bucket を含む)、S3 bucket、
  ECR repository、log group も削除した。Secrets Manager の 3 件は 7 日後の削除を予約した。
  ms.m8-decommission で予定していた RDS の GCS export は行っていない。
- **GCP は `tastile-dev` / `tastile-staging` / `tastile-prod` の請求先リンクを解除した。** 解除前に Cloud SQL
  `tastile-staging-pg` を NEVER (STOPPED) にし、Scheduler `tastile-core-ci-dispatch` を pause した。
  OpenTofu state は operator host の Git 管理外 `.tmp/gcp-tofu-state-backup-2026-10-20/` に退避した。
  請求先がない状態が続くと、Cloud SQL・Artifact Registry・GCS (state bucket を含む) は provider 側で失われうる。
  再開時に既存の resource が残っている前提にはしない。
- **Cloudflare は据え置く。** Tastile 分の従量課金は $0 である。Workers Paid などの account 単位の契約は他 project
  (rebuildup.dev など) と共有しているため、Tastile の判断では解約しない。Tastile の Worker・R2・DNS は残すが、
  `tastile-web-staging` (Hyperdrive → 削除済み staging RDS) と `tastile-edge-staging` の背後に動く backend はない。
- **Infisical は対象外とする。** self-hosted で、他 project と共有しているため。

### 凍結中の開発前提

1. **実行環境は `env.local` と、無料枠の `env.ci` だけとする。** staging と production は存在しないものとして扱う。
   Web・API・DB の検証は、developer host 上の PostgreSQL 17 と実 browser / 実 device で行う。
2. **課金を発生させる操作は一切しない。** GCP の billing 再リンク、`tofu apply`、Cloud Run / Cloud SQL / Cloud Build
   の起動、AWS resource の作成、有料 plan の契約が該当する。必要になった場合は agent が実行せず、operator に
   escalation する。
3. **private Core の heavy CI (Cloud Build 経路) は停止している。** release 判断には、local で実 PostgreSQL に対して
   full gate を実行した証跡を使う (AGENTS.md「検証と commit」と kpi.ci-real-db)。GitHub Actions の有料分も使わない
   (kpi.private-ci-spend = $0)。
4. **target architecture (ADR-0014〜0023、`architecture/model/` の planned node) は設計として維持する。**
   provider-neutral 化 (OCI image、vanilla PostgreSQL、port/adapter) など、local で完結する実装と検証は進めてよい。
   staging / production への配備、実 traffic を前提とする PoC、cost の実測は凍結が解除されるまで blocked とする。
5. **Cloudflare の無料枠や Infisical の利用は継続してよい。** ただし、Tastile 分として新たに有料 plan を契約しない。
6. **public な配布は既存の無料経路だけとする。** GitHub Releases、R2 の無料枠、Google Play が該当する。

## Resumption

凍結の解除は operator が判断し、新しい root ADR で記録する。解除の条件は、月額固定費の上限を明示した資金計画が
あることとする。再開の順序は次のとおり。

1. ms.pause-paid-infra の exit criteria に従い、予算額を `quality.yaml` の `cost_budget` に反映する。
2. 請求先を再リンクする。
3. 残っている resource と退避した state の差分を `tofu plan` で確認する。
4. foundation → staging の順に再構築する。

失われた resource は IaC から作り直す。AWS への復帰は行わない。

## Consequences

- ms.m2-foundation 〜 ms.m7-soak は ms.pause-paid-infra により blocked になる。ms.m8-decommission の AWS 削除は前倒しで完了した。repository 内に残る AWS 前提の記述の撤去は、
  引き続き ms.m8-decommission の作業として残る。
- 実 user も公開 endpoint もない状態になる。`staging*.tastile.app` / `api.tastile.app` などの DNS は、到達不能な
  backend を指す可能性がある。
- 費用の実績は $0 (Cloudflare の共有契約と domain は除く) になる。`poc.cost-30d` などの費用 PoC は測定できない。
