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

- [x] Tunnel、Access アプリ・ポリシー、Access Service Token 管理の 3 本を
      `tastile-edge-admin / prod / /provisioning` に登録。Infisical から取得し、
      Cloudflare の有効性検証と対応する一覧 API が全件 `200` であることを確認。
      既存トークンの DNS 書き込み実績、管理スコープ、利用方法は
      [Cloudflare エッジ基盤 runbook](../docs/runbooks/cloudflare-tunnel-access.md) を参照。
- [x] 指定の Devin セッションで期限付き読み取りを検証。対象の 3 キーを取得し、
      対応する Cloudflare API を呼び出せることと、対象外の環境・プロジェクトのキーを取得できないことを確認した。
- [x] 非公開の受入 Tunnel `tastile-acceptance` を作成し、
      `tastile-edge-runtime / staging / /cloudflared` から `TUNNEL_TOKEN` を取得。
      実際に `cloudflared` を起動して接続 4 件と Cloudflare の `healthy` を確認した。
- [ ] 承認済みの実行ホストで、固定した配備候補のコネクターが同じ取得経路で接続できること。
- [ ] Tunnel が Caddy 経由で `api.<domain>` → `api:31400`、
      `app.<domain>` → `web:3000` に到達し、未定義ホストを拒否すること。
- [ ] Cloudflare Access の Service Auth を構成し、Muse と受入プローブに必要な資格情報を
      対象実行主体へ供給できること。`https` ハーネスの Access ヘッダー注入は #168 で検証する。

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

- [ ] 発行後、`TUNNEL_TOKEN` と Access クライアント資格情報を用途別の Infisical 保管先に登録し、
      コネクター・Muse・受入プローブが必要なキーだけ取得できること。
- [ ] `TUNNEL_TOKEN`、Access service token、`BETTER_AUTH_SECRET`、
      `TASTILE_WEB_BRIDGE_SECRET` が対象 environment で解決できること。
- [ ] `STRIPE_*` は **設定しない** (Phase A は課金経路を使わない。
      空のままなら web の billing route は fail-closed で無効化される。
      下記「費用境界」を参照)。
- [ ] secret 値の編集は Infisical で管理し、実行プロセスへの注入と値を含まない証跡を確認する。

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
| Cloudflare Tunnel / Access | 無料枠を使用 | Zero Trust は `Teams Free Base`。同じアカウントに `Workers Paid` と `R2 Paid` があるため、Phase A の実経路について有料経路からの分離と追加課金ゼロを公開前に確認する |
| AWS / SES / Cognito / SOPS / KMS | 除去済み | web#262 (PR #271, release-1-1-0 merge 済み) で SES mailer を provider-agnostic mail boundary へ置換、Cognito 参照を除去。root#174 (PR #176) で SOPS/KMS 経路を退役 |

- `.env.example` の paid-path key (`STRIPE_*`, `AWS_*`, `GOOGLE_CLIENT_SECRET`) は
  すべて空が契約 (A-AT17 `no-paid-defaults` check が監査)。
- 上限到達時の挙動、課金契約、配備に使う権限を公開前に確認する。既存の有料サービスを
  Phase A のフォールバックとして使う構成は対象外。

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
