# Muse 向け Core 2.0.0 + CLI 日常利用 runbook

対象読者: Muse (運用 VM 上のエージェント)。開発エージェントへの依存なしで
日々の利用・再開・停止ができることを目的とする。

本書は **検証専用 stack** の利用手順である。Muse の現行運用 Tastile
(127.0.0.1:31400 / PostgreSQL 5433) の DB・worker・通知経路は一切変更しない。
新 Core への変更操作は検証専用 DB・専用アカウント (`muse-verify-shadow`)
に限定される。

- 正本 Issue: tastile/tastile-root#105、tastile/tastile-cli#6、tastile/tastile-core#322
- 関連証跡: `tastile-cli/docs/evidence/2026-11-19-core200-cli-e2e.md`、
  `tastile-cli/docs/evidence/2026-11-19-muse-access-edge-verification.md`

## 1. 固定バージョン (2026-11-19 時点)

| 要素 | 固定値 |
| --- | --- |
| Core source | `tastile-core` `origin/release-2-0-0` = `0e6ecb2f00038cbaa0fca149e5268f31386e8fe7` |
| Core image | `tastile-core-verify:0e6ecb2f`、image ID `sha256:8f54a36170ac17178fa80fb77014523af3f165442520ec8e636ce42037722440` |
| CLI | `tastile-cli` `release-1-1-0` = `582d7e1a`、`tastile 1.1.0` |
| OpenAPI pin | `49a1b449` (v3.8.1) |
| 検証 API (開発機側) | `127.0.0.1:31410` → container 31400 |
| 検証 DB | `127.0.0.1:55432` (開発機側。Muse からは直接触れない) |
| Muse 側 API (tunnel 後) | `http://127.0.0.1:31498` |
| credential 期限 | `2026-12-31` (要再発行。それ以前に失効したら §6 へ) |

CLI binary は `cargo build --release` 済みの `tastile 1.1.0` を使う。
再ビルドする場合は `tastile-cli` の `release-1-1-0` @ `582d7e1a` に固定する。

## 2. 接続方法

Muse VM から開発機 (`mac`、Tailscale `100.83.203.34`) の検証 API へは
**SSH local forward** で到達する。Muse 側では loopback に見えるため、
CLI の安全ゲート (loopback + 隔離 attestation + file credential +
port 31400 拒否) がすべて有効なまま使える。

### 2.1 前提 (初回のみ・要ユーザー対応)

以下は秘密情報を含むため、本書や共有ドキュメントには書かない。
既存の安全な受け渡し経路で Muse 側へ配置すること。

- `id_ed25519` (private key): `~/.ssh/tastile-verify-muse` に mode 600 で配置
- `credential.json`: `~/.config/tastile-muse/credential.json` に mode 600 で配置
  - 内容: `api_base_url=http://127.0.0.1:31498`、`bearer`、`expires_at`、`subject`
- `tastile` binary: PATH の通った場所に配置 (例: `~/.local/bin/tastile`)

### 2.2 tunnel の確立 (毎回)

```bash
ssh -N -L 127.0.0.1:31498:127.0.0.1:31410 \
  -i ~/.ssh/tastile-verify-muse \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  rebui@100.83.203.34 &
```

確認:

```bash
curl -s http://127.0.0.1:31498/v1/health
# => "version":"2.0.0" が返れば OK
```

### 2.3 環境変数 (毎回 export)

```bash
export TASTILE_API_URL=http://127.0.0.1:31498
export TASTILE_CREDENTIAL_FILE=$HOME/.config/tastile-muse/credential.json
export TASTILE_ISOLATED_TEST_STACK=confirmed
tastile auth status   # API base と owner pin が表示されれば認証 OK
```

`TASTILE_ISOLATED_TEST_STACK=confirmed` は「この loopback は隔離検証
stack である」という操作者の attestation であり、証明ではない。
接続先が本当に検証 stack であることは §2.2 の health version=2.0.0 と
§5 の禁止事項で担保する。

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
label-only source も返り得るので、role=LABEL は「予定」ではなく期間表示として扱う。

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
(開発機側 DB を見られるのは開発側のみ。Muse 側では reflow dry-run と
prompts list が一次情報)。

## 4. 許可される操作 / 禁止される操作

### 許可 (検証 stack 内)

