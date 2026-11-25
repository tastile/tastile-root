# Resource limits runbook (NF04-R05 / tastile-root#145)

Native-first 本番スタック（`deploy/prod-stack`）の資源上限と、その強制手段・
検証方法の正本。前提 VM は **4 vCPU / 8 GiB RAM / 64 GiB ディスク**。

原則: 監視だけでなく処理として強制する。容量逼迫時に正本（PostgreSQL volume）
を破壊しないことが最優先で、読み取り可用性は維持しつつ書き込み側を先に絞る。

## 上限一覧

| 層 | 上限値 | 強制手段 | 実装場所 |
| --- | --- | --- | --- |
| CPU | db 1.0 / api 1.25 / worker 0.75 / web 0.5 / caddy 0.25 / cloudflared 0.25（計 4.0） | compose `deploy.resources.limits.cpus`（cgroup cpu.max） | `deploy/prod-stack/compose.yaml` |
| RAM | db 2G / api 2G / worker 768M / web 1G / caddy 128M / cloudflared 128M（計約 6G） | compose `deploy.resources.limits.memory`（cgroup memory.max → OOM kill） | 同上 |
| PostgreSQL 接続数 | `max_connections=60` | `command: postgres -c max_connections=60` | 同上 `db` service |
| アプリ側 pool | api 10 / worker 10（`TASTILE_DATABASE__MAX_CONNECTIONS`） | sqlx `PgPoolOptions::max_connections` + acquire timeout 5s | tastile-core `storage::pool` |
| SQL 実行期限 | `statement_timeout` 60s / `idle_in_transaction_session_timeout` 300s | pool 接続への session 設定（core#579） | tastile-core `storage::pool::SessionLimits` |
| request body | 2 MiB → 413 | `RequestBodyLimitLayer` | tastile-core `api/src/main.rs` |
| request 全体 | 30s → 408 | `TimeoutLayer` | 同上 |
| API rate limit | auth 60/min、data read 600 / write 240 / bootstrap 12 rpm → 429 | in-process fixed-window limiter | 同上 |
| edge timeout | read_header 10s / read_body 30s / idle 2m | Caddy `servers.timeouts`（slowloris 対策。write timeout は sync stream 保護のため未設定） | `deploy/prod-stack/Caddyfile` |
| edge 同時接続 | web upstream 256 / api upstream 512 | Caddy `unhealthy_request_count`（超過時 fail-fast）+ `max_conns_per_host` | 同上 |
| ディスク空き | 4 GiB（`TASTILE_DISK_MIN_FREE_BYTES`） | api: 非 GET/HEAD/OPTIONS を 503 + `Retry-After: 30`。worker: drain 全延期（`DrainTermination::Deferred`） | tastile-core `resource` crate、`api` middleware、`worker::drain` |

service ごとの上書きは `TASTILE_<SERVICE>_CPUS` / `TASTILE_<SERVICE>_MEMORY`
（SERVICE = DB/API/WORKER/WEB/CADDY/CLOUDFLARED）。`deploy/verify-stack` は
検証用に小さい既定値（db 0.5/512M、api 1.0/1G、worker 0.5/512M、
`max_connections=40`、disk floor 1 GiB）を持つ。

## ディスク逼迫時の挙動

- **api**: `resource::DiskGuardConfig::is_low()`（`statvfs`、`/` は container
  では host volume と同一 filesystem）を各リクエストで評価。閾値未満の間、
  mutating request は handler に到達せず 503 + `Retry-After: 30`。
  GET/HEAD/OPTIONS と `/v1/health`・`/v1/ready` は継続可能。
- **worker**: 各 drain 呼び出しの先頭で同じ判定を行い、閾値未満なら
  `DrainTermination::Deferred` で即 return（claim も pass も実行しない）。
  daemon は次の cadence tick で自動再試行する。
- **計測失敗時は fail-open**（warn ログのみ）。`TASTILE_DISK_GUARD_PATH` は
  実在する mount を指すこと。閾値 `0` または env 未設定で guard は無効。
- cgroup の memory limit は最後の防衛線であり、超過時は OOM kill される
  （postgres のデータ破壊は volume 側の話であり、disk floor がその前に
  書き込みを止める役割を持つ）。

## 検証手順（verify-stack / prod-equivalent で実施）

前提: `deploy/verify-stack` または `deploy/prod-stack` + acceptance overlay
で stack を起動済み。証跡は `acceptance/.tmp/`（gitignore）に保存する。

1. **cgroup memory**: `docker stats` で上限が見えること、
   `docker update --memory` ではなく compose の limits が HostConfig に
   入っていること（`docker inspect -f '{{.HostConfig.Memory}}' <ctr>`）。
   意図的に小さい `TASTILE_VERIFY_API_MEMORY` で再起動し、api 内で
   メモリを確保する負荷をかけて OOM kill（`docker inspect -f '{{.State.OOMKilled}}'`）
   を確認する。
2. **cgroup cpu**: `cpu.max`（`/sys/fs/cgroup/cpu.max`）が quota/period に
   なること。`docker stats` の CPU% が上限を超えないことを負荷下で確認。
3. **PG 接続数**: `psql -c "show max_connections"` が設定値を返すこと。
   `pg_stat_activity` の接続数が pool 合計を超えて増えないこと。
   上限超過時は `FATAL: sorry, too many clients` が返ること。
4. **edge 接続**: `unhealthy_request_count` を一時的に小さい値にした
   Caddyfile で同時接続を張り、超過分が 502 で fail-fast すること
   （本番値に戻すこと）。
5. **disk floor**: `TASTILE_DISK_MIN_FREE_BYTES` を実際の空き容量より
   大きい値（例: `u64` 相当の巨大値）にして api/worker を再起動。
   - api: `curl -X POST` が 503 + `Retry-After: 30`、`curl /v1/health` が 200。
   - worker: `worker drain` が `"termination":"deferred"` を返し、
     DB の work item が claim されないこと。
   - 値を戻すと書き込みが復帰すること（正本を壊さず可逆であること）。

## 既知の gap

- prod-acc stack の pin image（`tastile-core:440c926f`）は本変更を含まない。
  prod 相当での実測には新 image の build/pin 更新（NF04-R03/R04）が必要。
- Caddy 公式 image には rate_limit plugin が無いため、edge の「同時接続」
  上限は concurrency cap であり、req/min の厳密な rate limit ではない。
  必要になれば自前 build または plugin 付き image を検討する。
- disk floor は単一 filesystem の `statvfs` であり、volume 単位の quota では
  ない。PGDATA volume が別 device にある構成では `TASTILE_DISK_GUARD_PATH`
  をその mount に向ける。
