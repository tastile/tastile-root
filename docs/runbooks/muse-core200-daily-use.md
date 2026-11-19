# Muse 向け Core 2.0.0 + CLI 独立検証 runbook (prerelease)

対象読者: Muse (検証 VM 上のエージェント)。開発エージェント・開発 Mac・
SSH tunnel・事前配布の秘密鍵なしで、公開済み成果物だけから環境を
再現できることを目的とする。

本書は **検証専用 stack** の手順である。Muse の現行運用 Tastile
(127.0.0.1:31400 / PostgreSQL 5433) の DB・worker・通知経路は一切変更
しない。新 Core は Muse 自身の環境で **別 port・別 DB** に立てる。

- 正本 Issue: tastile/tastile-root#105、tastile/tastile-cli#6、
  tastile/tastile-core#322
- リリース状態: **prerelease (Muse 検証用)**。G3/G5 の正式受入は未完了で、
  release→main の統合承認も未了。安定版として扱わない
- 関連証跡: `tastile-cli/docs/evidence/2026-11-19-core200-cli-e2e.md`、
  `tastile-cli/docs/evidence/2026-11-19-muse-access-edge-verification.md`

## 1. 固定バージョン

| 要素 | 固定値 |
| --- | --- |
| Core | `tastile-core` tag `v2.0.0-rc.1` = commit `0e6ecb2f00038cbaa0fca149e5268f31386e8fe7` (`release-2-0-0` head) |
| Core artifacts | GitHub Release `v2.0.0-rc.1` の `tastile-core-2.0.0-rc.1-linux-{amd64,arm64}.tar.gz` + `SHA256SUMS.txt` |
| CLI | `tastile-cli` tag `v1.1.0-rc.1` = commit `28d9b1d951bf330e4f4a544e50e27ebb71b7658a` (`release-1-1-0` head、`tastile 1.1.0`) |
| CLI artifacts | GitHub Release `v1.1.0-rc.1` の `tastile-linux-{amd64,arm64}` + `SHA256SUMS.txt` |
| OpenAPI pin | `tastile-openapi` tag `v3.8.1` = `49a1b449f22ca70b66989dbcebe224fd50c57d26` |

互換性: CLI 1.1.0 は pin した OpenAPI v3.8.1 の契約で Core 2.0.0 の
`/v1/*` を叩く。Core 側の実装範囲は v1 runtime (crates-v1) であり、
内部 v2 artifact runtime とは別物。

## 2. インストール (公開成果物のみ・再現可能)

前提: Linux x86_64 または aarch64、glibc 系 (Debian/Ubuntu 等。
Alpine/musl 不可)、PostgreSQL 16 (自前または Docker)、`curl`/`tar`/
`sha256sum` (または `shasum -a 256`)。Docker は compose 経路を使う場合
のみ必要。

### 2.1 Core

```bash
uname -m   # x86_64 -> amd64, aarch64 -> arm64

# GitHub Release から取得 (gh があれば `gh release download` でも可)
VER=2.0.0-rc.1
ARCH=amd64   # aarch64 の場合は arm64
BASE="https://github.com/tastile/tastile-core/releases/download/v${VER}"
curl -fLO "${BASE}/tastile-core-${VER}-linux-${ARCH}.tar.gz"
curl -fLO "${BASE}/SHA256SUMS.txt"
sha256sum -c SHA256SUMS.txt   # ファイル名が違う場合は個別に照合

tar xzf "tastile-core-${VER}-linux-${ARCH}.tar.gz"
cd "tastile-core-${VER}"
cp env.example .env           # 内容を確認・必要に応じて編集
```

### 2.2 CLI

```bash
VER=1.1.0-rc.1
ARCH=amd64   # aarch64 の場合は arm64
BASE="https://github.com/tastile/tastile-cli/releases/download/v${VER}"
curl -fLO "${BASE}/tastile-linux-${ARCH}"
curl -fLO "${BASE}/SHA256SUMS.txt"
sha256sum -c SHA256SUMS.txt
install -m 755 "tastile-linux-${ARCH}" ~/.local/bin/tastile
~/.local/bin/tastile version   # "tastile 1.1.0" が出れば OK
```

### 2.3 Core stack の起動

**推奨: docker compose** (同梱の `compose.yaml` + `.env`)

```bash
cd tastile-core-2.0.0-rc.1
docker compose up -d db
docker compose run --rm migrate      # schema migration (初回のみ・冪等)
docker compose up -d api worker
curl -s http://127.0.0.1:31410/v1/health   # "version":"2.0.0" を確認
```

**bare metal** (Docker を使わない場合): `README.md` の "bare metal"
節を参照。`./bin/migrate_run` → `./bin/api` → `./bin/worker` の順。
api は **port 31410** で listen させること (31400 は CLI が常に拒否する
運用 port)。

### 2.4 credential の自前発行 (秘密情報は配布されない)

