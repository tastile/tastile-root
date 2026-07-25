# tastile 実用化完遂指示書 — Kimi K3 / OpenCode Go 向け

## 0. この作業の最終目的

この作業の目的は、設計資料を増やすことでも、APIの形だけを整えることでも、テスト用fixtureだけを成立させることでもない。

**2026年7月27日（月）から、ユーザーが実際のテスト勉強と寮生活の管理に tastile を使用できる状態へ到達させること**が唯一の完了条件である。

2026年7月26日（日）中に、少なくとも次の経路を本番で一続きに動作させる。

```text
Web UIで生活・授業・勉強条件を定義
  ↓
SourceTile / Plan / Condition / Window / Relation として正規化保存
  ↓
worker が条件を継続評価
  ↓
Occurrence を生成
  ↓
汎用アルゴリズムで Placement を配置・再配置
  ↓
時刻到来またはユーザー操作で Execution を開始
  ↓
Execution の開始・一時停止・再開・完了を管理
  ↓
必要な通知を Web / Android へ配送
  ↓
自動決定できない場合だけ Decision → Session → InteractionTree を表示
  ↓
ユーザー回答を FeedbackTxn として適用
  ↓
Source / Placement / Execution / Completion を再評価
```

この鎖の一部だけが動く状態は完成ではない。

---

# 1. 作業対象と絶対的な進行順序

## 1.1 対象リポジトリ

以下の3リポジトリをこの順序で扱う。

1. `tastile/tastile-core`
2. `tastile/tastile-web`
3. `tastile/tastile-android`

各リポジトリとも、**必ず既存の `main` 作業ツリーで作業する**。

- worktreeを作らない
- 別ブランチへ逃げない
- 現在の未コミット変更をreset、checkout、stash、revertしない
- 無関係な変更を巻き戻さない
- ユーザーの既存作業を片側採用で破棄しない

## 1.2 機能上の順序

1. SourceTileを中心とする汎用定義モデル
2. Condition / Window / Relation / LABEL / Split の実評価
3. Source → Occurrence → Placement の依存駆動materialization
4. Placementの再配置・保護・競合処理
5. Placement → Execution の実行管理
6. Execution / Fact / Metric / Completion を受けた再評価
7. Decision / Session / Delivery
8. Webの完全な作成・実行・質問UI
9. Androidの実行・通知・質問UI
10. GitHub Actionsによる本番デプロイ

Webだけで疑似的に予定を組む、Android側だけでタイマーを動かす、DBへ直接fixtureを入れて完成とする、といった別経路は禁止する。

---

# 2. 用語と正本

## 2.1 Recurringは生成主体ではない

**Recurring Tile ≠ SourceTile。SourceTileが現在の正しい生成主体であり、Recurringは旧アーキテクチャの互換読取面である。**

新規実装では次を守る。

- 新しい日次・週次・条件発火スケジュールはSourceTileで作る
- `v1_recurring`、FrameRule、Recurring専用materializerへ新機能を追加しない
- `/v1/recurring/...` の書込経路を復活させない
- Webの「繰り返し」UIはSourceGenerationを編集するUIに置き換える
- `TileKind.RECURRING` を新規作成時の意味種別として使わない
- Recurringという語をUI上の一般的な「繰り返し」ラベルに使うことはよいが、wire/domain型として旧Recurringを送らない

## 2.2 休憩・睡眠・授業は用途であり、型ではない

以下を追加してはならない。

```text
BreakSource
SleepSource
ClassSource
StudyMode
ExamMode
DormMode
LaundryMode
AtCoderMode
isBreak
isSleep
isFixed
isMovable
weekdayOnly
```

タイトル、icon、色、project path、特定UUIDを見てアルゴリズム分岐することも禁止する。

同じ定義のタイトルをすべて無意味な名前へ変更しても、生成されるSpan・Relation・Execution・通知が一致しなければならない。

## 2.3 実際の構造

```text
SourceTile
├─ Tile presentation
├─ Plan
│  ├─ Completion
│  ├─ References
│  ├─ PlacementRules
│  ├─ NestingRules
│  ├─ Metrics
│  └─ Decisions
├─ SourceScheduleDefinition
│  ├─ Generation
│  ├─ Window
│  ├─ RequiredDuration
│  ├─ SplitPolicy
│  └─ Priority
├─ Flow[]
└─ RelationDefinition[]

SourceTile
  → SourceOccurrence
  → Placement
  → Execution
```

Relationの両端は対等なノードである。`INSIDE`の説明上「親」「子」と呼ぶことはあっても、恒久的なParentTile/ChildTile型を作らない。

---

# 3. エージェントが取ってはならない逃げ方

以下を理由に作業を停止してはならない。

- 「Phase B/C/Dは範囲外」
- 「今日はcoreだけにする」
- 「UIは後回し」
- 「通知プロバイダは別タスク」
- 「実装量が多すぎる」
- 「仕様が複雑なので簡易版にする」
- 「既存コードが分かりにくいので別実装を作る」
- 「テストが重いので型だけ追加する」
- 「ルートとDB行があるので完成」
- 「モックでE2Eを代用する」
- 「ユーザー確認がないので止まる」

外部資格情報が本当に不足している場合だけ、その外部呼出し1点を明示的なblockerとして残してよい。ただし、その場合も以下は全て完了させる。

- domain
- migration
- repository
- worker
- API
- provider adapter
- fake providerによる統合テスト
- Web/Android接続
- Actions workflow
- 必要なSecret名と設定手順

資格情報不足を理由に、それ以前の実装を止めない。

## 完成と認めない例

- structを追加しただけ
- migrationを追加しただけ
- routeを追加しただけ
- `TODO`、`NotImplemented`、空Vec、常にtrue/falseの仮評価
- JSON payloadを保存して後で読むだけ
- Webフォームに入力欄はあるがsubmitで捨てる
- AndroidでボタンはあるがAPIを呼ばない
- Delivery行をINSERTするだけで端末へ届かない
- Sessionを作るだけでInteractionTreeが無い
- StartExecution APIはあるがPlacement時刻と接続されていない
- fixtureを直接SQLで入れたときだけ動く

---

