# G5 shadow 試用 準備文書 (T15 前提整備)

- 日付: 2026-11-17
- 対象 gate: G5 / T15（root #105、12/09〜12/15 の最低 7 暦日 shadow、12/20 正式判定）
- 性質: **分析 + 文書化のみ**。runtime 変更・運用 VM / DB / 通知 / schedule への接触は一切行わない
- 関連正本: root #105（T15 定義・gate 規則）、tastile-core `docs/evidence/2026-11-16-muse-fixture-replay/`、`docs/evidence/2026-11-16-recurring-diff-classification/`、`docs/plans/2026-11-16-muse-fixture-replay.md`、core#322 → PR #324（release-1-1-0 merge 済み）

## 0. 現状サマリ（実測済みの出発点）

2026-11-15 受領の匿名化 fixture（`tastile-fixture-2026-11-15.zip`、SHA-256 `82c29572…994a5`、root #105 2026-11-16 コメント）に対する replay 結果:

- expected placements **359 件**中 **229 件**が nominal start 一致
- kind 内訳: OneTime 49/49、Recurring 180/199、DemandDriven 0/111（unsupported）
- recurring 未一致 19 件は core#322 で分類済み: ② replay adapter 起点誤り 2 件（修正済み）、③ 匿名化情報欠落 17 件
- `unplaced_by_scheduler` 4 tile（anon_id A055 / A057 / A076 / A099）は core#295 関連の別分類
- replay harness は `crates-v1/domain/examples/muse_fixture_replay.rs`（core#319 / PR #319、release-1-1-0 merge 済み）

G5 shadow は「運用側の正本データを read-only で観測し、Core 側の計算結果と日次比較する」試用である。本書はその比較を開始するために必要な (a) 取得可能なデータ、(b) 現時点で replay 不能なケースと必要入力、(c) 日次比較レコード形式、(d) guardrail、(e) 未決事項を固定する。

---

## 1. read-only shadow 比較で取得できるもの

### 1.1 取得経路の選択肢

運用側（Muse VM、PostgreSQL 16 / port 5433、Core debug API 127.0.0.1:31400、migration V1_050 時点の報告 — root #105 2026-11-15 コメント）からの取得経路は 2 系統ある。**推奨は (B) 定期匿名化 export**。理由は §3 の機密境界と、後述の API 側 silent truncation リスク（core#315）。

- **(A) read-only DB 接続**: 運用 PostgreSQL への SELECT-only role / 接続文字列を受領し、隔離 verify stack 側から `pg_dump` 相当の SELECT export を行う。全テーブル・全行を漏れなく取得できるが、credential 共有と VM 側 firewall/pg_hba 変更が前提になる（運用側の作業が発生する）。
- **(B) 定期匿名化 export**: 運用側が fixture と同形式（`tiles-anonymized.json` / `expected-placements.json` / `aggregates.json`、SHA256SUMS 付き）で export を生成し、安全な経路で受け渡す。前回 fixture と同じ手順・同じ sanitization 規則を踏襲でき、運用側の追加権限が最小。ただし export 仕様に本書 §2 の欠落フィールドを追加する必要がある。

API read-only 経路（`Scope(Read)` token による GET のみ）も理論上可能だが、**完全性の保証がない**ため単独では推奨しない（§1.3 の truncation 参照）。

### 1.2 必要なテーブル / read model（DB export の場合）

fixture replay harness が消費する `SourceTile` / `SourceGeneration`（`crates-v1/domain/examples/muse_fixture_replay.rs` の `FixtureTile` / `parse_generation`）と、配置比較に必要な v1 スキーマ正本（`crates-v1/storage/migrations/V1_001__base.sql` 以降の `v1_*` テーブル）に基づく。

