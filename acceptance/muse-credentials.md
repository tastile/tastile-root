# Muse 資格情報の保管・取得・更新・失効手順

対象: tastile/tastile-root#150（Muse 連携）、#165（NF04-A 受入正本）。
認証モデルと probe 手順の正本は [`muse-access.md`](./muse-access.md)、
接続先・操作例の正本は [`muse-handoff.md`](./muse-handoff.md) を参照。
本書は資格情報の **保管場所・キー一覧・取得/更新/失効コマンド・緊急遮断** のみを
版管理する。secret 実値は本書・Issue・PR・ログのいずれにも含めない。

## 1. Infisical 保管場所

| 項目 | 値 |
| --- | --- |
| Instance | `https://secrets.rebuildup.dev`（self-hosted） |
| Project | `tastile-staging`（projectId `44081e84-5983-4cc2-9fc9-dca5363005e1`） |
| Environment | `staging`（受入用途。実公開・本番切替後は `prod` 側へ別途整備する） |
| Path | `/tastile/muse`（2026-11-25 作成） |

`/tastile/<component>` 配下は `tastile-staging / staging` の既存規約
（`docs/runbooks/infisical.md`）に従う。Muse は独立した失効単位を持つため
専用フォルダーとし、`/tastile/core` や `/tastile/edge` の値は複製しない。

## 2. キー一覧（値なし）

| キー | 内容 | 発行元 / 更新責任 |
| --- | --- | --- |
| `TASTILE_MUSE_API_BASE` | API origin。現行値: `https://acc-api.tastile.app`（受入公開ホスト。公開承認前は未到達。loopback 検証時は `http://127.0.0.1:31440`） | 公開経路確定時（#144/#165 A-AT01）に更新 |
| `TASTILE_MUSE_API_TOKEN` | Core scoped API token。`scopes=tastile.read tastile.write`、`all` なし。label `muse-staging-202611`、token id `01a212b8-c968-7392-b77f-a1128f59ec7f`、expires_at `2027-02-23T00:00:00Z` | 専用 owner credential で `POST /v1/api-tokens`（§4） |
| `TASTILE_MUSE_OWNER_EMAIL` | 専用 owner `muse-integration@tastile-acceptance.invalid` のメール | owner 再作成時のみ変更 |
| `TASTILE_MUSE_OWNER_PASSWORD` | 同 owner のパスワード。token 発行・失効（OwnerAdmin 相当操作）に必要 | 同上 |

Cloudflare Access Service Token（`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`）
は現時点で **未登録**。理由と判断は §5 を参照。発行が承認された時点で
`/tastile/muse`（または実行主体別 path）へ追加する。

## 3. 取得手順

Muse 側の実行主体には、`tastile-staging / staging / /tastile/muse` の
**読み取りのみ** の Machine Identity または承認済み一時資格情報を付与する
（secrets-management Skill §7。現時点で専用 identity は未発行 — §6 の operator 作業）。
人間の運用者はログイン済み CLI から取得する。

```bash
# 値を表示せず実行プロセスへ注入する例
infisical run --domain=https://secrets.rebuildup.dev \
  --projectId=44081e84-5983-4cc2-9fc9-dca5363005e1 \
  --env=staging --path=/tastile/muse --expand=false \
  --include-imports=false --secret-overriding=false -- \
  <Muse probe コマンド>

# 単一キーの値を変数へ（出力しない）
TOKEN=$(infisical secrets get TASTILE_MUSE_API_TOKEN \
  --projectId=44081e84-5983-4cc2-9fc9-dca5363005e1 \
  --env=staging --path=/tastile/muse \
  --domain=https://secrets.rebuildup.dev --plain)
```

取得後は `muse-handoff.md` §5 の環境変数（`TASTILE_MUSE_API_BASE` /
`TASTILE_MUSE_API_TOKEN`）として供給し、引数・ログ・証跡への平文出力を禁止する。

## 4. token の発行・更新（rotation）

前提: `TASTILE_MUSE_OWNER_EMAIL` / `TASTILE_MUSE_OWNER_PASSWORD` で owner に
再認証できること。prod-acc 相当の protected runtime では password sign-up は
無効のため、owner credential は Web の sign-in → `/api/auth/bridge` で
`tastile_api_token` cookie を取得して使う（`acceptance/harness/src/bootstrap.ts`
の `signupViaWeb` と同経路。sign-in は `POST /api/auth/sign-in/email`）。

1. owner admin credential（bridge token）を取得する。
2. 新 token を発行する。raw token は応答で 1 回だけ返るため、即座に
   Infisical へ登録する（`infisical secrets set --file`。値を画面・ログに出さない）:

   ```http
   POST {API_BASE}/v1/api-tokens
   Authorization: Bearer <owner admin token>
   {"label":"muse-staging-<yyyymm>","scopes":"tastile.read tastile.write",
    "expires_at":"<RFC3339>"}
   ```

