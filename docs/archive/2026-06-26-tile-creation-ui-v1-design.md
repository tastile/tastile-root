# QuickTileCreate v1 移行設計

- **Status**: Draft (awaiting user review)
- **Date**: 2026-06-26
- **Author**: brainstorming session with user
- **Scope**: `tastile-web` のタイル作成 UI (`QuickTileCreate`) を `tastile-core` v1 API に完全対応させ、v1 の全スキーマ (Tile / Plan / Recurring / Placement / Execution / Window / ChangeSet / Condition / Metric / Reference) を UI から制御可能にする。
- **Out of scope**: TileEdit (既存タイルの編集) / Read Model 同期 / Push 配送の UI / Decision Session UI (Phase D)。

## 1. 背景と目的

`tastile-core` は 2026-06-24 に v1 era へ移行し、4 つの Aggregate、数値定数のみ、Window 第一級、ChangeSet の Key 構造、Condition AST、3 レイヤー解決を採用した。`tastile-web` は依然として旧 v7 仕様の condition vectors モデル (7 condition layers) と `/commands/tile/create` 等の旧エンドポイントを使用しており、v1 で獲得した表現力の大半を UI 側から触れない状態が続いている。

### 設計の絶対条件

1. **v1 のみ動作**。v7 系のエンドポイント・型・モデル・ファイルを残さない。フラグ分岐・並行運用・旧版への切替は **一切作らない**
2. **既存 UI 構成 (BasePanel + SubPanel + 共通 Row コンポーネント群) は温存**。書き換えるのは「タイル作成パネルの内部」と「データ層と API 層」
3. **多層オーバーレイ・モデル** を採用 (visual 04-08)。サブパネルは「独立画面」ではなく「N 階層に重なる追加要件」。`[← 戻る]` のみで 1 段ずつ遡る
4. **キャンセル/保存ボタンは存在しない**。編集はライブで単一 Store に書き戻し、永続化は Layer 0 の [作成] ボタンのみが担う
5. **アイコン + 最小ラベル** 原則 (lucide-react)。画面内の説明文・ラベルは極小に抑え、placeholder・色・構造で状態を伝える
6. **`tastile-core` との通信層は v1 envelope に統一** (`expectedRevision` / `idempotencyKey` / `occurredAt` / `payload`)。`actor` はサーバ側決定
7. **数値定数のみ**。UI 内部で文字列 enum・kind discriminator を発散させない。`src/lib/domain/v1/constants.ts` に集約
8. **休憩・固定・学期中などの用途別フラグは作らない**。Window / Condition / Flow の組合せで表現 (v1/10 §10)

### 触って良いファイル / 触らないファイル

| 区分 | ファイル |
| --- | --- |
| 書き換え | `src/components/tiles/QuickTileCreate.tsx`, `src/components/tiles/build-command.ts`, `src/components/tiles/QuickTileCreate.test.tsx` |
| 削除 (旧 v7 系の SubPanel / Dialog) | `sub-panels/QuickTileAutomationSubPanel.tsx`, `sub-panels/QuickTileInterruptSubPanel.tsx`, `sub-panels/QuickTileMetaSubPanel.tsx`, `sub-panels/QuickTileRecurrenceSubPanel.tsx`, `dialogs/DeferTileDialog.tsx`, `dialogs/DeleteTileDialog.tsx`, `dialogs/RecurringTileConfigDialog.tsx`, `src/lib/domain/tile.ts` (condition vectors 定義) |
| 新規 | `src/lib/domain/v1/*` (数値定数 + Aggregate 型), `src/lib/api/v1-endpoints.ts` (v1 エンドポイント定義), `src/lib/stores/quick-create-store.ts` (QuickCreateStore), `src/components/tiles/sub-panels/v1/*` (5 + 5 SubPanel), `src/components/tiles/shared/icons.tsx` (lucide-react ラッパ) |
| 触らない | `src/components/ui/*` (FormRow / RowInput / RowSegmented / RowToggle / RowSubPanel は無変更で流用), `src/lib/daemon/id-token-client.ts`, `src/lib/i18n/*` (キー追加のみ) |

## 2. アーキテクチャ

### 2.1 全体像

```
QuickTileCreate (Layer 0)
├─ Layer 0 状態: QuickCreateStore (zustand, 単一ソース)
├─ Layer 0 表示: BasePanel (ZONE A/B/C/D)
├─ SubPanelStack: 現在開いている Layer のスタック
└─ 各 SubPanel は Layer 1〜N、Store に対して読み書き
```

