# Cloudflare エッジ基盤の資格情報と運用

Tastile の Caddy、Cloudflare Tunnel、Access、DNS を構成する運用者向け。公開の承認と受入条件は [root #144](https://github.com/tastile/tastile-root/issues/144) と [root #165](https://github.com/tastile/tastile-root/issues/165) が管理する。旧トークンの権限調査は [root #179](https://github.com/tastile/tastile-root/issues/179) に記録している。

## 保管先とアクセス

編集正本は self-hosted Infisical (`https://secrets.rebuildup.dev`) とする。エッジ基盤の管理資格情報は `tastile-edge-admin` (`8196a4fd-4246-4c7d-a3a6-edf7b733743a`) が所有する。環境は `dev`、`staging`、`prod` で分け、管理用の資格情報は必要な環境の `/provisioning` に置く。Cloudflare 側の権限はプロジェクトの環境名から継承されない。管理する Cloudflare アカウントとリソース範囲は発行時に制限する。

| Infisical キー (`prod /provisioning`) | Cloudflare アカウント所有トークン | アカウントスコープ |
| --- | --- | --- |
| `CLOUDFLARE_TUNNEL_API_TOKEN` | `tastile-edge-tunnel-admin` | `Cloudflare One Connector: cloudflared Write` |
| `CLOUDFLARE_ACCESS_POLICY_API_TOKEN` | `tastile-edge-access-policy-admin` | `Access: Apps and Policies Write` |
| `CLOUDFLARE_ACCESS_SERVICE_TOKEN_API_TOKEN` | `tastile-edge-service-token-admin` | `Access: Service Tokens Write` |

3 本とも同じ既存 Cloudflare アカウント内の対応リソースを管理できる。DNS、Pages、Workers、R2、請求の権限は付与していない。管理プロジェクトの直接メンバーは人間の Admin 1 名、Machine Identity とグループは 0 件。既存の `tastile-prod` は Web runtime に Viewer、GitHub Actions に Member を付与しており、両標準ロールはプロジェクト内の secret 値を読める。このため、フォルダーだけで管理資格情報のアクセスを分離できない。

| 資格情報の種類 | 保管・利用経路 |
| --- | --- |
| DNS | 既存の `tastile-staging / staging / /tastile/edge` の `CLOUDFLARE_API_TOKEN` に `tastile.app` の DNS 書き込み実績がある。公開承認後に運用者が使用する。将来専用化する場合は対象 Zone の `DNS Write` に制限し、旧経路の利用を照合してから切り替える。 |
| Tunnel コネクター | 受入用 `tastile-acceptance` の `TUNNEL_TOKEN` は `tastile-edge-runtime / staging / /cloudflared`。本番コネクターは専用資格情報と対象実行主体を設定する。 |
| Access のサービス認証 | `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` をサービスごとに発行し、Muse や受入プローブの実行主体専用の保管先から注入する。Access の後段で Core のスコープ付き認証も要求する。 |
| R2 配布 | `tastile-prod / prod / /tastile/desktop` の R2 S3 資格情報。Desktop のリリース workflow が既存バケットへの配布に使う。通常の S3 互換ツールが読む `AWS_*` はこの経路では R2 の値を指す。 |
| 製品サイトと既存 Workers | Pages は静的サイト用。既存 Workers の配備・メディア・R2 は個別に管理する。Pages と Workers の資格情報をエッジ管理プロジェクトに共用しない。 |

2026-11-25 に Cloudflare の請求画面を確認した。対象アカウントは Zero Trust が `Teams Free Base`、`tastile.app` が `Free Plan` で、既存の `Workers Paid` と `R2 Paid` も同居している。ADR-0025 の独立無料環境の成立は未確認。公開前に Phase A の経路を対象に、有料サービスとの分離と追加課金ゼロを確認する。既存のデプロイ、配布、請求契約は各所有者が管理する。

コネクターと Access サービス認証は、実行主体とアクセス境界を確認して保管先を決める。発行後は実行主体ごとに取得を検証する。

## 取得と検証

既存の Infisical ログイン済み運用者は、プロジェクト・環境・パスを明示して CLI から必要な値を実行プロセスに注入する。標準出力に値を出さず、CLI のエラーや Cloudflare の応答からは HTTP ステータスとトークン状態だけを証跡に残す。

```sh
infisical run --domain=https://secrets.rebuildup.dev \
  --projectId=8196a4fd-4246-4c7d-a3a6-edf7b733743a \
  --env=prod --path=/provisioning --expand=false \
  --include-imports=false --secret-overriding=false -- <管理用コマンド>
```

3 本取得する上記コマンドは運用者の管理プロセス用。委譲時は対象セッションを承認し、`prod:/provisioning` の読み取りだけを持つ有効期限 1 時間以下の Infisical サービストークンを、サンドボックス内の対象プロセスに注入する。検証コマンドは値をプロセス内で使用し、取得結果と対象 API の成否だけを返す。別環境・別プロジェクトを指定したリクエストから対象外のキーを取得できないことも確認する。

2026-11-25 に Devin の指定セッションで、3 キーの取得と各 Cloudflare API の読み取りを検証した。Infisical の単一スコープのサービストークンは、対象外の環境・パスを指定しても許可スコープへ絞り込む場合がある。応答のステータスと返されたキーの所属を確認する。新たな作業で資格情報が必要になった場合は、そのセッションと作業に対して改めて期限付きの実行プロセスを起動する。

2026-11-25 に Infisical から 3 キーを取得した。Cloudflare の token verify で、互いに異なる 3 本が `active` であることを確認した。用途ごとの一覧 API は `200`。R2 バケット一覧とアカウント API トークン一覧は全件 `403` だった。一部の Tunnel・Access 一覧は異なる用途のトークンでも `200` を返すため、書き込みの分離は発行設定を確認した。既存 DNS トークンの書き込み実績は [root #144 の調査](https://github.com/tastile/tastile-root/issues/144#issuecomment-7157284771) を参照する。

### 非公開の受入コネクター

受入 Tunnel `tastile-acceptance` の実行用プロジェクト ID は `6a91a2d3-bf8d-4d51-804b-98fd99cc7d65`。公開前の接続検証では、一時プロセスにトークンを注入して `cloudflared` を実行する。`cloudflared` は公式配布の固定バージョンを使用する。

```sh
infisical run --domain=https://secrets.rebuildup.dev \
  --projectId=6a91a2d3-bf8d-4d51-804b-98fd99cc7d65 \
  --env=staging --path=/cloudflared --expand=false \
  --include-imports=false --secret-overriding=false -- \
  cloudflared tunnel --config /dev/null --no-autoupdate --metrics 127.0.0.1:0 run
```

`cloudflared` 2026.11.2 で接続 4 件と Cloudflare の `healthy` を確認した。Tunnel の公開 ingress と対象を指す DNS レコードは 0 件。検証後にコネクターを停止した。実 HTTPS、Access と Muse の検証は公開範囲の承認後に行う。

## 公開作業

1. `#144` で検証用ホスト名と公開範囲を確定する。既存 `app.tastile.app` と `api.tastile.app` の切替は独立した承認で扱う。
2. 対象アカウントで remotely managed Tunnel を構成する。取得したコネクタートークンを指定保管先に登録してから `cloudflared` に供給する。
3. ingress は Caddy を経由する。固定した Compose 候補で Caddy のホスト振り分けと origin TLS を確認し、末尾に `http_status:404` を置く。
4. Access で保護する API ホストには限定した Service Auth ポリシーを適用する。Muse と検証の資格情報は、実行主体と必要範囲を照合して発行する。DNS の作成前に Access 側の拒否条件を確認する。
5. API で設定する場合、Tunnel ingress の設定と Zone の proxied CNAME の作成は別の操作。承認済みのホスト名だけを `<tunnel-id>.cfargotunnel.com` に向ける。ダッシュボードの公開導線では DNS が自動作成されるため、承認前に送信しない。
6. 追加課金が発生しない契約・設定を確認し、[HTTPS 受入手順](../../acceptance/https-readiness.md) を実行する。

Cloudflare の仕様は [Tunnel 設定と DNS 作成](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/) と [Access Service Token 作成権限](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/) を参照する。

## 期限、失効、復旧

運用者は Cloudflare で 90 日の期限を設定し、Infisical のキーコメントと [root #99](https://github.com/tastile/tastile-root/issues/99) に期限、担当、更新予定を記録する。初回の有効期限は 2027-02-23。更新の目安は 14 日前の 2027-02-09。

更新時は用途を 1 本ずつ扱う。同じスコープで新規発行し、切替用の一時キーに登録して token verify と対象 API を検証する。次に正規キーへ反映し、取得する運用コマンドを再検証する。旧トークンは切替の検証と承認まで有効に保つ。復旧では有効な既知のトークンへの切戻し、または必要な用途だけの再発行を行う。期限を過ぎた場合は広いトークンにフォールバックせず、管理操作を止める。コネクターやサービス認証が別資格情報で構成されているため、管理トークンの期限切れだけで実行中の通信は止まらない。
