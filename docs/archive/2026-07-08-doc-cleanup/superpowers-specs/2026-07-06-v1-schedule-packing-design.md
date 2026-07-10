# v1 Schedule Packing (100% Gap Fill) Design

> Date: 2026-07-06
> Status: Design — awaiting user approval
> Source of truth: `tastile-core/v1/*` spec + existing `crates/v1/{domain,storage,api}` code

---

## Goal

タイムライン上の GAP (固定 Placement 同士の間の Window 内の余白) を、**active な Flow の `ProposePlacement` 出力** で埋める。時間固定なし & 分割可能なタイル (Plan) は Flow 経由で複数 GAP に分割配置され、視覚的に隙間無しのタイムラインになる。

ユーザー要件 (確定):

- `maximize` のような特別パラメータは **使わない**。
- 固定 Placement を先に置き、残った空白を完全埋める = 「スケジュール 100% 充填」。
- 「時間固定なし & 分割可能」タイルは任意の GAP に敷き詰め可能。
- 検証は **実 API 検証を主**、最終段階で web ダッシュボードの e2e を整えてユーザー目視確認。
- メインは **core 側実装**。web 側は作成パネルなど **最小限の修正のみ**。

---

## Background

### 現状

| 領域 | 状態 |
|---|---|
| `domain::gap::find_gap_windows` | green (`gap_tests.rs`) |
| `domain::flow::rank_flow_candidates` | green (`flow_tests.rs`) |
| `domain::materialization::materialize_placement` | green (`materialization_tests.rs`) |
| `storage::flow_repo::load_active_flows_for_owner` | **未実装** |
| `storage::placement_repo::list_in_range` | **未実装** |
| `storage::flow_tick::*` | **未実装** |
| `handlers::timeline::get_timeline` で flow_tick 呼び出し | **未実装** |

ドメイン層は揃っており、production caller だけが欠けている。

### 関連 spec

- `v1/00-glossary.md` — Window / GAP / Flow / Materialization の語彙
- `v1/03-time-and-windows.md` — Window 4 種 (CALENDAR / LABEL_SPAN / PARENT_SPAN / GAP)、GAP は休憩専用ではない
- `v1/09-nesting-and-flow.md` — Flow / FlowCandidate / `ProposePlacement` 出力
- `v1/10-invariants.md` — 休憩を専用構造にしない、Flow は Placement を暗黙削除しない、Command 部分成功禁止
- `v1/12-acceptance-tests.md` — AT-020..AT-022 (Phase C), AT-023..AT-027 (本設計で取り込み + 拡張)
- `tastile-core/docs/plans/2026-07-06-v1-phase-c-break-emission.md` — 休憩特化の前身計画書 (本設計で包含)

---

## Architecture

### レイヤ構成

```
GET /v1/timeline?start=...&end=...
    │
    ▼
handlers::timeline::get_timeline
    │
    ├─ frame_repo::lazy_expand_for_window(...)        # Recurring → Placement (既存)
    │
    ├─ flow_tick::evaluate_window(pool, owner, start, end, now)
    │     │
    │     ├─ placement_repo::list_in_range(...)
    │     ├─ flow_repo::load_active_flows_for_owner(...)
    │     ├─ gap::find_gap_windows(anchors, start, end)
    │     └─ 各 Flow → 各 candidate → 各 ProposePlacement 出力:
    │            ├─ span = GAP に収まる (LIMIT_SPAN 範囲内)
    │            ├─ proposal_key = "{flow_id}:{candidate_id}:{plan_id}:{gap_start_ms}"
    │            └─ dispatcher::dispatch(CreatePlacement{ source=FLOW, plan_id, span, proposal_key })
    │
    ▼
EffectivePlacement[] を返却
```

### 新規/変更モジュール

**Storage (新)**

- `storage/src/placement_repo.rs`
  - `pub async fn list_in_range(pool, owner, start, end) -> RepoResult<Vec<(Placement, Span)>>`
- `storage/src/flow_repo.rs`
  - `pub async fn load_active_flows_for_owner(pool, owner) -> RepoResult<Vec<Flow>>`
