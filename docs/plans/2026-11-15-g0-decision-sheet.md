# G0 判定シート — 2026-11-15 19:00〜19:30

対象: tastile/tastile-root#105 / G0「運用境界と実行可能なベースラインを確定」
本シートは判定の材料である。結論を緩めず、go を出すための解消項目を隠さない。

> **2026-11-11 更新:** T01 の追加調査で旧 origin の所在が確定した。
> 確認した範囲（Cloudflare DNS / tunnel / Worker route、TCP 到達性、Infisical ホスト、
> Windows/WSL 端末、Tailscale 端末、端末上の配置）には**稼働中の運用スタックが見当たらない**。
> 「所在不明」ではないが、未確認領域（追補 §7）が残るため「存在しない」とも断定しない。
> 判断項目が性質変更になったため、§解消項目 1 と §判定 を書き換えた。
> 詳細証拠は
> [`2026-11-11-t01-operational-stack-located.md`](./2026-11-11-t01-operational-stack-located.md)。

---

## 判定材料（固定値、2026-11-12 更新）

| 項目 | 値 |
| --- | --- |
| tastile-core | `main` = `399190030ba2`。**#256 → #260 → #261 → #259 まで統合済み。CI は green（run 43064987225 / 43060412760）**。直前の green だった `8e14178c`（07:42Z）以降の赤は下記のとおり解消 |
| tastile-core（CI 障害・解消済み） | 2026-11-11T15:11Z 以降、全 quality run が `Install PostgreSQL client` で `Temporary failure resolving security.ubuntu.com` 失敗（**runner 側の Ubuntu ミラー DNS、コード起因でない**）。`main` 自体も赤（run 43047397047）。**回復 PR #261 で解消**: ①psql は既存物を優先 → apt は DNS をプローブしてからリトライ → 検証 postgres service container の psql にフォールバック、②mold は同パターン + apt 不通時は upstream GitHub release tarball。run 43060412760 が green |
| tastile-core（統合済み） | **#260 merge**（`df14c4f`、core#258: dead `read_owner` / legacy `authenticate` 削除）。fmt / clippy / api 全テスト 257 件を独立検証してから統合 |
| tastile-core（統合済み） | **#259 merge**（`399190030ba2`、core#257: profile PATCH の Idempotency-Key 必須化）。2 commit目 `504860a` で idempotency 記録を write トランザクション内へ移動（並行 8 発で 409 になっていた欠陥を修正）。`owner_profile_authz` 11/11 Green、並行テスト 10/10、api 全 suite Green を独立検証のうえ、CI 回復後の run 43064987225 で green を確認して統合 |
| tastile-root | `main` = `4a92493e3575`（#106 台帳 / #107 運用スタック所在 / #108 隔離マトリクス network 名 / #109 本シート更新 / #110 検証スタックの origin 可変化 を統合済み） |
| tastile-web | `main` = `5212e995f2ad`。**`bun.lock` は next 16.3.4 / better-auth 1.7.3 のまま**（#200 未反映） |
| tastile-web（修正済み） | `release-1-1-0` = `a782a2ff3a66`。next 16.4.2 / better-auth 1.7.7 / zod 4.6.6（#205 #204 反映済み、CI success） |
| tastile-android | `main` = `8bef645246ea` |
| tastile-openapi | `main` = `8461ffa34594` |
| 運用スタック | **確認した範囲に稼働スタックなし**。旧 origin は AWS `52.194.61.218`（本番）/ `52.194.223.15`（staging）で 22/443 閉塞・Cloudflare 522。`TASTILE_DATABASE_URL` の RDS エンドポイントは NXDOMAIN。R2 / AWS 現況 / 旧 origin バックアップ / 端末ローカル DB は未確認（追補 §7） |
| 運用境界の文書化 | 完了（台帳 + 追補。運用VMを変更対象外とする境界は不変） |
| 検証環境 | 隔離実測済み。`tastile-verify-{db,api,worker}` 稼働、`/v1/health` 200（`database:reachable`, `version:1.0.2`）、`/v1/ready` 200、`v1_migration` 63。**2026-11-12 追加**: `docker restart tastile-verify-api` 後も health 200 / migration 63 / `v1_tile` 145,813 行が不変（volume 永続化と再起動を同一検証で確認）。運用先への書込経路 0 は #104「T02 追記」§6 で静的走査 + コンテナ env + established 接続の3系統で実測 |
| G0 タスク進捗 | **T01 / T02 / T04 完了**（#105 のチェックボックスに証拠付きで記録）。T03 は「CI 赤の原因分類と回復経路」が本シート更新時点で apt DNS 障害の対応（#261）待ち |
| G1 前提（実測） | Web sign-up → bridge → `tastile_api_token` 発行 → `/api/proxy/v1/tiles` 200 を実 Chromium で確認済み（Web `3e7842e0`）。**`main` ではなく `release-1-1-0` 系の SHA**であることに注意 |
| G1 起動コマンド | `cd deploy/verify-stack && docker compose -f compose.yaml up --build -d` → `curl http://127.0.0.1:31400/v1/health` |