# 4. 開発環境と検証環境

## 4.1 ローカルのビルド・テスト・起動はWSLC内で閉じる

Windowsホスト上で直接 `cargo`、`bun`、`gradlew` を実行した結果を完了証拠にしてはならない。

編集はWindows側のエディタで行ってよいが、以下はWSLC内で行う。

- dependency install
- code generation
- format check
- lint
- typecheck
- unit test
- PostgreSQL integration test
- API/worker起動
- Web build/start
- Android build/test/install
- E2E

## 4.2 core

対象:

```text
tastile-core/
├─ Containerfile.v1
├─ scripts/wslc/
├─ crates-v1/
└─ .github/workflows/deploy.yml
```

既存のPowerShell直操作または `scripts/wslc` を用いる。WSLC上で次を通す。

```powershell
wslc build -f Containerfile.v1 -t tastile-v1-api:latest .

wslc container rm -f tastile-worker tastile-api tastile-db
# 既存のREADMEに従ってDB / API / workerを再生成

curl.exe -s http://127.0.0.1:31400/v1/health
curl.exe -s http://127.0.0.1:31400/v1/ready
```

Rustの品質ゲートはWSLC builder内で `crates-v1/Cargo.toml` を明示して実行する。

```bash
cargo fmt --manifest-path crates-v1/Cargo.toml --all -- --check
cargo clippy --manifest-path crates-v1/Cargo.toml --workspace --all-targets -- -D warnings
cargo build --manifest-path crates-v1/Cargo.toml --workspace --all-targets
cargo test --manifest-path crates-v1/Cargo.toml --workspace -- --test-threads=1
```

PostgreSQL統合テストをskipしてはならない。

## 4.3 web

対象:

```text
tastile-web/
├─ Containerfile
├─ scripts/wslc/
├─ src/
└─ .github/workflows/deploy.yml
```

既存のWSLC scriptsを使う。

```bash
./scripts/wslc/build.sh
./scripts/wslc/up.sh
./scripts/wslc/status.sh
```

Webコンテナ内で次を通す。

```bash
bun install --frozen-lockfile
bun run check:release
```

core stackを同じ `tastile-net` で起動し、ブラウザから以下を実確認する。

```text
http://localhost:3000
http://localhost:3000/dashboard
http://localhost:3000/dashboard/schedule
```

200だけでは不十分。console error 0、API error 0、実際の作成・配置・実行操作を確認する。

## 4.4 android

対象:

```text
tastile-android/
├─ .wslc/
├─ app/
└─ .github/workflows/{verify.yml,release.yml}
```

既存スクリプトを使う。

```powershell
.wslc/wslc-build.ps1
.wslc/wslc-dev.ps1
wslc exec tastile-android-dev ./gradlew verify
wslc exec tastile-android-dev ./gradlew assembleDebug
```

可能な場合はWSLC内のADBから実機へinstallし、通知・deep link・実行操作を確認する。

---

# 5. 現在のmainに存在する基盤と、完成扱いしてはいけない部分

## 5.1 既に再利用するもの

### core domain

```text
crates-v1/domain/src/source_schedule.rs
crates-v1/domain/src/relation.rs
crates-v1/domain/src/condition.rs
crates-v1/domain/src/flow.rs
crates-v1/domain/src/decision.rs
crates-v1/domain/src/command.rs
crates-v1/domain/src/resolver.rs
```

既に存在する主な能力:

- OneTime / Recurring / DemandDriven SourceGeneration
- weekday mask / date range / excluded dates
- SourceWindow
- RequiredDuration
- SplitPolicy
- priority
- RelationKind: INSIDE / BEFORE / AFTER / STARTS_AT / ENDS_AT / SAME_SPAN / SAME_DURATION
- deterministic selector
- normalized Flow output sequence
- Condition AST
- Completion / Metric / Decision / InteractionTreeの型

### core storage

```text
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/source_lifecycle_repo.rs
crates-v1/storage/src/relation_repo.rs
crates-v1/storage/src/execution_repo.rs
crates-v1/storage/src/decision_repo.rs
crates-v1/storage/src/feedback_repo.rs
crates-v1/storage/src/delivery_repo.rs
crates-v1/storage/src/dispatcher.rs
crates-v1/storage/src/outbox_repo.rs
crates-v1/storage/src/initial_source_bundle.rs
crates-v1/storage/src/publish_schedule_repo.rs
```

既に存在する主な能力:

- SourceTile作成・更新・reflow
- SourceOccurrence生成
- Placement segment生成
- owner schedule lock
- worker lease/retry/cursor
- Relation definition / realized relationの保存
- Execution start/pause/resume/finishの永続化
- Decision定義の正規化保存
- FeedbackTxn永続化
- Delivery行の保存

### API

```text
crates-v1/api/src/main.rs
crates-v1/api/src/handlers/commands.rs
crates-v1/api/src/handlers/source_tiles.rs
crates-v1/api/src/handlers/read.rs
crates-v1/api/src/handlers/timeline.rs
crates-v1/api/src/handlers/notifications.rs
crates-v1/api/src/handlers/endpoints.rs
crates-v1/api/src/openapi.rs
```

### worker

```text
crates-v1/worker/src/main.rs
```

現在は以下を回している。

- outbox drain
- Source horizon fill
- Source work execution
- Flow horizon fill

## 5.2 現在の仮実装・未接続部分

次は存在していても完成ではない。

1. `relation_repo.rs` は保存・読取だけで、Relation依存materializationが無い
2. `relation_lifecycle_repo.rs` はまだ存在しない
3. workerはPlacement時刻からExecutionを駆動しない
4. Decision定義は保存できるがDecisionRun evaluatorが無い
5. `CreateSession` はworkflow Sessionではなく、認証session表へ最小行を書くだけの仮実装
6. StartTile通知は空SessionとDelivery行を作るだけで、Decision/Interactionを通らない
7. Deliveryは状態行を保存するだけで実配送しない
8. Endpointはraw tokenをhash化して捨てるため、配送時にtokenを復元できない
9. `prompt_repo.rs` はJSON payload inboxであり、正規化契約に反する
10. WebのsubmitはCompletion rootを空ALLへ差し替え、フォーム入力を捨てる
11. WebのAutomationPanelは日次/週次/終了日だけで、SourceWindow・Condition・Relation・Splitを編集できない
12. QuickTileCreate内にPhase B/C/D stubという前提が残っている
13. Androidはtimeline/read中心で、Execution command・Decision response・notificationが未接続