- `storage/src/flow_tick.rs` (新ファイル)
  - `pub async fn evaluate_window(pool, owner, start, end, now) -> RepoResult<usize>` — 新規発行 Placement 数を返す

**API (改)**

- `crates/v1/api/src/handlers/timeline.rs`
  - `lazy_expand_for_window(...)` 直後に `flow_tick::evaluate_window(...)` を呼ぶ

**Web (最小修正のみ)**

- 現状の QuickTile 作成パネル / タイムライン表示 API は `GET /v1/timeline` を使うので、core 側の修正のみで反映される
- 必要なら「Plan に LIMIT_SPAN を設定する UI ヘルパ」程度を追加 (要否は core 実装後に web 動作確認で決定)
- 新規ページや大規模 UI 改修は **行わない**

**Domain**

- 変更なし。既存ヘルパを呼ぶだけ

---

## Data Flow (詳細)

1. **入力**: ユーザー所有 owner、`start`, `end`, `now`
2. **窓内 Placement 取得**: `list_in_range` で時間窓内 Placements + Span を取得
3. **active Flow 取得**: `load_active_flows_for_owner` で revoked でない Flow を全件
4. **GAP 抽出**: `gap::find_gap_windows` で GAP Span を取得
5. **候補評価**: 各 Flow について:
   - rank 降順で Flow を処理
   - 各 `candidate.when` (GapTerm 等) を GAP Span に対して評価 (`evaluate_gap_size`)
   - met した candidate の各 output について:
     - output が `ProposePlacement(plan_id=X, span_constraints=Y)` の場合
     - GAP Span を `LIMIT_SPAN` 範囲にクランプ
     - `CreatePlacementPayload { source: FLOW, plan_id: X, span: <clamped>, proposal_key: "{flow_id}:{candidate_id}:{plan_id}:{gap_start_ms}" }` を構築
       - `gap_start_ms` を含めてフロー間・GAP 間の proposal_key 衝突を防ぐ
     - `dispatcher::dispatch` で発行 (revision check / atomicity は dispatcher 保証)
6. **冪等性**: 構築した `proposal_key` を dispatcher が既存判定 (重複は reject)
7. **返却**: 発行件数 `usize` を返す (ハンドラは使用しないが、テスト・観測用)

### 分割 (Splitting)

1 Plan が 60min 必要、LIMIT_SPAN [25min, 30min]、GAP 1 (10:00–10:30, 30min) と GAP 2 (10:30–11:00, 30min) がある場合:

- Flow candidate が GAP 1 で met → 30min の study Placement が GAP 1 に
- 同一 Flow candidate が GAP 2 で再評価 (observe Signal) → 30min の study Placement が GAP 2 に
- 合計 60min = 必要時間。タイムライン上 100% 充填

### 100% 充填の保証

GAP Span の両端は固定 Placement の Span。Flow が `ProposePlacement(span=GAP Span に一致)` を出すと、発行 Placement の Span は GAP Span と一致する。**GAP が埋まる = 隙間が消える = 100% 充填**。

複数 Plan が同じ GAP を狙う場合は Flow rank で優先順位解決 (`v1/09 §Permit/Deny 順位` 参照)。

---

## Error Handling

| ケース | 対応 |
|---|---|
| Plan が DB に存在しない | `debug_event_repo` に記録、スキップ |
| `LIMIT_SPAN` に GAP が収まらない | `debug_event_repo` に記録、スキップ |
| Dispatcher 失敗 (revision conflict 等) | `Result` を伝播、ハンドラが 500。タイムライン全体が失敗 |
| `load_active_flows_for_owner` / `list_in_range` 失敗 | `Result` を伝播 |
| 同一 Flow × GAP の二重評価 | `proposal_key` の一意性で dispatcher が reject (AT-027 相当) |
| 巨大 Window | 1 クエリで処理 (Phase C 範囲)。必要なら後で chunk 化 |

エラー時、ハンドラは 500 を返さず debug event 記録のみで継続する選択肢もあるが、**v1/10 §4 (Command 部分成功禁止)** 整合のため dispatcher 失敗は伝播する方針。読み取り時の部分成功は許容 (Placement 作成失敗 ≠ タイムライン取得失敗)。

