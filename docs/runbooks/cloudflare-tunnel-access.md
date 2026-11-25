# Cloudflare Tunnel / DNS / Access — 資格情報実証と HTTPS 公開経路の設定準備

対象 Issue: tastile/tastile-root#179
関連: #165 (A-AT01 実 HTTPS), #144 (NF04-R04 公開経路), #66 (Infisical SoT), #99 (edge token rotation), #34 (Cloudflare/AWS 責務分離)

本書は read-only 調査の結果と、権限が揃った後に実行する設定手順の正本である。
secret 値は一切記録しない。キー名・path・権限 scope・HTTP status のみを記録する。

## 1. Infisical 調査結果 (2026-11-25 時点)

SoT: self-hosted Infisical `https://secrets.rebuildup.dev`。全 repo の `.infisical.json` は同一の
project / identity mapping を持ち、secret path は `/tastile/<repo>` 規約。

| project | env | 主な path | Cloudflare 関連キー |
|---|---|---|---|
| `949b4193-…` | dev | `/tastile/{android,ci,core,desktop,web}` | なし |
| `44081e84-…` | staging | `/tastile/edge` | `CLOUDFLARE_API_TOKEN`, `TASTILE_EDGE_ASSERTION` |
| `44081e84-…` | staging | `/tastile/core/{api,migrate,shared,worker}`, `/tastile/platform/cloud-sql`, `/tastile/web/runtime` | なし |
| `ab532e90-…` | prod | `/tastile/desktop` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_BUCKET`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` |
| `ab532e90-…` | prod | `/tastile/{android,core,web}` | なし |

確認済みの事実:

- `TUNNEL_TOKEN`、`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`、その他 tunnel / Access 関連キーは
  全 project・全 path・root `/` に**未登録**。