これらを全て実装対象に含める。

---

# 6. core実装 — ファイル単位の指示

以下の順序で実装する。ただし各タスクを「型だけ」「repositoryだけ」で閉じず、同じタスク内でdomain→storage→worker→API→testまで通す。

## C1. ローカル日付・タイムゾーンを正しく扱う

### 変更するファイル

```text
crates-v1/domain/src/source_schedule.rs
crates-v1/domain/src/condition.rs
crates-v1/domain/src/evaluation.rs          # 現在のEvaluationContext定義先を確認して変更
crates-v1/domain/src/command.rs
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/condition_repo.rs
crates-v1/storage/src/access_repo.rs
crates-v1/api/src/handlers/source_tiles.rs
crates-v1/api/src/openapi.rs
```

### 必須実装

現在のweekday/date filterをUTCの `date_naive()` だけで評価してはならない。

- ownerのtimezoneまたはdefinitionに明示された `offset_min` をEvaluationContextへ渡す
- 日本時間の日付・曜日をそのoffsetで決定する
- DSTのあるtimezoneを将来扱える構造にする
- SourceGenerationのdate range / excluded dates / weekday maskをローカル日付で評価する
- 保存はUTC、評価時のcalendar boundaryだけlocal contextを用いる
-端末時刻を暗黙参照しない

### テスト

```text
crates-v1/domain/src/source_schedule_tests.rs
crates-v1/storage/tests/at_source_local_calendar.rs
```

最低限:

- JST 00:30がUTC前日でもJST曜日で生成される
- 23:00〜翌日範囲が日跨ぎで正しく生成される
- excluded dateがJST日付で除外される
-同じUTC instantでもoffsetが異なればcalendar condition結果が異なる

## C2. Relation definitionをSourceTile公開payloadへ統合する

### 変更するファイル

```text
crates-v1/domain/src/command.rs
crates-v1/domain/src/relation.rs
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/relation_repo.rs
crates-v1/storage/src/publish_schedule_repo.rs
crates-v1/api/src/handlers/commands.rs
crates-v1/api/src/handlers/source_tiles.rs
crates-v1/api/src/handlers/read.rs
crates-v1/api/src/openapi.rs
```

### 必須実装

`CreateSourceTilePayload`、`UpdateSourceTilePayload`、`PublishScheduleDefinitionPayload`から、同一publish operation内のclient-local source/reference IDを解決してRelation definitionを作成できるようにする。

payloadには少なくとも次を含める。

```text
relations[]
- client_local_id
- subject_source_ref
- referenced_source_ref
- kind
- point
- offset_ms
- ordering
- duration_expression
- split_policy
- correlation_scope
- lifecycle_filter
- eligible_through_revision
- summary_priority
```

Relationを別の裏APIで後付けするだけにしない。Source definitionの作成・更新と同一transactionで確定する。

### migration

現在の最大migration番号を確認し、空いていれば次を作る。番号が進んでいればsuffixを維持して次番号を使う。

```text
crates-v1/storage/migrations/V1_033__source_relation_authoring.sql
```

### テスト

```text
crates-v1/api/tests/source_relation_authoring.rs
crates-v1/storage/tests/at_source_relation_authoring.rs
```

- 同一command内client-local参照
- cross-owner拒否
- duplicate local ID拒否
- nonexistent source拒否
- contradictory split拒否
- transaction途中失敗時にSourceだけ残らない

## C3. 依存駆動Relation materializerを完成させる

### 新規作成

```text
crates-v1/domain/src/relation_materialization.rs
crates-v1/storage/src/relation_lifecycle_repo.rs
crates-v1/storage/tests/at_relation_materialization.rs
```

### 変更するファイル

```text
crates-v1/domain/src/lib.rs
crates-v1/storage/src/lib.rs
crates-v1/storage/src/relation_repo.rs
crates-v1/storage/src/source_lifecycle_repo.rs
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/outbox_repo.rs
crates-v1/worker/src/main.rs
```

### migration

```text
crates-v1/storage/migrations/V1_034__relation_materialization_state.sql
```

必要な正規化状態:

- definition evaluation cursor
- selected candidate facts
- deterministic component/proposal key
- pending reason
- superseded relation lifecycle
- blocked component identity
- dependency edge → affected source/range index

### アルゴリズム要件

1. 参照候補をowner・lifecycle・correlation・revisionで閉じる
2. 入力順序に依存しないtotal orderでcandidateを選ぶ
3. referenceがまだ存在しない場合はpendingとして保持する
4. source/occurrence/placement/relation/executionの変化で依存範囲だけを再評価する
5. Relation component単位で解を計算する
6. STARTS_AT / ENDS_AT / BEFORE / AFTER / SAME_SPAN / SAME_DURATION / INSIDEを同じsolver経路で扱う
7. 外部固定値の無い矛盾循環はBLOCKED
8. 外部固定値にanchorされた等価群は解決する
9. selected candidateが変わった場合は同一transactionで古いcomponentをsupersedeし、新しいcomponentを作る
10. detach、Placement ChangeSet、Execution開始済みのいずれかが含まれる場合、部分closeをせず全componentをrollbackしてDecisionへ送る
11. 同じeventの再処理で二重生成しない
12. source作成順をforward/reverse/randomへ変えても結果が同じ

### 必須テスト

```text
at_relation_materialization_forward_reverse_random
at_relation_missing_reference_remains_pending
at_relation_selected_candidate_change_is_atomic
at_relation_protected_component_has_zero_partial_close
at_relation_unanchored_cycle_is_blocked
at_relation_anchored_equal_span_group_resolves
at_relation_rename_does_not_change_result
```

## C4. 汎用配置アルゴリズムを実生活条件まで引き上げる

### 変更するファイル