```bash
# 1) owner 作成 + session token 取得 (TASTILE_ENV=development で password auth 有効)
curl -s -X POST http://127.0.0.1:31410/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"muse-verify@example.com","display_name":"muse-verify"}'
# => session_id / owner_id / token / expires_at

# 2) file credential を自分で作成 (mode 600 必須)
mkdir -p ~/.config/tastile-muse && chmod 700 ~/.config/tastile-muse
cat > ~/.config/tastile-muse/credential.json <<EOF
{"api_base_url":"http://127.0.0.1:31410","bearer":"<token>","expires_at":"<expires_at>","subject":"<owner_id>"}
EOF
chmod 600 ~/.config/tastile-muse/credential.json

# 3) 環境変数
export TASTILE_API_URL=http://127.0.0.1:31410
export TASTILE_CREDENTIAL_FILE=$HOME/.config/tastile-muse/credential.json
export TASTILE_ISOLATED_TEST_STACK=confirmed
tastile auth status   # API base と owner pin が一致すれば OK
```

`TASTILE_ISOLATED_TEST_STACK=confirmed` は「この loopback stack は
隔離検証用である」という操作者の attestation であり、証明ではない。
書き込み系コマンドは attestation + loopback + mode-600 file credential
+ credential の api_base_url 一致が揃わないと拒否される。port 31400 は
読み書きとも常に拒否される。

## 3. 日常ワークフロー

すべて `tastile` CLI 経由。直接 DB / HTTP を叩かない。

### 3.1 今日の予定取得と次タスク判断

```bash
tastile today --json          # 次に実行すべき actionable item
tastile tiles                 # 今日の tile 一覧
tastile timeline --start <RFC3339> --end <RFC3339>            # 期間の配置
tastile timeline --start ... --end ... --include-labels       # LABEL lane 込み
```

`today` は `projected_next_start_at` 昇順。過去・stale・null は除外済み。
label-only source も返り得るので、role=LABEL は「予定」ではなく期間表示
として扱う。

### 3.2 現行予定との比較・遅延時の再調整候補

```bash
tastile source-tiles list --json                    # 自分の source 全件 (cursor 完走)
tastile source-tiles get <id> --json                # 定義 read-back
tastile source-tiles placements <id> --json         # 生成済み placement
```

再調整候補の生成 (write を伴うので必ず dry-run から):

```bash
tastile source-tiles reflow <id> --from <RFC3339> --to <RFC3339> --dry-run
tastile source-tiles reflow <id> --from ... --to ...           # apply
```

dry-run は affected placements と `INSUFFICIENT_CAPACITY` 等の
reason / required_ms / available_ms / conflicting_source_id を表示する。
apply は read-back で revision と open placement 数を確認する。

### 3.3 予定の追加・編集・取消プレビュー

```bash
# 追加
tastile source-tiles create --title "..." --daily 09:00 --utc-offset 540 \
  --duration 30 --horizon-days 30            # dry-run 的に schedule を表示してから
# 実際の作成は対話確認または --from-json
tastile source-tiles create --from-json draft.json

# 編集 (full replacement。まず get で現行定義を読み、変更分だけ書き換えた
# draft を --from-json で渡す。--dry-run で field diff を確認)
tastile source-tiles update <id> --from-json patch.json --dry-run
tastile source-tiles update <id> --from-json patch.json --expect-revision <N>

# 取消
tastile source-tiles cancel <id> --dry-run
tastile source-tiles cancel <id> --reason-code 0
```

`--expect-revision` は CAS。stale なら 409 + current_revision が返るので
読み直してからやり直す。`schedule publish --apply` は loopback +
idempotency key 必須 (retry は同一 key を再利用)。

### 3.4 タスク実行 (開始→完了)

```bash
tastile source-tiles placements <source-id> --json   # open placement の id を取得
tastile executions start <placement-id> --json       # => aggregate.id = execution id
tastile executions pause <execution-id>
tastile executions resume <execution-id>
tastile executions finish --kind 2 --note "..." <execution-id>
```

finished placement は reflow から保護される (422 で拒否)。

### 3.5 診断 (未配置・競合・滞留 prompt・未対応条件)

```bash
tastile prompts list              # pending prompt (kind は数値 enum)
tastile prompts resolve <id> --resolution ack --note "..."
tastile source-tiles completion <id>   # per-segment / per-occurrence 完了状況
tastile doctor                    # 環境診断 (secret は出さない)
```

未配置 occurrence は reflow dry-run の表と
`v1_source_decision_required_*` の notification に理由が出る
(notification provider は `fake` なので外部配送はされず DB outbox に
記録される。Muse 側では reflow dry-run と prompts list が一次情報)。

## 4. 許可される操作 / 禁止される操作

### 許可 (自分が立てた検証 stack 内)

- §3 のすべての read / write (自分で発行した credential の owner の範囲)
- `muse-e2e-*` タイトルのテスト source の作成・取消
- `scripts/muse-shadow-e2e.sh` の実行 (tastile-cli tag `v1.1.0-rc.1` の
  source。`https://github.com/tastile/tastile-cli/archive/refs/tags/v1.1.0-rc.1.tar.gz`
  を展開するか git clone して取得)

### 禁止 (fail-closed で拒否されるが、試みない)

