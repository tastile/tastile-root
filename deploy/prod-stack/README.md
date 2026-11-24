# Production-equivalent stack (Native-first release plan v0.4, NF04-R02)

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
cd deploy/prod-stack
# .env.example を元に Infisical から値を注入した env file を用意（gitignore 対象・commit 禁止）
docker compose --env-file <rendered.env> config          # 設定検証
docker compose --env-file <rendered.env> up -d           # 起動
docker compose --env-file <rendered.env> ps
docker compose --env-file <rendered.env> logs --tail=50 api worker web
```

Cloudflare Tunnel を使う場合は `TUNNEL_TOKEN` を設定し `--profile tunnel` を付ける。
その場合 caddy の 80/443 は loopback bind（`CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT`
を `127.0.0.1:80` 等に設定）に変更し、公開経路を tunnel のみに限定できる。

## 承認境界

このディレクトリの追加は設定の正本化であり、実デプロイではない。以下は別途
明示承認が必要: VM への実構築（NF04-I01）、DNS 移管・外部公開（NF04-I03/I04）、
既存本番データの切り替え（NF04-I05）、release→main 統合。

## 未決・後続タスク

- resource 上限・restart policy の確定は NF04-R05（本 compose は `unless-stopped`
  のみ。VM の RAM/CPU に合わせて `deploy.resources` を追加する）。
- image の build/publish 手順と digest pin の固定は NF04-R03/R04。
- backup 連携（別物理 Mac + age 暗号）は NF04-I02。
- `TASTILE_DELIVERY_PROVIDER` は現状 `fake` 既定。本番通知経路の決定は
  Core 側タスク（NF04-C 系）と合わせて確定する。