- `Layer 0` (BasePanel) は常時表示。`ZONE A` コア入力、`ZONE B` サマリ + 簡易コントロール、`ZONE C` メタ、`ZONE D` 確定
- `Layer 1〜N` は BasePanel の上に重なる。`[←]` で 1 段ずつ上の Layer に戻る
- 全 Layer が同一 `QuickCreateStore` を購読する。編集はライブ反映

### 2.2 QuickCreateStore (zustand)

```
QuickCreateStore
├─ identity
│  ├─ title: string
│  ├─ kind: TileKind                (0=RECURRING / 1=PLACEMENT / 2=EXECUTION、display only)
│  ├─ externalId: { value: string | null }   ← UI ピッカーは別途 (source は v1 に存在しない)
│  └─ visual: { color: string, icon: string }
├─ plan
│  ├─ role: PlanRole                (0=EXECUTABLE / 1=LABEL)
│  ├─ completion: { rootKind: ConditionKind, timeReqs: TimeRequirement[], tasks: TaskDefinition[] }
│  ├─ references: PlanReference[]
│  ├─ planning: { placement: PlacementRule[], nesting: NestingRule[], flows: Flow[] }
│  ├─ metrics: Metric[]              (Phase C スコープ)
│  └─ decisions: Decision[]          (Phase D スコープ、未実装)
├─ time
│  ├─ span: { start: Instant | null, end: Instant | null, offsetMin: smallint }
│  └─ durationMinMax: { min: number | null, max: number | null }
├─ windows: Window[]
├─ recurring: { life: RecurringLife, frameRules: FrameRule[], recurringRules: RecurringRule[] }
├─ advanced
│  ├─ changeSets: ChangeSet[]
│  └─ rules: PlacementRule[]/NestingRule[]/Flow[]
├─ meta
│  ├─ project: string | null
│  ├─ tags: string[]
│  └─ memo: string
└─ submit: { state: 'idle'|'submitting'|'error', step: SubmitStep | null, error: ApiError | null }
   ※ SubmitStep: 'create-tile' | 'set-plan' | 'append-frames' | 'append-rules' | 'create-placement' | 'start-execution'
```

zustand の selector で「該当フィールドのみ再描画」を実現する。`buildCreateTileCommand(state)` は純粋関数で、`Submit` 時にこのスナップショットを v1 envelope に詰めて POST する。

### 2.3 Layer スタック

```ts
type Layer =
  | { kind: 'base' }
  | { kind: 'subpanel', id: 'plan' | 'completion' | 'references' | 'window' | 'frame-recurring', title: string }
  | { kind: 'editor', id: string, parent: string, title: string, breadcrumb: string[] }

const [layerStack, setLayerStack] = useState<Layer[]>([{ kind: 'base' }])
const currentLayer = layerStack[layerStack.length - 1]
const push = (l: Layer) => setLayerStack(prev => [...prev, l])
const pop = () => setLayerStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
```

- 同時に表示するのは **常に BasePanel + 現在の Layer のみ**。複数同時開は禁止
- `[×]` で QuickTileCreate 全体 close (= Layer 0 の `quick-create-store.isOpen = false`)。未保存編集は破棄される (これは許容: visual 07 §4)
- `[←]` で 1 段 pop。Layer 0 まで戻ったら `[×]` と同義

### 2.4 データフロー

```
[User 入力]
   │
   ▼
QuickCreateStore.setField(path, value)   (live)
   │
   ├─→ Zustand subscriber → 当該表示コンポーネント再描画
   │
   └─→ [作成] ボタン押下時:
         QuickCreateStore.submit()
            ├─ buildCreateTileCommandV1(snapshot)  (純粋関数)
            ├─ POST /v1/tiles (kind = snapshot.kind)
            │     ├─ 成功 → 続けて POST /v1/tiles/{id}/plan (role/completion/refs/planning)
            │     ├─ RECURRING なら POST /v1/recurrings/{id}/frames /rules
            │     ├─ PLACEMENT なら POST /v1/placements (source = MANUAL or RECURRING)
            │     └─ EXECUTION なら POST /v1/placements/{id}/executions
            ├─ ApiErrorKind 分岐 (visual 07 通り: STALE_REVISION / BLOCKED 等は表示)
            └─ 成功 → close(), refresh local cache via Sync API
```

- リクエスト数は kind で決まる: RECURRING → 4 リクエスト (tile / plan / frames / rules)、PLACEMENT → 2 リクエスト (tile / plan)、EXECUTION → 3 リクエスト (tile / plan + 既存 Placement からの start、Creation 時のみ 1 件追加)
- 途中で失敗したら部分成功を保存しない (v1/10 §4)。`submit.state = 'error'` + `submit.step` (失敗した段階) を表示
- `idempotencyKey` は submit 開始時に UUIDv7 で生成し、関連 4 リクエストすべてに同じキーを使う (v1/14 §1)

