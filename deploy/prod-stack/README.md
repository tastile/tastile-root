# Production-equivalent stack (Native-first release plan v0.4, NF04-R02)

> **stack 操作は必ず `<tastile-root>/scripts/stack.sh` 経由で行う**（root#183）。
> `prod` / `prod-acc` は registry で class `prod` / `prod-equiv` に分類され、
> 破壊的操作（`down -v` 等）は `TASTILE_STACK_DESTRUCTIVE_OK=<id>` が必須。
> preflight が project・port・volume・image を照合する。正規手順は
> `docs/runbooks/stack-operations.md` を参照。

ADR-0025 で採用した Native-first 構成の本番相当 Compose 定義。対象ホストは
専用の常時稼働 Windows マシン上の隔離 Ubuntu LTS VM。追加クラウド費用ゼロ、
Oracle Cloud は不使用。

## 構成

| service | 役割 | 外部公開 |
| --- | --- | --- |
| `db` | PostgreSQL 16（Core 用 `tastile` / Better Auth 用 `tastile_auth` を別 role・別 DB で分離） | なし（internal network のみ） |
| `api` | tastile-core HTTP API（`Containerfile.v1` image） | なし（caddy 経由のみ） |
| `worker` | tastile-core worker（同一 image、`/app/worker`） | なし |
| `web` | Next.js standalone（`output: "standalone"`、`Containerfile` image） | なし（caddy 経由のみ） |
| `caddy` | reverse proxy（`APP_DOMAIN` → web、`API_DOMAIN` → api） | 80/443 |
| `cloudflared` | Cloudflare Tunnel connector（optional、`--profile tunnel`） | outbound のみ |

Muse 運用 SoT とは DB・port・credential・volume をすべて分離する。本スタックは
初回 init 時に専用の database / role / volume を作成し、既存運用データへは
接続経路を持たない。

`initdb/00-provision.sh` は初回 initdb で Core 用 `tastile` / Better Auth 用
`tastile_auth` の database・role を作成し、続けて
`initdb/better-auth/better-auth-schema.sql`（`deploy/verify-stack/` の
`better-auth-schema.sql` と同一 schema、header comment のみ差分）を `tastile_auth` DB へ `tastile_auth`
role として適用する。Better Auth 側に migration runner は無いため、この
provisioning が sign-up 可能な schema の唯一の供給経路である（root#165
https profile B2: 未適用だと sign-up が 503 になる）。initdb は空の data
directory でのみ走るので、既存 volume への後付けは `psql` で同ファイルを
手動適用する。

## 前提

- Docker + Compose v2 が動く Ubuntu LTS VM（ADR-0025 の隔用 VM）
- image は事前 build 済みのものを `TASTILE_CORE_IMAGE` / `TASTILE_WEB_IMAGE`
  で指定する（tag または digest pin 推奨）。registry が無い初回は
  `compose.yaml` 内のコメントアウト済み `build:` 節を有効化し、兄弟
  checkout（`TASTILE_CORE_DIR` / `TASTILE_WEB_DIR`）から build する。
- web image の build には `TASTILE_INFISICAL_INJECTED=1` と Infisical 由来の
  `NEXT_PUBLIC_*` build args が必要（`tastile-web/Containerfile` 参照）。
- secret 値の正本は Infisical（self-hosted）。deploy 時に
  `infisical run` 等で環境変数へ注入し、`.env` を平文で残さない。

## 手順（承認後の VM 上で実施）

```bash
cd <tastile-root>
# .env.example を元に Infisical から値を注入した env file を用意（gitignore 対象・commit 禁止）
export TASTILE_STACK_ENV_FILE=<rendered.env>
scripts/stack.sh prod doctor                        # preflight（up 相当の全検査）
scripts/stack.sh prod up -d                         # 起動
scripts/stack.sh prod ps
scripts/stack.sh prod logs --tail=50 api worker web
```

prod-equivalent 受入 stack（このホスト上の `tastile-prod-acc`）も同じ wrapper を使う:
`scripts/stack.sh prod-acc ...`（env file は registry 登録済み
`.tmp/prod-equivalent/prod.env`）。

Cloudflare Tunnel を使う場合は `TUNNEL_TOKEN` を設定し `--profile tunnel` を付ける。
その場合 caddy の 80/443 は loopback bind（`CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT`
を `127.0.0.1:80` 等に設定）に変更し、公開経路を tunnel のみに限定できる。

## 承認境界

このディレクトリの追加は設定の正本化であり、実デプロイではない。以下は別途
明示承認が必要: VM への実構築（NF04-I01）、DNS 移管・外部公開（NF04-I03/I04）、
既存本番データの切り替え（NF04-I05）、release→main 統合。

## 資源上限（NF04-R05 / root#145）

VM 前提 4 vCPU / 8 GiB RAM / 64 GiB ディスクに対し、以下を処理として強制する
（監視のみではない）。上限値と検証手順の正本は
[`docs/runbooks/resource-limits.md`](../../docs/runbooks/resource-limits.md)。

| 層 | 上限 | 強制手段 |
| --- | --- | --- |
| CPU / RAM | service 別（下表） | compose `deploy.resources.limits`（cgroup） |
| DB 接続数 | `max_connections=60` | `command: postgres -c` + per-process pool 10 |
| SQL 実行時間 | 60s / idle-in-tx 300s | core `SessionLimits`（pool session 設定） |
| request body / timeout | 2 MiB / 30s | `TASTILE_MAX_REQUEST_BODY_BYTES` / `TASTILE_REQUEST_TIMEOUT_SECONDS` |
| API rate limit | auth 60/min, data 600r/240w/12b rpm | core in-process limiter → 429 |
| edge 接続 | read_header 10s / read_body 30s / idle 2m、upstream 同時 256(web)/512(api) | Caddyfile `servers.timeouts` + `unhealthy_request_count` |
| ディスク逼迫 | 空き 4 GiB 未満 | api: 書き込み 503+Retry-After、worker: drain 延期 |

既定の cgroup 配分: db 1.0 CPU/2G、api 1.25/2G、worker 0.75/768M、
web 0.5/1G、caddy 0.25/128M、cloudflared 0.25/128M（計 4.0 CPU / 約 6G、
残りを OS と page cache に残す）。`TASTILE_*_CPUS` / `TASTILE_*_MEMORY`
で service ごとに上書き可能。

## 未決・後続タスク

- image の build/publish 手順と digest pin の固定は NF04-R03/R04。
- backup 連携（別物理 Mac + age 暗号）は NF04-I02。
- `TASTILE_DELIVERY_PROVIDER` は現状 `fake` 既定。本番通知経路の決定は
  Core 側タスク（NF04-C 系）と合わせて確定する。