- 運用 API `127.0.0.1:31400` および運用 DB (port 5433 系) への一切の接続
- credential / token の表示・ログ出力・他者への共有
- `TASTILE_API_URL` を loopback 以外や port 31400 に向けること
- `TASTILE_CREDENTIAL_FILE` を mode 600 以外にすること
- OS keyring への production credential 登録 (この検証経路では使わない)
- DemandDriven (generation kind=2) の作成 — 未対応。近似で作らない
- relation / decision 系の複雑な plan を推測で組み立てること
  (schema が分からない場合は release source の docs を確認)

## 5. 停止・再起動・異常時の復旧

| 操作 | 手順 |
| --- | --- |
| 停止 (compose) | `docker compose down` (DB も消すなら `down -v`) |
| 停止 (bare metal) | api/worker のプロセスを `kill`。DB は別途管理 |
| 再起動 | `docker compose up -d` / bare metal は migrate 済みなら api/worker を上げ直すだけでよい (migration は冪等) |
| health | `curl -s http://127.0.0.1:31410/v1/health` → `"status":"ok"`, `"version":"2.0.0"` |
| ready | `curl -s http://127.0.0.1:31410/v1/ready` → DB 到達性など |
| credential 期限切れ | §2.4 を再実行して credential.json を作り直す (signup は冪等) |
| `credential has expired` / `belongs to a different API base` | credential の期限切れまたは `api_base_url` 不一致。`credential.json` の `api_base_url` が `TASTILE_API_URL` と完全一致しているか確認 |
| `no isolated test-stack confirmation` | `TASTILE_ISOLATED_TEST_STACK=confirmed` の export 忘れ |
| `refusing ... port 31400` | `TASTILE_API_URL` が port 31400 を指している。31410 に修正 |
| placements が materialize しない | worker が止まっていないか確認 (`docker compose ps` / プロセス)。worker ログに advisory lock 待ちは起動直後のみ出ることがある (定常遅延ではない) |
| write が 409 stale revision | `--expect-revision` に最新 revision を指定して再実行 |
| idempotent retry | 同一操作の再送は同一 `--idempotency-key` (schedule publish) または同一 expect-revision で行い、結果を read-back で確認 |

## 6. 日次比較の記録

Muse の日常判断で新 Core の結果を使った日は、以下を簡潔に記録する
(実予定の内容・個人情報は書かない。anon 化した分類と時刻のみ)。

```
date: YYYY-MM-DD
used_for: today / next-task / reflow-candidate / preview / execution / diagnostics
commands_run: (代表的なもの数件)
observations: 新 Core の結果と現行運用の体感差 (あれば)
anomalies: error / unexpected / blocked (あれば)
```

7 日間の shadow 評価と実運用切替判断は別 gate (root#105 G5) であり、
この記録はその材料である。

## 7. フィードバック方法

- 機械的な差分・再現手順 → tastile-cli#6 または tastile-core の該当 Issue
- 成果物・インストールの問題 → tastile-core / tastile-cli の Release
  ページに issue を立てるか、既存 Issue へ
- 体感上の問題 (遅い・分かりにくい) → §6 の日次記録に残し、週次で共有

## 8. できること / まだできないこと

### できる (Core 2.0.0-rc.1 + CLI 1.1.0-rc.1、自前の検証 stack 内)

- source tile の作成 (one-time / daily / weekly / 例外日 `--exclude` /
  label-only `plan_role=1` / priority / window / duration / horizon)
- placement 生成の read-back、timeline / today / prompts / completion の read
- execution start / pause / resume / finish
- update (full replacement + revision CAS + dry-run diff)、cancel、reflow
- schedule publish preview / apply (loopback + idempotency key)
- 未配置理由 (INSUFFICIENT_CAPACITY 等) の reflow dry-run 表示、
  decision-required notification の発火と重複抑止 (DB 制約で保証済み。
  provider=fake のため外部配送はされない)

### まだできない / 対象外

- monthly recurrence (OpenAPI 未契約。CLI は近似を拒否)
- DemandDriven generation (kind=2、明示的 unsupported)
- relation / Flow / Decision を使う複雑な plan の CLI 表現
  (from-json の opaque fields はあるが、意味論は server 側。推測で作らない)
- 実運用 stack への一切の書き込み・通知・worker 操作
- Web/Android 向けの新 Core 公開 (今回対象外)
- prerelease のため、G3/G5 合格や stable 品質は保証しない

## 9. 自動 E2E (再実行可能)

`tastile-cli` tag `v1.1.0-rc.1` の source にある
`scripts/muse-shadow-e2e.sh` (GitHub の `archive/refs/tags/v1.1.0-rc.1.tar.gz`
から取得可) は §3 の主要経路を自動検証する
(日付は実行日から動的に導出されるため毎日再実行可能)。
前提は §2.4 と同じ環境変数 + `TASTILE_ISOLATED_TEST_STACK=confirmed`。

```bash
bash scripts/muse-shadow-e2e.sh   # PASS/FAIL を表示、証跡 JSON を保存
```

`muse-e2e-*` タイトルの source は実行後に自動 cancel され、
active な残りがないことまで検証する (`KEEP=1` で残して調査可)。
他者の source には触れない。