## 3. BasePanel (Layer 0) の構成

### 3.1 物理順序

```
┌──────────────────────────────────────────┐
│ [×]                                       │ ← Layer 0 ヘッダ (title 不要、× のみ)
├──────────────────────────────────────────┤
│ ZONE A: コア入力                          │
│   [✏️  Title                          ]   │ ← プレースホルダ主体
│   📅 [2026-06-26 14:00] 〜 [15:00]        │ ← ScheduleRow
│   ⏱  [25] 分 〜 [60] 分                  │ ← DurationRow (Range, 片側 null 可)
├──────────────────────────────────────────┤
│ ZONE B: サマリ + 簡易コントロール         │
│   🔖 [EXECUTABLE ▼]          ← role 切替 (ラベルオンリーと双方向同期) │
│   🎨 ●━━━━━━                 ← visual.color ピッカー                │
│   🎯 ALL: 4h + 2              ← completion root サマリ              │
│   🔗 3                        ← refs 件数バッジ                    │
│   🪟 学期中・平日 19-22       ← window サマリ                        │
│   🔁 毎週月 19:00             ← recurring サマリ                     │
│   ▸ Advanced                  ← ChangeSet / Metric / Rules への導線 │
│   (各行タップ → Layer 1 該当 SubPanel)                              │
├──────────────────────────────────────────┤
│ ZONE C: メタ                              │
│   🗂 [project      ] 🏷 [#tag ×] [+      ]  │
│   💬 [memo                              ]   │
├──────────────────────────────────────────┤
│ ZONE D: 確定                              │
│   ── divider ──                            │
│   🔖 ラベルオンリー  ○━━●                  │ ← PlanRole と双方向同期
│   ┌──────────────────────────────┐        │
│   │            [作成]              │        │
│   └──────────────────────────────┘        │
│   ⚠ error (kind → 日本語メッセージ)        │
└──────────────────────────────────────────┘
```

### 3.2 ゾーンの責務境界

- **ZONE A**: `identity.title`, `time.span`, `time.durationMinMax`。**常時編集可能**
- **ZONE B**: 各 SubPanel へのサマリ + 頻出パラメータのみインライン編集可能。**クリックで Layer 1 を開く導線**を併設。簡易コントロールの内容変更は対応する SubPanel を開く必要なし
- **ZONE C**: project / tags / memo。**常時編集可能**
- **ZONE D**: ラベルオンリー トグル + 作成ボタン + エラー。**PlanRole は ZONE B の kind/role と同期**

「(ZONE B と SubPanel で) 同じパラメータが存在する」のは **仕様** (visual 05 確認済み)。片方を変えれば他方はライブ反映される。

### 3.3 アイコン + 最小ラベル原則

- **ラベル文字列ゼロが理想**。`RowInput` の `placeholder` のみで用法を伝える
- 5 文字超のラベルは禁止。1〜3 単語 (日本語なら 2〜6 文字) 以内
- アイコン体系 (lucide-react) は §6 に集約
- 状態は **色 + アイコン + 1 語** で表現
- 注釈文 (「(= BasePanel と同期)」など) は画面に出さない。Storybook テストで担保

## 4. SubPanel (Layer 1〜N) 一覧

### 4.1 5 + N の SubPanel

| ID | 開く導線 (ZONE B) | 中身 | 子の Layer |
| --- | --- | --- | --- |
| `plan` | 🔖 / 🎨 | Tile.kind / Plan.role / visual / externalId / timezone → offset_min | (なし) |
| `completion` | 🎯 | root 合成プレビュー (ALL/ANY/NOT), TimeRequirement[], TaskDefinition[] | `time-req` (TimeRequirement 編集), `task` (TaskDefinition 編集), `condition` (Condition AST) |
| `references` | 🔗 | PlanReference[] 一覧 | `reference-picker` (Reference 種別選択) |
| `window` | 🪟 | Window[] 一覧 | `window-editor` (Window 編集) |
| `frame-recurring` | 🔁 | RecurringLife, FrameRule[] (Step / Reference / Calendar / Transform), RecurringRule[] (when/rank/outputs) | `frame-rule`, `recurring-rule`, `condition` |
| `advanced` | ▸ Advanced | ChangeSet[] / Metric[] / Rule[] | `change-editor`, `metric-editor` (ScalarExpr ビルダ), `rule-editor` |

`advanced` は「⑤ の内側」ではなく独立 RowSubPanel として並べる (visual 04 §2 のフィードバック反映)。

### 4.2 各 SubPanel の物理レイアウト

