# T01 read-only 台帳 — local-first 実用化の運用境界

対象: tastile/tastile-root#105 G0 判定（2026-11-15）の入力
確認日: 2026-11-11
状態: **未決事項あり。本文記載の判断項目が解消しない限り、G0 は go にできません。**
関連 PR: tastile/tastile-core#256（branch `251`）
正本: tastile-root `docs/plans/2026-11-11-local-first-t01-readonly-ledger.md`

---

## 結論（G0 で決めることは 1 つ）

G0 の受入条件のうち、**運用VMの正本保護を証明できていない**。作業環境から運用スタックを観測できず、「正本が保護されている」ことを論じる材料が無い。

判断項目は次の 1 つに集約する。

> **運用スタックの所在と、read-only で参照する手段（端末、SSH、read-only DB role 等）を、11-15 19:00 まで提示できるか。**

- 提示できる場合: 本台帳の §5 に追記する。ただし go の判定には **正本保護そのものの確認**（権限境界、read-only role または tooling によるアクセス経路、運用スタックからの書込みポリシー、予定の追加確認）が揃うことを要する。所在と read-only 手段の提示のみでは不足である。
- 提示できない場合: #105 の規則どおり **G0 は no-go**。T04 以降の検証環境構築は並行準備として進めてもよいが、T14（v1/v2 比較）と T15（shadow 試用）は開始できない。

---

## 1. 運用境界（この台帳が固定するもの）

Tastile を local-first で実用化するにあたり、**何を触ってよく、何を触ってはいけないか**を次のとおり固定する。以後の T02〜T16 はこの境界を前提とする。

- **運用VMは一切の変更対象外とする。** 停止、再起動、再デプロイ、DB 書込み、migration 適用、通知設定変更、scheduler / worker の操作、運用先の切替を、本計画のいかなる作業でも行わない。
- **試用期間中の予定の正本は運用VMのみとする。** 検証環境の予定・タスクは正本ではない。両者を同期させない。検証側は shadow / read-only の提案表示に留める。
- 本計画で作る環境は、別 DB・別 volume・別 port・別 container・別 credential を持つ**独立した非本番検証環境**である。運用の永続データ、環境変数、secrets、scheduler、通知キューを一切使い回さない。
- 運用データの抽出・複製・公開は、所有者の明示許可が確定するまで実行しない（§6-1）。

---

## 2. 固定 HEAD

各リポジトリの `main` は 2026-11-11 時点で以下のとおり。

| リポジトリ | HEAD | 状態 |
| --- | --- | --- |
| tastile-core | `c37b49f055fedf38eae7de9cad1a884a85763579` | CI が失敗中（§4）。修正は PR #256 で提出 |
| tastile-root | `9a40e814854ef45001c8586975050a24c0033f95` | Root quality gate / Architecture SoT gate は success |
| tastile-web | `5212e995f2ad1ef36d84c51c989d3aea182786db` | この SHA で `Recovery drill` と `schemathesis contract tests` が failure |
| tastile-android | `8bef645246ead1c9720165f74867943f328fb945` | Recovery drill は success。`Verify` の failure は旧 SHA `f97b0f14` のもの |
| tastile-openapi | `8461ffa345943c28385a9f06a2fd7b945205de54` | |

tastile-core の v1 release tag は `v1.0.1` が最新。`v1.0.2` は version 文字列のみで tag は未作成。

---

## 3. 未マージ PR と CI の現状

tastile-core の `main` CI は 2026-09-27 以降赤のまま。原因は 2 件とも `f729831`（2026-09-27、全 handler への scope gate 一括適用）に由来する。

| 事象 | 内容 |
| --- | --- |
| `owner_profile_authz` 2 件 fail | profile GET が 401。write 側 scope 検査は fixture 不正で空振りしていた |
| `tastile.write` トークンが書き込み不可 | 認証層の旧規則（`scopes == "all"` 必須）が write を 403 で落としていた |

