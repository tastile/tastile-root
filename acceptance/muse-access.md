# Muse 実環境 probe・資格情報供給経路の設計 (NF04-A)

正本: tastile/tastile-root#165 (A-AT05/A-AT06/A-AT16, 実行タスク 4)、担当 Issue #150。
引渡しパッケージ (接続先・契約版・操作例・失効手順) は
[`muse-handoff.md`](./muse-handoff.md) を正本とする。
本書は「Muse の実行環境から直接 HTTP で実 API を操作する」経路の設計を版管理する。
実環境からの実測は #150 / #165 の統合候補で行い、本書はその手順・契約・証跡形式を固定する。
local harness の A-AT05 は同一 API 呼び出しを loopback で再現するものであり、
外部ネットワーク経路の証明にはならない (それは A-AT01 = https profile + #144/#66)。

## 1. 認証モデル

Muse はブラウザ・CLI・Web session に依存しない機械クライアントである。Core API に対して
以下の 2 段階で認証する。

1. **入口 (任意・profile 依存)**: Cloudflare Access Service Token
   (`CF-Access-Client-Id` / `CF-Access-Client-Secret`)。https profile で Access を
   前段に置く場合のみ。local/prod-equivalent では不要。
2. **アプリ認可 (必須)**: Core scoped API token を `Authorization: Bearer` で送る。
   scope は `tastile.read` / `tastile.write` の独立 scope で、必要最小限を付与する
   (#165: scope 付き token、最小権限・失効)。

Better Auth の session cookie や `x-tastile-web-bridge-secret` は Muse 経路では使わない
(bridge secret は server-only であり client artifact に入れない。A-AT16 が注入拒否を検証)。

## 2. 専用 owner と token ライフサイクル

- owner: `acc-<runId>-museprobe@tastile-acceptance.invalid` (共通規則 `dedicated_owner`)。
  実運用 owner・実データには触れない。
- token 発行: owner credential (bridge api token) で
  `POST /v1/api-tokens { label: "acc-<runId>-muse", scopes: "tastile.read tastile.write", expires_at }`。
  有効期限は用途に応じた短期 (probe は run 内、handoff 用は #150 で別途決定)。
- 失効: `DELETE /v1/api-tokens/{id}`。A-AT04/A-AT06 が revoke → 401 を検証済み。
- 証跡には token 生値・cookie・password を出さない。sha256 prefix (先頭 8 hex) と
  owner_id のみ記録する (`bootstrap.ts` の `tokenPrefix`)。

## 3. 資格情報供給経路

- 正本の保管場所は Infisical (`/tastile/...` 配下。path は #150 で確定)。
- harness・probe script・GitHub Issue/PR/証跡に secret 実値を置かない。
- Muse 環境への注入は「Muse 側が Infisical から取得」または「承認済み手順での一時配布」
  のいずれかとし、いずれも #150 の handoff 手順に記録する。ローカル `.env` への
  実値保存はしない (workspace 契約)。
- probe 実行時は環境変数 (`TASTILE_MUSE_API_BASE`, `TASTILE_MUSE_TOKEN` 等) 経由とし、
  引数・ログ・証跡への token 平文出力を禁止する。

## 4. probe 手順 (実環境、#150 で実施)

前提: https profile の api_base が確定 (A-AT01 PASS)、専用 owner/token 発行済み。

1. `GET {api}/v1/health` → 200 (到達性。A-AT01 と重複するが probe 単位で記録)。
2. `POST /v1/tiles` (Bearer = Muse token, fixture title `acc-<runId>-museprobe`) → 2xx。
3. `GET /v1/tiles/{id}` → title/kind/owner 一致の readback。
4. `GET /v1/tiles` (scope=tastile.read のみの第 2 token) → 200、
   同 token で `POST /v1/tiles` → 403 (scope 分離の実測。A-AT06 と同一 oracle)。
5. 失効確認: `DELETE /v1/api-tokens/{id}` 後の再 read → 401。
6. 証跡: 各 status、tile id、token prefix hash、実行環境の識別子 (秘密を含まない範囲)、
   時刻。保存先は #165 の証跡集約ルールに従う。

合否: 手順 2–5 が全て期待通りなら「Muse 実環境からの直接 HTTP 操作」成立。
200 応答のみ・health のみ・mock は不可 (#165 共通条件)。

## 5. 担当対応

| 項目 | 担当 |
|---|---|
| token 発行/失効 API・scope 検証 | 本 harness A-AT05/A-AT06 (local で実測済み) |
| probe script の実装と実環境実行 | #150 (Muse 連携)。prod-acc での直接 HTTP 実測は harness run `muse-nf04a2` (A-AT05–12 PASS) で実施済み。実 Muse 環境からの probe は承認境界 |
| 外部到達性 (DNS/Tunnel/Access) | #144/#66 → A-AT01 (https profile) |
| 資格情報の保管・供給経路確定 | #150 + Infisical 運用 (#102 費用境界と整合) |
| handoff (接続先・OpenAPI 版・scope・操作例・失効手順) | #165 実行タスク 4 |