- `/tastile` 直下にも secret はない。staging のみ `/tastile/edge` と `/tastile/platform` が存在する。
- `CLOUDFLARE_ACCOUNT_ID` = Cloudflare account `c6ab6651a5d4d6d0d07686bbd3c3d56f`
  (Rebuild.up.up@gmail.com's Account)。`CLOUDFLARE_API_TOKEN` が verify した account と一致。
- R2 bucket `tastile-desktop-releases` は `download.tastile.app` 配信用
  (`tastile-desktop/.github/workflows/release.yml` が `/tastile/desktop` から S3 credential を注入)。
- `CLOUDFLARE_API_TOKEN` (staging `/tastile/edge`) の consumer はこの workspace 内に見当たらない。
  root#99 の「Cloudflare edge deploy token」に相当すると推定される (edge worker deploy 用)。

## 2. 権限実証結果 (read-only API のみ、write は未実施)

`CLOUDFLARE_API_TOKEN`:

| probe | 結果 |
|---|---|
| `GET /user/tokens/verify` | 200 `active` (user token, id `26c54285…`) |
| `GET /accounts` | 200、account 1 件 |
| `GET /zones`, `GET /zones/{id}`, `GET /zones/{id}/dns_records`, `GET /zones/{id}/settings` | 200。zone: `tastile.app`, `rebuildup.dev`, `yusuke-kim.com` (すべて active) |
| `GET /accounts/{id}/cfd_tunnel` | 200、tunnel 0 件 (read 可) |
| `GET /accounts/{id}/access/apps` | 200、0 件 |
| `GET /accounts/{id}/access/service_tokens` | 200、0 件 |
| `GET /accounts/{id}/workers/scripts`, `/workers/domains` | 200、script 9 件 (`tastile-web-staging`, `tastile-web-preview`, `tastile-edge-staging` 等) |
| `GET /accounts/{id}/r2/buckets`, `/hyperdrive/configs`, `/memberships`, `/accounts/{id}/tokens` | 403 |
| `GET /user/tokens/{id}` (self detail) | 403 |

write-probe (2026-11-25 追試。作成物は即削除または失敗のため残存物なし):

| probe | 結果 |
|---|---|
| `POST /zones/{id}/dns_records` (TXT `acc-perm-probe`) → `DELETE` | **200 作成・削除成功 → DNS: Edit 保有を実測** |
| `POST /accounts/{id}/cfd_tunnel` (`tastile-phase-a-acc`) | **403 Authentication error → Tunnel: Edit 非保有を確定** |
| `POST /accounts/{id}/access/service_tokens` (`acc-probe-delete-me`) | **403 → Access service token 発行権限 非保有を確定** |

R2 S3 credential (prod `/tastile/desktop`):

| probe | 結果 |
|---|---|
| `aws s3 ls s3://tastile-desktop-releases --endpoint-url https://<account>.r2.cloudflarestorage.com` | 200、prefix `channels/ releases/ updates/` |
| `aws s3api head-bucket` | 200 |

注: write-probe により DNS: Edit の保有と Tunnel / Access write の非保有を実測で
確定した (上表)。残る「未確定」は Access Apps and Policies の application/policy
書き込みのみで、service token 発行が 403 である以上同 scope も非保有と見なすのが
安全。

## 3. 実 HTTPS に必要な権限の充足表

A-AT01 (`https` プロファイル) が要求する公開経路:

| # | 操作 | 必要権限 | 現状 |
|---|---|---|---|
| 1 | remotely-managed tunnel 作成 | Account → Cloudflare Tunnel: Edit | **403 で非保有を確定** |
| 2 | tunnel token 取得 (`GET /accounts/{id}/cfd_tunnel/{tid}/token`) | 同上 | `TUNNEL_TOKEN` 未発行・未登録 |
| 3 | 公開 hostname の DNS record 作成 | Zone(`tastile.app`) → DNS: Edit | **write-probe で保有を実測済み** |
| 4 | (任意) Access application + policy / service token | Account → Access: Apps and Policies: Edit (service token 発行を含む) | service token 作成 **403 で非保有を確定** |
| 5 | cloudflared runtime | `TUNNEL_TOKEN` を Infisical から注入 | compose 済み (`deploy/prod-stack`)、secret のみ不足 |

`app.tastile.app` / `api.tastile.app` の DNS は既存 A/AAAA record が別 stack を指している
(`acceptance/https-readiness.md` 参照)。cutover は #144 の公開経路構築における
明示承認が前提 (root#66 は Infisical SoT の issue であり DNS 移管承認の正本ではない)。

## 4. 不足権限の最小要求 (user 判断)

**推奨は案 B**: 既存 `CLOUDFLARE_API_TOKEN` は edge worker deploy 用途で既に
広い read scope を持つため、そこへの権限追加 (案 A) は過剰権限の集中を招く。
不足分のみを持つ専用 token を新規発行し、用途と失効を独立させる。

次のいずれか。値の登録は Infisical のみで行い、GitHub Secret / repo への commit はしない。

- **案 A**: 既存 `CLOUDFLARE_API_TOKEN` (staging `/tastile/edge`) に以下を追加付与
  - Account → Cloudflare Tunnel: Edit
  - (Access を使う場合) Account → Access: Apps and Policies: Edit
    (service token 発行権限を含む。Muse probe 用に必須)
  - ~~Zone → DNS: Edit~~ → **write-probe で既保有を実測済みのため不要**
  - rotation は root#99 の手順に従う。
- **案 B (推奨)**: 不足 scope のみを持つ専用 Account API Token を新規発行し、
  Infisical prod project (`ab532e90-…`) の `/tastile/edge` (新規 path) に
  `CLOUDFLARE_TUNNEL_API_TOKEN` として登録。prod 側に `/tastile/edge` がないため、
  deploy 用途なら prod project への配置が自然。
  - 発行手順 (Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token):
    - Account Resources: `Rebuild.up.up@gmail.com's Account` (c6ab6651…)
    - Permissions: Account → **Cloudflare Tunnel: Edit**
    - Permissions: Account → **Access: Apps and Policies: Edit**
      (service token 発行を含む。Muse probe 用に必須)
    - Zone Resources / Zone permissions: **不要** (remotely-managed tunnel の
      public hostname は tunnel config API 側で管理され、既存 token の DNS:Edit で
      別途 route を張る場合のみ DNS 権限が要る)
    - TTL / client IP filter は任意 (推奨: TTL 90 日 + rotation を root#99 手順に従う)
  - remotely-managed tunnel では ingress の public hostname は
    `PUT /accounts/{id}/cfd_tunnel/{tid}/configurations` で設定し、
    DNS record は Cloudflare が自動作成するため Zone DNS:Edit は本 token に不要。
- **案 C (権限付与なし)**: tunnel と Access service token を CF dashboard で手動作成し、
  token / client id+secret を Infisical へ直接登録する。agent は DNS route・
  cloudflared・Caddy/env 整備を既存 DNS:Edit 権限で実行する。

`TUNNEL_TOKEN` は tunnel 作成後にしか発行できないため、現時点での要求は API token の scope のみ。
tunnel 作成・DNS 変更・Access 変更はいずれも承認境界の内側であり、権限付与後も実行は別途承認を得る。

## 5. 権限付与後の設定手順 (準備済みドラフト)

以下は権限が揃った時点で実行する手順。秘密値は Infisical 経由でのみ扱う。

### 5.1 tunnel 作成 (API、remote-managed)

```bash
# 前提: token は Infisical から process 内変数へ (値を出力しない)
# POST /accounts/{account_id}/cfd_tunnel  {name: "tastile-prod", config_src: "cloudflare"}
# → tunnel id と token を取得。token は即座に Infisical へ登録し、以後出力しない。
```

- tunnel 名案: `tastile-prod` (account 内で一意)。
- `config_src: "cloudflare"` = remotely-managed。ingress は dashboard/API で管理し、
  `cloudflared` は token のみで `tunnel --no-autoupdate run` できる
  (`deploy/prod-stack/compose.yaml` の `cloudflared` service と一致)。

### 5.2 ingress / public hostname (計画)

| public hostname | service | 対応 origin |
|---|---|---|
| `app.<domain>` (apex) | `http://web:3000` | Next.js web |
| `api.<domain>` | `http://api:31400` | tastile-core API |

fallback: `http_status:404`。`APP_DOMAIN` / `API_DOMAIN` の最終値は #144 の
公開経路構築における明示承認後に確定 (root#66 は Infisical SoT の issue)。
現行 placeholder 候補は `app.tastile.app` / `api.tastile.app` だが既存 stack が
利用中のため、cutover 前の Phase A 検証には既存レコードと分離した専用
サブドメイン (例: `acc-app.tastile.app` / `acc-api.tastile.app`) を使う
(公開のため record 作成自体に承認が必要。DNS:Edit は token が保有済み)。

### 5.3 DNS record (計画、未作成)

各 public hostname に tunnel への CNAME を作成 (proxied):

- `<hostname>` CNAME → `<tunnel-id>.cfargotunnel.com`

`cloudflared tunnel route dns <tunnel> <hostname>` でも同等。既存 A/AAAA record との
衝突は cutover 時に置き換える (#144 公開経路構築の明示承認後)。

### 5.4 Access (採用する場合の設計案)

- application: `api.<domain>` に self-hosted application を作成。
- policy: Muse / harness probe 用に **service token** (`non_identity` + `service_auth`) を
  1 本発行し、`CF-Access-Client-Id` / `CF-Access-Client-Secret` を Infisical に登録
  (`acceptance/https-readiness.md` の要求と一致)。
- Web (`app.<domain>`) は Access を掛けない (一般公開が目的)。Edge assertion
  (`TASTILE_EDGE_ASSERTION`) は別層のアプリ認証であり、Access とは独立。
- Bypass / service-auth の scope は最小限にし、service token は環境ごとに分離する。

### 5.5 secret schema 追加 (Infisical、値は登録時にのみ設定)

prod project (`ab532e90-…`) に `/tastile/edge` を新設し、以下を登録する案:

| key | 用途 |
|---|---|
| `CLOUDFLARE_TUNNEL_API_TOKEN` | tunnel 作成・route 管理用 API token (あれば) |
| `TUNNEL_TOKEN` | `cloudflared run` 用。tunnel 作成後に発行・即登録 |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Access 採用時の probe/service token |

prod-stack の env 注入は `deploy/prod-stack/.env.example` の `TUNNEL_TOKEN=` に対応済み。
`/tastile/prod-stack` のような専用 path を新設する案もあるが、既存規約
(`/tastile/<consumer>`) に合わせ `/tastile/edge` を推奨。

## 6. 検証 (権限付与直後、read-only)

```bash
TOKEN=<infisical から取得>
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify   # active
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel"
```

write を伴う確認 (tunnel 作成等) は承認後に実施し、結果は本 runbook へ追記する。