---

## Invariants

| 不変条件 | 担保 |
|---|---|
| AT-022 (Proposal 消滅時 Placement を暗黙削除しない) | flow_tick は create のみ。delete API を呼ばない |
| `v1/10 §9` 休憩を専用構造にしない | Plan ID は Flow 出力の `proposal.plan_id`。`isBreak` / `kind_break` / `breakMode` フラグを追加しない |
| `v1/10 §5` Flow は Placement を暗黙削除しない | 削除 API を呼ばない |
| `v1/09 不変条件` Flow は Placement を直接破壊的に更新しない | 全て dispatcher 経由 |
| `v1/10 §4` Command は部分成功しない / 正本・revision・Domain Event・Outbox Event は同一 Transaction | `dispatcher::dispatch` を再利用 |
| memory `feedback_no_kind_enums.md` (kind/source_kind/type 判別子禁止) | Plan ID による識別のみ。新 enum 追加なし |
| memory `feedback_no_fragmented_reimplementations.md` (break-as-category 禁止) | 休憩も学習も同じ Flow 機構を通る |
| memory `feedback_no_unverified_pass.md` (REVIEWED vs VERIFIED 区別) | 全 AT は実行コマンド + 出力ファイルで証跡を残す |
| memory `feedback_observe_actual_behavior.md` (実 API 振る舞いで検証) | cargo test だけでなく curl で実 API 確認 |
| memory `feedback_verify_ui_in_browser.md` (実ブラウザ目視) | e2e 段階で chrome-devtools MCP で take_screenshot |
| memory `feedback_measure_actual_scheduling.md` (実 placement 生成測定) | AT-023..AT-029 で実際に Placement が DB にできることを確認 |

---

## Acceptance Tests

`crates/v1/domain/src/at_acceptance_tests.rs` に追加:

| AT | 内容 | 期待 |
|---|---|---|
| AT-023 | Gap ≥ 30 min + 休憩 Flow | 10:00–10:30 に休憩 Placement (`source=FLOW`) |
| AT-024 | Gap < 30 min | 新規 Placement なし |
| AT-025 | 固定 Placement 追加で Gap 消滅 | 既存 break Placement 残る |
| AT-026 | Flow 出力の plan_id が break 以外 | Flow は met、Placement は作らず debug event |
| AT-027 | 既存 break ある Gap で再評価 | 重複なし (proposal_key で冪等) |
| **AT-028** | 任意 flexible+ splittable Plan で Gap 充填 | 固定 A 9–10 + study Plan + Flow → 10:00–10:30 に study Placement |
| **AT-029** | 同一 Plan を複数 Gap に分割 | 固定 A 9–10 + 固定 B 11–12 + study (必要 60min, LIMIT_SPAN [25,30]) + Flow → 10–10:30 と 10:30–11 に各 30min ずつ study Placement (合計 60min) |

---

## Storage / Domain Tests

**Storage 結合テスト (新)**

- `storage/tests/integration_placement_list.rs`
  - `list_in_range_returns_in_window`: 窓内 2 件、窓外 1 件除外
  - `list_in_range_filters_by_owner`: 別 owner の Placement は出ない
- `storage/tests/integration_flow_load.rs`
  - `load_active_flows_for_owner_returns_active`: active 2 件、revoked 0 件
  - `load_active_flows_for_owner_isolates_owner`: 別 owner は 0 件

**Domain 単体テスト**

- 既存 (`gap_tests.rs`, `flow_tests.rs`, `materialization_tests.rs`) を green 維持。追加なし

---

## Local Verification

ユーザー指定: **実 API 検証が主**、**最終段階で web ダッシュボード e2e を整える**。

### Step 1: Core 起動

```bash
cd tastile-core
cargo run -p tastile-core-api
```

- listen: `http://0.0.0.0:31400` (環境変数 `TASTILE_API_HOST` / `TASTILE_API_PORT` で変更可。デフォルトは host=`0.0.0.0`, port=`31400`)
- DB: Postgres + v1 マイグレーション適用済み (`DATABASE_URL` 環境変数)
- 認証: USER_AUTH またはテスト seed (memory `project_cognito_mfa_emailotp_constraint.md` 参照、TOTP は一旦 seed で回避可)