```text
crates-v1/domain/src/source_schedule.rs
crates-v1/domain/src/condition.rs
crates-v1/domain/src/placement_rule.rs      # 現在の定義先を確認
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/flow_tick.rs
crates-v1/storage/src/gap_repo.rs
crates-v1/storage/src/change_set_repo.rs
crates-v1/storage/src/completion_repo.rs
```

### 必須能力

- flexible window内でrequired durationを置く
- preferred timeをscoreで表現する
- fixed timeをwindow/permit/deny/limitで表現する
-日次・週次・date range・除外日
- 特定日だけ別曜日の時間割へ置換
- label active期間による条件切替
-前後関係
- 同日・同Occurrence correlation
- 1つのtaskを複数segmentへ分割
- LABEL内へ配置
- LABELはbusy timeを消費しない
- executableはbusy timeを消費する
- 重複許可を用途flagではなくScope/Ruleで表現する
- priorityとscoreを混同しない
-不足capacityを静かに捨てず、BLOCKEDまたはDecisionへ送る

### 禁止

- 最も早いgapへ置くだけで全ケースを済ませる
- preferred timeを無視する
- 先に登録されたSourceを常に勝者にする
- titleによる固定予定判定
- 1日のUTC境界で切る

### テスト

```text
crates-v1/domain/src/life_schedule_tests.rs
crates-v1/storage/tests/at_life_schedule.rs
```

後述の第10章の全ユースケースをfixture化する。

## C5. Split配置とExecution集約

### 変更するファイル

```text
crates-v1/domain/src/source_schedule.rs
crates-v1/storage/src/source_tile_repo.rs
crates-v1/storage/src/execution_repo.rs
crates-v1/api/src/handlers/read.rs
crates-v1/api/src/handlers/timeline.rs
crates-v1/api/src/openapi.rs
```

### 新規テスト

```text
crates-v1/storage/tests/at_split_execution.rs
crates-v1/api/tests/split_execution_read.rs
```

### 必須実装

- 1 occurrenceを複数Placementへ分割
- 各Placementが固有tile/plan identityを正しく持つ
- `source_tile_id`、`occurrence_id`、`split_group_id`を共有
- split_index/countは決定的
- Executionは各segment Placementにだけ紐づく
- Completionはsegment個別とOccurrence全体の両方を集約できる
- Month/summaryはsummary_priorityとrelation specificityで代表を選ぶ
- 任意の小さな固定上限で実用ケースを切らない
- max_segmentsは入力制約としてのみ機能し、隠れた実装上限で成功ケースを拒否しない

## C6. PlacementからExecutionを駆動するruntime

### 新規作成

```text
crates-v1/domain/src/execution_runtime.rs
crates-v1/storage/src/execution_runtime_repo.rs
crates-v1/storage/tests/at_execution_runtime.rs
```

### 変更するファイル

```text
crates-v1/domain/src/lib.rs
crates-v1/storage/src/lib.rs
crates-v1/storage/src/execution_repo.rs
crates-v1/storage/src/dispatcher.rs
crates-v1/storage/src/outbox_repo.rs
crates-v1/storage/src/work_item_repo.rs
crates-v1/worker/src/main.rs
crates-v1/api/src/handlers/read.rs
crates-v1/api/src/handlers/commands.rs
```

### migration

```text
crates-v1/storage/migrations/V1_035__execution_runtime.sql
```

### runtime要件

1. Placementの開始前通知時刻をwork itemとして登録する
2. 開始時刻到来時に実行方針を評価する
3. 自動開始可能なら既存DispatcherのStartExecutionを呼ぶ
4. ユーザー確認が必要ならDecisionRunを発行する
5. Placementが移動したら古いwork itemを失効させ、新時刻へ再登録する
6. Placementがcloseされたら実行開始しない
7. 同一PlacementにACTIVE Executionを1件だけ保証する
8. pause/resume/finishは既存Execution segment経路を使う
9. finish時にTask/Fact/Metric/Completionを再評価する
10. Execution結果から必要なSource reflowをoutbox経由で起動する
11. worker再起動後も時刻到来を取りこぼさない
12. 遅延起動時は現在時刻と猶予を評価し、勝手に過去Executionを作らない

### 重要

workerから `execution_repo::start` を直接雑に呼ばず、system ActorのCommandEnvelopeを作りDispatcherへ通す。冪等性、outbox、auditを迂回しない。

## C7. Decision evaluator / workflow Session / Feedback loop

### 新規作成

```text
crates-v1/domain/src/decision_runtime.rs
crates-v1/storage/src/decision_runtime_repo.rs
crates-v1/storage/tests/at_decision_runtime.rs
crates-v1/api/tests/decision_feedback_runtime.rs
```

### 変更するファイル

```text
crates-v1/domain/src/decision.rs
crates-v1/domain/src/command.rs
crates-v1/storage/src/decision_repo.rs
crates-v1/storage/src/feedback_repo.rs
crates-v1/storage/src/session_repo.rs
crates-v1/storage/src/dispatcher.rs
crates-v1/storage/src/outbox_repo.rs
crates-v1/worker/src/main.rs
crates-v1/api/src/handlers/commands.rs
crates-v1/api/src/handlers/read.rs
crates-v1/api/src/main.rs
crates-v1/api/src/lib.rs
crates-v1/api/src/openapi.rs
```

### migration

```text
crates-v1/storage/migrations/V1_036__decision_run_session.sql
```

### 根本修正

現在の認証用 `v1_session` とworkflowのDecision Sessionを同じ最小行で誤魔化さない。

- 認証sessionとworkflow sessionを物理・repository・型で分離する
- 既存のauth session互換性を壊さないmigrationを作る
- `CreateSession` のzero token hash仮実装を削除する
- SessionDecisionRun、InteractionTree、revision、stateを正規化保存する
- Sessionは未解決DecisionRunがある場合だけ作る
-候補が1つに決まる場合は自動適用しSessionを作らない
-過去FeedbackReuseRuleが有効なら同じ質問を繰り返さない
- LOCKED / REPLACE / MERGEを実際に競合処理へ使う
- FeedbackTxn適用後にDecision、Placement、Execution、Completionを再解決する
- REVOKEは履歴削除ではなく追記として扱う

### `prompt_repo.rs`