| データ | テーブル / read model | 用途 |
| --- | --- | --- |
| source tile 定義 | `v1_source_tile`（`generation_kind` / `generation_at` / `source_state` / `offset_min` / `plan_role` は `V1_026__source_state_and_producer.sql` 系で正規化） | fixture `tiles[].schedule.generation` / `source_state` / `plan_role` の元 |
| generation 詳細 | `v1_source_tile` の recurring / monthly_rule / one_time / demand 系カラム（kind 別） | `weekday_mask` / `interval_ms` / `starts_at` / `excluded_dates` / `monthly_rule` の export 元 |
| schedule window / split / priority | `v1_source_tile` 内の window・split_policy・priority 相当カラム（`SourceScheduleDefinition`、`source_schedule.rs`） | fixture `schedule.window` / `split_policy` / `priority` |
| occurrence（展開済み nominal） | `v1_source_occurrence`、producer 由来は `v1_source_occurrence_producer`（`V1_025__source_occurrence_producer.sql`） | expected placements の照合対象・DemandDriven producer の実績確認 |
| placement | `v1_placement` + provenance `v1_placement_source_ref_*`（`_source` / `_recurring` / `_flow` / `_producer` / `_manual` / `_import`） | expected placements（`start_min` / `end_min`）と source 帰属 |
| plan | `v1_plan` + `v1_plan_planning` / `v1_plan_metric` / `v1_plan_decision` / `v1_plan_completion` / `v1_plan_references` | plan_role・Label 判定・Flow 参照解決 |
| Flow / demand 入力 | `v1_flow`、`v1_flow_candidate`、`v1_flow_candidate_output`（+ `..._proposal` / `..._companion` / `..._change`）、`v1_flow_signal`、`v1_planning_flow`、`v1_flow_when` | **DemandDriven 111 件の replay に必須**（§2-1） |
| window / rule | `v1_window`、`v1_window_rule`、`v1_window_bounds` | 配置判断の window 入力・`window_relation` 診断 |
| condition | `v1_condition` + `v1_condition_term_{calendar,fact,feedback,gap,life,metric,moment,relation,requirement,task}` | Flow `when` / Candidate 条件の評価入力 |
| recurring 例外・除外日 | `v1_source_date_exclusion`、recurring model / exception 系テーブル | excluded_dates・暦例外の実日付 anchor |
| busy / 実行占有 | `v1_execution`、`v1_placement`（span）、relation 系 `v1_placement_relation` | unplaced 分類・将来の placement-level 比較 |
| owner profile / timezone | owner profile 系（`v1/15`、owner_tz repo） | `offset_min` 欠落 tile の offset 継承可否（現 fixture では未提供で unsupported 化した経路、`muse_fixture_replay.rs` の `unsupported_missing_offset`） |

### 1.3 API read-only 経路の場合の対応表（検証済み endpoint 名）

`v1/14-read-model-and-endpoint.md` §15-16 と `crates-v1/api/src/` の route 登録で確認した read endpoint:

- `GET /v1/source-tiles`（ListResponse、`updated_at DESC` keyset paging）/ `GET /v1/source-tiles/{id}`（occurrences・placements を独立 cursor/limit で返す。`definition` read-back は core#326 / OpenAPI v3.2.0 で契約化済み）/ `GET /v1/source-tiles/{id}/placements` / `GET /v1/source-tiles/{id}/completion`
- `GET /v1/placements`、`GET /v1/tiles`、`GET /v1/candidates`、`GET /v1/labels`、`GET /v1/active-tile`、`GET /v1/timeline`、`GET /v1/timeline/today`、`GET /v1/calendar/{day,week,year}`、`GET /v1/recurring/{id}`、`GET /v1/flows`、`GET /v1/flows/{id}`、`GET /v1/windows`、`GET /v1/windows/{id}`、`GET /v1/conditions/{id}`、`GET /v1/decisions/{id}`、`GET /v1/sessions`、`GET /v1/sync?cursor=...`

**注意（完全性リスク）**: core#315 で未契約化が指摘されている通り、`GET /v1/recurring/{id}/instances` は SQL `LIMIT 500` の silent cap、deliveries 系は offset+clamp、`/v1/endpoints` 等は bare array。Muse 実データ規模（source tile 179・30 日 placement 859）では `LIMIT 500` に抵触し得るため、**API 経路で export する場合は paging/cap の棚卸し（core#315 の残課題）を先に解消するか、DB export を優先する**。