注: memory `project_windows_defender_blocks_cc1.md` により cargo build が失敗する可能性あり。v1 crates は純 Rust (sqlx, chrono, tokio のみ) なので成功する見込み。失敗時は WSL または CI ubuntu-latest で実施。

### Step 2: テストデータ作成 (curl)

```bash
TOKEN=$(curl -s -X POST http://localhost:31400/v1/auth/login -d '...' | jq -r .access_token)

# 固定 A: 09:00-10:00
curl -X POST http://localhost:31400/v1/placements \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"start":"2026-07-07T09:00:00Z","end":"2026-07-07T10:00:00Z","plan_id":"fixed-a"}'

# 固定 B: 11:00-12:00
curl -X POST http://localhost:31400/v1/placements \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"start":"2026-07-07T11:00:00Z","end":"2026-07-07T12:00:00Z","plan_id":"fixed-b"}'

# Plan "study" — placement_rules に LIMIT_SPAN [25min, 60min]
curl -X POST http://localhost:31400/v1/tiles/<study-tile>/plan \
  -H "Authorization: Bearer $TOKEN" \
  -d @study-plan.json

# Flow: GapTerm size >= 30min → ProposePlacement(study)
curl -X POST http://localhost:31400/v1/flows \
  -H "Authorization: Bearer $TOKEN" \
  -d @packing-flow.json
```

### Step 3: タイムライン取得 (JSON 確認 = AT-028 検証)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:31400/v1/timeline?start=2026-07-07T08:00:00Z&end=2026-07-07T13:00:00Z" \
  | jq '.placements[] | {start, end, plan_id, source}'
```

**期待出力**: 09:00-10:00 (fixed), 10:00-10:30 (study, source=FLOW), 11:00-12:00 (fixed) — gap 完全埋まり。

### Step 4: 分割ケース (AT-029 検証)

固定 A 09:00-10:00 + 固定 B 11:00-12:00、study Plan (必要 60min, LIMIT_SPAN [25,30]) + Flow (GapTerm size ≥ 25min, ProposePlacement(study)) で:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:31400/v1/timeline?start=2026-07-07T08:00:00Z&end=2026-07-07T13:00:00Z" \
  | jq '.placements[] | {start, end, plan_id, source}'
```

**期待出力**: 09:00-10:00 (fixed), 10:00-10:30 (study), 10:30-11:00 (study), 11:00-12:00 (fixed) — 合計 60min study で完全充填。

### Step 5: 冪等性 (AT-027 検証)

```bash
# 同じ GET を 2 回実行
curl -H "Authorization: Bearer $TOKEN" .../v1/timeline?... > out1.json
curl -H "Authorization: Bearer $TOKEN" .../v1/timeline?... > out2.json
diff out1.json out2.json
```

**期待**: 差分なし。

### Step 6: web ダッシュボード目視 (e2e、最終段階)

```bash
cd tastile-web
CLOUD_API_BASE=http://localhost:31400 \
TASTILE_RUST_API_URL=http://localhost:31400 \
TASTILE_WEB_BRIDGE_SECRET=... \
bun run dev
```

- `http://localhost:3000` (Next.js port) を開く
- ユーザー目視でタイムラインに隙間無くタイルが並ぶことを確認
- chrome-devtools MCP で `take_screenshot` して証跡保存

### 証跡保存

`evidence/v1-schedule-packing-{timestamp}/`:

- `step3-at028.json` — AT-028 検証の curl 出力
- `step4-at029.json` — AT-029 検証の curl 出力
- `step5-idempotent.json` — 冪等性 diff
- `dashboard.png` — chrome-devtools MCP スクリーンショット
- `run.log` — 全実行コマンド + 時刻 + PASS/FAIL 記録

memory `feedback_no_unverified_pass.md` に従い、**実行証跡なしの PASS 報告は禁止**。全 AT は JSON 出力で PASS を確認。

---

## Definition of Done

