# Staging edge publication (generation 26, 2026-10-19 UTC)

control: `ctl.staging-edge-publication`。token: `cred.cloudflare-edge-deploy` (Infisical staging `/tastile/edge`)。

## 公開前の検証
1. **direct origin の拒否**: Cloud Run `web` に allUsers invoker を付与した後、edge assertion 無しの匿名 request を両 URL (`web-vr74ihzzja-an.a.run.app`、決定的 URL `web-447901102899.asia-northeast1.run.app`) に送った。
   - `/`, `/login`, `/dashboard`, `/api/auth/get-session`, `/api/auth/token`, `/api/proxy/v1/tiles` は全て 403 (Web の edge gate)。
   - `/api/auth/jwks` だけが 200 (公開鍵 1 件 OKP/Ed25519、秘密鍵 field 無し)。
2. **JWT/JWKS**: Core (`core-api-00011-ppn`) に `TASTILE_WEB_JWKS_URL` (origin の JWKS) と `TASTILE_WEB_ASSERTION_ISSUER=https://staging-app.tastile.app` を設定し、その後 Web の `TASTILE_WEB_CORE_ASSERTION_ENABLED=true` を有効にした。
   - 正常系: login 後の Core 呼び出し (tiles・execution-view・active-tile・prompt・notifications) は全て 200。
   - 異常系: Core へ直接送った request は全て 401 `invalid web assertion`。
     - 未知の kid で偽造した token
     - `alg: none`
     - 形式不正
     - issuer 不一致
     - 期限切れ
   - 残り: bridge header だけで assertion の無い request は、移行中の経路として 200。Core は IAM-only で公開されておらず、bridge secret は server-only。`staging-api` を公開する前に、Core が assertion を必須にし bridge を廃止する (m4 の残作業)。

## 作成した resource (staging 専用)
| resource | id |
| --- | --- |
| Worker script `tastile-edge-staging` (source `infra/cloudflare/edge/worker.js`、sha256 `a06ee6a5…`) | — |
| route `staging-app.tastile.app/*` → `tastile-edge-staging` | `c5eae5435e7948ed9306d1aa04d97486` |
| DNS AAAA `staging-app.tastile.app` → `100::` (proxied) | `72db3acf29762805886c8c2c270e988d` |

`cloudflare-before.json` / `cloudflare-after.json` の差分は上記 3 件の追加だけ。既存の DNS record 18 件 (production と `staging.app`・`staging.api` 等)、他の Worker script (`my-web-2026`・`tastile-web-*`・`yusuke-kim-router`) は変更していない。

## 公開後の確認
- `https://staging-app.tastile.app` の `/`・`/login`・`/auth/signup` は 200 (`server: cloudflare`)。
- `/dashboard` は相対 `Location: /login?error=no_session` の 307 で、公開 host を保つ。
- `/api/auth/token` は無効 (404)。

## rollback
`rollback.ts` (workspace `.tmp/g28-cf.ts` の helper を使う) が route → DNS record → script の順に削除する。Cloud Run 側は OpenTofu で戻す。
- `web_core_assertion=false` → `core_web_assertion=false` → `web_public=false` の順に apply する。
- 逆順にすると、assertion 付き request が 401 になる時間ができる。

## 公開 hostname での Web E2E (実ブラウザ、local 代替なし)
Playwright Chromium を public DNS・実 TLS で `https://staging-app.tastile.app` に接続し、新規ユーザーで次の操作を行った。
- 新規登録: `__Secure-better-auth.*` と `tastile_uid` を `staging-app.tastile.app` に設定し、console error は 0 件。
- タスク作成 (時刻なし)、実行開始 (`tiles/{id}/start` 200、`placements/{id}/executions` 200、残り時間を表示)。
- cookie の無い新しい context で再ログインし、実行中の状態 (残り時間・操作) が復元された。
- 実行完了: `executions/{id}/finish` 200。

Web の assertion flag は有効で、Core への呼び出しは全て検証済み assertion で 200 だった。

## 一時的な非公開化: next@16.3.4 の critical advisory (2026-10-19)
- 別 session (tastile-e8) の報告: next/og `ImageResponse` に critical RCE、ほかに high が 2 件 (SSRF・sharp・source-map-js)。staging Web (image `web@sha256:56ce6882…`、next 16.3.4) は `/icon` (next/og) を公開 host で 200 返していた。
- 06:14Z ごろ、edge route だけを削除して公開を止めた (公開 host は 522)。direct origin は edge gate で 403 のまま。DNS と Worker script は残した。
- 公開していた間の Cloud Run log: `/icon` への request は自分の確認だけで、client は全て Cloudflare edge の IP 範囲。悪用の痕跡は見つからなかった。
- 修正 web#194 (`67329435`、next ~16.3.8、sharp >=0.35.5、source-map-js >=1.2.2) を web 171 に取り込み (`669e3b20`)、`bun audit --prod` clean と `bun run check` green を確認した。
- image `web@sha256:34df12ff…` (revision `web-00006-jsg`) を配備し、edge route を再作成した (`5817d1a2f7cb48b1b79c30059df7f8e0`)。
- 再公開後: 公開 `/login`・`/icon`・JWKS は 200、direct origin は 403。非公開だった時間は約 06:14–06:53Z。