```
┌────────────────────────────────────────┐
│ [←]  Plan                      [×]    │ ← SubPanelHeader (既存流用)
├────────────────────────────────────────┤
│ Kind   ┌────┐┌────┐┌────┐              │
│        │ 🔁 ││ 📅 ││ ▶  │              │
│        │Recu││Plc ││Exe │              │ ← セグメント (アイコン + 極小)
│        └────┘└────┘└────┘              │
│ Role   [EXECUTABLE ▼]                  │ ← ドロップダウン (4 文字以内)
│ Color  ●━━━━━━━                       │
│ Icon   [sun ▼]                          │
│ ExtID  [src ▼] [id value          ]    │
│ TZ     [Asia/Tokyo ▼]                   │
└────────────────────────────────────────┘
```

- 1 フィールド 1 行
- ラベルは省略または極小 (4 文字以内)
- RowInput / RowSegmented / RowToggle を無変更で流用

### 4.3 Condition AST ビルダ (Layer N)

```
┌──────────────────────────────────────┐
│ [←]  Condition               [×]    │
├──────────────────────────────────────┤
│ Kind [ALL ▼]                          │
│         ┌─────────────────────────┐  │
│         │ [ALL]                    │  │
│         │  ├─ ⏱ TimeRequirement #0 │  │
│         │  │   [編集]              │  │
│         │  ├─ ☑ TaskDefinition #1   │  │
│         │  │   [編集]              │  │
│         │  └─ [+ 子条件]           │  │
│         └─────────────────────────┘  │
│ [+ 必要時間を追加]                    │
│ [+ Task を追加]                       │
└──────────────────────────────────────┘
```

- 10 種 Term (CalendarTerm / MomentTerm / RelationTerm / GapTerm / TaskTerm など v1/05) は Term 追加時に選択モーダル (placeholder 主体)
- 循環禁止 (v1/13): 既に祖先にある Condition は子に選べない
- AST は内部的に `{ kind: 'ALL'|'ANY'|'NOT'|'TERM', children: Node[] }` で表現

## 5. v1 API 通信層

### 5.1 エンドポイント (v1 のみ)

| Method | Path | 用途 | コマンド kind |
| --- | --- | --- | --- |
| `POST` | `/v1/tiles` | Tile 新規作成 | `CREATE_TILE` |
| `POST` | `/v1/tiles/{tileId}/plan` | Plan 設定 | `SET_PLAN` |
| `POST` | `/v1/recurrings/{recurringId}/frames` | FrameRule 追加 | `APPEND_FRAMES` |
| `POST` | `/v1/recurrings/{recurringId}/rules` | RecurringRule 追加 | `APPEND_RULES` |
| `POST` | `/v1/placements` | Placement 新規作成 | `CREATE_PLACEMENT` |
| `POST` | `/v1/placements/{placementId}/changes` | ChangeSet 追加 | `APPEND_CHANGES` |
| `POST` | `/v1/placements/{placementId}/executions` | Execution 開始 | `START_EXECUTION` |
| `POST` | `/v1/executions/{executionId}/pause` | 一時停止 | `PAUSE_EXECUTION` |
| `POST` | `/v1/executions/{executionId}/resume` | 再開 | `RESUME_EXECUTION` |
| `POST` | `/v1/executions/{executionId}/finish` | 終了 | `FINISH_EXECUTION` |
| `GET` | `/v1/tiles` | タイル一覧 | (Read) |
| `GET` | `/v1/placements` | Placement 一覧 | (Read) |
| `GET` | `/v1/timeline` | Timeline (Effective のみ) | (Read) |
| `GET` | `/v1/sync?since={cursor}` | Sync | (Read) |

`endpoints.ts` を全面書き換え。v7 系の path・関数・型は **存在自体を削除**。

### 5.2 Envelope (v1/14 §1)

```ts
interface CommandRequest<T> {
  expectedRevision: number | null
  idempotencyKey: string  // UUIDv7
  occurredAt: string      // ISO-8601, server-side override
  payload: T
}

interface CommandResponse {
  commandId: string
  acceptedAt: string
  aggregate: { kind: number, id: string } | null  // AggregateKind
  revision: number | null
  result: number  // CommandResult: 0=APPLIED / 1=ALREADY_APPLIED / 2=ACCEPTED
  pending: PendingWork[]
}

interface ApiError {
  kind: number  // ApiErrorKind 0..7
  message: string
  currentRevision: number | null
  violations: ResolutionViolation[]
}
```

`ApiErrorKind` の数値定数は §6 の集約テーブルに従い、`src/lib/domain/v1/constants.ts` から import。

### 5.3 送信フロー

