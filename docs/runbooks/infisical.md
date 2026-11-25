# Tastile の Infisical 運用

値の編集正本は self-hosted Infisical (`https://secrets.rebuildup.dev`) とする。リポジトリはキー名、型、必須条件、環境、取得先を管理する。アプリケーションの契約は各リポジトリの env schema、Compose の契約は `deploy/prod-stack/.env.example`、アーキテクチャは ADR-0025 を参照する。

## プロジェクトと環境

- プロジェクトは所有者とアクセス主体が一致する単位で作る。標準ロールで管理者、開発者、実行主体の権限を分けきれない場合はプロジェクトを分ける。プロジェクト名には長期の責務を表す名前を付ける。
- 環境スラッグは `dev`、`staging`、`prod`。ローカル開発は `dev`、共有統合と隔離検証は `staging`、本番リソースを管理または利用する資格情報は `prod` に置く。Cloudflare のアカウント単位の権限は、先行検証で使用する場合も本番リソースに作用する。
- フォルダーは `/` を構造の起点とし、値を読むコンポーネントや運用目的が分かる小文字の名前を付ける。既存 Tastile クライアントの `/tastile/<component>` はリポジトリの `.infisical.json` と実行入口が参照する。変更する際は利用元の切替と復旧を同じ作業で検証する。
- キーは読み手が要求する `UPPER_SNAKE_CASE` を使う。新規資格情報はサービス名と用途を名前に含める。コネクターなど外部ソフトウェアが規定するキー名はその契約に従う。
- 持ち主と失効単位が同じ値を同一プロジェクト内の複数の実行主体が使う場合は、元のキーを 1 つ定めて Infisical の secret reference を使う。参照を解決する主体が元の値に必要なアクセスだけを持つことを確認する。プロジェクト間共有は有料機能のため、現行の構成では用途別の資格情報とアクセス主体を定義する。 [Infisical の参照と共有](https://infisical.com/docs/documentation/platform/secret-reference)

## 利用主体

| 利用主体 | 取得経路 |
| --- | --- |
| 人間の開発者 | Infisical にログインし、環境とパスを指定して既存の CLI 入口から実行プロセスに注入する。 |
| GitHub Actions と self-hosted runner | 対象リポジトリ、workflow、保護された environment の GitHub OIDC を Machine Identity に制限する。資格情報を使う job だけに `id-token: write` と対象プロジェクトの読み取りを付与する。 |
| Compose runtime | API、Worker、Web、DB、コネクターへ各サービスが要求するキーを供給する。Infisical と接続できない状態での再起動と復旧は、環境を固定して検証する。 |
| エッジ管理者 | `tastile-edge-admin / prod / /provisioning` を使用する。管理権限と実行資格情報の対応を runbook で管理する。 [Cloudflare エッジ基盤](cloudflare-tunnel-access.md) |

標準 `viewer` はプロジェクト内の値を読むことができ、`member` は値の作成・変更・削除も可能。フォルダーや CLI 引数は利用経路を指定する。権限はロールで確認する。既存の広いロールを狭める場合は、対象の実行主体で新しい取得を実測し、他環境へのアクセス拒否を確認してから切り替える。

## staging の既存参照

`tastile-staging / staging` では次のキーを参照元として維持する。

| 元のパスとキー | 参照先 |
| --- | --- |
| `/tastile/core/shared` の `TASTILE_DATABASE_URL`、`TASTILE_DELIVERY_KEY` | `/tastile/core/api`、`/tastile/core/worker` |
| `/tastile/core` の `TASTILE_WEB_BRIDGE_SECRET` | `/tastile/core/api`、`/tastile/web/runtime` |
| `/tastile/edge` の `TASTILE_EDGE_ASSERTION` | `/tastile/core/api`、`/tastile/web/runtime` |

## 移行、復旧、廃止候補

1. 切替前にキー名、参照元、環境、担当、発行元、権限、失効・復旧の手順を記録する。稼働中の取得経路は別のリリースや外部設定も照合する。
2. 新しい取得経路を追加して、対象の実行主体と許可外の主体で検証する。値の比較が必要ならプロセス内で一致・不一致だけを判定する。
3. 承認済みの切替で利用元を更新し、実行を検証する。旧経路が有効な間に切戻し手順を確認する。値の削除と発行元での失効は承認を得てから実施する。
4. 廃止候補には `retirement-review` タグを付ける。タグは棚卸し用で、現在の値やアクセスを維持する。依存が不明な値は現行パスに保持し、Issue で担当と照合先を明記する。

| 対象 | 判断 |
| --- | --- |
| Cognito | Web の release-1-1-0 で退役。`tastile` と `tastile-prod` の 19 キーに `retirement-review` を付与した。既存配備のソースと照合してから削除・失効を判断する。 [Web #262](https://github.com/tastile/tastile-web/issues/262) |
| SOPS / AWS KMS | Tastile の未適用経路は退役済み。別プロジェクトの端末ブートストラップや暗号化構成は各リポジトリの利用経路で判断する。 [root #174](https://github.com/tastile/tastile-root/issues/174) |
| 旧 EC2 DB runtime と GCP identities | Native-first の Compose とは別の経路。EC2 DB runtime 用の 2 キーに `retirement-review` を付与した。稼働中の配備、復旧経路、アクセス実績を照合してから権限や値を整理する。 |
| PostgreSQL と Better Auth | API/Worker 用と認証用の DB・ロールを区別する。移行前後で認証と Core の API 認可を検証する。 |
| Desktop の R2 配布 | 既存の Desktop release workflow に参照がある。配布の保管先と権限を維持する。 |
| Stripe、Resend | Stripe は先行稼働の注入対象外。既存本番値の有効性は別途確認する。メールを有効化する場合は対象環境で Resend の上限と発送元の権限を確認する。 |

値を含まない取得検証と未解消事項は [root #66](https://github.com/tastile/tastile-root/issues/66) に記録する。