修正は PR #256（branch `251`、現在は ready for review）で提出した。ローカル実測で 935 passed / 0 failed（Colima + PostgreSQL 17、新規 DB）。CI は `c18284d` と `e5a02f0` の両 commit で success。

未マージの主な PR:

| PR | 状態 | CI |
| --- | --- | --- |
| core#229（core#228 reflow） | MERGEABLE / CLEAN | quality success |
| core#227（core#226 edge assertion） | MERGEABLE / UNSTABLE | quality failure |
| core#222（core#217 Flow 増分評価） | MERGEABLE / CLEAN | quality success |
| core#256（本計画） | ready for review、CI green | success |

web 未マージ: #199 (mobile token, Draft)、#196 (drift prompts, Draft)、#198 (/api/me)、#185 (Better Auth assertion, Draft)。いずれも PR 上の check は success。android 未マージ: #89 (docs archive, Draft)、dependabot 群、#72 (release-0-7-0)。

---

## 4. 現物確認の結果 — 運用スタックを観測できなかった

> **2026-11-11 追補:** 所在は確定した。旧 origin は AWS 上の `52.194.61.218` /
> `52.194.223.15` で、現在はいずれも不達（522）。アプリ DB（RDS エンドポイント）は
> NXDOMAIN。詳細と read-only 証拠、#105 への含意は
> [`2026-11-11-t01-operational-stack-located.md`](./2026-11-11-t01-operational-stack-located.md)
> を正本とする。以下の §4 は「観測できなかった」時点の記録として残す。

**これが本台帳で最も重要な事実である。**

#105 は「現在VMで稼働している既存ローカルTastile」を予定の唯一の正本と定めている。しかし本作業環境から到達できる範囲では、その稼働インスタンスを観測できなかった。

| 確認 | 結果 |
| --- | --- |
| `api.tastile.app` / `app.tastile.app` / `tastile.app` | 応答なし。`tastile.app` は Cloudflare 522（origin 不達）。DNS は Cloudflare を向いている |
| 到達可能な端末上のコンテナ | Windows host・WSL・本機のいずれにも稼働コンテナ 0 件 |
| Windows host の `wslc` | イメージ 3 件（`tastile-core-schema-g4` / `rust` / `postgres`）と開発用 volume のみ。運用 DB volume は無い |
| 到達可能な端末の listen port | 5432 / 31400 / 3000 のいずれも閉塞 |
| 内部の共有ホスト（名前と IP は非公開） | SSH が拒否またはタイムアウト（Permission denied / timeout） |
| 内部の online Tailscale peer | 22 / 80 / 443 / 3000 / 5432 / 31400 すべて閉塞 |
| 本機の LaunchAgent / brew services / `/opt` | Tastile 関連の常駐なし |
| **Android 側設定の手がかり（Muse = Android 端末）** | Android リポジトリ上、接続先は `BuildConfig.TASTILE_CORE_URL`（Infisical `/devices` 由来）。環境キーは `TASTILE_CORE_URL` / `WEB_BASE_URL` / `TASTILE_WEB_BRIDGE_SECRET` である |
| **Windows 側のヒント（known_hosts / ssh config）** | `id_ed25519_tastile_infisical_hetzner` が「hetzner:tastile-infisical」とコメントされ、別途 VM 実行が示唆される。Tailscale/ssh 登録先に `x220-158-20-47.static.xvps.ne.jp`（= `xserver`、現在未達）が存在する。Infernal / 患者機接続情報は配置にあっても実データへ到達できていない |
| **公開 DNS（Cloudflare）の実態** | `api.tastile.app` の A/AAAA は無しまたは 522。`app.tastile.app` / `tastile.app` も同様 |

解釈: 運用スタックは、少なくとも本環境からは**正本として参照できない**。存在しないとは断定しない。別端末・別ネットワーク・停止中のいずれかであり、本環境からは判別できない。

