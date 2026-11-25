# 受入ハーネス実装レビュー記録 (root#166)

- 日時: 2026-11-25
- 対象: `acceptance/contract/acceptance-contract.json` v0.1.1、`acceptance/harness/` (commit `4561041` 時点 + 本レビューでの修正)
- 正本: tastile/tastile-root#165 (A-AT01〜17 + 中核 E2E)、#166 (実施条件)
- 方法: 実装者と同一セッションによる厳格な自己レビュー (別 subagent 不使用)。契約 JSON の全 case を実装コードと 1 対 1 で照合し、check id の一意性・oracle の独立性・fail-closed 境界・secret 非出力を検査した。

## レビュー観点と結果

### 1. 契約カバレッジ — PASS

- contract の 18 case (A-AT01〜17 + A-E2E-CORE) すべてに `environments` / `prerequisites` / `fixture` / `oracle` / `checks` / `steps` / `api_refs` / `evidence` / `timeout_seconds` / `owner_issues` があり、`contract.ts` の REQUIRED_CASE_FIELDS 検証と registry 完全一致チェック (`main.ts`) で契約↔実装の drift を fail させる。
- `ctx.check` は契約未定義の check id で throw するため、実装側の独断 check 追加も検出される。
-環境適用: A-AT01 は `https` のみ、A-AT13/14/15 は `local|prod-equivalent` のみ、`https` では ops 注入なし (`profile.ts` / `ctx.requireOps`)。#165 の「実 HTTPS では安全な専用データ操作のみ、障害注入は隔離環境」と一致。

### 2. fail-closed / 安全境界 — PASS (修正後)

- `local` profile は API base が loopback http のみ許可し、それ以外は ProfileError。`prod-equivalent` は env 未設定で起動不能、http は loopback/プライベートのみ。`https` は https + 公開 DNS 名必須で IP 直打ち・loopback を拒否。
- ops 注入は service allowlist (`db/api/worker/web/caddy/cloudflared`) + `https` profile 禁止 + prod-equivalent は `TASTILE_ACCEPTANCE_OPS_CMD` / `TASTILE_ACCEPTANCE_OPS=compose` の明示指定がない限り `none`。
- secret は `http.ts` の redact が evidence/step/detail に適用され、token は sha256 prefix のみ記録 (`bootstrap.ts`)。password は run ごとの乱数で evidence に出ない。
- 専用 owner は `acc-<runId>-*@tastile-acceptance.invalid` のみ。既存運用 owner/DB/volume に触れない。A-AT15 の restore は別 compose project + 別 volume + 無作為 port で、復元後 `down -v` で teardown。

### 3. oracle の独立性 — 概ね PASS (1 件強化)

- 200 応答・health・自己比較での代用はない。各 check は readback・revision・span・状態機械遷移など独立した観測に基づく。
- A-AT17 は `cases/audit.ts` で機能テストから分離し `audit/cost-audit.md` に別出力。repo/config 面の監査であり provider 側課金状態は「open item」として明示し PASS 扱いしない — #165 の要求と一致。
- A-AT09 の期待 span は fixture の固定値との一致で検証 (`expected-window`)。`/v1/placements/{id}` が baseline span を返す仕様差異は `/v1/timeline` の resolved span で検証する形に修正済み (commit 4561041)。

### 4. 検出した欠陥と修正 (本レビューで対応)

`ctx.check(id, ok)` は同一 case 内で同じ id を再度呼ぶと前の結果を上書きする。複数 probe/段階で同じ check id を emit していた箇所は「後の成功が前の失敗をマスクする」false-PASS 経路になり得た。以下をすべて単一 emit + AND 蓄積に修正した。

| 箇所 | 欠陥 | 修正 |
|---|---|---|
| `cases/edge.ts` A-AT01 | `no-direct-backend` が port ごとの OPEN 検出 (false) の後に無条件 `true` で上書き → 常に PASS | `backendsClosed` に蓄積し最後に 1 回 emit |
| 同上 | `tls-cert-valid` / `https-reachable` / `no-plain-http-bypass` が api/web ループで上書き | 蓄積フラグで 1 回 emit |
| 同上 | `no-plain-http-bypass` が plain http の 200 応答を許容 → 契約 oracle (redirect または拒否) と不一致 | 200 を合格から除外。http で 200 を返す経路は plaintext bypass として FAIL |
| `cases/edge.ts` A-AT16 | live TCP probe の `db-not-public`/`worker-not-public` が後続の静的 compose scan で上書き | live + static を AND して最後に emit |
| `cases/api.ts` A-AT05 | `direct-crud` が create/readback の 2 回 emit で上書き | 両条件を AND して 1 回 emit |
| `cases/api.ts` A-AT07 | `cross-write-denied` が patch 結果を delete 結果で上書き (patch 成功・delete 拒否で false PASS) | patchDenied && delDenied を 1 回 emit |
| `cases/api.ts` A-AT08 | `readback-match` が view 内容チェックを list 包含チェックで上書き | viewOk && listOk を 1 回 emit |
| `cases/auth.ts` A-AT03 | `logout-rejects` が sign-out status を事後 probe で上書き、かつ cookie jar を clear していたため「同一 session の失効」を検証していなかった | jar を保持したまま sign-out 成功 && 保護経路拒否を 1 回 emit |
| `cases/auth.ts` A-AT04 | `expiry-or-revoke` が pre-revoke 成功を post-revoke で上書き | before===200 && after===401 を 1 回 emit |
| `cases/ops.ts` A-AT13 | restart 失敗時に常に `restart-api` check へ false を記録 (誤ラベル) | service→check id を対応付け |
| `cases/web.ts` A-AT02 | `real-backend-data` が collection への任意 2xx を許容し、作成 tile 固有の proxy readback を要求していなかった | `/api/proxy/v1/tiles/{id}` で fixture title 一致を追加 oracle に |

### 5. 残存観察事項 (修正せず記録)

- A-AT16 の live port probe は prod-equivalent/https のみ (local は loopback host のため意図的に skip)。静的 compose scan は service 名 `db/api/worker` のハードコードで、prod-stack/verify-stack の現行 service 名と一致することを確認済み。stack 構成変更時は scan の service 集合も更新が必要。
- A-AT17 `rate-limit-active` は env 明示がなくても「core 内蔵 default (main.rs の bounded_env_usize: 60/600/240/12) + body/timeout cap」を根拠に PASS とする。default 値の存在は `tastile-core/crates-v1/api/src/main.rs:569-579` で確認済み。provider 側の実請求・権限証跡は #102/#144 の open item であり、本 case の PASS は repo/config 監査の範囲に限定される (contract と audit 出力に明記済み)。
- A-AT09 の flow fixture probe と legacy recurring write probe は oracle ではなく証跡採取 (note のみ)。契約の `worker-commit`/`expected-window`/`readback-consistent` が判定を担う。
- A-E2E-CORE は `requireWeb` で web_base 必須。chain は逐次で最初の失敗で停止し、`chain-complete`/`cross-surface-consistency`/`post-restart-state` の 3 check で集約。https profile では restart 段を skip し `post-restart-state` は prod-equivalent の証跡に委ねる (contract の environments と整合)。

## 結論

契約・ハーネスは #166 の要求 (版管理契約、fail-closed profile 分離、専用 fixture、独立 oracle、証跡形式、A-AT17 分離) を満たす。上記 12 件の false-PASS 経路を修正し、`bunx tsc --noEmit` PASS、local baseline を再実行して結果を #165 に追記する。prod-equivalent / https profile の baseline は env・承認待ちの BLOCKED であり PASS 扱いしない。
