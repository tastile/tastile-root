# Core #217 (incremental Flow horizon) staging deploy and sweep window (generation 26, 2026-10-19 UTC)

- candidate: Core `6988533` (PR core#222、Terra は code・設計 PASS、条件付き)。
- pinned clone で full gate (`--no-fail-fast`): 118 groups、1073 passed / 0 failed。rollback 段は exit 0。
- exact OCI rollback proof: proof build `4ca9a4ad`、image `core@sha256:b0086e4a…`、`image-rollback-proof.json`。
  - SUCCESS。独立 baseline `9b3f8b5` で実際の SourceTile smoke を通した。
  - cleanup exit 0、所有 DB の残り 0。
- 配備: migrator `core-migrate-fgplx` (V1_073、成功 1・失敗 0) → `core-api-00012-67l` / `core-worker-00007-8j2`。`/v1/ready` は `V1_073__flow_horizon_dirty_from`。
- sweep window (`ctl.staging-mvp-e2e-sweep`): 04:01:11Z から 40 分 unpause し、`PAUSED` を readback した。

## 結果 (`drain-passes.tsv`、`timeline-latency.json`)
| 指標 | #217 前 (2026-10-18、42 分) | #217 後 (40 分) |
| --- | --- | --- |
| `/drain` の pass | 全て 503・55 秒、収束せず | 36 pass 中 200 が 34、503 が 2 (04:11、04:12) |
| backlog | 解消せず | 04:02–04:08 の約 7 分で解消。以後は大半が 0.1–0.7 秒 |
| timeline API (login 済み、公開 edge 経由) | 17–69 秒 | 23 sample の中央値は約 1.15 秒。19 件が 1.9 秒以下、最大 11.2 秒 |

## 残課題
- 15 分 cadence で owner の継続が同期し、04:25–04:34 に deadline まで使う pass が続いた (どれも 200)。timeline の 9–11 秒の spike 3 件は、backlog とこの同期 burst の時間帯に起きた。
- owner ごとの jitter (core#215) で分散させる。db-f1-micro の余力は小さい。
- 2 件の 503 は、backlog 解消直後に全体期限まで使った pass。