### 1.4 匿名化形式と refresh cadence

- **匿名化の単位**: tile ごとに決定的 `anon_id`（現行 harness は `deterministic_uuid_v7(uuid_time_ms, "source", &anon_id)` で ID を再生成するため、実 UUID を渡す必要はない）。owner 識別子・タイトル・表示名・絶対パス等の直接識別子は export に含めない。前回 fixture が `anon_id` + schedule 数値のみで成立した実績を踏襲する。
- **日付の扱い**: 現 fixture は実日付を持たず day0 を仮定していた（§2-2 の原因）。G5 では **epoch 基準または day0 実日付の開示**を要求する（root #105「Muse shadow 比較に必要な最小データ」1）。暦を要する値（`weekday_mask` / `excluded_dates` / `starts_at` / monthly_rule / calendar condition）は、実日付を private export 内に保持し、git に出る記録には日付そのものを書かない（§3）。
- **refresh cadence**: **日次 1 回**（推奨: 運用一日の schedule 確定後、JST 固定時刻）+ schedule 変更時の随時 export。7 暦日の drift 検出には日次で十分であり、placement horizon（30 日）の中で nominal start が当日〜数日先までずれ込むため、比較対象 window は「export 時点から +14 日」を維持する（現行 harness の `window_days=14`、`aggregates.json` 検証と同一）。snapshot 識別子として export の SHA-256（`SHA256SUMS` 方式踏襲）+ 取得時刻 + 運用側 `v1_migration` 最新値を記録する。

---

## 2. 現時点で replay 不能なケースと必要入力

root #105 2026-11-16 コメント「Muse shadow 比較に必要な最小データ」の 5 項目を、fixture replay harness の実装（`muse_fixture_replay.rs`）と v1 仕様に対応付けて具体化する。

### 2-1. DemandDriven（kind=2）— 111 placements、最大の未 replay 領域

- **現状**: fixture の kind=2 tile 3 件は `unsupported_demand` に分類され、expected placement 111 件はすべて未比較。harness は `expand_occurrences_local`（occurrence 展開）だけを呼び、**Flow の評価・OccurrenceRequest 発行経路を実行しない**（evidence README「配置 engine は実行せず」）。
- **v1 上の設計**（`v1/09-nesting-and-flow.md` §Flow）: Flow は `Vec<OccurrenceRequest>` を発行するだけで Placement を直接作らない。`PROPOSE_PLACEMENT` output は同一 owner の `DemandDriven` SourceTile を target にし、Flow の id/revision/local key は `OccurrenceProducer`（`v1_source_occurrence_producer`）に残り、placement の `placement_source` は `SOURCE` になる。
- **必要な追加入力**:
  1. `v1_flow` 系 export: Flow 定義、`v1_flow_when`（成立条件 = Condition AST）、`v1_flow_signal`（再評価契機）、`v1_flow_candidate` + `v1_flow_candidate_output`（window・頻度・優先度・`ProposePlacement` 系 output）
  2. `v1_planning_flow`（plan ↔ flow の関連）、対象 plan / window / condition の正規化データ（`v1_plan_planning`、`v1_window`、`v1_condition` + term テーブル）
  3. DemandDriven tile 自体の schedule window / priority / split_policy（既存 fixture 項目で充足）
  4. harness 側の拡張: Flow 評価（`flow_tick_planner` 系）または producer 実績（`v1_source_occurrence_producer` / `v1_placement_source_ref_producer`）の replay 取り込み。**入力が揃っても現 harness では比較できない**ため、core 側の実装タスクとして別 Issue 化が必要（本書では実装しない）。

### 2-2. Recurring の絶対日付 anchor — 17 placements（分類③）