```ts
async function submitQuickCreate(store: QuickCreateStore) {
  store.submit = { state: 'submitting', error: null }
  const idempotencyKey = uuidv7()
  try {
    // 1. CREATE_TILE
    const tileRes = await postV1('/v1/tiles', {
      expectedRevision: null,
      idempotencyKey,
      occurredAt: nowIso(),
      payload: {
        kind: state.kind,
        title: state.title,
        visual: state.visual,
        externalId: state.externalId,
      }
    })
    const tileId = tileRes.aggregate!.id

    // 2. SET_PLAN
    await postV1(`/v1/tiles/${tileId}/plan`, {
      expectedRevision: tileRes.revision,
      idempotencyKey,
      occurredAt: nowIso(),
      payload: {
        role: state.plan.role,
        references: state.plan.references,
        completion: state.plan.completion,
        planning: state.plan.planning,
      }
    })

    // 3. kind 別追加
    if (state.kind === 0 /* RECURRING */) {
      await postV1(`/v1/recurrings/${tileId}/frames`, ...)
      await postV1(`/v1/recurrings/${tileId}/rules`, ...)
    }
    if (state.kind === 1 /* PLACEMENT */) {
      await postV1('/v1/placements', {
        payload: {
          tileId,
          source: 0, // MANUAL
          span: state.time.span,
        }
      })
    }
    if (state.kind === 2 /* EXECUTION */) {
      await postV1(`/v1/placements/${state.placementId}/executions`, ...)
    }

    store.submit = { state: 'idle', error: null }
    store.close()
    queryClient.invalidateQueries(['tiles'])
  } catch (e: ApiError) {
    store.submit = { state: 'error', error: e }
  }
}
```

### 5.4 エラーハンドリング (ApiErrorKind 分岐)

| kind | 数値 | UI 表示 |
| --- | --- | --- |
| `VALIDATION` | 0 | フィールド下に赤帯 (invalidField highlight) |
| `FORBIDDEN` | 1 | 「権限がありません」 + フォームは維持 |
| `STALE_REVISION` | 2 | 「他で変更されました。再読み込みしますか?」 |
| `IDEMPOTENCY_KEY_REUSED` | 3 | 内部エラー。再送不可 (バグ報告導線) |
| `NOT_FOUND` | 4 | 「対象が見つかりません」 + フォーム閉じる |
| `CONFLICT` | 5 | 「競合しています」 + ChangeSet 競合は violations 展開 |
| `BLOCKED` | 6 | 「現在状態では実行できません」 + violations 展開 |
| `RETRYABLE` | 7 | 自動 1 回リトライ + 失敗ならエラー表示 |

## 6. 数値定数 & 型集約 (`src/lib/domain/v1/`)

### 6.1 ディレクトリ構造

```
src/lib/domain/v1/
├─ constants.ts         # 数値定数 (v1 HARNESS の集約テーブル全部)
├─ tile.ts              # Tile / Plan / Recurring 型
├─ placement.ts         # Placement / Span 型
├─ execution.ts         # Execution / ExecutionSegment 型
├─ window.ts            # Window 型
├─ change-set.ts        # ChangeSet / Key / MergeMode 型
├─ condition.ts         # Condition AST / Term 10 種型
├─ completion.ts        # TimeRequirement / TaskDefinition 型
├─ metric.ts            # Metric / ScalarExpr 型
├─ reference.ts         # PlanReference / ReferencePicker 4 種別型
├─ actor.ts             # ActorKind
├─ command.ts           # CommandRequest / CommandResponse / ApiError
└─ envelope.ts          # uuidv7(), nowIso() 等のヘルパ + payload ビルダ
```

`src/lib/domain/v1/constants.ts` は v1/HARNESS.md の集約テーブルをそのまま TS 化する。**散在禁止**。テストで `TileKind.RECURRING === 0` を検証。

### 6.2 アイコン体系 (`src/components/tiles/shared/icons.tsx`)

lucide-react から再エクスポート。alias を統一して v1 概念に紐付ける。

