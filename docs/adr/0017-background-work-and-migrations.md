---
id: adr.root.0017
status: Accepted
date: 2026-09-29
scope: tastile-core (worker, storage, api), deployment
relates: [adr.root.0014]
gated_by: [poc.worker-drain]
---

# ADR-0017: Background work — stateless drain、外部 trigger、process lifecycle を domain に持ち込まない

## Context

- Core worker (`crates-v1/worker/src/main.rs`) は 5 秒 interval の常駐 loop で outbox drain、SourceTile horizon fill
  (32 日)、execution due、decision、delivery、prompt を処理する。状態は DB の Work Item / Outbox にあり、取得は
  `FOR UPDATE SKIP LOCKED` と lease で多重起動に安全。
- 起動時に「まだ ACTIVE の Execution は前の process より長生きした」とみなし全件に startup-recovery prompt を出す。
  deploy・restart・scale のたびに user へ prompt が出る (f.startup-recovery-on-boot)。これは Pomodoroom / desktop daemon
  時代の「process = user の実行主体」前提の名残で、backend-centric service では誤り。
- api と worker の双方が起動時に DDL 権限で migration を実行する (f.migrations-at-startup)。runtime role に DDL が必要になり、
  autoscale で多数 instance が同時に起動する環境に向かない。
- Cloud Run で常駐 worker (instance-based billing, 1 vCPU) は ≈ $50 / 月。sweep 起動なら free tier 内 (deployment.yaml)。

## Decision

1. **Work Item / Outbox table が唯一の正本。** scheduler・queue・push は「起こす」だけの hint であり state を持たない。
2. **worker は stateless drain。** `drain` entrypoint は期限到来分を lease 付きで処理し、空になるか deadline (55 秒) で返る。
   HTTP で起動され、同時に複数起動されても安全 (SKIP LOCKED)。
3. **起動 trigger は 2 つ。** (a) sweep: Cloud Scheduler が 1 分ごとに起動 (失われた wake の回収)。(b) wake: Command が
   `available_at` を持つ Work Item を作ったとき、Core が Cloud Tasks に schedule 時刻付きの起動を登録する (optional、SLO 未達時)。
4. **process lifecycle は domain semantics に影響しない。** 「Execution が放置されている」等は domain fact (最終 heartbeat /
   操作時刻、Placement 終了時刻) から導出し、worker / api の起動を条件にしない。startup-recovery の定義は core v1 側で改訂する。
5. **migration は `core-migrate` job が deploy ごとに 1 回、`tastile_migrator` role で実行する。** api / worker は起動時に schema
   version を確認し、未適用なら ready にならない (DDL は実行しない)。runtime role は DML のみ。
6. worker の cadence・horizon・batch size は config 化し、SLO (slo.work-lag) で調整する。

## Alternatives considered

- **Cloud Run instance-based の常駐 worker**: 現行 code のまま動くが固定費 ≈ $50 / 月で qg.cost に反する。
- **Cloud Run jobs を毎分実行**: 起動 overhead が大きく、free tier の消費が増える。
- **PostgreSQL LISTEN / NOTIFY で常駐 wake**: 常駐 process が前提になり 1 と同じ問題。

## Consequences

- worker の最悪遅延は sweep 間隔 (≈ 60 秒)。user への即時性は client の local OS alarm が担う (ADR-0018)。
- core に `drain` entrypoint、schema version check、migrate binary、prompt 導出の変更が必要 (ms.m3-core-staging)。

## Verification

poc.worker-drain (work lag p95 < 60 秒、重複副作用 0、worker 起動起因の prompt 0) を ms.m3-core-staging の exit 条件にする。
