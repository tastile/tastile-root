# Verification stack for #105 (Tastile local-first)

独立開発検証用のローカルスタック。**運用（production）環境の代替ではなく、常に非本番**として扱う。本番の DB・volume・network・credential・port を一切使い回さない。

> **stack 操作は必ず `../../scripts/stack.sh` 経由で行う**（root#183）。
> project 名・port・volume・image の事前照合と allowlist は wrapper の preflight が
> 強制する。bare `docker compose` は project 名既定値による他 stack の誤爆を
> 起こし得るため使わない。正規手順は `docs/runbooks/stack-operations.md` を参照。

## 前提

- 兄弟 checkout（`tastile-root` を基準ディレクトリとする）:
  ```text
  workspace/
    tastile-root/      # このリポジトリ（deploy/verify-stack を持つ）
    tastile-core/      # tastile-core（api/worker Dockerfile を持つ）
    tastile-web/       # (任意) Web 検証用
  ```
- Docker と Docker Compose v2（`docker compose version`）
- `jq`（preflight が解決済み Compose 設定を検査するため）
- 開発 API の branch 切替は `TASTILE_CORE_DIR` / `TASTILE_CORE_TAG` で行う。デフォルトは Compose ファイルから見て **`../../../tastile-core`**（`tastile-root/deploy/verify-stack/` から workspace 兄弟）を `.wslc/Containerfile.v1` から build する。

## 起動（fresh checkout 手順）

```bash
cd <workspace>
git clone https://github.com/tastile/tastile-root
git clone --branch main https://github.com/tastile/tastile-core      # または固定 SHA を checkout
git clone --depth 1 --branch release-1-1-0 --recurse-submodules \
          https://github.com/tastile/tastile-web                      # Web 検証する場合

cd tastile-root

# secret は .tmp/verify.env 等の gitignore 済み env file に保存する
# （TASTILE_WEB_BRIDGE_SECRET 必須。registry の env_file 列を参照）

export TASTILE_STACK_ENV_FILE=$PWD/.tmp/verify.env
scripts/stack.sh verify doctor                 # preflight（up 相当の全検査）

# ディスク残量・Compose 設定の事前確認（build 前に必須。stack.sh の
# preflight とは別物で、こちらは容量と設定値の attestation を行う）
set -a; . .tmp/verify.env; set +a
(cd deploy/verify-stack && bash preflight.sh)

scripts/stack.sh verify up --build -d

# 健全性確認（migration は初回起動時に自動適用される）
curl -s http://127.0.0.1:31410/v1/health
scripts/stack.sh verify ps                     # db = healthy、api/worker = running
scripts/stack.sh verify logs --tail=50 api worker
```

preflight は実際に解決された Compose 設定を読み取り、API host port が `31400` / `31401`、DB host port が `5432` / `5433` でないこと、両サービスが `TASTILE_DELIVERY_PROVIDER=fake` を使うこと、API / worker の DB URL が compose network の `db:5432` を指すことを確認する。API と DB の host 公開先が `127.0.0.1` であることも検証する。条件に合わなければ stack の起動前に失敗し、合格時は検証専用の attestation 行を出力する。`docker compose up` に使う環境変数や `COMPOSE_FILE` を変える場合は、同じ設定で preflight を実行する。

host API port の既定値は `31410`、container 内の Core API port は `31400` のまま。`TASTILE_API_PORT` は loopback に公開する host port を、`TASTILE_API_HOST` は container 内の API bind address を指定する（既定 `0.0.0.0`）。通常の endpoint は `127.0.0.1:31410 → container:31400` となる。

### Web 検証のための認証ストア（Better Auth）の初期化

Web サインイン・セッション復元をローカルのみで検証する場合は、Core と同一の verify DB 内に `tastile_auth` データベースと Better Auth の表を作成しておく。スクリプトは冪等なので再実行してよい。

```bash
bash bootstrap-web-auth.sh
# => `tastile_verify` ではなく `tastile_auth` が作られる。schema は better-auth-schema.sql を参照。
```

この初期化は fresh DB への確認であっても、既存の検証データを破壊しない（`tastile_verify` は対象外）。

### Web を立ててブラウザ検証する（ローカルのみ）

```bash
cd <workspace>/tastile-web
bun install --frozen-lockfile
TASTILE_ENV=development \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
NEXT_PUBLIC_APP_HOST=localhost \
NEXT_PUBLIC_APEX_HOST=apex.tastile.local \
CLOUD_API_BASE=http://localhost:31410 \
NEXT_PUBLIC_TASTILE_CORE_URL=http://localhost:31410 \
NEXT_PUBLIC_DAEMON_BASE_URL=http://localhost:31410 \
TASTILE_USE_RUST_CORE=1 \
TASTILE_RUST_API_URL=http://127.0.0.1:31410 \
TASTILE_WEB_BRIDGE_SECRET="$(cat /path/to/verify-bridge-secret.txt)" \
TASTILE_AUTH_DATABASE_URL=postgres://tastile:tastile-verify-only@127.0.0.1:55432/tastile_auth \
PORT=3000 \
bun run next dev
```

