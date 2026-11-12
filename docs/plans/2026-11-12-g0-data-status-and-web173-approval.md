# G0 判定資料 — 実データ/バックアップ確認状況と web #173 承認パッケージ（2026-11-12）

- 対象: tastile/tastile-root#105 G0。参照元: [`2026-11-15-g0-decision-sheet.md`](./2026-11-15-g0-decision-sheet.md)。
- 位置づけ: 判断材料の整理のみ。**A/B/C の選択、判定（No-go）、web #173 の承認は本資料では行わない。**
- 観測日時: 2026-11-12（SHA / check はこの日の GitHub 読み取り値）。
- 境界: 運用システム・本番・課金クラウドへは一切接触していない。本日実施した再確認は public DNS 解決のみ。

---

## 1. 実データ・バックアップの確認状況（PR #107 §7 の未確認 4 項目）

| 項目 | 実際に確認済みの内容（出典） | 本環境で確認できない理由 | 確認可能になった場合に変わること |
| --- | --- | --- | --- |
| Cloudflare R2 バケットの内容 | Cloudflare API の zone 読み取り（DNS / tunnel / Worker route）は実行済みだが、R2 / Pages API は **token 権限外で auth エラー**（追補 §1 表 / §7）。`download.tastile.app` → `public.r2.dev` が 200 で Desktop 更新 manifest を配信継続（追補 §2）— **公開配信は稼働、バケットの中身は不明** | この環境にある token は zone スコープのみ。新しい credential の入手・探索は本作業の範囲外 | R2 オブジェクト一覧（read-only）で「アプリ DB のバックアップ/スナップショットが置かれているか」が確定する。あれば A の再建に restore 源が加わる。無ければ R2 分岐は閉じる（**「無い」とは今も断定しない**） |
| AWS アカウントの現在の残存 resource | `aws` CLI の session 失効を #107 時点に記録（追補 §7）。旧 origin IP の whois = Amazon Technologies で #102 の削除記録（EC2 4 台 / EIP / RDS 2 台削除）と整合（追補 §2）。zone の A レコードは旧 IP のまま（Cloudflare API 読み取り、追補 §2） | 有効な AWS credential が無い。かつ AWS API 接触は課金制約（#102 / ADR-0024）で禁止 | 有効な read-only 権限（承認済み）があれば `describe` 系で残存の有無、特に **RDS snapshot の有無** が確定する。snapshot があれば A の再建源、無ければ「AWS 上に残存」の未確認分岐が閉じる |
| 旧 origin 上のデータの最終バックアップ | `52.194.61.218` / `52.194.223.15` の 22/443 閉塞・ICMP 100% loss・HTTPS 522（追補 §1）。SSH 経路なし（鍵・config 照合、`xserver` は NXDOMAIN、#105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6785785819)）。**本日 2026-11-12T02:43Z 再確認: RDS エンドポイントは引き続き NXDOMAIN**（`dig @1.1.1.1`）。app / api は public DNS で Cloudflare edge を解決（proxied レコードの通常応答。origin 実体への到達は未確認） | ホストが応答しない。バックアップの置き場所を示唆する記録も、確認済みの設定・端末からは特定できない | ホスト復旧、またはバックアップ所在の特定で実データの復元源になる。A の再建を前倒しにし、B/C でも匿名化 snapshot の入力源として検討対象になる（追補 §7 末尾の扱い） |
| Muse 端末のローカル DB | Tailscale `muse`（100.75.166.5）の 22/80/443/3000/5432/31400/8080 すべて閉塞（追補 §1）。Windows `%APPDATA%\Tastile` は `settings.json` / `credentials.bin` のみ（追補 §1）。credential を持たない当方からは read-only 抽出経路なし（#105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6785785819)） | 端末に到達できない。アクセス手段の与件が無い | 到達可能化、またはユーザー提供のエクスポートがあれば、スタック再建を待たずに実予定の read-only snapshot 入力源として検討対象になる（追補 §7 末尾の扱い） |

**本日 (2026-11-12) の再確認で新しく判明したことは DNS 2 件のみ**（RDS エンドポイント = NXDOMAIN 継続、app / api = Cloudflare edge 解決）。4 項目それぞれの未解消の前提（token 権限外・失効 session・不達ホスト・不達端末）に変化はなく、確認できた範囲を超える結論を書き足さない。

---

## 2. A/B/C 各案が T14 / T15 / G5 の受入証明に与える影響

前提（#105 の文言そのまま）:

- **T14**: 同一の匿名化 snapshot / **fixture** で v1/v2 の差分・処理時間・再計算・失敗を比較。
- **T15**: 運用VM のタスクを唯一の正本とする 7 日間の shadow 試用（認可された読取専用データ / 匿名化 snapshot からの提案・予定計算比較）。
- **G5 ACCEPT**: 最低 7 日間の shadow 試用 ＋ 試験環境上の mutation E2E により実用効果と安全性が証明される。
- 共通: **mutation E2E はどの案でも試験環境のダミー/テストデータで実施**する（#105 の比較用データ規則。これは案によって証明可能性が変わらない）。

| 案 | T14（12/06） | T15（7 日 shadow 試用） | G5 ACCEPT（12/20） |
| --- | --- | --- | --- |
| **A. 運用スタックを再建** | snapshot / fixture 双方で実施可能。再建後の read-only 経路が成立すれば、**実データ由来の匿名化 snapshot での比較証拠**も作れる | 規格どおり実施可能（正本 = 再建後の運用スタック） | 規格どおりの証明が可能（実データ 7 日 shadow ＋ 試験環境 mutation E2E）。「正本不在」の制約は A で解消する |
| **B. 正本なきまま進める** | **合成 fixture のみ**。差分・処理時間・再計算・失敗の比較証拠は作れるが、実データ代表の証明は **synthetic-fixture-only** | 規格どおりの実施は不可 → 合成 fixture 限定の 7 日試用へ書き換え（#105 の G5 ACCEPT 変更承認が前提） | 既存文言のままでは証明不可。書き換え版でも「実用効果」の証明は **synthetic-fixture-only**。試験環境 mutation E2E は証明可 |
| **C. G0〜G4 のみ進める** | fixture 比較まで実施可能（G4 の比較証拠はここで充足。実データ代表は **synthetic-fixture-only**） | 実施しない（G5 保留） | 判定しない。実用性の証明が合成データ止まりであることを明示して受容し、G5 は正本成立後に再計画 |

本表は各案の定義（追補 §5 / 判定シート 解消項目 1）から機械的に導いた内容であり、**案の推奨・選択を含まない**。選択は #105 のスコープ判断（本人）。

---

## 3. web #173 承認パッケージ

