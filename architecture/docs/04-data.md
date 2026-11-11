# 04 Data

正本: `model/data.yaml` (保存場所・保護・backup・retention)。data の意味 (table、制約、numeric constant) は core
`crates-v1/storage/migrations/` と `v1/` が正本 (fd.db-schema、fd.domain-spec)。一覧: [generated/data.md](../generated/data.md)。

## Stores

| store | engine | 目標 | 演習 |
| --- | --- | --- | --- |
| store.domain-db | Cloud SQL PostgreSQL 17 (`tastile`) | RPO 5 分 / RTO 60 分 | 月次 PITR restore (production project 内の一時 instance) |
| store.auth-db | 同 instance の `tastile_auth` | 同上 | domain-db と同時 |
| store.media | R2 | best effort | — |
| store.downloads | R2 | GitHub Release から再構築可能 | — |
| store.logs | Cloud Logging | 30 日 | — |

## PostgreSQL の前提 (evidence: poc.local-runtime)

- 必要 extension は `pgcrypto` だけ。provider 固有機能 (RDS / Aurora / Supabase 拡張) を使わない。
- `FOR UPDATE SKIP LOCKED`、transaction-scoped advisory lock、migration 用の session-scoped advisory lock、`pg_notify` を使う。
  transaction-mode pooler (PgBouncer transaction mode 等) は使わない。
- connection budget は instance の上限内に置く (db-f1-micro は 25; api 2×5 + worker 3 + web 2×3 + migrate 2 = 21)。
  pool size は config 化する (f.pool-size)。

## Datasets と retention

- ds.identity は Better Auth が所有 (repo.web)。account 削除で即時削除。
- ds.domain は owner scope ごとに削除し tombstone のみ残す (core ADR-0010 C06 / migration V1_068)。owner は export を取得できる。
- ds.api-tokens は hash のみ。revoke / expiry 後 90 日で物理削除。
- ds.billing-refs は Tastile に保存しない (Stripe customer metadata で参照)。entitlement の扱いは oq.billing-model。

## Residency

user data at rest は日本 (asia-northeast1、R2)。edge cache は public data だけ。

## Cutover (AWS → GCP)

RDS から Cloud SQL へは logical dump / restore で移す (risk.cutover-data)。staging で 2 回 rehearsal した後、告知付き
maintenance window (≤ 30 分) で実施し、AWS は 7 日間停止のみで保持する (ms.m6-cutover)。