Sign-up → `/api/auth/bridge`（`tastile_api_token` 取得）→ `/dashboard/timeline/month` に到達。proxy 経由の `/api/proxy/v1/*` が `TASTILE_WEB_BRIDGE_SECRET` と `x-tastile-web-session-user` を用いた Bridge 認証で Core に到達する。

## 資源上限（NF04-R05 / root#145）

本番相当の上限を小さい値で再現し、ローカルで強制動作を検証できる。

- cgroup: db 0.5 CPU/512M、api 1.0/1G、worker 0.5/512M
  （`TASTILE_VERIFY_*_CPUS` / `TASTILE_VERIFY_*_MEMORY` で上書き可）
- PostgreSQL: `max_connections=40`
- ディスク floor: `TASTILE_DISK_MIN_FREE_BYTES`（既定 1 GiB）。実際の空きより
  大きい値を与えると api の書き込みが 503、worker drain が `deferred` になる。
- 上限値一覧と検証手順の正本: `docs/runbooks/resource-limits.md`

## 並行インスタンス（複数の検証スタックを同時に起ける）

1 タスク 1 スタックで隔離する場合は、**prefix・compose project 名・host port・image tag の 4 つをすべて**既定値から変える。1 つでも既定のままだと既存インスタンスと衝突する（`container_name` と volume name は compose project 名で自動的に分散しないため `-p` だけでは足りない。共通の image tag は互いに image を置き換える）。

並行 instance を立てる前に **`deploy/stacks.tsv` へ新しい stack id を登録する**
（project・env_file・ports・images を明示）。登録後は `scripts/stack.sh <id>` で
操作する。registry に無い ad-hoc な `docker compose -p` 起動は preflight を
通らないため行わない。

```bash
cd <workspace>/tastile-root

# secret は生成して .tmp/ 配下の env file に保存する
openssl rand -hex 24 > /tmp/verify-b-bridge-secret.txt
cat > .tmp/verify-b.env <<EOF
TASTILE_VERIFY_PREFIX=tastile-verify-b
TASTILE_CORE_TAG=verify-b
TASTILE_API_PORT=31420
TASTILE_VERIFY_PG_PORT=55433
TASTILE_WEB_BRIDGE_SECRET=$(cat /tmp/verify-b-bridge-secret.txt)
EOF
# .tmp/verify-b.env を stacks.tsv の新規行 env_file に登録してから:
scripts/stack.sh verify-b doctor
scripts/stack.sh verify-b up --build -d
```

| 変数 | 効果 |
| --- | --- |
| `TASTILE_VERIFY_PREFIX` | container 名（`<prefix>-db/api/worker`）と DB volume 名（`<prefix>-pgdata`） |
| stacks.tsv の `project` 列 | compose project 名 → network `<project>_default`（volume key とは独立）。wrapper が `-p` を自動付与 |
| `TASTILE_CORE_TAG` | image 名 `tastile-core-verify:<tag>`。**インスタンスごとに一意にする**（共通 tag は一方の build が他方の image を置き換える） |
| `TASTILE_API_PORT` / `TASTILE_VERIFY_PG_PORT` | host 側 loopback port（この例では API `31420` / DB `55433`） |
| `TASTILE_WEB_BRIDGE_SECRET` | インスタンス専用の検証 secret（既定は必須。上記のようにファイルへ保存して Web にも渡す） |

Web dev server も同じインスタンスの port を指す（上の例の値）:

| Web 変数 | 例 |
| --- | --- |
| `PORT` | `3002` |
| `CLOUD_API_BASE` / `NEXT_PUBLIC_TASTILE_CORE_URL` / `TASTILE_RUST_API_URL` / `NEXT_PUBLIC_DAEMON_BASE_URL` | `http://localhost:31420` |
| `TASTILE_AUTH_DATABASE_URL` | `postgres://tastile:tastile-verify-only@127.0.0.1:55433/tastile_auth` |
| `TASTILE_WEB_BRIDGE_SECRET` | 保存した secret ファイルの値 |

- Better Auth 初期化は `TASTILE_VERIFY_PREFIX=<prefix> bash bootstrap-web-auth.sh`（container を直接指定したい場合のみ `TASTILE_PG_CONTAINER` を使う）。
- 停止は registry 登録済みの stack id で `scripts/stack.sh <id> down` を使う。
  `down -v` は volume 完全削除なので証跡確定後のみ:

  ```bash
  scripts/stack.sh verify-b down              # 停止（volume 保持）
  scripts/stack.sh verify-b down -v           # 停止＋volume 削除。要件のときだけ
  ```

