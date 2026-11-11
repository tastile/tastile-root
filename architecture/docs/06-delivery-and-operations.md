# 06 Delivery and operations

正本: `model/quality.yaml` (SLO / KPI / cost)、`model/repositories.yaml` (versioning / gate / artifact)。判断: ADR-0007 (branch)、
ADR-0019 (contract)、ADR-0020 (build / release / deploy)。運用契約: `docs/agent-orchestration.md`。

## Branch と release (変更なし)

`main` = released / integrated。sprint = `release-<major>-<minor>-<patch>`。ticket branch は Issue 番号のみ。merge commit。
詳細は ADR-0007 と docs/agent-orchestration.md §2。

## Build → deploy

```
release branch merge → tag (= manifest version) → build once (Cloud Build) → image digest in Artifact Registry
  → staging: core-migrate job → new revisions (no traffic) → smoke → 100%
  → production: same digest → core-migrate job → new revisions (no traffic) → smoke → 100%
rollback: traffic → previous revision (≤ 5 min); migrations are expand / contract compatible
```

- private repository (tastile-core) の CI は Cloud Build。public repository は GitHub Actions (ADR-0020)。
- CI が使えないときも gate は省略しない。local full gate (実 PostgreSQL) の結果と SHA を PR に添付する。
- version は manifest が単一正本。tag は manifest から作る。Android versionCode は release job が Play の最新 + 1 を設定。
  Desktop の 4 桁 assembly version は 3 桁 SemVer から導出。
- client 配布: Android = Play (internal → beta → production)、Desktop = R2 channel manifest + GitHub Release、CLI = GitHub Release。

## Gate

| repo | gate | 実環境 evidence |
| --- | --- | --- |
| root | `bun run architecture:validate` | — |
| core | fmt / clippy -D warnings / `cargo test --workspace` (実 PostgreSQL、skip 無し) | staging `/v1/ready`、migration rehearsal |
| web | `bun run check:release` | 実 browser (Playwright) で auth / proxy / dashboard |
| android | `./gradlew verify` + emulator canary | 署名 build を実 device で同一 test identity により操作 |
| desktop | `pwsh scripts/check.ps1` | 実 Windows で installer → sign-in → 操作 |
| cli | fmt / clippy / test + OpenAPI drift | staging への実 login |

## SLO と KPI

一覧: [generated/quality.md](../generated/quality.md)。pre-launch の主要目標:

- slo.api-availability / slo.web-availability: 99.5% (post-launch 99.9%、SLA 付き DB tier が前提)。
- slo.api-read-latency: p95 300 ms / p99 1 s (server-side)。slo.api-command-latency: p95 500 ms。
- slo.work-lag: p95 60 秒 / p99 120 秒。slo.sync-convergence: p95 60 秒。
- slo.auth-success: 99.5%。slo.data-durability: RPO 5 分 / RTO 60 分、月次 drill。
- kpi.deploy-lead-time ≤ 30 分、kpi.deploy-success-rate ≥ 90%、kpi.rollback-time ≤ 5 分、kpi.private-ci-spend = $0、
  kpi.ci-real-db = 100%、kpi.restore-drill 3/3、kpi.secret-stores = 1。

ほぼ全 SLO は `unmeasured` である。計測 (Cloud Run request log の log-based metric、Work Item の SQL、staging synthetic probe) を
ms.m3-core-staging と ms.m4-web-staging で作り、ms.m7-soak の 14 日間 evidence を公開判断に使う。error budget を速く消費している間は feature より信頼性を優先する。

## Observability

- 構造化 JSON log (tracing) を Cloud Logging へ。user-content と credential を出さない。
- Cloud Monitoring uptime check: `https://api.tastile.app/v1/health`、`https://app.tastile.app/`。
- budget alert 50 / 90 / 100%。
- 外部 mutation は docs/journal/<env>/*.jsonl に記録する。

## Incident と復旧

- 判断者は operator。agent は staging までの authority (ctl.prod-mutation-authority)。
- 第一手は traffic rollback。data 問題は PITR clone で調査し、本番 instance を直接いじらない。
- 事後に ADR または risk を更新する。