- **現状**: fixture に実日付がなく day0 を 2026-11-09（月曜）に仮固定。`starts_at.minutes_from_day0` は「fixture の明示 offset で UTC 変換した local midnight 起点」の相対値。`excluded_dates` も day offset 整数。結果、17 placement は expected に合う Core occurrence を一意に対応付けられず③（匿名化情報欠落）に分類（`docs/evidence/2026-11-16-recurring-diff-classification/README.md`）。
- **必要な追加入力**: day0 の実日付、または全暦依存値を epoch / 開示済み anchor からの相対値で再表現した export。`weekday_mask` の bit 順（bit0=Monday）と local-date 判定は Core 実装で確定済みだが、fixture 側に暦がないと phase を確定できない。
- **補足**: `starts_at.anchor = "epoch"` + `time_of_day_utc` の形は既に fixture contract で受理される（`parse_generation` の recurring 分岐）。残る欠落は「recurring がどの日付から位相を持つか」の情報であり、epoch anchor 付き `starts_at` または実日付のどちらか一方で解消する。

### 2-3. unplaced_by_scheduler — 4 tile（core#295 関連）

- **現状**: expected placement が無い tile を `unplaced_by_scheduler` と分類するが、これは「placement 入力が fixture に無い」ことを意味し、scheduler が原因と確定したものではない（evidence README 明記）。
- **必要な追加入力**: 配置判断の入力一式 — window（`v1_window`/`v1_window_rule`）、priority、capacity/busy span（`v1_execution`・open placement）、relation（`v1_placement_relation`、inside/nesting）、および `unplacedOccurrences` / `UnplacedInfo` 相当の診断（`v1/14` §CommandResponse.aggregateMeta、core#295 の未配置理由）。
- **位置づけ**: これが揃わない限り placement-level 等価は証明不可（root #105 最小データ 3）。G5 では「occurrence-level 一致 + unplaced は理由不明のまま計数」でもよいが、その場合は既知ギャップとして判定資料に明記する（fallback、§5）。

### 2-4. Monthly generation — 現 fixture 範囲外

- **現状**: `SourceGenerationKind::Monthly` は domain に実装済み（core#292 / PR#293、release-1-1-0 merge `e09fcf30`、migration V1_078）だが、harness は `"monthly generation is outside this fixture contract"` で reject する（`muse_fixture_replay.rs` L569 付近）。Muse 実運用では月次は未使用との報告（root #105 2026-11-15 コメント）なので現時点の実害はないが、将来 monthly tile が現れた場合は fixture contract と harness の拡張が必要。

### 2-5. その他の fixture contract 制約（再掲・変更不要だが shadow 設計に影響）

- `offset_min` を持たない recurring tile は owner timezone が無いため `unsupported_missing_offset`（現 fixture では 0 件）。export に owner profile の timezone/offset を含めるか、全 tile に明示 offset を付ける運用にするかは §5 の未決事項。
- `source_state` は 0/3 のみ受理。その他 state が出た場合は export 側で分類するか contract 拡張が必要。
- OneTime `minutes_from_day0` は「選択した local-frame midnight 起点」で、明示 offset が無い tile は UTC を coordinate origin に使う（evidence「仮定と制約」）。実日付 anchor を入れる際にこの規約の再確認が必要。

---

## 3. 日次比較レコード形式

### 3.1 記録するフィールド（1 日 1 レコード）

比較は fixture replay harness の分類語彙をそのまま使う。日次レコードは **集計値 + anon_id + hash のみ**とし、schedule 内容・実日付・タイトルを含めない（git 記録の機密境界、§3.3）。