- 各インスタンスは専用 DB・volume・port・secret を持ち、互いに、また運用とも接続しない。証跡には起動コマンドと prefix を記録する。

## 容量管理（disk capacity）

2026-11-13 に検証作業中へ host disk が満杯となり、Docker Desktop の image/volume store が消失して全スタックの再 build が必要になった。再発防止として次を守る。

- **build 前に `bash preflight.sh` を実行する**。空き容量が `TASTILE_VERIFY_MIN_FREE_GIB`（既定 15 GiB）未満なら exit 1 で止まる。並行スタックを増やすときは特に必須。
- **使い捨てスタックは証跡確定後に `down -v` で畳む**。証跡は host 上の `docs/evidence/` に保全されるため、検証 DB volume を保持し続ける必要はない。
- **image tag は SHA / run ごとに分ける**（`TASTILE_CORE_TAG`）。旧 tag は `preflight.sh --prune-images` で、どの container からも参照されない `tastile-core-verify:*` だけを削除できる。volume・他プロジェクト・運用スタックの資源には触れない。
- **EXITED のまま残った検証 container** は `preflight.sh --prune-stopped` で `<prefix>-*` のみ削除できる。
- `docker system prune` / `docker volume prune` のような全体 prune は**使わない**。運用スタックや他プロジェクトのデータを巻き込み得るため。
- 長時間キャンペーン中は `bash preflight.sh` を定期実行し、空き容量の減少傾向を確認する。

## 停止・復元

```bash
cd <workspace>/tastile-root
scripts/stack.sh verify down           # 停止（DB volume は保持）
scripts/stack.sh verify down -v        # 停止＋テスト DB volume 完全削除
scripts/stack.sh verify up --build -d  # 緊急再構成（volume があれば復元を検証できる）
```

事故時（検証 DB 破損・不正 write の疑い）の手順:

1. `scripts/stack.sh verify stop api worker`
2. `psql "postgres://tastile:tastile-verify-only@127.0.0.1:55432/tastile_verify"` で状態を確認（書き込み禁止）
3. 必要なら `scripts/stack.sh verify down -v` で破棄し、`up --build -d` で再構成
4. 運用へは一切触れない

## 隔離の構造

| 層 | 検証環境 | 禁止される共有 |
| --- | --- | --- |
| DB port | `127.0.0.1:55432 → container:5432`（host port は変更可能） | 運用 `5432` / `5433` との共有。preflight で拒否 |
| DB 名 / credential | `tastile_verify` / `tastile`+`tastile-verify-only` | 運用 credential |
| volume | `tastile-verify-pgdata`（専用） | 運用 volume・cloud 上 volume |
| API port | `127.0.0.1:31410 → container:31400`（host port は変更可能） | 運用 `31400` / `31401` との共有。preflight で拒否 |
| network | `verify-stack_default`（compose project 名の既定。`-p` を付けると `<project>_default` に変動。いずれも検証専用） | 運用 network |
| 通知経路 | `TASTILE_DELIVERY_PROVIDER=fake`（外部送信なし） | 運用通知先 |
| 認証 | 検証用 bridge secret（起動毎にランダム生成を推奨） | 運用 bridge secret / Cognito |
| データ | 合成 fixture / シードのみ | 運用実データ |

運用 API と検証 stack が別 host にあることを安全性の根拠にしない。preflight は起動前に解決済み Compose 設定の port、DB URL、通知 provider、loopback binding を機械検証する。運用 host の到達性や設定には依存しない。

## 外部依存（free / paid）

| 依存 | 種別 | 本スタックでの扱い |
| --- | --- | --- |
| PostgreSQL Open-source | free (OSS) | 使用（alpine image） |
| Rust toolchain / base images (`rust:1-bookworm`) | free (OSS) | 使用 |
| Infisical（self-hosted） | free（自己ホスト） | **不使用**。検証既定値で代替 |
| Cloudflare / AWS / GCP / Stripe / Cognito | paid または課金連動 | **不使用**。Web は E2E_BYPASS_AUTH=1 で認証を bypass し loopback Core を叩く |

## 検証チェックリスト

- [ ] `scripts/stack.sh verify ps` で db が `healthy`、api/worker が `running` であることを確認
- [ ] migration 適用を `scripts/stack.sh verify logs api` と `v1_migration` 件数で確認
- [ ] API 再起動後も DB の行が保持される（volume 永続性）
- [ ] `scripts/stack.sh verify down -v && scripts/stack.sh verify up --build -d` で再構成できる
- [ ] 運用の DB への write 経路が存在しない（URL・port・credential のいずれも検証専用）