対象: [tastile/tastile-web#173](https://github.com/tastile/tastile-web/pull/173)（`release-1-1-0` → `main`、現在 **BLOCKED**）。
読み取り日時: 2026-11-12。mutable な状態は GitHub を正とし、本節はその時点の記録である。

### 3.1 固定 SHA（2026-11-12 読み取り）

| repo | `release-1-1-0` | `main` | 備考 |
| --- | --- | --- | --- |
| tastile-web | `31b27426de91`（= PR #173 head） | `5212e995f2ad` | T05 実測 SHA は `a782a2ff3a66`。以降の 2 commit は evidence 追加（`notes.md` / `signup-dashboard.png`）のみで **bun.lock 変更なし**（compare 確認済み） |
| tastile-core | `f1f834b3c1a3` | `399190030ba2` | core main の CI は green（2026-11-11T17:25Z、run 43064987225） |

### 3.2 CI / check 状況（PR #173 head = `31b27426de91`）

- **pass**: `verify` ×2、`pr-smoke`、`cli-auth-postgres` ×3、`Audit dependency surface`、`React Doctor`（100/100、0 errors / 0 warnings）、`release-build`、`release-source`、`CodeRabbit`。
- **waiting**: `deploy` = **Cloudflare preview**（run [43061265426](https://github.com/tastile/tastile-web/actions/runs/43061265426)、2026-11-11T16:44Z の push で作成、status = `waiting`）。
- **PR 状態**: `mergeable` = `MERGEABLE`、`mergeStateStatus` = **`BLOCKED`**、`reviewDecision` = `null`。BLOCKED の原因は断定しない（上記 waiting check と未解決 thread の両方が観測されている）。

参考（release 系統外・既知の赤。#173 の check ではない）:

- tastile-core `release-1-1-0` 分支の直近 run は `Deploy staging` = failure（2026-10-19T10:29Z、head `f1f834b3c1a3`）。理由は本資料では分類していない。
- tastile-web `main` の直近: `Recovery drill` = failure（2026-11-10T00:31Z）、`Dependabot Updates` = success / failure 各 1（2026-11-09T00:15Z）。
- tastile-core の release PR [tastile-core#207](https://github.com/tastile/tastile-core/pull/207)（`release-1-1-0` → `main`）は **DIRTY（conflict）**。

### 3.3 依存 audit・ビルド結果

- PR #173 上の Dependency Review（github-actions、現在の head `31b27426de91` を参照）: **vulnerabilities / license issues なし**。snapshot 未登録の warning 付き。
- #173 check: `Audit dependency surface` = pass、`release-build` = pass。
- root #105 T05（記録）: `bun audit --production` = **No vulnerabilities found (437 packages)**（`a782a2ff3a66`、bun.lock は head まで不変）。lockfile = next 16.4.2 / better-auth 1.7.7 / zod 4.6.6。**#200 の解消を実行ビルドで確認**。
- PR #205 の記録（root #105）: `bun audit --production` 0 件、`bun run check` = 1272 passed / 1 skipped、CI verify SUCCESS。
- 対照: web `main` の `bun.lock` は **next 16.3.4 のまま（#200 未反映）** — これがこの release の理由。

### 3.4 E2E 証跡のポインタ（root #105 に記録済み）

- **G1 / T05 = 完了**: root #105 T05 行（signup → bridge → `tastile_api_token` 発行 → `/api/proxy/v1/tiles` 200 を実 Chromium で 6/6 PASS、login 経路 3/3 PASS）。証跡本体: `evidence/2026-11-12-t05-web-core-auth/notes.md`（[SHA 固定 URL](https://github.com/tastile/tastile-web/blob/31b27426de9120d55712277bfa7d3fc735981008/evidence/2026-11-12-t05-web-core-auth/notes.md)、#173 に含まれる）＋ `signup-dashboard.png`。fresh-checkout 再現は #105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6785785819)。
- **G1 前提の実起動（T04）**: 検証スタック `/v1/health` 200 / `v1_migration` 63 / 再起動後も不変（root #105 T04 行）。
- **T06 = 未完了**: 基本ループ 10 中 9 通過、項目 3（QuickCreate の ONE_TIME SOURCE が予定に入らない）未解決 — #105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6802210908)。切り出し先 [tastile-core#262](https://github.com/tastile/tastile-core/issues/262)（#105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6809466207)）。**G2 は未達のまま**。

### 3.5 未解決の review thread（merge 前に解消が必要。2026-11-12 時点 5 件）

| thread | 対象 | 内容 |
| --- | --- | --- |
| [r4132738037](https://github.com/tastile/tastile-web/pull/173#discussion_r4132738037) | `AGENTS.md` | README のデプロイ記述（現行 AWS / target Cloud Run）の整理 |
| [r4312780133](https://github.com/tastile/tastile-web/pull/173#discussion_r4312780133) | `FloatingHeader.tsx` | `execution_id` 欠落時 EXECUTING 表示の条件分岐 |
| [r4535312405](https://github.com/tastile/tastile-web/pull/173#discussion_r4535312405) | `api-token-session.ts` | 30 日で切れる proxy token の renew / bridge 経由再発行（Major） |
| [r4540712963](https://github.com/tastile/tastile-web/pull/173#discussion_r4540712963) | evidence `notes.md` | Core の固定 commit と起動・検証手順の記録不足 |
| [r4540712980](https://github.com/tastile/tastile-web/pull/173#discussion_r4540712980) | evidence `notes.md` | リリース設定で email 検証が無効（`requireEmailVerification` / `sendOnSignUp` = false）である旨の明記 |

（解決済み 1 件: `AGENTS.md` の email OTP 表記。）

### 3.6 承認者が知っておくべき既知のギャップ

1. **Core の修正が `release-1-1-0` にしか存在しない**: core#224 / PR #225 の `execution_state`（一時停止 → 再開）は `f1f834b3c1a3` のみに merge され、core `main`（`399190030ba2`）には**無い**（#105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6801707754) の byte 級照合）。web `main` 系 Core に対しては Pause/Resume が成立しない（#105 [コメント](https://github.com/tastile/tastile-root/issues/105#issuecomment-6802210908)）。
2. **Web #200 の修正も `release-1-1-0` のみ**: web `main` は next 16.3.4 のまま脆弱。#173 の承認が `main` への反映経路であり、**本番再デプロイは別判定**（#105 / 判定シート 解消項目 3）。
3. **core 側の release 統合が未完了**: [tastile-core#207](https://github.com/tastile/tastile-core/pull/207) は DIRTY。#173 の承認だけでは core は同期しない。
4. **security architecture 記録（PR #173 上）**: CodeRabbit の security architecture review は Moderate を記録。email 検証を通過しない新規登録が session / API token 供給へ到達する点を retained concern として明記している（PR の該当 review を参照）。
5. **evidence 証跡自体に未解決の指摘**（3.5 の `notes.md` 2 件）。証跡の完全性は thread 解消まで未確定。
6. **T06 は未完了**（3.4）。G2 の受入は未達で、#173 承認と G2 合否は別件。

---

## 4. 本資料の範囲外（意図的に扱わない）

- A/B/C の選択、G0 の go/no-go、web #173 の承認判断 — **いずれも本人の判断事項**。
- 判定シートの No-go とブロッカー 2 件（A/B/C 判断・web #173 承認）は変更しない。
- 運用システム・本番・課金クラウドへの接触、credential の入手・探索は行わない。
