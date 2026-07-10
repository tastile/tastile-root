# `tastile.app` スタイル欠落 — 根本原因の特定 (2026-07-06)

## TL;DR

CF の origin は **`35.79.255.34` (i-026c215cacda95559, "tastile-web", Caddy host)** を指しているが、
ユーザーの直近デプロイは **`52.194.61.218` (i-0ec20b65596468a79, "tastile-web-server", nginx host)** に入っている。
`35.79.255.34` の Next.js デプロイは `0.1.42` で止まっており、`.next/static/chunks/` ディレクトリ自体が**欠落**している。

Caddy は正しく `127.0.0.1:3000` に reverse proxy しているので無罪。
罪は **CF origin になっているホストの Next.js に静的ファイルが存在しない**こと。

`app.tastile.app` は CF エッジキャッシュ (`Cf-Cache-Status: HIT`, age 31177s) で動いているように見えるだけ。
実 origin では両方とも 404。

---

## 検証結果

| 経路 | HTML | CSS | 備考 |
|---|---|---|---|
| `https://tastile.app/` | 200 (`Via: 1.1 Caddy`) | **404** (`Via: 1.1 Caddy`, `BYPASS`) | origin へ到達 |
| `https://app.tastile.app/` | 200 (`Via: 1.1 Caddy`) | 200 (`Server: cloudflare`, `HIT` age 31177s) | **CF キャッシュが救っているだけ** |
| `https://app.tastile.app/_next/static/chunks/4e716ac3d08c9fbb.css?v=NOW` | — | **404** (`BYPASS`) | cache buster で実 origin を確認 → 同じく 404 |
| `http://52.194.61.218/` Host: tastile.app | 200 (nginx) | 200 (nginx, 87047 bytes, immutable) | nginx host は完全動作 |
| `http://35.79.255.34:3000/` (Next.js 直) | 200 | **404** | Next.js 自身が 404 を返す |

### 証拠

1. **DNS 解決**
   - `tastile.app` / `app.tastile.app` / `api.tastile.app` すべて同じ CF anycast IP (`104.21.94.226`, `172.67.140.221`) → CF proxy 経由
2. **CF edge cache が `app.tastile.app` を救っている**
   - `app.tastile.app` CSS: `Cf-Cache-Status: HIT`, `Age: 31177` (≈8.6 時間前), ETag `W/"15407-19f352e5240"`, Last-Modified `2026-07-06 02:07:36 UTC`
   - これは **cookie rename fix より前のビルド**。現ビルドの ETag は `W/"15407-19f3689bfa8"` (08:27:05 UTC)
3. **CFN `AppInstanceId` は stale**
   - `aws cloudformation describe-stacks tastile-foundation` → `i-09a0b66534f7c8c3e`
   - 全リージョンで `InvalidInstanceID.NotFound` (terminate 済み)
4. **3 つの EC2 インスタンスが関係**

   | InstanceId | Public IP | Name tag | 用途 | Next.js 直 CSS |
   |---|---|---|---|---|
   | `i-09a0b66534f7c8c3e` | — | (CFN 出力のみ) | 既に terminate | — |
   | `i-0ec20b65596468a79` | `52.194.61.218` | `tastile-web-server` | nginx + Next.js systemd | **200** (CSS 完全) |
   | `i-026c215cacda95559` | `35.79.255.34` | `tastile-web` | Caddy + Next.js systemd | **404** (`/opt/tastile/web/current/.next/static/chunks/` 欠落) |

5. **Caddyfile (35.79.255.34 上)** は正しく `tastile.app` を handle している
   ```caddyfile
   :443 {
     tls /etc/caddy/tastile-origin.crt /etc/caddy/tastile-origin.key
     @api host api.tastile.app
     @app host app.tastile.app tastile.app
     handle @api { reverse_proxy 127.0.0.1:31400 }
     handle @app { reverse_proxy 127.0.0.1:3000 }
     handle { respond "tastile v1" 200 }
   }
   ```
   Caddy は問題ない。**後ろの Next.js が静的ファイルを持っていない**だけ。