3. Infisical `/tastile/muse` の `TASTILE_MUSE_API_TOKEN` を新値で更新し、
   Muse 側の取得経路で新 token の read（`GET /v1/tiles` → 200）を実測する。
4. 旧 token を失効する（§5）。順序を逆にすると Muse が旧 token で失敗するため、
   **新 token の動作確認後に旧 token を revoke** する。

`expires_at` は必須（省略は 400）。現行 handoff token は 2027-02-23 失効予定で、
更新目安は 2027-02-09（edge 管理 token と同じ 14 日前ルールを適用）。

## 5. 失効・緊急遮断

### Core scoped token の失効

owner admin credential で:

```http
DELETE {API_BASE}/v1/api-tokens/{token_id}
Authorization: Bearer <owner admin token>
```

失効後の呼び出しは 401（`acceptance/.tmp/muse-credentials/verify.json` で実測）。
`expires_at` 経過でも自動失効する。token id は §2 の表と Infisical 登録時の
運用記録で管理する（id 自体は秘密ではない）。

### 緊急時の遮断（優先順）

1. `DELETE /v1/api-tokens/{id}` で Muse token を即時失効 → API は 401。
2. 必要なら owner password を変更し、Web session / bridge token も無効化する
   （owner credential 自体の封じ込め）。
3. 公開経路側: Muse 用 Access Service Token を発行済みの場合は Cloudflare で
   当該 service token を削除または service-auth policy から除外する
   （`tastile-edge-admin / prod / /provisioning` の
   `CLOUDFLARE_ACCESS_SERVICE_TOKEN_API_TOKEN` /
   `CLOUDFLARE_ACCESS_POLICY_API_TOKEN` を使う運用者操作。エージェントの
   自律 write は承認境界）。
4. Infisical `/tastile/muse` の値を削除・更新して再取得を止める。

## 6. 未整備の operator 作業（承認・権限待ち）

| 作業 | 状態 | 必要な承認/権限 |
| --- | --- | --- |
| Muse 取得用 Machine Identity（`/tastile/muse` read のみ）発行 | 未実施 | Infisical org 管理者による identity 作成と scope 付与 |
| Access Service Token `tastile-acc-muse` 専用発行 | **推奨・未発行** | 下記 §5-Access の判断記録の通り、Cloudflare write（Service Tokens Write）の実施承認 |
| `TASTILE_MUSE_API_BASE` の実 HTTPS 到達確認 | 未実施 | 公開経路（Tunnel ingress / DNS / cloudflared 起動）の承認（#144） |
| `prod` environment 側の `/tastile/muse` 整備 | 未実施 | 実公開後 |

## 7. Access Service Token の判断記録

- 既存 `tastile-acc-muse-probe`（`tastile-edge-runtime / staging / /access`）は
  受入プローブ専用に発行済みで、service-auth policy `eaf7f482-…` の対象は
  当該 token のみ。
- Muse 用に **専用 token `tastile-acc-muse` の新規発行を推奨**する。
  理由: 失効独立性（Muse 漏洩時に probe を止めない/その逆も同様）、
  用途名と実行主体の一致、policy 対象を実行主体ごとに分離できる。
- 既存 probe token の共有も技術的には可能だが、名前・policy・失効単位が
  probe と共用になるため最小権限の観点で採用しない。
- 発行は `Access: Service Tokens Write` 権限を持つ
  `tastile-edge-admin / prod / /provisioning` の
  `CLOUDFLARE_ACCESS_SERVICE_TOKEN_API_TOKEN` による Cloudflare write であり、
  read-only 検証済みの範囲を超えるため **operator 作業として承認待ち**。
  発行後は client_id/secret を `/tastile/muse`（staging）へ登録し、
  service-auth policy の対象へ追加する。

## 8. 検証証跡

2026-11-25、prod-acc stack（api `http://127.0.0.1:31440`）に対して実測
（証跡: `acceptance/.tmp/muse-credentials/verify.json`。値は含まない）:

- handoff token（`muse-staging-202611`）で `GET /v1/tiles` → 200。
- `tastile.read` のみの検証用 token で `GET /v1/tiles` → 200、
  `POST /v1/tiles` → 403 `missing scope 'tastile.write'`。
- 検証用 token を `DELETE /v1/api-tokens/{id}` で失効 → 204、
  失効後 `GET /v1/tiles` → 401。
- 不正 bearer → 401。
- 検証用 token は全て revoke 済み（生値を紛失した 1 本を含む）。
  handoff token は Infisical `/tastile/muse` にのみ保管し、ローカルの
  一時コピーは削除済み。