| v1 概念 | ラッパ名 | lucide 実体 | 用途 |
| --- | --- | --- | --- |
| Tile / タイトル | `<TitleIcon>` | `FileText` | 自由記述の主要入力 |
| 開始/終了 | `<ScheduleIcon>` | `Calendar` | Span |
| 時間 | `<DurationIcon>` | `Clock` | Range |
| Plan / ラベル | `<PlanIcon>` | `Bookmark` | role / 参照 |
| 色 | `<ColorIcon>` | `Palette` | visual.color |
| 参照件数 | `<RefIcon>` | `LinkIcon` | references |
| 完了条件 | `<CompletionIcon>` | `Target` | Completion.root |
| Window | `<WindowIcon>` | `AppWindow` | 適用中 Window |
| 繰り返し | `<RecurringIcon>` | `Repeat` | RecurringState |
| Recurring.kind=RECURRING | `<RecurringKindIcon>` | `Repeat` | Tile.kind |
| Recurring.kind=PLACEMENT | `<PlacementKindIcon>` | `CalendarPlus` | Tile.kind |
| Recurring.kind=EXECUTION | `<ExecutionKindIcon>` | `Play` | Tile.kind |
| externalId | `<ExternalIdIcon>` | `Plug` | 外部連携 ID |
| Condition | `<ConditionIcon>` | `GitBranch` | AST |
| CalendarTerm | `<CalendarTermIcon>` | `CalendarDays` | Term |
| MomentTerm | `<MomentTermIcon>` | `AlarmClock` | Term |
| RelationTerm | `<RelationTermIcon>` | `Link2` | Term |
| GapTerm | `<GapTermIcon>` | `Ruler` | Term |
| RequirementTerm | `<RequirementTermIcon>` | `BarChart3` | Term |
| TaskTerm | `<TaskTermIcon>` | `CheckSquare` | Term |
| FactTerm | `<FactTermIcon>` | `Pin` | Term |
| MetricTerm | `<MetricTermIcon>` | `TrendingUp` | Term |
| FeedbackTerm | `<FeedbackTermIcon>` | `ThumbsUp` | Term |
| LifeTerm | `<LifeTermIcon>` | `Activity` | Term |
| TimeRequirement | `<TimeReqIcon>` | `BarChart3` | TimeObservation |
| Task | `<TaskIcon>` | `CheckSquare` | TaskDefinition |
| Metric | `<MetricIcon>` | `TrendingUp` | ScalarExpr |
| Flow | `<FlowIcon>` | `Waves` | Flow |
| Rule | `<RuleIcon>` | `Scale` | PlacementRule / NestingRule |
| ChangeSet | `<ChangeIcon>` | `Wrench` | ChangeSet |
| ChangeKind.SET | `<ChangeSetIcon>` | `Wrench` | SET |
| ChangeKind.CLEAR | `<ChangeClearIcon>` | `Eraser` | CLEAR |
| ChangeKind.PUT | `<ChangePutIcon>` | `Pencil` | PUT |
| ChangeKind.DROP | `<ChangeDropIcon>` | `Trash2` | DROP |
| Frame | `<FrameIcon>` | `Frame` | FrameRule |
| FrameRule.Step | `<FrameStepIcon>` | `SkipForward` | StepGenerator |
| FrameRule.Reference | `<FrameRefIcon>` | `Anchor` | ReferenceGenerator |
| FrameRule.Calendar | `<FrameCalIcon>` | `Calendar` | CalendarGenerator |
| FrameRule.Transform | `<FrameTransIcon>` | `RefreshCw` | TransformGenerator |
| Exec / Pause / Resume / Finish | `<ExecIcon>` 等 | `Play` / `Pause` / `Play` / `Square` | Execution |
| Project | `<ProjectIcon>` | `FolderOpen` | project タグ |
| Tags | `<TagIcon>` | `Tag` | タグ |
| Memo | `<MemoIcon>` | `MessageSquare` | メモ |
| エラー | `<ErrorIcon>` | `AlertCircle` | submit エラー |
| Close | `<CloseIcon>` | `X` | × ボタン |
| Back | `<BackIcon>` | `ChevronLeft` | ← ボタン |

## 7. アクセシビリティ (WCAG 2.2 AA)

- コントラスト比: 本文 4.5:1、UI 3:1 (Tailwind 既定の `--foreground` / `--foreground-muted` で担保)
- タッチ/クリックターゲット: icon-only ボタンは **最低 40×40 px** (`h-10 w-10` 以上)。視覚アイコンは 16-20 px
- スクリーンリーダー: すべての icon-only ボタンに `aria-label` (i18n キー経由)
- 意味的役割: icon-only Segmented / Toggle は `role="radiogroup"` / `role="switch"`
- フォーカス順序: ZONE A → ZONE B → ZONE C → ZONE D。SubPanel は開いた瞬間に最初の入力にフォーカス
- `prefers-reduced-motion`: SubPanel の slide-in を 0 に縮退
- キーボードショートカット: `Cmd/Ctrl+Enter` で [作成] 発火。`Esc` で現在の Layer を 1 段閉じる (Layer 0 なら QuickTileCreate 全体 close)

## 8. テスト戦略

### 8.1 ユニット (Vitest)