```text
crates-v1/storage/src/prompt_repo.rs
```

これはJSON payload inboxを正本としているため、そのまま拡張しない。

- workflow Decision/Sessionへ置換する
- 旧prompt readが必要ならcompat projectionだけにする
-新しい質問内容をJSONBへ保存しない
- InteractionNode/Input/Option/Resultを正規化テーブルへ保存する

### 必須テスト

- 一意候補は自動適用されSession 0件
- 複数候補だけSession作成
- 同条件の有効Feedbackで質問を再作成しない
- 2端末同時回答でLOCKEDは1回だけ
- MERGE入力は統合
- stale baseRevisionは再評価
- RequestDraftは同じidempotency keyで1回だけ実行
- Session回答後にPlacementが再配置される

## C8. 実際に配送できるDelivery driver

### 問題

現在のEndpoint登録はraw tokenをSHA-256へ変換して捨てるため、Delivery workerがpush tokenを利用できない。これはセキュリティではなく配送不能な設計である。

### 新規作成

```text
crates-v1/storage/src/delivery_driver.rs
crates-v1/worker/src/delivery_tick.rs
crates-v1/storage/tests/at_delivery_driver.rs
```

### 変更するファイル

```text
crates-v1/api/src/handlers/endpoints.rs
crates-v1/api/src/handlers/notifications.rs
crates-v1/storage/src/delivery_repo.rs
crates-v1/storage/src/dispatcher.rs
crates-v1/storage/src/lib.rs
crates-v1/worker/src/main.rs
crates-v1/api/src/openapi.rs
```

### migration

```text
crates-v1/storage/migrations/V1_037__endpoint_delivery_secret.sql
```

### 必須設計

- token lookup用hashと、配送用暗号化tokenを分ける
- plaintext tokenをread APIへ返さない
- encrypted tokenはKMSまたは既存secret encryption abstractionで保護する
- Push / WebPush / Emailをprovider interfaceで分離する
- developmentではfake provider、productionでは実providerを注入する
- Delivery PENDINGをworkerがclaimする
-成功時DELIVERED、失敗時attempts/last_error/next retryを更新
-既にSessionが回答済みなら不要Deliveryを停止
-配信失敗で新しいSessionを作らない
-同一Session/endpointを二重送信しない

### 実用上の最低配送先

- Web: in-app prompt + browser notification
- Android: system notification + deep link

Delivery行だけ作って完了としない。

---

# 7. workerの最終構成

`crates-v1/worker/src/main.rs` を巨大な直書きループにせず、責務ごとに分ける。

### 新規ファイル

```text
crates-v1/worker/src/source_tick.rs
crates-v1/worker/src/relation_tick.rs
crates-v1/worker/src/execution_tick.rs
crates-v1/worker/src/decision_tick.rs
crates-v1/worker/src/delivery_tick.rs
```

既存処理を移す場合も挙動を失わない。

### 1 tickの順序

```text
1. outbox capture
2. source horizon enqueue
3. source work claim/execute
4. relation dependency work claim/execute
5. flow evaluation
6. execution due work claim/execute
7. decision run evaluation
8. session/delivery enqueue
9. delivery claim/send
10. retry/dead-letter maintenance
```

各段階はSKIP LOCKED lease、idempotency、retry backoffを持つ。

workerを2台以上起動しても二重Execution・二重Delivery・二重Placementが起きないことをPostgreSQL integration testで証明する。

---

# 8. Web実装 — UIから全条件を表現できるようにする

## 8.1 既存の誤ったsubmit経路を置き換える

### 変更するファイル

```text
tastile-web/src/lib/stores/quick-create-store.ts
tastile-web/src/lib/api/v1/submit.ts
tastile-web/src/lib/api/v1/schedule-definition.ts
tastile-web/src/lib/api/v1/build-command.ts
tastile-web/src/components/tiles/QuickTileCreate.tsx
tastile-web/src/components/tiles/editor/AutomationPanel.tsx
```

### 必須修正

- `submit.ts` 内の空ALL completion root差し替えを削除
- storeのCompletion/Condition/Task/Metric/Decisionをそのままwireへ変換
-新規スケジュールは旧CreateTile→SetPlan→Recurring ladderではなく、SourceTileまたはatomic schedule-definition publishを使う
- `TileKind.RECURRING` へ切り替えるUIを廃止
-「毎日」「毎週」はSourceGeneration editorのpresetにする
- form stateにある値を送信時に捨てない
- TypeScriptの `unknown[]` を具体型へ置き換える
- Relation definitions、split、priority、local calendar offset、excluded datesをwire型に追加

## 8.2 新規editor panel

### 新規作成

```text
tastile-web/src/components/tiles/editor/SourceGenerationPanel.tsx
tastile-web/src/components/tiles/editor/SourceWindowPanel.tsx
tastile-web/src/components/tiles/editor/ConditionPanel.tsx
tastile-web/src/components/tiles/editor/PlacementRulesPanel.tsx
tastile-web/src/components/tiles/editor/RelationPanel.tsx
tastile-web/src/components/tiles/editor/SplitPolicyPanel.tsx
tastile-web/src/components/tiles/editor/FlowSequencePanel.tsx
tastile-web/src/components/tiles/editor/CompletionPanel.tsx
tastile-web/src/components/tiles/editor/DecisionPanel.tsx
tastile-web/src/components/tiles/editor/DeliveryPolicyPanel.tsx
```

### UIで必ず編集できる項目

- one-time / interval / daily / weekly / demand-driven
- local timezone / offset
- date range
- excluded dates
- weekday mask
- occurrence nominal time
- availability window start/end
- required/preferred duration
- split min/max/max segments
- priority
- Permit/Deny/Limit/Score/Record Requirement
- Condition All/Any/Not/Term
- LABEL期間参照
- Reference selector
- Relation kind / point / offset / duration / correlation / ordering
- Flow observe / candidate / sequence step
- Completion task / time requirement
- Decision candidate / Interaction input / option / reuse rule
-通知タイミングとinteraction requirement

「高度な設定」としてJSONを直接入力させる方式は禁止する。

## 8.3 プロジェクト階層

文字列pathだけを正本にしない。