Android 側の `TASTILE_CORE_URL` が Infisical secret 由来で、Windows 側の `id_ed25519_tastile_infisical_hetzner` 配置と整合するため、「運用スタックは hetzner 系の Hetzner VPS（Hetzner Cloud）に self-hosted Infisical + 常時デプロイで動作する」説は**未確認の仮説**である。当確認者は Hetzner アカウント／パスワード／Access Token を保持しておらず、この仮説の真偽は本作業の範囲では判定できない。

この事実が持つ意味:

1. #105 が前提とする「運用スタックの情報のみを読む朝の調査」は本環境では実行できない。T14 / T15 の shadow 試用が前提とする read-only データ経路も未確立である。
2. 確認できた範囲（到達可能な端末の全 port / コンテナ）では運用環境への書込経路を観測できなかった。ただし未確認の端末、ポート、API 経由の書込経路は除外できない。「運用環境への書込経路が 0 である」とは言えない。正本への誤書込みは、各到達路の権限 scope（DB role、API token scope、bridge secret、通知 provider）を明示的に閉じたうえで初めて「低リスク」と言える。

---

## 5. 構築した検証環境（実測）

本作業で実際に起動し、隔離を確認した範囲。

| 項目 | 値 |
| --- | --- |
| ランタイム | Colima（macOS, aarch64, 4 CPU / 8 GiB）, Docker 29.8.2 |
| DB（CI 再現用。使い捨て） | コンテナ `tastile-verify-pg`、`postgres:17-alpine`、host port **55432**（前述 p.公開は 0.0.0.0） |
| DB（fresh-checkout 検証） | `tastile-verify-db` + `tastile-verify-api` + `tastile-verify-worker`（いずれも `127.0.0.1` に bind、`postgres:16-alpine`） |
| DB 名 | `tastile`（テスト実行用）、`tastile_iso`（CI 失敗の隔離再現用）、`tastile_auth`（better-auth 検証用） |
| API / worker | ローカル cargo ビルド・Docker イメージ両方動作確認済み |
| migration | `storage::migrations::run` が接続時に自動適用。`v1_migration` 63 件適用を確認。API 再起動で 63 件維持を確認。`pg_dump` → 別 DB restore で 63 件一致を確認 |
| CI 再現 | `owner_profile_authz` の 401 と空振り write 検査を同一 DB 上で再現し、修正後に全通過を確認（fresh-checkout では monitoring を含む） |
| fresh checkout 再現 | `git clone tastile-root (branch 105)` + `git clone tastile-core (branch 251)` → `docker compose up --build -d` で `health` = 200、worker 実起動、migration 63、api 再起動・`pg_dump` restore まで通過を確認 |

### 隔離の根拠

- DB は専用コンテナ・専用 volume・**非標準 port 55432** に閉じている。運用の 5432 と衝突しない。
- credential は検証専用（`tastile` / `tastile`、または compose 既定）。運用 secrets を参照していない。
- 既存の `ujp-data` / `procon-goal-*` 等の Docker host ボリュームは本作業では一切操作していない。
- 環境変数は `TASTILE_DATABASE_URL` / `DATABASE_URL` / `TASTILE_ROLLBACK_ADMIN_URL` の 3 つのみを明示設定した。AWS credential、通知 provider、bridge secret は未設定。
- `docker compose ps`：db=`healthy`、api/worker=`running`（fresh-checkout 実測）。

### 既に退避済みの loopback 境界リスク

台帳作成時の `tastile-verify-pg` は `docker run -p 55432:5432`（0.0.0.0 公開相当）であった可能性がある。今後の再現コマンドはすべて `127.0.0.1:55432:5432` に統一し、`deploy/verify-stack/compose.yaml` が `127.0.0.1:${port}:5432` を直接指定していることを確認した。fresh-checkout 経路は compose が既定でこのバインドを行う。

### 再現手順（fresh-checkout、推奨）