```jsonc
{
  "date": "2026-12-09",                 // 比較対象日（JST）
  "snapshot": {
    "export_sha256": "…",               // tiles/placements/aggregates + 追加フィールドの SHA256SUMS 由来
    "exported_at": "…",                 // 運用側 export 生成時刻
    "window_days": 14,                  // 現行 harness contract と同一
    "day0_weekday": "Monday"
  },
  "baseline": { "diff_analysis_run": "…", "issue": "tastile-core#322" },  // 差分分類の基準 run
  "totals": {
    "tiles_total": 179,
    "expected_placements": 359,
    "start_matched": 229
  },
  "by_generation_kind": {
    "0": { "exact": 49, "cancelled_state": 18, "unplaced_by_scheduler": 2, "empty": 61, "label_only": 10 },
    "1": { "exact": 15, "partial": 2, "unexpected": 9, "cancelled_state": 1, "unplaced_by_scheduler": 2, "empty": 5, "label_only": 2 },
    "2": { "unsupported_demand": 3 }
  },
  "diff_classification": {               // core#322 の 4 分類を日次差分に適用
    "safe_fix": 0,                       // ① 意図した安全修正
    "regression": 0,                     // ② 回帰（adapter 含む。Core regression と adapter regression を分けて記録）
    "anonymization_loss": 0,             // ③ 匿名化情報欠落（追加フィールドで解消した分は日々減るはず）
    "nondeterminism": 0                  // ④ 不定性（同一入力で結果が揺れる）
  },
  "new_diffs_vs_baseline": [             // baseline run から増えた anon_id のみ列挙
    { "anon_id": "A045", "kind": 1, "class": "regression", "note": "adapter anchor" }
  ],
  "unreplayable": {
    "unsupported_demand_tiles": 3,
    "unsupported_demand_placements": 111,
    "unsupported_missing_offset": 0,
    "monthly_out_of_contract": 0
  },
  "drift_flags": []                      // matched 数の前日比・新規 diff・snapshot hash 変化の有無
}
```

- **matched/mismatched/unreplayable の計数単位**: `expected placement` を主単位とし、tile 分類（`Classification::ALL` 9 値）と generation kind 別に集計する。`unreplayable` は `unsupported_*` / `monthly_out_of_contract` を独立計上し、比較不能を FAIL にしない（core#322 の分類規則踏襲）。
- **diff 分類 ①〜④ の適用**: 日次 export 間、または baseline fixture replay との比較で nominal start が一致しない placement を対象に、core#322 と同じ手順（`--diff-analysis` の Δstart/Δend・window 判定・最近接 candidate 選択）で分類する。①は仕様上意図した差分、②は Core または replay adapter の回帰、③は匿名化で情報が落ちたもの、④は同一入力で再現しないもの。**比較不能は FAIL にしない**が、②④が出た日は G5 判定材料として即座に Issue 化する。
- **new diffs vs baseline**: baseline は「G5 開始前に確定した直近 replay run」（現時点では core#322 修正後の run: kind=1 は 182/199 match、未一致 17 件 = ③）。毎日の `new_diffs_vs_baseline` が空であることが drift なしの定義。baseline 自体を更新する場合は理由と新 hash を記録する。

### 3.2 記録の置き場所（推奨）

**推奨: `tastile-core/docs/evidence/g5-shadow/` に日次 JSON + 週次/期間末の Markdown summary を commit する。**

- 根拠: 既存 evidence（`docs/evidence/2026-11-16-muse-fixture-replay/`、`2026-11-16-recurring-diff-classification/`）と同じ sanitization 規則（anon_id・分差分・分類・hash のみ、絶対時刻・schedule 内容・対応表は記録しない）が適用でき、commit しても機密を含まない。gate の証跡は durable work の正本であるべきで、tastile-core 側に置くと harness・fixture contract・evidence が同一 repo で完結する。
- **raw export（tiles/placements の実データ、実日付を含む版）は絶対に commit しない**。置き場所は repository 外の private 領域（前回 fixture と同じ `~/work/.tmp/` 系 + `SHA256SUMS`）とし、Issue / PR / commit / agent result に実 schedule 内容を転記しない。root #105 の完了規則 4「機密値・実タスク内容を公開ログ/Issueに記録しない」を日次運用にも適用する。
- 代替案として `tastile-root/docs/evidence/` 新設もあり得るが、比較 harness と fixture contract が tastile-core にあるため、機械可読な日次 JSON は core 側、root #105 / G5 判定資料には集計サマリへのリンクのみを記す分担を推奨する。

---

## 4. Guardrails（明示）