次の階層はLABEL SourceTileとINSIDE Relationで表現し、UIではtreeとして編集する。

```text
生活時間
└─ 日次

学校
└─ 授業
   ├─ 時間割
   └─ 科目
      └─ 課題
```

### 変更・作成

```text
tastile-web/src/components/tiles/editor/ProjectRelationPanel.tsx
tastile-web/src/lib/stores/quick-create-store.ts
tastile-web/src/lib/api/v1/schedule-definition.ts
```

LABEL名を変更しても所属Relationが壊れないこと。

## 8.4 Timelineと実行UI

### 変更するファイル

```text
tastile-web/src/lib/hooks/calendar/use-events.ts
tastile-web/src/components/calendar/DayView.tsx
tastile-web/src/components/calendar/WeekView.tsx
tastile-web/src/components/calendar/MonthView.tsx
tastile-web/src/components/calendar/MonthEventTile.tsx
tastile-web/src/lib/api/v1/tile-commands.ts
```

### 新規作成

```text
tastile-web/src/components/execution/ExecutionPanel.tsx
tastile-web/src/components/execution/ActiveExecutionBar.tsx
tastile-web/src/components/decision/DecisionPromptSheet.tsx
tastile-web/src/components/decision/InteractionTreeForm.tsx
tastile-web/src/lib/hooks/use-active-execution.ts
tastile-web/src/lib/hooks/use-pending-sessions.ts
tastile-web/src/lib/api/v1/executions.ts
tastile-web/src/lib/api/v1/sessions.ts
```

### 必須操作

- Placementから開始
- pause
- resume
- finish normal/void
- task checklist/fact入力
-実行時間表示
- split group全体の進捗表示
- Session質問への回答
-回答取消
- defer/skip/replaceなどDecisionが定義した選択
-回答後のtimeline自動更新

## 8.5 Web通知

- service workerを用いたbrowser notification
- in-app prompt
- notification clickで対象ExecutionまたはSessionを開く
- endpoint registrationを行う
- token更新時にendpointを更新する
-Delivery delivered/failedをcoreへ返す

## 8.6 Webテスト

既に削除された「未実装設計に対するテスト」を、今度は実装と共に復活させる。

```text
tastile-web/src/lib/api/v1/schedule-definition.test.ts
tastile-web/src/lib/api/v1/submit.test.ts
tastile-web/src/components/tiles/QuickTileCreate.test.tsx
tastile-web/src/components/tiles/editor/ConditionPanel.test.tsx
tastile-web/src/components/tiles/editor/RelationPanel.test.tsx
tastile-web/src/components/execution/ExecutionPanel.test.tsx
tastile-web/src/components/decision/DecisionPromptSheet.test.tsx
tastile-web/e2e/test-study-life.spec.ts
```

E2Eは実core WSLC stackへ接続し、mock APIだけで済ませない。

---

# 9. Android実装 — 実行と通知を実用可能にする

## 9.1 API client

### 変更するファイル

```text
tastile-android/app/src/main/java/app/tastile/android/data/api/V1ApiClient.kt
tastile-android/app/src/main/java/app/tastile/android/data/api/V1Models.kt
tastile-android/app/src/main/java/app/tastile/android/data/repository/TileRepository.kt
```

実際のモデルファイル名が分割されている場合は、既存DTOの所在へ合わせる。

### 追加するAPI

```text
POST /v1/placements/{id}/executions
POST /v1/executions/{id}/pause
POST /v1/executions/{id}/resume
POST /v1/executions/{id}/finish
GET  /v1/active-tile
GET  /v1/executions/{id}/view
GET  /v1/sessions/pending
GET  /v1/sessions/{id}
POST /v1/sessions/{id}/feedback
POST /v1/endpoints
DELETE /v1/endpoints/{id}
POST /v1/deliveries/{id}/delivered
POST /v1/deliveries/{id}/failed
```

Core wire shapeを推測せず、OpenAPIまたは実レスポンスfixtureで固定する。

## 9.2 UI

### 変更するファイル

```text
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/calendar/DayView.kt
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/calendar/WeekView.kt
```

### 新規作成

```text
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionScreen.kt
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/execution/ExecutionViewModel.kt
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/decision/DecisionSheet.kt
tastile-android/app/src/main/java/app/tastile/android/ui/mobile/decision/DecisionViewModel.kt
tastile-android/app/src/main/java/app/tastile/android/notification/TastileMessagingService.kt
tastile-android/app/src/main/java/app/tastile/android/notification/NotificationDeepLink.kt
```

### 必須操作

- Day/WeekのPlacement tapからExecution開始
- active Execution表示
- pause/resume/finish
- Session質問へ回答
- notificationから対象画面へ遷移
-アプリ再起動後もactive Execution復元
-回答後にtimeline更新

## 9.3 Android通知

- FCM token取得
- core endpoint登録
- token rotation対応
- notification channel作成
- action replyをサポートできるSessionは通知actionから回答
- delivered/failedをcoreへ返す
- foreground/background/terminatedで確認

## 9.4 テスト

```text
tastile-android/app/src/test/java/app/tastile/android/data/api/V1ExecutionApiTest.kt
tastile-android/app/src/test/java/app/tastile/android/data/api/V1SessionApiTest.kt
tastile-android/app/src/test/java/app/tastile/android/data/repository/ExecutionRepositoryTest.kt
tastile-android/app/src/test/java/app/tastile/android/ui/mobile/decision/DecisionViewModelTest.kt
tastile-android/app/src/androidTest/java/app/tastile/android/ExecutionFlowTest.kt
tastile-android/app/src/androidTest/java/app/tastile/android/NotificationDeepLinkTest.kt
```

---

# 10. 実用ユースケースをそのまま受け入れ試験にする

以下は例示ではなく、**全体を完成させたことを証明する受け入れ契約**である。

ただし実装は名前や用途を特別扱いせず、汎用パラメータの組合せだけで実現する。

## 10.1 生活期間LABEL

UIから次を作成できること。

```text
2学期: 2026-06-10〜2026-08-10
夏季休暇: 2026-08-11〜2026-10-01
テスト期間: 2026-08-03〜2026-08-05本番を含み、初日の1週間前〜最終日前日
```