- [ ] `crates/v1/domain/src/at_acceptance_tests.rs` に AT-023..AT-029 全 7 件追加、PASS
- [ ] `storage/tests/integration_placement_list.rs` 追加、PASS
- [ ] `storage/tests/integration_flow_load.rs` 追加、PASS
- [ ] `storage/src/flow_tick.rs` 実装、`storage/src/lib.rs` で `pub mod flow_tick`
- [ ] `storage/src/placement_repo.rs` に `list_in_range` 追加
- [ ] `storage/src/flow_repo.rs` に `load_active_flows_for_owner` 追加
- [ ] `crates/v1/api/src/handlers/timeline.rs` で `flow_tick::evaluate_window` を呼ぶ
- [ ] `cargo build --workspace --all-targets` clean
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` clean
- [ ] `cargo fmt --all -- --check` clean
- [ ] `cargo test --workspace` 全 PASS
- [ ] Step 3-5 の curl 出力で隙間無し確認
- [ ] Step 6 で web ダッシュボード目視確認 + スクリーンショット保存
- [ ] `evidence/v1-schedule-packing-{timestamp}/` に全証跡揃う
- [ ] HARNESS.md §実装履歴 に本機能エントリ追加
- [ ] 新規 `isBreak` / `kind_break` / `breakMode` フラグ導入なし (grep 確認)
- [ ] legacy crate (`crates/tastile-{scheduler,daemon,mcp,plugin-runtime}/`) 無変更 (grep 確認)

---

## Rollback Plan

- 各 Task は独立コミット → `git revert <task-commit>` で巻き戻し
- Task 5 (`handlers::timeline` 改変) を revert すれば自動充填停止。既存 Placement は dispatcher 経由で正規に作成済みなのでデータ整合性保持
- AT-022 不変条件 (暗黙削除禁止) を全 Task で保っているので、ロールバック時に既存 break Placement が消えることはない

---

## Out of Scope (本設計で対応しない)

- 自律ワーカーティック (`crates/v1/worker/src/main.rs` 改良): 引き続き同期 on-read
- Decision / Session / Delivery (Phase D): break Placement は Decision を経由しない (Flow 候補が met なら即発行)
- ChangeSet 競合解決の高度化: 初回発行のみ対応
- Break Recurring を入力にする代替案 (Option 2 from earlier discussion)
- web 側の新規 UI 改修 (作成パネルへの LIMIT_SPAN ヘルパ追加など、必要なら別タスク)
- `maximize` 相当の特別パラメータ実装 (ユーザー指定により廃止)

---

## Risks (Top 3)

1. **Dispatcher トランザクション共有**: `flow_tick` が timeline 読み取りと同じ tx を使うか別 tx を開くかで原子性が変わる。方針: 1 候補 = 1 dispatcher tx で open。読み取り全体が失敗しても partial commit なし (v1/10 §4 整合)
2. **Flow 行スキーマと domain::Flow 構造体の drift**: `load_active_flows_for_owner` が返す型が `rank_flow_candidates` の期待と一致しないと silent reject。`integration_flow_load.rs` で往復テスト
3. **`proposal_key` 衝突**: メインフローで `{flow_id}:{candidate_id}:{plan_id}:{gap_start_ms}` 形式を採用することでフロー間・GAP 間衝突を防ぐ。ただし同一 Flow × 同一 candidate × 同一 plan_id × 同一 gap_start_ms が偶然一致する可能性は依然ゼロではない (例: フロー再評価で `now` が変わった場合)。dispatcher 側で既存 placement の plan_id 一致を最終確認する追加チェックを Task 4 で実装

---

## References

- 既存 Phase C 計画書: `tastile-core/docs/plans/2026-07-06-v1-phase-c-break-emission.md`
- v1 仕様: `tastile-core/v1/{00..15}-*.md`
- 既存 AT: `tastile-core/v1/12-acceptance-tests.md`
- Domain API: `crates/v1/domain/src/{gap,flow,materialization,resolver}.rs`
- 既存 API: `crates/v1/api/src/main.rs`, `crates/v1/api/src/handlers/timeline.rs`