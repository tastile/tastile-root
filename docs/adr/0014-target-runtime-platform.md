---
id: adr.root.0014
status: Accepted
date: 2026-09-29
scope: tastile-core, tastile-web, tastile-desktop, tastile-root (edge), all environments
relates: [adr.root.0013, adr.root.0015, adr.root.0017, adr.root.0020]
gated_by: [poc.cloud-run-core, poc.web-cloud-run, poc.restore-drill]
---

# ADR-0014: Target runtime platform — GCP Tokyo (Cloud Run + Cloud SQL) behind Cloudflare edge

## Context

一般公開の告知前に、長期運用できる infra を「既に使っているから」ではなく Tastile の必要から決め直す
(raw corpus 2026-09-28〜29)。前提と evidence:

- **要求 (quality.yaml の順位)**: data integrity (RPO 5 分)、実行制御の timeliness (work lag p95 60 秒)、多端末収束、
  owner isolation、1 人で運用できること、固定費の小ささ、provider exit の容易さ。user は日本 (Tokyo latency)。
- **current (AWS ap-northeast-1)**: EC2 + systemd + nginx に api / worker / web、RDS、SSM、S3 / CloudFront、SES、
  Secrets Manager、Infisical runtime fetch。無料 credit は消滅 (推定 $90/月、請求は未確認)。
- **運用 evidence (architecture/evidence/2026-09-29-github-ops.md)**: core production deploy 成功 3/12、staging 6/29、
  web deploy 0/11。失敗原因は SSM shell quoting、systemd 上の対話的 Infisical login、WorkingDirectory、45 分 deploy、
  staging EC2 role が production RDS secret を読める IAM 範囲など、VM + 手組み deploy 経路そのものに由来する。
- **local PoC (poc.local-runtime / poc.core-suite-vanilla-pg)**: Core は vanilla PostgreSQL 17 (extension は pgcrypto のみ)
  で migration と 931 test が成立し、起動 42 ms・RSS 22 MB・stripped binary 44 MB。serverless container に適する。
  AWS 依存は avatar 用 SDK の IMDS probe (起動 +3 s) のみ。
- **Web**: Cloudflare Workers (OpenNext) staging は pg-cloudflare の bundle 回避策と Hyperdrive → private RDS 到達を要し、
  workflow 成功 0/12。同じ app を Node と workerd の二 runtime で動かす差異 (localhost proxy incident 等) の温床。

## Decision

1. **Application runtime = Google Cloud Run (asia-northeast1)。** `core-api`、`web` は request-based billing の service、
   production は min instances 1 / staging は 0。`core-worker` は internal ingress の service で外部 scheduler が起動する
   (ADR-0017)。`core-migrate` は Cloud Run job。
2. **Database = Cloud SQL for PostgreSQL 17 Enterprise (Tokyo)**、environment ごとに 1 instance。domain DB `tastile` と
   auth DB `tastile_auth` を同 instance の別 database・別 role に置く。接続は Cloud SQL connector (unix socket) のみ。
   automated backup 7 日 + PITR 7 日 + 週次 logical export。初期 tier は db-f1-micro、`risk.db-tier` の trigger で上げる。
3. **Edge = Cloudflare を維持。** DNS / Universal SSL / WAF / rate limit、download と media の R2、`app` / `api` hostname を
   run.app origin へ転送する edge router Worker (`cmp.edge.router`)。Cloud Run domain mapping は preview かつ
   asia-northeast1 で latency 既知問題があるため使わない。global external LB (固定費) も使わない。origin は
   `cred.edge-assertion` の無い request を拒否する。
4. **hostname は `*.tastile.app` の一段 subdomain に限る** (Universal SSL の範囲)。staging は `staging-app` / `staging-api`
   (environments.yaml)。nested hostname (`api.staging.app.tastile.app`) は廃止。
5. **Artifact = OCI image**、Artifact Registry に digest で保存し staging → production に promotion する。Docker daemon は
   不要 (Cloud Build が build)。旧 HARNESS の「Docker を使わない」は「host に Docker daemon を前提にしない」に置き換える。
6. **AWS・Cloudflare Workers 上の Web・Infisical runtime fetch は retire** (ms.m8-decommission)。current の AWS runbook
   (core `docs/production/`) は cutover まで current state の手順として有効。

## Alternatives considered

| 案 | 評価 | 結論 |
| --- | --- | --- |
| A. AWS 現状維持 (EC2 + systemd + RDS) を hardening | 固定費 ≈ $90 (unverified)。VM patch・deploy 経路・IAM を自前で保守し続ける。失敗 evidence の原因がそのまま残る | 不採用 |
| B. AWS managed container (ECS Fargate / App Runner) + RDS | VM は消えるが ALB 固定費 (≈ $20/env)、RDS ×2、NAT / IPv4 で ≈ $110+。App Runner は新規受付の継続性が不確実 (unverified) | 不採用 |
| **C. GCP Cloud Run + Cloud SQL** | 期待 ≈ $42 / 月 (deployment.yaml)。min instance の idle 単価が低く、worker を sweep 起動にでき、PITR 込み、WIF / Secret Manager / Cloud Build と identity が一体 | **採用** |
| D. Cloudflare 中心 (Workers / Containers + Hyperdrive) | Rust core (tokio / sqlx) は Workers に載らず Containers は region 指定と常駐 worker の成熟度が不確実。DB は外部が必要 | edge のみ採用 |
| E. Cloud Run + Supabase (Tokyo) | Pro $25 + project $10。PITR は $100 / 7 日 / project で、無しでは RPO が 24 時間 (verified: supabase.com/pricing) | 不採用 |
| F. Tokyo VPS 1 台 (PostgreSQL 自前) | 最安だが backup / PITR / patch / failover を 1 人で持つ。qg.operability が qg.cost より上位 | 不採用 |
| G. Neon | Tokyo region なし (verified: neon.com/docs/introduction/regions)、最寄りは Singapore | 不採用 |

## Consequences

- Core の contract に provider 固有 API を入れない (vanilla PostgreSQL、HTTP 起動 worker、OCI、標準 JWT)。exit cost を低く保つ。
- 新たに必要な Core 変更: migration job 分離、pool size config、IMDS probe 除去、object storage port、worker drain entrypoint、
  startup-recovery prompt の導出変更 (poc.local-runtime findings、roadmap ms.m3-core-staging)。
- Web は Cloud Run 上の Node runtime に一本化し、`wrangler.jsonc`・OpenNext・pg-cloudflare・Hyperdrive は ms.m4-web-staging で撤去する。
- GCP billing account と project 作成、production mutation は operator authority (ms.m2-foundation / ms.m6-cutover)。

## Verification / gates

cutover (ms.m6-cutover) 前に poc.cloud-run-core、poc.web-cloud-run、poc.restore-drill が passed であること。
cutover 後は最初の 14 日の実費を月額へ extrapolate して pre-launch budget を確認する。poc.cost-30d は継続観測として実行し、超過時は本 ADR を再評価するが、30 日経過そのものを公開前 gate にはしない。
