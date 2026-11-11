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

- 提示できる場合: 本台帳の §5 に追記し、G0 の他の条件（固定 SHA、隔離、課金禁止、判定資料）と併せて go。
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

**これが本台帳で最も重要な事実である。**

#105 は「現在VMで稼働している既存ローカルTastile」を予定の唯一の正本と定めている。しかし本作業環境から到達できる範囲では、その稼働インスタンスを観測できなかった。

| 確認 | 結果 |
| --- | --- |
| `api.tastile.app` / `app.tastile.app` / `tastile.app` | 応答なし。`tastile.app` は Cloudflare 522（origin 不達）。DNS は Cloudflare を向いている |
| 到達可能な端末上のコンテナ | Windows host・WSL・本機のいずれにも稼働コンテナ 0 件 |
| Windows host の `wslc` | イメージ 3 件（`tastile-core-schema-g4` / `rust` / `postgres`）と開発用 volume のみ。運用 DB volume は無い |
| 到達可能な端末の listen port | 5432 / 31400 / 3000 のいずれも閉塞 |
| secrets host（`rebuildup-secrets-host`） | Tailscale 経由で 22 番に到達せず（timeout） |
| `muse`（Tailscale peer, online） | 22 / 80 / 443 / 3000 / 5432 / 31400 すべて閉塞 |
| `device-mac`（Tailscale peer, online） | SSH が `Permission denied (publickey)` |
| 本機の LaunchAgent / brew services / `/opt` | Tastile 関連の常駐なし |

解釈: 運用スタックは、少なくとも本環境からは**正本として参照できない**。存在しないとは断定しない。別端末・別ネットワーク・停止中のいずれかであり、本環境からは判別できない。

この事実が持つ意味:

1. #105 が前提とする「運用スタックの情報のみを読む朝の調査」は本環境では実行できない。T14 / T15 の shadow 試用が前提とする read-only データ経路も未確立である。
2. 一方で、**運用環境への書込経路が 0 であることは、この観測結果によって裏づけられる**。到達経路が無いため、誤って書き込む経路も存在しない。

---

## 5. 構築した検証環境（実測）

本作業で実際に起動し、隔離を確認した範囲。

| 項目 | 値 |
| --- | --- |
| ランタイム | Colima（macOS, aarch64, 4 CPU / 8 GiB）, Docker 29.8.2 |
| DB | コンテナ `tastile-verify-pg`、`postgres:17-alpine`、host port **55432** |
| DB 名 | `tastile`（テスト実行用）、`tastile_iso`（CI 失敗の隔離再現用） |
| API / worker | ローカル cargo ビルド。コンテナ化は T04 |
| migration | `storage::migrations::run` が接続時に自動適用（この DB で 63 件適用済みを `v1_migration` で確認） |
| CI 再現 | `owner_profile_authz` の 401 と空振り write 検査を同一 DB 上で再現し、修正後に全通過を確認 |

隔離の根拠:

- DB は専用コンテナ・専用 volume・**非標準 port 55432** に閉じている。運用の 5432 と衝突しない。
- credential は検証専用（`tastile` / `tastile`、ローカルのみ）。運用 secrets を参照していない。
- 既存の `ujp-data` / `procon-goal-*` 等の Docker host ボリュームは本作業では一切操作していない。
- 環境変数は `TASTILE_DATABASE_URL` / `DATABASE_URL` / `TASTILE_ROLLBACK_ADMIN_URL` の 3 つのみを明示設定した。AWS credential、通知 provider、bridge secret は未設定。

再現手順:

```bash
colima start --cpu 4 --memory 8 --disk 60
docker run -d --name tastile-verify-pg \
  -e POSTGRES_USER=tastile -e POSTGRES_PASSWORD=tastile -e POSTGRES_DB=tastile \
  -p 55432:5432 postgres:17-alpine

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

§4 のとおり、所在を特定できていない。read-only で参照する経路（端末、SSH、read-only DB role など）の提示が必要。

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
| 運用VMの正本保護 | **未確定**。運用スタックを観測できていない（§4） |
| 未確認事項の非隠蔽 | 充足（本書） |

---

## 8. G0 以降の進行可否

- 進行可: PR #256 の統合と CI 回復、検証環境の compose 化・healthcheck・再起動・永続性の検証（T02 / T04）、Web 実ブラウザ認証の実証準備（T05）。
- 判断待ち: 運用スタックを参照する作業（T14 の比較、T15 の shadow 試用）。合成 fixture のみでの実施は可。
- 不可: 運用環境への書込み、実データ抽出、課金を伴う操作、7 日試用の短縮。
