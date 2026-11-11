# Verification stack for #105 (Tastile local-first)

独立開発検証用のローカルスタック。**運用（production）環境の代替ではなく、常に非本番**として扱う。本番の DB・volume・network・credential・port を一切使い回さない。

## 前提

- 兄弟 checkout（`tastile-root` を基準ディレクトリとする）:
  ```text
  workspace/
    tastile-root/      # このリポジトリ（deploy/verify-stack を持つ）
    tastile-core/      # tastile-core（api/worker Dockerfile を持つ）
    tastile-web/       # (任意) Web 検証用
  ```
- Docker と Docker Compose v2（`docker compose version`）
- 開発 API の branch 切替は `TASTILE_CORE_DIR` / `TASTILE_CORE_TAG` で行う。デフォルトは Compose ファイルから見て **`../../../tastile-core`**（`tastile-root/deploy/verify-stack/` から workspace 兄弟）を `.wslc/Containerfile.v1` から build する。

## 起動（fresh checkout 手順）

```bash
cd <workspace>
git clone https://github.com/tastile/tastile-root
git clone --branch main https://github.com/tastile/tastile-core      # または固定 SHA を checkout
git clone --depth 1 --branch release-1-1-0 --recurse-submodules \
          https://github.com/tastile/tastile-web                      # Web 検証する場合

cd tastile-root/deploy/verify-stack
export TASTILE_WEB_BRIDGE_SECRET="$(openssl rand -hex 24)"
docker compose up --build -d

# 健全性確認（migration は初回起動時に自動適用される）
curl -s http://127.0.0.1:31400/v1/health
docker compose ps
docker compose logs --tail=50 api worker
```

## 停止・復元

```bash
docker compose down          # 停止（DB volume は保持）
docker compose down -v       # 停止＋テスト DB volume 完全削除
docker compose up --build -d # 緊急再構成（volume があれば復元を検証できる）
```

事故時（検証 DB 破損・不正 write の疑い）の手順:

1. `docker compose stop api worker`
2. `psql "postgres://tastile:tastile-verify-only@127.0.0.1:55432/tastile_verify"` で状態を確認（書き込み禁止）
3. 必要なら `docker compose down -v` で破棄し、`up --build -d` で再構成
4. 運用へは一切触れない

## 隔離の構造

| 層 | 検証環境 | 禁止される共有 |
| --- | --- | --- |
| DB port | 127.0.0.1:55432（非標準） | 運用 5432 との共有 |
| DB 名 / credential | `tastile_verify` / `tastile`+`tastile-verify-only` | 運用 credential |
| volume | `tastile-verify-pgdata`（専用） | 運用 volume・cloud 上 volume |
| API port | 127.0.0.1:31400 | 運用公開 port |
| network | `tastile-verify-stack_default` | 運用 network |
| 通知経路 | `TASTILE_DELIVERY_PROVIDER=fake`（外部送信なし） | 運用通知先 |
| 認証 | 検証用 bridge secret（起動毎にランダム生成を推奨） | 運用 bridge secret / Cognito |
| データ | 合成 fixture / シードのみ | 運用実データ |

## 外部依存（free / paid）

| 依存 | 種別 | 本スタックでの扱い |
| --- | --- | --- |
| PostgreSQL Open-source | free (OSS) | 使用（alpine image） |
| Rust toolchain / base images (`rust:1-bookworm`) | free (OSS) | 使用 |
| Infisical（self-hosted） | free（自己ホスト） | **不使用**。検証既定値で代替 |
| Cloudflare / AWS / GCP / Stripe / Cognito | paid または課金連動 | **不使用**。Web は E2E_BYPASS_AUTH=1 で認証を bypass し loopback Core を叩く |

## 検証チェックリスト

- [ ] `docker compose ps` で db が `healthy`、api/worker が `running` であることを確認
- [ ] migration 適用を `docker compose logs api` と `v1_migration` 件数で確認
- [ ] API 再起動後も DB の行が保持される（volume 永続性）
- [ ] `docker compose down -v && up --build -d` で再構成できる
- [ ] 運用の DB への write 経路が存在しない（URL・port・credential のいずれも検証専用）