- §3 のすべての read / write (自分の `muse-verify-shadow` owner の範囲)
- `muse-e2e-*` タイトルのテスト source の作成・取消
- `scripts/muse-shadow-e2e.sh` の実行 (tastile-cli branch `6`、PR #32)

### 禁止 (fail-closed で拒否されるが、試みない)

- 運用 API `127.0.0.1:31400` および運用 DB `5433` への一切の接続
- credential / token の表示・ログ出力・他者への共有
- `TASTILE_API_URL` を loopback 以外や port 31400 に向けること
- `TASTILE_CREDENTIAL_FILE` を mode 600 以外にすること
- OS keyring への production credential 登録 (この検証経路では使わない)
- DemandDriven (generation kind=2) の作成 — 未対応。近似で作らない
- relation / decision 系の複雑な plan を推測で組み立てること
  (schema が分からない場合は開発側へ確認)

## 5. 異常時の復旧

| 症状 | 対処 |
| --- | --- |
| `curl :31498/v1/health` が connection refused | tunnel が落ちている。§2.2 を再実行。ssh が `Address already in use` なら既存 tunnel を `pkill -f "31498:127.0.0.1:31410"` で整理してから再接続 |
| health が version=1.1.0 等 2.0.0 でない | **接続先誤認**。直ちに操作を止め、tunnel の forwarding 先を確認 (127.0.0.1:31410 であること)。迂回しない |
| `credential has expired` / `belongs to a different API base` | credential の期限切れまたは base 不一致。§6 で再発行を依頼 |
| `no isolated test-stack confirmation` | `TASTILE_ISOLATED_TEST_STACK=confirmed` の export 忘れ |
| `refusing ... port 31400` | 運用 port に向いている。`TASTILE_API_URL` を確認 |
| placements が materialize しない | worker は開発機側で常駐。30 分以上出ない場合は開発側へ連絡 (worker 停止の可能性) |
| write が 409 stale revision | `--expect-revision` に最新 revision を指定して再実行 |
| idempotent retry | 同一操作の再送は同一 `--idempotency-key` (schedule publish) または同一 expect-revision で行い、結果を read-back で確認 |

## 6. credential 再発行・鍵の失効

期限 (`2026-12-31`) 前に credential が失効した場合、または鍵を
無効化したい場合は開発側 (ユーザー) に依頼する。開発側で
`v1_api_token` の revoke / 再 mint と credential.json の再配布を行う。

## 7. 日次比較の記録

Muse の日常判断で新 Core の結果を使った日は、以下を簡潔に記録する
(共有ドキュメントまたは Muse 側の記録場所。実予定の内容・個人情報は
書かない。anon 化した分類と時刻のみ)。

```
date: YYYY-MM-DD
used_for: today / next-task / reflow-candidate / preview / execution / diagnostics
commands_run: (代表的なもの数件)
observations: 新 Core の結果と現行運用の体感差 (あれば)
anomalies: error / unexpected / blocked (あれば)
```

7 日間の shadow 評価と実運用切替判断は別 gate (root#105 G5) であり、
この記録はその材料である。

## 8. フィードバック方法

- 機械的な差分・再現手順 → tastile-cli#6 または tastile-core の該当 Issue
- 接続・credential の問題 → ユーザー経由で開発側へ
- 体感上の問題 (遅い・分かりにくい) → §7 の日次記録に残し、週次で共有

## 9. できること / まだできないこと

### できる (Core 2.0.0 + CLI 1.1.0、検証 stack 内)

- source tile の作成 (one-time / daily / weekly / 例外日 `--exclude` /
  label-only `plan_role=1` / priority / window / duration / horizon)
- placement 生成の read-back、timeline / today / prompts / completion の read
- execution start / pause / resume / finish
- update (full replacement + revision CAS + dry-run diff)、cancel、reflow
- schedule publish preview / apply (loopback + idempotency key)
- 未配置理由 (INSUFFICIENT_CAPACITY 等) の reflow dry-run 表示、
  decision-required notification の発火と重複抑止 (DB 制約で保証済み)

### まだできない / 対象外

- monthly recurrence (OpenAPI 未契約。CLI は近似を拒否)
- DemandDriven generation (kind=2、明示的 unsupported)
- relation / Flow / Decision を使う複雑な plan の CLI 表現
  (from-json の opaque fields はあるが、意味論は server 側。推測で作らない)
- 実運用 stack への一切の書き込み・通知・worker 操作
- Web/Android 向けの新 Core 公開 (今回対象外)
- `build_identity` が null のため、稼働 binary の commit は
  本書の固定 SHA を正本として扱う

## 10. 自動 E2E (再実行可能)

`tastile-cli` branch `6` (PR #32) の `scripts/muse-shadow-e2e.sh` は
§3 の主要経路を 32 項目で自動検証する。前提は §2 と同じ環境変数。

```bash
tastile source-tiles list --json > /dev/null   # 疎通確認
bash scripts/muse-shadow-e2e.sh                # PASS/FAIL を表示、証跡 JSON を保存
```

`muse-e2e-*` タイトルの source は実行後に自動 cancel される
(`KEEP=1` で残せる)。他者の source には触れない。