6. **直近デプロイの行き先不一致**
   - `52.194.61.218`: リリース `tastile-web-20260706-1810-cf-cookie-rename-v2` (07-06 08:28 UTC) を含む 20+ リリース
   - `35.79.255.34`: リリース `tastile-web-0.1.40/0.1.41/0.1.42` のみ (07-06 04:39 / 05:05 / 05:19 UTC) — semver タグ、**別系統**

---

## 取るべきアクション (3 択)

### Option A — CF origin を nginx host (`52.194.61.218`) に切り替える【最短・推奨】

CF の `tastile.app` / `app.tastile.app` / `api.tastile.app` A レコードの origin を `35.79.255.34` → `52.194.61.218` に変更。
nginx の `server_name app.tastile.app tastile.app;` は既に設定済みなので、`52.194.61.218` 直アクセスで `tastile.app` も `app.tastile.app` も動く。

- **orange cloud (proxied)** で 52.194.61.218 を向けるか、**grey cloud (DNS-only)** で直接 nginx に流すか
- grey なら CF の DDoS 保護を失うが、`35.79.255.34` (Caddy host) の問題は即座に消える
- orange なら CF キャッシュ・DDoS は維持。CF origin に `52.194.61.218` を設定

### Option B — Caddy host (`35.79.255.34`) に最新ビルドをデプロイ

`deploy-web-v1.ps1` が `35.79.255.34` にも投入されるよう、CFN `AppInstanceId` を更新 + CF origin は現状維持。
ただし `52.194.61.218` (nginx host) の役割が曖昧になる (Caddy と nginx の二重構成は負債)。

### Option C — 二重構成を解消して 1 ホストに集約

`35.79.255.34` を decommission、または `52.194.61.218` を decommission。
CFN / deploy スクリプト / systemd unit / `.env` などの依存を整理する必要あり。
時間がかり、A/B/C の中で最もリスクが高い。

---

## 推奨

**Option A (orange cloud + 52.194.61.218)** が最短。
CF ダッシュボードで `app.tastile.app` / `api.tastile.app` / `tastile.app` の **DNS record の "Content" フィールド (= CF origin IP)** を `35.79.255.34` から `52.194.61.218` に書き換える。

注意: `Proxied` を ON (orange cloud) のままで。OFF (grey cloud) だと CF のキャッシュが効かない。
ただし `52.194.61.218` は nginx で CF の IP レンジを許可していれば OK (nginx config は既に `server_name app.tastile.app tastile.app;` 込みで整っている)。

---

## 関連ファイル / 関連メモリ候補

- `/c/Users/rebui/Desktop/tastile/tastile-web/scripts/v1/deploy-web-v1.ps1` (deploy target = CFN `AppInstanceId`)
- `/c/Users/rebui/Desktop/tastile/tastile-core/scripts/v1/setup-cloudflare-dns.ps1` (only touches `app.tastile.app` / `api.tastile.app`, NOT bare `tastile.app`)
- nginx config on `52.194.61.218`: `/etc/nginx/conf.d/tastile-private-prod.conf` (`server_name app.tastile.app tastile.app;` 済み)
- Caddy config on `35.79.255.34`: `/etc/caddy/Caddyfile` (handle 正しく設定済みだが後ろの Next.js が静的ファイル欠落)

新メモリ候補 (新規保存):
- **CF origin と deploy target の二重管理リスク**: `tastile-foundation` CFN stack の `AppInstanceId` 出力が stale になりやすい + `35.79.255.34` (Caddy host) と `52.194.61.218` (nginx host) の役割分担が暗黙
- **Caddy ホストの Next.js は静的ファイルを持たない場合がある**: `0.1.42` リリース以降デプロイが止まっていて、`.next/static/chunks/` 欠落 → CSS 404