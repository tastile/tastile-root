# HTTPS プロファイル受入 readiness checklist

対象: `tastile/tastile-root#165` の `https` 環境プロファイル (A-AT01 を含む全 case)。
現状 (2026-11-25 時点): `https` プロファイルは外部経路が存在しないため A-AT01 は
N-A、その他 case は prod-equivalent で代替検証済み。本書は `https` プロファイルを
実行可能にするための前提条件と、実行時の確認手順を版管理する。

## 背景となる制約 (承認境界)

- `https` プロファイルは公開 DNS 名 + TLS の origin を要求し、loopback / IP literal
  を拒否する (`harness/src/profile.ts`)。
- ops 注入 (A-AT13–A-AT15) は `https` プロファイルでは禁止 (fail-closed)。
  Cloudflare Tunnel / DNS cutover / Access 設定は承認境界の内側であり、
  受入ハーネスからは実行しない。
- 外部経路の構築は `#144` (公開経路) / `#141` (正式リリース計画の承認境界)
  側の作業である。root#66 は Infisical SoT の issue であり DNS 移管の正本ではない。

## 前提条件チェックリスト

### 1. Cloudflare / Tunnel

- [ ] Cloudflare account への管理権限を保有していること。
      2026-11-25 の実証 (root#179 read-only + write-probe) で account
      `c6ab6651…` と `CLOUDFLARE_API_TOKEN` (staging `/tastile/edge`) の
      権限範囲を確定済み: zones / DNS records / tunnels / access apps /
      workers の read は可、**DNS record の create/delete も可**
      (TXT probe で実測)。一方 `POST /cfd_tunnel` と
      `POST /access/service_tokens` は 403 で、Zero Trust write scope
      (Tunnel:Edit / Access service token 発行) のみが不足。
      最小要求は `docs/runbooks/cloudflare-tunnel-access.md` §4 を参照
      (DNS:Edit は既保有のため要求から除外済み)。
- [ ] `cloudflared` tunnel を作成し `TUNNEL_TOKEN` を取得済みであること。
      compose 上は `cloudflared` service (`tunnel --no-autoupdate run`) が存在するが、
      token 未設定では起動しない。
- [ ] tunnel の public hostname が `api.<domain>` → `api:31400`、
      `app.<domain>` (apex) → `web:3000` に route されていること。
- [ ] Cloudflare Access (service token) の要否を判断済みであること。
      有効化する場合は harness からの probe 用 service token
      (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) を Infisical に登録する。

### 2. DNS / 公開経路

- [ ] 公開 DNS 名が決定し、A/CNAME が Cloudflare に向いていること。
      現在 `app.tastile.app` / `api.tastile.app` は既存の別 stack が利用中のため、
      新 stack への cutover は `#144` の公開経路構築における明示承認が必要
      (DNS 移管は不可逆に近い操作。root#66 は Infisical SoT の issue であり
      DNS 移管承認の正本ではない)。
- [ ] `APP_DOMAIN` / `API_DOMAIN` が prod-equivalent の `*.localhost` から
      公開名へ切り替わった env が用意されていること。
- [ ] `TASTILE_ALLOWED_ORIGINS` / `BETTER_AUTH_URL` / `NEXT_PUBLIC_*` が
      すべて公開 origin (`https://<domain>`) と一致していること。
      prod-equivalent で踏んだ落とし穴: public origin と内部 origin の不一致は
      Better Auth の Origin 検証で 403 になる。

### 3. Secrets (Infisical)

- [ ] `/tastile/*` に Cloudflare / Tunnel / Access 関連 secret の schema が
      追加されていること (現状: `CLOUDFLARE_API_TOKEN` と R2 S3 credential のみ登録済み。
      `TUNNEL_TOKEN` / Access service token は未登録。配置案は
      `docs/runbooks/cloudflare-tunnel-access.md` §5.5 を参照)。
- [ ] `TUNNEL_TOKEN`、Access service token、`BETTER_AUTH_SECRET`、
      `TASTILE_WEB_BRIDGE_SECRET` が対象 environment で解決できること。
- [ ] `STRIPE_*` は **設定しない** (Phase A は課金経路を使わない。
      空のままなら web の billing route は fail-closed で無効化される。
      下記「費用境界」を参照)。
- [ ] secret 値を本 repository / `.tmp/` 以外へ commit しないこと。

### 4. 実行時の確認

```bash
# 前提: 公開経路が生きていることを人間が先に確認する
dig +short app.<domain> api.<domain>
curl -sI https://api.<domain>/v1/health   # 200
curl -sI https://app.<domain>/            # 200

cd acceptance/harness
bun src/main.ts --profile https \
  --run-id <run-id>
```

- `TASTILE_ACCEPTANCE_API_BASE` / `TASTILE_ACCEPTANCE_WEB_BASE` に
  公開 `https://` origin を設定する (未設定だと ProfileError で fail-closed)。
- `TASTILE_ACCEPTANCE_OPS_CMD` / `TASTILE_ACCEPTANCE_OPS` は設定しない
  (設定しても無視されるが、証跡の混乱を避けるため未設定が望ましい)。
- TLS 検証は厳格のまま実行する。`TASTILE_ACCEPTANCE_TLS_INSECURE` は
  prod-equivalent の private CA 用であり、https プロファイルでは使わない。

### 5. 合格条件

- A-AT01 の 4 check (`tls-cert-valid` / `https-reachable` /
  `no-plain-http-bypass` / `no-direct-backend`) が PASS。
- 残り全 case が `https` プロファイルで PASS (ops 依存 case は
  契約上 prod-equivalent/local 側の証跡を参照する)。

## 費用境界 (Phase A での経路別判定、2026-11-25 時点)

| 経路 | Phase A 判定 | 状態 |
|---|---|---|
| Stripe | **無効化** | prod env で `STRIPE_*` を未設定にする。compose は `:-` 既定で空を注入し、web の `getStripe()` は "Missing STRIPE_SECRET_KEY" で fail-closed。稼働中の既存 prod (app.tastile.app) が使う Infisical prod `/tastile/web` の値は**変更しない** — Phase A 用 env は別途 render する |
| Resend (mail) | 任意・上限付き | `TASTILE_MAIL_PROVIDER=auto` は `RESEND_API_KEY` 未設定時 noop 相当。設定する場合も hourly 20 / daily 90 の quota が Resend Free (~100/day, ~3,000/month、自動有料化なし) 内に収まる設計 (web#262) |
| R2 (`tastile-desktop-releases`) | **維持** | desktop 配布の既存用途。Phase A で新規利用しないが、既存配布を破壊しない |
| Hyperdrive | 不使用 | `wrangler.jsonc` の Workers deploy 経路のみ。Phase A は compose 配備のため binding 自体が生成されない |
| Cloudflare Tunnel / Access | 無料枠 | Argo Tunnel / Access service token は Cloudflare Free プランの範囲。使用量課金の自動昇格設定は行わない |
| AWS / SES / Cognito / SOPS / KMS | 除去済み | web#262 (PR #271, release-1-1-0 merge 済み) で SES mailer を provider-agnostic mail boundary へ置換、Cognito 参照を除去。root#174 (PR #176) で SOPS/KMS 経路を退役 |

- `.env.example` の paid-path key (`STRIPE_*`, `AWS_*`, `GOOGLE_CLIENT_SECRET`) は
  すべて空が契約 (A-AT17 `no-paid-defaults` check が監査)。
- 無料枠超過時に自動有料化する構成は採用しない (Resend quota・CF Free プランとも
  上限到達時は送信/接続が止まるだけで課金は発生しない)。

## prod-equivalent で得た知見 (https でも再利用)

- web → api は必ず TLS 経路 (caddy 経由) を通す。protected runtime は
  plain http の core URL を拒否する (`InvalidCloudApiBaseError`)。
- Better Auth は credential POST に `Origin` header を要求する。
  公開 origin と `BETTER_AUTH_URL` / `TASTILE_ALLOWED_ORIGINS` を完全一致
  させる (port 番号の有無も含む)。prod-equivalent では caddy を
  `127.0.0.1:80/443` に bind して port 無し origin を再現した。
- `__Secure-` prefix cookie は https origin でのみ注入可能。
  ブラウザ検査には `TASTILE_ACCEPTANCE_WEB_BROWSER_BASE` と
  `TASTILE_ACCEPTANCE_TLS_INSECURE` (private CA の場合のみ) を使う。
- core image は `/v1/sync/snapshot` (A-AT14) を含む release HEAD で
  build し、`/app/migrate_run` を一度実行してから api を起動する。
