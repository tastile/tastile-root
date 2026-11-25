# Muse 連携ハンドオフ — 直接 HTTP API 操作パッケージ (NF04-A)

正本: tastile/tastile-root#165（受入契約 A-AT01–A-AT17）、#150（Muse 連携）、
#105（現行運用移行・運用境界）。認証・probe 設計の前提は
[`muse-access.md`](./muse-access.md) を参照。

本書は Muse の実行環境（ブラウザ・CLI・Web session に依存しない独立ネットワークの
機械クライアント）へ引き渡す接続先・契約版・機械認証・資格情報経路・操作例・失効手順の
正本である。secret 実値・個人ホスト識別子・実データは含めない。

## 1. 範囲と承認境界

- 対象は **Phase A（#165）**: 新環境の専用 owner で、Muse 相当クライアントから
  Core HTTP API を直接操作できる状態の確立と引渡し。
- 実 Muse 環境・実 HTTPS 公開経路・本番 deploy への接続は承認境界であり、本書の
  手順は承認後にのみ実行する。既存 Muse 運用 SoT・実データ・通知経路は変更しない。
- CLI 正式公開（tastile-cli#6）や既存データ移行（#105 Phase B）は本パッケージの
  前提ではない。

## 2. 接続先

| 項目 | 値 |
| --- | --- |
| API origin | `{API_DOMAIN}`（prod-equiv 候補の実測値: `https://api.localhost`、Caddy 経由。loopback 限定の隔離 stack であり、実 Muse ネットワークからの到達証明ではない） |
| API path prefix | なし。全エンドポイントは `{API_DOMAIN}/v1/...` |
| 契約版 | **OpenAPI contract v4.0.0** — `tastile/tastile-openapi` tag `v4.0.0`、commit `d0b8d4ba785d07bc610f0339bf7c02fec1424e59` |
| live 契約 snapshot | `GET {API_DOMAIN}/v1/openapi.json`（稼働中 API が生成する実装一致の契約） |
| Web origin（参照のみ） | `{APP_DOMAIN}`。Muse 経路では使用しない |

公開ドメイン（`APP_DOMAIN` / `API_DOMAIN` の実値）は DNS 移管・Tunnel 承認
（#144 / #66、A-AT01）で確定する。それまでは prod-equivalent stack の
`*.localhost` 名が接続先であり、外部ネットワークからの到達は未証明である。

## 3. 機械認証モデル

Muse は以下の 2 段階のうち **アプリ認可（必須）のみ** を使う。

1. **入口（任意・profile 依存）**: Cloudflare Access Service Token
   （`CF-Access-Client-Id` / `CF-Access-Client-Secret`）。https profile で Access を
   前段に置く場合のみ必要。現行の local / prod-equivalent では不要。
   要否は A-AT01 の https profile 確定時に決まる。
2. **アプリ認可（必須）**: Core scoped API token を
   `Authorization: Bearer <token>` で送る。

- scope は `tastile.read` / `tastile.write` の独立 scope。`all` は付与しない
  （`all` は OwnerAdmin を含むレガシーワイルドカードであり、Muse へは最小権限の
  scoped token のみを渡す）。
- Muse の推奨 scope は `tastile.read tastile.write`（タスク操作に必要な最小構成）。
  読み取り専用の利用には `tastile.read` のみの token を別途発行する。
- Better Auth session cookie、`x-tastile-web-bridge-secret`、`x-owner-id`
  フォールバックは Muse 経路では使わない（bridge secret は server-only、
  `x-owner-id` は protected runtime で無効）。

### token の権限境界（core#153 / ADR-0010 で実装済み）

- `POST /v1/api-tokens` 等の token 管理・account export/delete は
  `OwnerAdmin` 要求であり、scoped token（`tastile.read` / `tastile.write`）では
  **403 で拒否される**。Muse token が漏洩しても新規 token 発行・権限昇格・
  アカウント削除には到達できない。
- `expires_at` は必須（省略は 400）。失効は `DELETE /v1/api-tokens/{id}`
  （OwnerAdmin のみ）または期限切れ。失効・期限切れ後の API 呼び出しは 401。

## 4. 資格情報の取得・保管・失効

### 発行（operator 手順、承認後）

1. 専用 owner を Web の sign-up 経路で作成する
   （`acc-<runId>-muse@tastile-acceptance.invalid` 形式の専用アドレス。
   protected runtime では Core password sign-up は 503 で無効のため Web 経由）。