```bash
cd <workspace>   # tastile-root と tastile-core を同階層に clone する
git clone --branch 105 https://github.com/tastile/tastile-root
git clone --branch 251  https://github.com/tastile/tastile-core

cd tastile-root/deploy/verify-stack
export TASTILE_WEB_BRIDGE_SECRET="$(openssl rand -hex 24)"
export TASTILE_CORE_TAG=e5a02f0   # または fresh clone の SHA を明示
docker compose up --build -d
curl -s http://127.0.0.1:31400/v1/health   # → {"status":"ok","database":"reachable",...}
docker exec tastile-verify-db psql -U tastile -d tastile_verify -t -c 'SELECT count(*) FROM v1_migration;'
```

### 再現手順（単体 DB、任意）

```bash
colima start --cpu 4 --memory 8 --disk 60
docker run -d --name tastile-verify-pg \
  -e POSTGRES_USER=tastile -e POSTGRES_PASSWORD=tastile -e POSTGRES_DB=tastile \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
export TASTILE_DATABASE_URL='postgres://tastile:tastile@127.0.0.1:55432/tastile'
export DATABASE_URL="$TASTILE_DATABASE_URL"
cargo test --manifest-path crates-v1/Cargo.toml --workspace --jobs 1 -- --test-threads=1
```

---

## 6. 未決事項

### 6-1. 実データの抽出可否（T01 の明示的な未決項目）

アプリ実データを抽出する場合の**権限・匿名化・保持期間**を未決として記録する。所有者の明示許可が確定するまで抽出を実行しない。

- 権限: 所有者本人の明示許可が必要。本台帳はその許可を前提にしない。
- 匿名化: 予定・タスク本文を残さない。owner 識別子は付け替える。
- 保持: 検証目的の期間のみ。GitHub・ログ・Issue へ記載しない。
- 代替: 合成 fixture で代替できる範囲を優先する。T14 の比較は、匿名化 snapshot が得られない場合は合成 fixture のみで実施する。

### 6-2. 運用スタックの所在と観測手段

**追補（2026-11-11）で解消。** 所在は AWS 上の旧 origin（`52.194.61.218` /
`52.194.223.15`）で、現在は削除済み・不達。アプリ DB の RDS エンドポイントも
NXDOMAIN。「所在不明」ではなく「正本が存在しない」ことが確認された。
証拠と #105 への含意は
[`2026-11-11-t01-operational-stack-located.md`](./2026-11-11-t01-operational-stack-located.md)。

### 6-3. 検証環境の通知経路

運用の通知送信先を使わない。検証用の送信先（または通知無効）を確定するまで、通知を含む E2E は他の検証と独立に扱う。

---

## 7. G0 の受入条件に対する現時点の評価

| 条件（#105 G0 ACCEPT） | 状態 |
| --- | --- |
| 固定 SHA | 充足（§2） |
| 検証環境の隔離 | 充足（§5、実測） |
| 固定 SHA・起動依存の課金禁止 | 遵守。AWS / GCP の再開・課金操作を一切行っていない |
| 権限境界 | 文書化済み（§1）。ただし運用側の境界は未確認（下記） |
| 運用VMの正本保護 | **未充足**。所在は確定したが正本（稼働スタックと DB）が存在しない（§4 追補 / 追補 §3）。保護対象が無いことの確認であり、ACCEPT 条件の充足ではない || 未確認事項の非隠蔽 | 充足（本書） |

---

## 8. G0 以降の進行可否

- 進行可: PR #256 の統合と CI 回復、検証環境の compose 化・healthcheck・再起動・永続性の検証（T02 / T04）、Web 実ブラウザ認証の実証準備（T05）。
- 判断待ち: 運用スタックを参照する作業（T14 の比較、T15 の shadow 試用）。**両タスクとも、運用スタックの所在と read-only 参照経路が提示されるまでは開始できない**。合成 fixture での比較・手順の準備のみ可能で、比較・判定のための実行は不可。
- 不可: 運用環境への書込み、実データ抽出、課金を伴う操作、7 日試用の短縮。