1. **shadow は read-only**。運用 VM の DB・API・ファイルへの書き込み、`v1_placement` / `v1_source_tile` 等への INSERT/UPDATE/DELETE、migration、restart、notification / delivery 接続は一切行わない。取得は SELECT export または `Scope(Read)` GET のみ。
2. **運用スタックは唯一の正本のまま**。新候補（Core release-1-1-0 head の計算結果）は提案・予定計算の比較にのみ使い、実予定の更新・通知・自動化に接続しない（T15 原文どおり）。
3. **mutation E2E は別テストデータ上**。verify-stack（root#104 / PR#119、port 分離 + preflight 機械検証済み）の fresh DB / `TASTILE_DELIVERY_PROVIDER=fake` でのみ実施し、運用 DB を mutation 対象にしない。
4. **7 暦日は短縮しない**。12/09 開始が遅れた場合は終了日も自動で後ろ倒し（例: 12/10 開始なら 12/16 まで）。中間評価の 12/13 13:00〜14:30 枠は正式 G5 判定ではない（#105 明記）。
5. **固定 SHA の明示**: 比較に使う Core は開始時に `release-1-1-0` の固定 SHA を記録し、期間中に head が進んだ場合は「比較対象 SHA が変わった日」として記録する（途中の無断 pin 変更をしない）。
6. **CI 状態の区別**: GitHub Actions billing blocker 継続中のため、全検証はローカル実測として記録し、未実施 CI を成功扱いしない（#105 2026-11-16 方針）。
7. **export の安全性**: 匿名化 export であっても raw ファイルは private 領域に限定し、SHA256SUMS による完全性検証を比較前に必須とする（前回 fixture と同じ手順）。

---

## 5. 未決事項（運用側 / ユーザー判断が必要）

1. **read 経路の確定**: (A) read-only DB role の credential 共有か、(B) 運用側での定期匿名化 export 生成か。export を選ぶ場合、生成を誰が・どの頻度で行うか（手動 / VM 上の read-only job。後者は運用側の作業追加になるため承認が必要）。
2. **実日付の開示範囲**: recurrence anchor 解消（§2-2）のため、実日付を private export に含めてよいか。git 記録には出さない前提でも、実日付を含むファイルの受け渡し経路（暗号化 / 安全な転送）を決める必要がある。代替として全暦値を epoch-shift した pseudodate 表現にできるか。
3. **DemandDriven の export 範囲**: `v1_flow` 系一式（Flow / when / signal / candidate / output / planning_flow）を export 対象に含めるか。含めない場合、111 placements は G5 全期間を通じて `unsupported_demand` のままとなり、「既知ギャップ」として判定資料に明記する fallback（root #105 コメント記載）を採用するかの判断。
4. **unplaced 理由の取得範囲**: placement engine の入力（busy span / relation / capacity）まで export するか、occurrence-level 比較に留めるか。後者なら `unplaced_by_scheduler` 4 tile は理由不明のまま計数し、core#295 の実測対応は別経路（Muse 再観測）に委ねる。
5. **owner timezone の扱い**: `offset_min` 欠落 recurring tile（現 fixture 0 件）への備えとして、owner profile の timezone を export に含めるか、全 tile に明示 offset を付与する運用ルールにするか。
6. **比較実行の担当**: 日次 replay + diff 分類を誰が実行するか（agent が verify stack で日次実行 / 運用側の export 受領後に手動）。自動化する場合も read-only 経路の範囲を超えないこと。
7. **G5 開始可能日の逆算**: 上記 1〜3 の回答が得られる最終期限。12/09 開始を守るには少なくとも 12/05 までに export 仕様が確定している必要がある（初回 export + baseline 確定 + dry-run 1 回分のバッファ）。間に合わない場合は開始遅延 → 終了自動後ろ倒しの規則を適用し、その旨を #105 に記録する。

---

## 6. 次アクション（本書の範囲内で可能なもの）

- 運用側への依頼文面を §1.2 / §2 のテーブル・フィールド一覧から作成し、root #105 または別 Issue で提示する（依頼自体は本タスクのスコープ外・要指示）。
- export 仕様が確定した時点で、fixture contract v2（実日付 anchor・flow 入力・monthly 対応）と harness 拡張の Issue を tastile-core に起票する。
- 日次比較レコードの JSON schema を `docs/evidence/g5-shadow/` 初回 commit 時に固定する（初回データが来るまで schema だけ先行 commit も可）。