2. Web bridge（`/api/auth/bridge`）で owner の admin 相当 token を取得する。
3. その credential で scoped token を発行する:

   ```http
   POST {API_DOMAIN}/v1/api-tokens
   Authorization: Bearer <owner admin token>
   Content-Type: application/json

   {"label":"muse-<env>-<yyyymm>","scopes":"tastile.read tastile.write","expires_at":"<RFC3339>"}
   ```

   応答の `token`（raw）は **この 1 回だけ** 返却される。`id` / `prefix`
   （sha256 先頭 8 hex ではなく token 先頭 8 文字）/ `scopes` を記録し、
   raw token は即座に保管経路へ移す。

### 保管・供給

- 正本の保管場所は Infisical。**新規 path `/tastile/muse`** に
  `TASTILE_MUSE_API_BASE` / `TASTILE_MUSE_API_TOKEN`（必要なら
  `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`）を置く計画。
  path 作成と secret 投入は operator 作業であり、現時点では **未作成（blocker）**。
- Muse 側は Infisical の machine identity で取得するか、承認済み手順での
  一時配布とする。配布・取得のいずれでも GitHub Issue/PR・ログ・証跡への
  平文出力を禁止する。
- 実行時は環境変数経由とし、引数・ログ・証跡への token 平文を禁止する
  （`muse-access.md` §3 と同一規則）。

### 失効

- 即時失効: owner admin credential で `DELETE {API_DOMAIN}/v1/api-tokens/{id}`。
  失効後の呼び出しは 401（A-AT06 で実測済み）。
- 計画失効: 発行時の `expires_at` を運用期間に合わせて設定する
  （probe 用は短期、handoff 用は別途決定）。
- ローテーション: 新 token 発行 → Muse 側の資格情報差し替え → 旧 token 失効の順。

## 5. 操作例（curl、`$TASTILE_MUSE_API_BASE` / `$TASTILE_MUSE_API_TOKEN` を環境変数で供給）

全ての command 系リクエストは `idempotency_key`（UUID 等の一意値）を body に含める。
`payload` の形状は `GET {API}/v1/openapi.json` の各 request schema が正本。

```bash
API="$TASTILE_MUSE_API_BASE"   # 例: https://api.localhost
TOK="$TASTILE_MUSE_API_TOKEN"
AUTH="Authorization: Bearer $TOK"

# 到達性
curl -fsS "$API/v1/health"

# タスク（tile）作成 → readback
curl -fsS -X POST "$API/v1/tiles" -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "idempotency_key": "'"$(uuidgen)"'",
  "payload": {"kind":1,"title":"muse-task-001","description":null,"color":"#3b82f6","icon":"check-circle","external_id":null,"plan_role":0,"owner_subject_id":null}
}'
curl -fsS "$API/v1/tiles/{tile_id}" -H "$AUTH"

# 一覧・検索
curl -fsS "$API/v1/tiles?limit=100" -H "$AUTH"

# 予定化（placement 作成）— tile の plan_id と window (RFC3339) を使う
curl -fsS -X POST "$API/v1/placements" -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "idempotency_key": "'"$(uuidgen)"'",
  "payload": {"tile_id":"{tile_id}","plan_id":"{plan_id}","source":0,
    "source_ref":{"created":null,"recurring":null,"flow":null,"frame":null,"proposal":null,"source_text":null,"external_id":null},
    "baseline":{"span":{"start":"2026-12-01T09:00:00.000Z","end":"2026-12-01T10:00:00.000Z"},"inside":null}}
}'

# タイムライン（解決済み span の確認）
curl -fsS "$API/v1/timeline?start=2026-12-01T00:00:00.000Z&end=2026-12-01T23:59:59.999Z" -H "$AUTH"

# 実行制御（placement → execution）
curl -fsS -X POST "$API/v1/placements/{placement_id}/executions" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"'"$(uuidgen)"'","payload":{"placement_id":"{placement_id}"}}'
curl -fsS -X POST "$API/v1/executions/{execution_id}/pause"   -H "$AUTH" -H 'Content-Type: application/json' -d '{"idempotency_key":"'"$(uuidgen)"'","payload":null}'
curl -fsS -X POST "$API/v1/executions/{execution_id}/resume"  -H "$AUTH" -H 'Content-Type: application/json' -d '{"idempotency_key":"'"$(uuidgen)"'","payload":null}'
curl -fsS -X POST "$API/v1/executions/{execution_id}/finish"  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"'"$(uuidgen)"'","payload":{"execution_id":"{execution_id}","kind":0,"note":"done"}}'

# 編集・削除（archive）
curl -fsS -X POST "$API/v1/tiles/{tile_id}/update" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"'"$(uuidgen)"'","payload":{"tile_id":"{tile_id}","title":"new title"}}'
curl -fsS -X DELETE "$API/v1/tiles/{tile_id}" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"'"$(uuidgen)"'","payload":{"tile_id":"{tile_id}"}}'
```