---

## 受入条件と判定

| G0 ACCEPT の条件 | 結果 | 証拠 |
| --- | --- | --- |
| 運用VMの正本保護が文書化されている | **未充足（性質変更）**。確認した範囲に稼働スタックが見当たらず、保護を証明できない。ACCEPT は「正本を保護できている」ことを要求しており、これは充足ではない | 追補 §0 / §3 / §4 |
| 検証環境の隔離が文書化されている | 充足 | 台帳 §5 |
| 固定SHA・起動依存の課金禁止が遵守されている | 遵守。無償 Colima / OSS のみ。AWS / GCP の再開なし | 台帳 §5、#102 |
| 権限境界が文書化されている | 充足（検証環境は loopback のみ） | 台帳 §1 / §7 |
| 判定資料が用意されている | 充足 | 本シート + 台帳 + 追補 + #259 |
| 未確認事項が隠れていない | 充足 | 追補 §7 |

---

## 解消項目（go を出すための残件）

1. **#105 のスコープ判断（本人）。** 確認した範囲に稼働スタックが見当たらないため、#105 の「実予定を正本とする shadow 試用」は現状のままでは成立しない。次のいずれかの決定が必要。
   - **A. 運用スタックを再建**する（旧 origin 復旧 or 新規構築）。再建後に「正本保護」を再判定する。
   - **B. 正本なきまま進める**（T14/T15 を合成 fixture のみに限定し、G5 ACCEPT を書き換える）。
   - **C. G0〜G4 のみ進める**（実データ比較を前提から外し、実用性の証明が合成データ止まりであることを明示して受容）。
   本シートは A/B/C を選ばない。**これは計画のスコープ変更であり、実装側の判断ではない。**
   各案を選んだ場合に G0 の go 条件へ追加される前提は次のとおり。
   - **A を選ぶ場合**: 再建された正本の所在・稼働確認、read-only 参照経路、保護の実測（権限境界・書込経路の遮断）が揃ってから go。
     再建そのものは G0 の前提作業であり、再建後の再判定を経る。
   - **B / C を選ぶ場合**: #105 の G5 ACCEPT（実データでの shadow 試用）を書き換え、
     合成 fixture での比較計画と「実用性の証明範囲」を明記した版の承認が go 条件。
     実データ抽出の未決（台帳 §6-1）は引き続き未決のまま残す。
2. ~~**Core PR #259 の merge**~~ **完了（2026-11-12）**。#260（`df14c4f`）→ #261（CI 回復、`2b7fda5`）→ #259（`399190030ba2`）の順で統合。`main` の quality は run 43064987225 で green。
3. **Web の脆弱依存**は `release-1-1-0` で解消済み、`main` は未反映。本番反映は PR #173 の release 承認（別判定）。
4. Web の外部認証依存（Better Auth、実メール送受信）は運用判断として残る。

---

## 判定

- **現状: No-go。** 未確定の運用境界がある以上、#105 の規則に従って go にはできない。
  以前との差は「所在が分からない」から「確認した範囲に正本が見当たらない」への変化であり、
  **G0 を PASS に近づけるものではない。**
- go にできる最小条件:
  1. 解消項目 1 の A/B/C の決定（本人）と、選んだ案の前提条件の充足
  2. ~~Core #259 の merge~~ **完了（2026-11-12）**
  3. 本シートに対する本人合意
- go にならない場合: G0 を no-go と記録し、11/22 の次回判定枠で再判定する。
  **T04〜T13（検証環境内の実装・検証）は並行して継続してよい**（本作業でも進行中）。
  T14/T15、実データ抽出、7 日 shadow 試用は開始しない。

---

## ブロッカー

| ブロッカー | 種別 | 解消の所在 |
| --- | --- | --- |
| 運用スタックの所在は確定したが稼働実体を確認できない → #105 の前提不成立 | **判断事項（本人）** | #105 / 追補 §5 |
| Web 脆弱依存の release 未承認 | リリース承認 | PR #173（`release-1-1-0`） |
| ~~Core CI 全滅（runner の apt DNS 障害）~~ | **解消（2026-11-12）** | PR #261 統合、run 43060412760 green |
| ~~Core PR #259 未マージ~~ | **解消（2026-11-12）** | PR #259 統合、`399190030ba2` |

---

## 11/22 週次レビューへの持ち越し

- 解消項目 1 の決定（A/B/C）と、それに伴う #105 のスコープ・G5 ACCEPT の書き換え。
- Core #259 のレビュー・CI 結果、および #261（CI apt 回復）の成否と、その先で再実行する PR 群。
- Web 側の release 承認可否。本番再デプロイは本計画に含まれない。
