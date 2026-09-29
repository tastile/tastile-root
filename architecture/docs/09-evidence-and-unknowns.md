# 09 Evidence and unknowns

正本: `model/pocs.yaml`、`model/risks.yaml`。一覧: [generated/pocs.md](../generated/pocs.md)、[generated/risks.md](../generated/risks.md)。

## 何が検証済みで、何が未検証か

| 主張 | 状態 | 根拠 |
| --- | --- | --- |
| Core は vanilla PostgreSQL 17 で migration・起動・主要 read が成立する | **検証済み (local)** | poc.local-runtime |
| Core の起動は 42 ms / RSS 22 MB (AWS SDK の IMDS probe を除けば) | **検証済み (local)** | poc.local-runtime c3, c5 |
| Core の DB test は provider 非依存 | **検証済み (local)**、ただし 3 test が失敗中 | poc.core-suite-vanilla-pg |
| Cloud Run + Cloud SQL で SLO と予算を満たす | 未検証 (price page からの見積もりのみ) | poc.cloud-run-core、poc.cost-30d |
| sweep 起動 worker で work lag p95 60 秒 | 未検証 | poc.worker-drain |
| Web + Better Auth が Cloud Run で動く | 未検証 | poc.web-cloud-run |
| JWT assertion で bridge secret を置換できる | 未検証 | poc.jwt-assertion |
| Infisical + workload identityだけで development / CI / GCP runtime がstatic credential無しに回る | 未検証 | poc.infisical-workload-auth |
| Resend で日本の mailbox に届く | 未検証 | poc.email-provider |
| Core CI が Cloud Build free tier 内に収まる | 未検証 | poc.cloud-build-ci |
| RPO 5 分 / RTO 60 分 | 未検証 | poc.restore-drill |
| current AWS 費用 ≈ $93 / 月 | 未検証 (請求を参照できない) | deployment.yaml current nodes |

cloud 上の PoC は GCP billing account と project 作成 (operator authority) が前提で、2026-09-29 時点ではこの workspace に
AWS / GCP / Cloudflare の認証が無いため実行していない。

## 2026-09-29 に見つかった実装上の事実

- Core の release line で 3 test が失敗 (auth / scope の regression)。CI が budget で止まった後に merge された (risk.undetected-regression)。
- scope 判定が payload validation より後にある (`tastile.read` の POST が 422)。
- worker 起動が全 ACTIVE Execution に startup-recovery prompt を出す (f.startup-recovery-on-boot)。
- api / worker が起動時に DDL migration を実行 (f.migrations-at-startup)。pool size 固定 16 (f.pool-size)。
- AWS SDK の IMDS probe が AWS 外で起動を 3 秒遅らせる (f.imds-startup)。
- 受け入れ harness `scripts/usecase-e2e` が API から drift し 15 / 18 失敗 (f.e2e-harness-drift)。
- `crates-v1/rust-toolchain.toml` の pin は repo root から `--manifest-path` で呼ぶと効かない (1.97.1 指定に対し 1.98.1 が使われた)。
- core `v1/00-glossary.md` 等に制御文字による欠字があった (core#199 で修復)。
- Desktop は account session token を v1 Bearer に送っている (oq.desktop-bearer)。

## Open questions

所有 repository ごとの一覧は [generated/risks.md](../generated/risks.md)。domain に関わるもの (oq.owner-model、oq.sharing-scope、
oq.product-analytics、oq.billing-model、oq.alert-schedule、oq.google-calendar、oq.core-legacy-migrations-dir) は core で決める。

## Evidence files

- [evidence/2026-09-29-local-runtime-poc.md](../evidence/2026-09-29-local-runtime-poc.md)
- [evidence/2026-09-29-github-ops.md](../evidence/2026-09-29-github-ops.md)
- [evidence/2026-09-29-platform-evaluation.md](../evidence/2026-09-29-platform-evaluation.md)
- [evidence/2026-09-29-sot-audit.md](../evidence/2026-09-29-sot-audit.md)
- 履歴: `docs/raw/tastile-history-from-origin-2026-09-29.md`、tastile-core `docs/raw/`