これらはLABEL SourceTileとして生成され、他SourceのConditionから参照できる。

## 10.2 睡眠と睡眠不足調整

### 通常睡眠

```text
毎日
基本 01:00〜07:30
平均睡眠時間 7時間30分を目標
予定によって徹夜を許容
```

汎用表現:

- recurring generation
- daily local calendar
- availability/preferred window
- required/preferred duration
- priority
- Execution duration metric
- rolling average metric/condition
- override ChangeSetまたはDecision feedback

### 昼寝

```text
平均睡眠不足を補う
目安2時間
2日に1回程度
徹夜明けは例外的に増やせる
```

- rolling metricで不足量を計算
- gap/window/priorityで候補を生成
-一意なら自動配置
-複数候補または他予定との競合時だけDecision

### コーヒー

徹夜予定が成立した日に「コーヒーを買う」を徹夜作業より前へ配置する。

タイトルやsleep flagではなく、徹夜を表すFact/Decision result/ReferenceとBEFORE Relationで表現する。

## 10.3 食事・入浴

```text
朝食: 毎日 07:40〜08:00、必要15分
昼食: 11:40〜12:40、必要20分、12:20付近を優先
夕食: 17:40〜19:40、必要20分、18:00付近を優先
入浴: 17:00〜21:40、必要20分、夕食後を優先
```

入浴は次の両方を自然に扱う。

- 夕食直後に入る
- 一度部屋へ戻った後に改めて入る

これは `AFTER夕食` の高rank候補と、一般window内のfallback候補で表現する。必ず直後とする専用条件を作らない。

## 10.4 点呼・消灯

```text
朝点呼
夜点呼: 21:43〜21:47、所要1分、21:45付近を優先
消灯: 23:00まで、所要1分以下
```

夜点呼前にすぐ出られるよう構える範囲は、必要ならLABELまたは短い準備Sourceとして表現する。`rollCallMode`を作らない。

## 10.5 いど端底力タイム

```text
毎日 21:00〜22:40
20:55から準備
21:00〜21:15 作業1
21:15〜21:20 休憩
21:20〜21:50 作業2
21:50〜21:55 休憩
21:55〜22:40 作業3
22:40後に約10分の振り返り
```

必要な独立Source:

- 全体LABEL 21:00〜22:40
- 準備 5分 BEFORE
- 作業segment 15/30/45
- 休憩segment 5/5
- 振り返り 10分 AFTER
- Discord stage開始task
- timekeeper bot起動task

全体LABEL内の各segmentはRelationで構成する。特別なfocus workflow型を作らない。

## 10.6 日次学習・ゲームの順序

```text
Duolingo: 毎日、24:00まで、約15分、底力タイム後を優先
モチタン: 毎日、24:00まで、約15分、Duolingo後
LinkedIn Games: 毎日、時刻指定なし、モチタン後を優先
```

- AFTER Relation
- deadline window
- preferred relation candidate
- fallback placement

の組合せで表現する。

## 10.7 授業時間LABEL

### 通常

```text
1・2時限 08:50〜10:20
3・4時限 10:30〜12:00
5・6時限 12:50〜14:20
7・8時限 14:40〜16:10
```

### 水曜午後

```text
5時限 13:05〜13:55
6・7時限 14:00〜15:30
8時限 〜16:10
```

時間枠をLABEL SourceTileとして作り、科目SourceをSAME_SPANまたはINSIDEで割り当てる。

## 10.8 二学期時間割

```text
法学A          月 1・2
英語IV A       月 3・4
計測工学       月 5・6
体育IV         火 1・2
応用数学       火 3・4
PJ学習III      火 5〜8 / 水 6〜8 / 木 5〜8
数値計算       水 1〜4
卒業研究II     木 5〜8
中国語A        金 3・4
```

科目ごとに別SourceTileとし、曜日・期間LABEL・時間割LABEL参照で生成する。

## 10.9 祝日・特別日程

```text
2026-07-20 海の日: 通常授業なし
2026-07-16: 木曜日の日付だが月曜日時間割へ置換
2026-07-22: 水曜日の日付だが月曜日時間割へ置換
2026-08-06: 補講日、通常授業なし、内容未確定
2026-08-07 / 08-10: 返却時間割、通常授業なし、内容未確定
```

必要能力:

- excluded date
-特定日のreplacement calendar label
-通常Sourceを抑止する高rank condition/change
-未確定Sourceをplaceholder LABELとして作り、内容確定後にRelationを追加

日付ごとのif文をschedulerへ追加しない。

## 10.10 初期休憩Source

```text
15分作業 → 5分休憩
30分作業 → 5分休憩
45分作業 → 5分休憩
60分作業 → 5分休憩
75分作業 → 5分休憩
90分作業 → 30分休憩
その後15分作業へ戻る
```

-休憩Placementだけを作る
-固定予定で中断された新しいgapではsequence先頭へ戻る
-休憩へ音楽・ゲーム等のtaskを割り当てられる
-タイトルを変更しても同じ結果

既存のgeneric `wait_before_ms` / `emit_duration_ms` sequenceを使う。

## 10.11 洗濯

```text
3〜4日に1回程度
洗濯開始
約1時間30分後に乾燥機へ移す
約4時間後に回収
3回の人間行動
前回から3日以上空いていることを優先
```

汎用表現:

- 前回ExecutionFinishedをReference
- duration/count metric
- 3日経過condition
- 洗濯開始Source
- AFTER + offset 90分で移動task
- AFTER + offset 4時間で回収task
-各行動は別Placement/Execution
- 中間待機時間はbusy timeにしない

## 10.12 土曜日AtCoder

```text
土曜のAtCoder ABCを底力タイムへ割り当てる
```

- Saturday condition
- 底力タイムLABEL参照
- 15/30/45分segmentへsplit assignment
- 実行結果はAtCoder taskへ集約
-底力タイム全体をExecutionにしない

---

# 11. ユースケースE2E fixture

fixtureはテストデータ投入の便宜であり、production専用分岐にしてはならない。

### core

```text
crates-v1/storage/tests/fixtures/test_study_life.rs
crates-v1/storage/tests/at_test_study_life.rs
```