| 対象 | 確認内容 |
| --- | --- |
| `constants.ts` | `TileKind.RECURRING === 0`、`PlanRole.LABEL === 1` 等 v1/HARNESS.md 集約テーブル全件 (約 73 個) |
| `envelope.ts` | `buildCreateTileCommandV1` のスナップショットが正しいパスにマッピング |
| `QuickCreateStore` | setField → 購読コンポーネント再描画、submit 失敗時の error 状態 |
| `Condition AST builder` | 循環禁止、Term 10 種全部選択可能、root 合成プレビュー |
| `ApiError` 分岐 | 8 kind すべてが UI メッセージに正しく変換される |
| `buildCreateTileCommandV1` | 各 kind (RECURRING/PLACEMENT/EXECUTION) 別ペイロードの差分 |

### 8.2 コンポーネント (Vitest + Testing Library)

| テスト | 確認内容 |
| --- | --- |
| `BasePanel` | ZONE A〜D が正しい順序で描画、kind/role 双方向同期、ラベルオンリートグル動作 |
| `PlanSubPanel` | セグメント 3 種切替、externalId ドロップダウン、offset_min 算出 |
| `CompletionSubPanel` | root プレビュー、TimeRequirement 追加、Task 追加、子 Layer への遷移 |
| `ReferencesSubPanel` | 4 種別 (Tile / Series / Filter / Context) ピッカー動作 |
| `WindowSubPanel` | Window 追加・編集・削除、bounds Span 編集 |
| `FrameRecurringSubPanel` | RecurringLife 状態、FrameRule 4 種追加、RecurringRule when 編集 |
| `AdvancedSubPanel` | ChangeSet (4 kind) 追加、Metric (ScalarExpr) 編集、Rule (3 種) 追加 |
| `LayerStack` | push / pop / base 保護、`[←]` で 1 段戻る |
| `Submit` | 正常系・全 8 エラー kind での表示 |

### 8.3 結合テスト

- 5 種 SubPanel を順に開いて全フィールド入力 → 作成ボタン → モック `/v1/tiles` へのリクエストスナップショット一致
- 深い階層 (Condition AST 3 段) の編集が QuickCreateStore にライブ反映
- Layer 0 の [×] で編集中破棄される
- レンダリング: 画面内に説明文ラベル (`(= BasePanel と同期)` 等) が **含まれていない** を textContent で検証

### 8.4 E2E (実環境)

- ローカル: `bun dev` で `tastile-core` ローカル daemon を立てて Chrome DevTools MCP で実機確認
- 5 フロー: RECURRING 作成 / PLACEMENT 作成 / EXECUTION 作成 / LABEL 作成 / 全 8 エラーパスの表示確認
- v1 envelope (`idempotencyKey` UUIDv7 形式 / `expectedRevision` 数値 / `occurredAt` ISO-8601) が wire 上で正しいことを `chrome-devtools__list_network_requests` で確認

## 9. ファイル変更計画

### 9.1 削除

| ファイル | 理由 |
| --- | --- |
| `src/lib/api/endpoints.ts` | v7 系の path を含み、全面 v1 化するため削除 |
| `src/lib/domain/tile.ts` | condition vectors モデル → v1 Tile 集約に置換 |
| `src/components/tiles/sub-panels/QuickTileAutomationSubPanel.tsx` | v1 に同等概念なし (delivery/session は Phase D) |
| `src/components/tiles/sub-panels/QuickTileInterruptSubPanel.tsx` | v1 に「interrupt」概念なし、PlacementRule/Metric に分解 |
| `src/components/tiles/sub-panels/QuickTileMetaSubPanel.tsx` | タグ/プロジェクト/メモは BasePanel ZONE C に統合 |
| `src/components/tiles/sub-panels/QuickTileRecurrenceSubPanel.tsx` | Recurring 概念を ⑤ + Advanced に分割 |
| `src/components/tiles/dialogs/DeferTileDialog.tsx` | Defer は v1 ChangeSet + Placement で表現 |
| `src/components/tiles/dialogs/DeleteTileDialog.tsx` | 別 UI スコープ (TileEdit と同時) |
| `src/components/tiles/dialogs/RecurringTileConfigDialog.tsx` | ⑤ に統合 |

### 9.2 新規