補足: `PATCH /v1/tiles/{id}` は meta-min 限定・`If-Match` 必須のため、タイトル等の
編集は command 経路 `POST /v1/tiles/{id}/update` を使う。再配置は
`POST /v1/placements/{id}/changes`（ChangeSet）を使い、確定結果は
`/v1/timeline` で readback する。

## 6. 実測結果（prod-equivalent stack `tastile-prod-acc`）

- 実行: 2026-11-25、harness run-id `muse-nf04a2`、profile `prod-equivalent`、
  ops なし。対象: `A-AT05`–`A-AT12`（#165 の Muse 直接 HTTP・認可・owner 分離・
  CRUD・予定化・Web↔API 収束・編集/再配置/削除・実行制御に対応）。
- 環境: api `http://127.0.0.1:31440`（`https://api.localhost` でも同一）、
  web `https://app.localhost`。image `tastile-core:87271a29` /
  `tastile-web:prod-equiv-acceptance`。専用 owner `acc-muse-nf04a2-*` のみ使用
  （実運用 owner・実データ不変）。
- 結果: **8/8 PASS**。証跡:
  `acceptance/.tmp/acceptance/muse-nf04a2-prod-equivalent/`（case ごとの
  check/step JSON と summary。token 生値・password は記録していない）。

| #165 AT | harness case | prod-acc 実測 |
| --- | --- | --- |
| A-AT05 Muse 実行環境から直接 HTTP（機械認証・scope 付き token・ブラウザ/CLI 非依存） | A-AT05 | PASS（scoped token のみの fresh client で CRUD 成立） |
| A-AT06 未認証・誤資格情報・失効・scope 不足の拒否 | A-AT06 | PASS（401/403 を実測。read-only token の write=403、write-only の read=401、revoke 後=401） |
| A-AT07 別 owner の読取・更新拒否 | A-AT07 | PASS（cross-owner read/write/delete=404 で存在隠蔽、list 分離、状態不変） |
| A-AT08 source/task 作成→取得 | A-AT08 | PASS（create/readback/idempotent replay/revision 前進） |
| A-AT09 予定化 | A-AT09 | PASS（placement 作成→timeline で期待 span 一致） |
| A-AT10 Web↔直接 API の観測一致 | A-AT10 | PASS（同一 owner で双方から同一 tile を観測） |
| A-AT11 編集・削除・再配置 | A-AT11 | PASS（title 編集 readback、ChangeSet による再配置、archive で list から消失・履歴 read 可） |
| A-AT12 開始・中断・再開・終了 | A-AT12 | PASS（start/pause/resume/finish、state 遷移 0→1→0、履歴保存） |

注意: 本実測は loopback の prod-equivalent stack に対するものであり、Muse の
独立ネットワークからの到達そのものではない。外部経路は A-AT01（https profile、
#144/#66）で別途証明する。

## 7. エラー・障害対応

- `401`: credential なし・不正・失効・期限切れ。token を再発行/再供給する。
- `403`: scope 不足（例: `tastile.read` のみで write）または OwnerAdmin 要求
  endpoint への scoped token アクセス。scope 設計を見直す（`all` は付与しない）。
- `404`: cross-owner アクセスは存在隠蔽のため 404。自 owner のリソースか確認する。
- `400`: `expires_at` 欠落、未知 scope、不正 JSON 等の validation error。
- `409`: `STALE_REVISION` 等の競合。readback で revision を取り直して再試行。
- `422`: cursor 形式不正・`limit` 範囲外等（contract v4.0.0 の sync 系を含む）。
- `429`: rate limit（core in-process limiter）。バックオフして再試行。
- `503`: protected runtime での password auth 無効等。Web 経路の bootstrap を確認。

## 8. 残存 blocker / 未確定事項

| 項目 | 状態 | 担当 |
| --- | --- | --- |
| 実公開 API ドメインと外部到達（A-AT01） | 未確定。DNS/Tunnel/Access は #144/#66・承認境界 | root#144, #66 |
| Infisical `/tastile/muse` path と secret 投入 | 未作成（operator 作業） | #150 handoff 実施時 |
| Cloudflare Access Service Token の要否 | https profile 確定後に判断 | #144/#66 |
| handoff 用 token の有効期限・ローテーション周期 | 未決定（#150 で運用値を確定） | #150 |
| 実 Muse 環境からの probe 実行 | 承認境界。承認後に `muse-access.md` §4 の手順で実施 | #150 |