公開Command/Dispatcher経路だけで全定義を作る。直接SQLでdefinition本体を作らない。

### web

```text
e2e/test-study-life.spec.ts
```

UIだけで以下を行う。

1. 期間LABEL作成
2. 生活Source作成
3. 授業時間LABEL作成
4. 科目作成
5. 特別日程設定
6. 底力タイム構成
7. 休憩Source編集
8. テスト勉強task作成
9. timeline生成確認
10. Execution開始/完了
11. Decision回答
12. 再配置確認

### rename invariance

同じpayloadでtitle/color/iconだけを全て変更したfixtureを別ownerへ作り、次を比較する。

- occurrence nominal/window
- placement spans
- relation graph
- split groups
- decision count
- execution policy

全て一致すること。

---

# 12. 月曜日から実用できることの受け入れ条件

次のシナリオを本番で完遂するまで完成と報告しない。

## シナリオA: テスト勉強taskの登録

1. Webで「応用数学 テスト勉強」を作る
2. deadlineをテスト前日に設定
3.必要時間を複数segmentへ分割可能にする
4. 授業・食事・底力タイム・睡眠の間へ自動配置される
5.予定を追加すると自動再配置される
6.固定したsegmentと開始済みExecutionは動かない

## シナリオB: 実行

1. 開始前にWeb/Androidへ通知
2. PlacementからExecution開始
3. pause/resume
4. taskを完了
5. finish
6. 実績時間がCompletion/Metricへ反映
7.残作業が再配置される

## シナリオC: 質問

1. 同rank候補または保護Placementで自動解決不能にする
2. Decision evaluatorがSessionを1件だけ作る
3. WebとAndroidへ同じSessionが届く
4. 一方で回答
5.他方は回答済みへ更新
6. FeedbackTxnが適用される
7. timelineが再計算される
8.同条件で有効なreuse ruleがある場合、同じ質問を繰り返さない

## シナリオD: 再起動耐性

1. API/workerを再起動
2. 未処理work itemを再claim
3. 二重Placementなし
4. 二重Executionなし
5.二重Deliveryなし
6. 予定・実行状態が保持される

---

# 13. GitHub Actionsによるデプロイ

本番デプロイはローカルからSSH/SSM/手動コピーしない。**必ず各リポジトリのGitHub Actionsを使う。**

順序:

1. core
2. web
3. android internal track

## 13.1 core

変更対象:

```text
tastile-core/.github/workflows/deploy.yml
```

既存workflowはfmt/clippy/build後にbinaryを配布するが、deploy前に次を追加する。

```text
cargo test --manifest-path crates-v1/Cargo.toml --workspace -- --test-threads=1
PostgreSQL migration smoke test
worker/API integration test
life schedule E2E fixture
OpenAPI generation drift check
```

deploy後probe:

- `/v1/health`
- `/v1/ready`
- fresh owner作成
- Source作成
- timeline生成
- execution start/finish
- test notification providerまたはproduction endpointへのDelivery

probe失敗時はworkflowをfailさせる。

## 13.2 web

変更対象:

```text
tastile-web/.github/workflows/deploy.yml
```

既存 `bun run check:release` に加え、core staging/prod-compatible APIを使ったE2Eをdeploy前gateにする。

デプロイ後:

- app root
- dashboard
- schedule
- Source作成
- timeline取得
- Session取得

を確認する。

## 13.3 android

変更対象:

```text
tastile-android/.github/workflows/verify.yml
tastile-android/.github/workflows/release.yml
```

`release.yml` の `bundleRelease` 前に必ず `./gradlew verify` を実行する。

releaseは最初にinternal trackへ送る。

- signing secretが無い場合にunsignedのままPlay uploadへ進ませない
- core URL / Cognito / FCM設定をActions Secretsから注入
- AAB artifactを保存
- internal track upload成功を確認

---

# 14. 実装・コミットの進め方

## 14.1 コミット単位

以下を目安にする。

```text
feat(core): make source calendar evaluation timezone-aware
feat(core): author source relation definitions atomically
feat(core): materialize relation dependency graph
feat(core): drive placement execution runtime
feat(core): evaluate decisions and workflow sessions
feat(core): deliver interactive notifications
feat(web): author complete source schedule definitions
feat(web): connect execution and decision runtime
feat(android): connect execution and interactive notifications
ci: gate production deploy on practical e2e
```

各コミットに実装と対応テストを同居させる。

## 14.2 進捗報告

「調査しました」「型を追加しました」ではなく、次の形式で記録する。

```text
Completed path:
UI input
→ request payload
→ API handler
→ Dispatcher
→ normalized rows
→ worker evaluation
→ Placement/Execution/Session
→ read API
→ UI result

Evidence:
- test names
- WSLC command
- HTTP response
- DB invariant query
- browser/device result
- commit SHA
```

## 14.3 停止条件

停止してよいのは次だけ。

1. repository accessが失われた
2.必要な本番Secretが存在せず外部providerの実送信だけが不可能
3. ユーザーの未コミット変更と同一行で、意図を保存した統合が論理的に不可能
4. GitHub/AWS/Google Play自体の障害

その場合も、可能な全実装とテストを終えてから、**止まっている1点だけ**を具体的に報告する。

---

# 15. 最終完了報告に必ず含めるもの

- core / web / androidのcommit SHA
- 変更ファイル一覧
- migration一覧
- WSLCで実行した全quality gate
- PostgreSQL integration test結果
- life schedule acceptance結果
- Web E2E結果
- Android unit/instrumentation結果
- core Actions run URL
- web Actions run URL
- Android internal release run URL
-本番health/ready結果
-作成したテスト勉強taskのtimeline結果
- Execution start/pause/resume/finishの実証
-通知受信の実証
-Decision回答と再配置の実証
-残存blockerがある場合は、その1点と必要なSecret/外部操作

以下の表現だけで完了報告してはならない。

```text
概ね完成
基盤は揃った
今後接続可能
UIは後続
通知は準備済み
テストは主要部分のみ
```

**ユーザーが2026年7月27日（月）から実際にテスト勉強へ使えるかどうか**を基準に、完成か未完成かを判断する。