```
src/lib/domain/v1/
├─ constants.ts
├─ tile.ts
├─ placement.ts
├─ execution.ts
├─ window.ts
├─ change-set.ts
├─ condition.ts
├─ completion.ts
├─ metric.ts
├─ reference.ts
├─ actor.ts
├─ command.ts
└─ envelope.ts

src/lib/api/
└─ v1-endpoints.ts                          # v1 専用 (旧 endpoints.ts は削除)

src/lib/stores/
└─ quick-create-store.ts                    # QuickCreateStore (zustand)

src/components/tiles/
├─ QuickTileCreate.tsx                      # 全面書き換え
├─ build-command.ts                         # buildCreateTileCommandV1 へ全面書き換え
├─ QuickTileCreate.test.tsx                 # 全面書き換え
├─ shared/
│  └─ icons.tsx                             # lucide-react ラッパ
└─ sub-panels/
   ├─ SubPanelHeader.tsx                    # 既存無変更 (props が title 任意のため)
   ├─ QuickTilePlanSubPanel.tsx
   ├─ QuickTileCompletionSubPanel.tsx
   ├─ QuickTileReferencesSubPanel.tsx
   ├─ QuickTileWindowSubPanel.tsx
   ├─ QuickTileFrameRecurringSubPanel.tsx
   ├─ QuickTileAdvancedSubPanel.tsx
   ├─ ConditionAstBuilder.tsx
   ├─ FrameRuleEditor.tsx
   ├─ RecurringRuleEditor.tsx
   ├─ WindowEditor.tsx
   ├─ ReferencePicker.tsx
   ├─ ChangeEditor.tsx
   ├─ MetricEditor.tsx
   └─ ScalarExprBuilder.tsx
```

### 9.3 変更

| ファイル | 変更内容 |
| --- | --- |
| `src/components/tiles/QuickTileCreate.tsx` | BasePanel Layer 0 実装。useState ではなく `useQuickCreateStore` から subscribe |
| `src/components/tiles/build-command.ts` | `QuickCreateFormState` → `QuickCreateStore` 読込。`buildCreateTileCommandV1(snapshot)` 純粋関数化 |
| `src/lib/stores/quick-create-store.ts` | 新規 (quick-create-store.ts) |
| `src/lib/i18n/ja.ts`, `en.ts` | 新規 SubPanel / Condition AST 用 i18n キー追加 (placeholder 主体) |

## 10. リスク TOP 3

| リスク | 緩和 |
| --- | --- |
| 旧 endpoints.ts の削除により、旧 UI からの参照が build エラーになる | grep で全使用箇所 (`from "@/lib/api/endpoints"`) を `v1-endpoints` に置換。テストフェーズで再走。**旧 v7 への参照が残っていない** ことも grep で確認 |
| Condition AST ビルダ (Layer 3+) で循環禁止実装が複雑化 | v1/13 §「Task 順序は循環禁止」のテストケースを 100% 移植。AST builder に cycle detection を入れる |
| Layer スタックの `[←]` ナビゲーションが深い場合に focus 管理が崩れる | SubPanel を開いた瞬間に最初の `RowInput` に autofocus、戻る時は Layer N-1 の最初の `RowInput` に戻す。`prefers-reduced-motion` で transition を縮退 |

### ロールバック

- **Git**: `git revert <merge-commit>` 一発で v7 系の旧エンドポイント・旧 Tile モデルへ戻せる (v7 系のコードが archive 扱いなら `git revert` で復活)
- **フラグ分岐**: **導入しない**。v7 残置禁止のため、フラグ経由の切替も禁止
- **部分ロールバック**: SubPanel 単位で実装するため、Problem の SubPanel のみ revert 可能 (他 SubPanel は無傷)

## 11. 受け入れ条件

実装完了とみなす条件:

1. v1 集約 4 種すべてが UI から作成可能 (RECURRING / PLACEMENT / EXECUTION / LABEL)
2. 数値定数 73 個すべてが `constants.ts` に集約され、散在していない
3. BasePanel + 6 SubPanel (Plan/Completion/References/Window/FrameRecurring/Advanced) + 9 Editor の 16 コンポーネントが描画可能
4. Layer スタック push/pop が `[←]` `[×]` で正しく動作
5. submit 時に v1 envelope 形式で kind 別 2〜4 リクエストが送信される
6. ApiErrorKind 8 種すべてが UI メッセージに分岐する
7. Vitest ユニット・コンポーネント全件 pass
8. `bun run build` 通過
9. 画面内に「(○○と同期)」のような注釈文ラベルが **含まれていない** を textContent テストで検証
10. Chrome DevTools MCP で実環境 E2E (RECURRING/PLACEMENT/EXECUTION/LABEL 作成フロー + 8 エラーケース) を確認

## 12. オープン項目 (将来フェーズ)

- TileEdit (既存タイル編集) の v1 化 — 同 Layer モデル流用
- Push / WebPush / Email 配送 UI (Phase D)
- Decision Session UI (Phase D)
- Metric 高度可視化 (Phase C)
- Flow エディタ (Phase B 後)
- Condition AST の AND/OR ビジュアル化 (ツリー → グラフ)
- Layer N+1 プリフェッチ (深い階層の Layer 3 を開いた瞬間に Layer 4 の先読み)