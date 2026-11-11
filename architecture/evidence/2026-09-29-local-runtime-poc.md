# Evidence: local runtime PoC — Core on vanilla PostgreSQL 17 (2026-09-29)

> Evidence record (fd.poc). Authority は `architecture/model/pocs.yaml` の `poc.local-runtime` と
> `poc.core-suite-vanilla-pg`。本文は観測の記録であり、再実行で上書きせず新しい日付の file を追加する。

## Environment

| item | value |
| --- | --- |
| host | Linux 6.18.40.1-microsoft-standard-WSL2, 8 vCPU, 23 GiB RAM |
| Core commit | tastile-core `86b4964` (branch 197 = release-1-1-0 + raw corpus docs only) |
| Rust | cargo / rustc 1.98.1 (see finding T1) |
| PostgreSQL | 17.11 (zonky embedded-postgres-binaries linux-amd64, Maven Central), `initdb --auth=trust -E UTF8`, port 55432 |
| extensions after migration | `plpgsql`, `pgcrypto` |
| public tables after migration | 172 |

PostgreSQL と build 出力は workspace scratch (`.tmp/poc/`) に置き、repository には含めない。

## Procedure

```bash
# build (release, api + worker)
CARGO_TARGET_DIR=.tmp/poc/core-target cargo build --release --manifest-path tastile-core/crates-v1/Cargo.toml -p api -p worker
# start api on an empty database (runs embedded migrations)
TASTILE_DATABASE_URL=postgres://postgres@127.0.0.1:55432/tastile_poc TASTILE_ENV=development \
  TASTILE_API_HOST=127.0.0.1 TASTILE_API_PORT=31400 .tmp/poc/core-target/release/api
# poll /v1/health until 200; measure wall time; repeat on migrated DB with and without AWS_REGION
# 50 sequential GETs per endpoint with x-owner-id header (development-only owner path)
# full suite
cargo test --manifest-path tastile-core/crates-v1/Cargo.toml --workspace --no-fail-fast -- --test-threads=4
```

## Results

| measurement | value |
| --- | --- |
| release build wall / CPU | 2 m 57 s wall, 779 s user CPU, peak RSS 2.7 GB (8 vCPU) |
| binary size (unstripped / stripped) | api 60.2 MB / 44.4 MB; worker 22.9 MB / 18.2 MB |
| api start → healthy, empty DB (all migrations) | 3.43 s |
| api start → healthy, migrated DB, default env | 3.03–3.04 s (×3) |
| api start → healthy, migrated DB, `AWS_REGION` set | 0.035–0.042 s (×3) |
| api RSS idle | 21.9–22.8 MB |
| `/v1/health` / `/v1/ready` | 200 in 1.3 ms / 7.3 ms (`ready` reports database reachable) |
| GET latency (local, no network, n=50) | `/v1/sync` p50 2.0 / p95 2.7 ms; `/v1/prompts/pending` p50 1.8 / p95 2.4 ms; `/v1/active-tile` p50 3.1 / p95 4.0 ms; `/v1/tiles` (500 tiles) p50 66 / p95 85 ms |
| full test suite | 934 executed: **931 passed, 3 failed**; 6 m 20 s wall incl. debug build |

Failed tests (all in `crates-v1/api/tests`):

- `owner_profile_authz::get_profile_is_public` — expected 200, got 401.
- `owner_profile_authz::patch_profile_happy_path_updates_avatar_url` — `avatar_url` null.
- `scope_enforcement::scope_enforcement_matrix_pins_read_write_owneradmin` — `tastile.read` on `POST /v1/source-tiles`
  expected 403, got 422 (payload validation runs before scope enforcement).

These tests use the same environment as Core CI (`ci.yml`). The regressions landed with `f729831`
(2026-09-27, central `require()` pattern) after Core CI stopped running on 2026-09-26 (Actions budget).
They are not provider-specific.

## Findings

| id | finding | model link |
| --- | --- | --- |
| f.imds-startup | AWS SDK default chain probes IMDS for region (3 × 1 s timeout) before `api listening`; adds ≈ 3 s outside AWS | pocs.yaml `poc.local-runtime` c4 |
| f.migrations-at-startup | `storage::Store::connect` runs all migrations from both api and worker with the runtime role | ADR-0017 |
| f.pool-size | `storage/src/pool.rs` fixes `max_connections(16)` | deployment.yaml connection budget |
| f.startup-recovery-on-boot | worker boot emits startup-recovery prompts for every ACTIVE Execution | ADR-0017 |
| f.e2e-harness-drift | `scripts/usecase-e2e/run.ts` 1 PASS / 15 FAIL / 2 PARTIAL: legacy Recurring writes return 410, SourceTile payload lacks `flows`; `client.ts` hard-codes port 31400 in some helpers | roadmap ms.m1-freeze |
| T1 | `crates-v1/rust-toolchain.toml` pins 1.97.1 but commands run from the repo root with `--manifest-path` resolve the toolchain from the cwd, so 1.98.1 was used; the pin is not effective for CI-style invocations | core follow-up |

## Portability conclusions

- The schema needs only `pgcrypto`; locking uses `FOR UPDATE SKIP LOCKED`, transaction-scoped
  `pg_advisory_xact_lock`, a session-scoped advisory lock for migrations, and `pg_notify`. Any managed
  PostgreSQL ≥ 16 with direct connections works (Cloud SQL, RDS, Supabase direct). Transaction-mode poolers
  are not compatible with the session-level migration lock.
- Startup (42 ms) and memory (22 MB) fit request-scaled containers; cold start is dominated by image pull
  and platform scheduling, not by Core.
