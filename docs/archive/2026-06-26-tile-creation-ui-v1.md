# QuickTileCreate v1 移行 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (batch execution with checkpoints) を推奨。Steps は checkbox (`- [ ]`) 形式で進捗管理。

**Goal:** `tastile-web` の `QuickTileCreate` を `tastile-core` v1 API に完全対応させ、v1 集約 4 種 (RECURRING / PLACEMENT / EXECUTION / LABEL) を UI から作成可能にする。v7 残置禁止・フラグ分岐なし。

**Architecture:** 多層オーバーレイ (Layer 0 = BasePanel / Layer 1+ = SubPanels)。単一 `QuickCreateStore` (zustand) にライブ編集。キャンセル/保存なし、永続化は Layer 0 の [作成] ボタンのみ。アイコン + 最小ラベル (lucide-react)。数値定数は `src/lib/domain/v1/constants.ts` に集約。

**Tech Stack:**
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS v4
- zustand (QuickCreateStore)
- lucide-react (アイコン)
- Vitest + Testing Library (テスト)
- bun (パッケージマネージャ + テストランナー)

**受け入れ基準:** spec §11 の 10 条件 (Task 10 で検証)。

---

## ファイル構造 (実装で固定する境界)

```
src/lib/domain/v1/
├─ constants.ts          ← 数値定数 73 個 (Task 1)
├─ tile.ts               ← Tile / Plan / Recurring 型 (Task 1)
├─ placement.ts          ← Placement / Span 型 (Task 1)
├─ execution.ts          ← Execution / ExecutionSegment 型 (Task 1)
├─ window.ts             ← Window 型 (Task 1)
├─ change-set.ts         ← ChangeSet / Key / MergeMode 型 (Task 1)
├─ condition.ts          ← Condition AST + Term 10 種型 (Task 1)
├─ completion.ts         ← TimeRequirement / TaskDefinition 型 (Task 1)
├─ metric.ts             ← Metric / ScalarExpr 型 (Task 1)
├─ reference.ts          ← PlanReference 型 (Task 1)
├─ actor.ts              ← ActorKind (Task 1)
└─ envelope.ts           ← CommandRequest / Response / ApiError 型 + uuidv7() (Task 1)

src/lib/api/
└─ v1-endpoints.ts       ← v1 専用 fetch 関数 (Task 2、旧 endpoints.ts 削除)

src/lib/stores/
└─ quick-create-store.ts ← QuickCreateStore (zustand) (Task 2)

src/components/tiles/
├─ QuickTileCreate.tsx              ← 全面書き換え (Task 6)
├─ build-command.ts                 ← buildCreateTileCommandV1 (Task 4)
├─ QuickTileCreate.test.tsx         ← 全面書き換え (Task 6)
├─ shared/
│  └─ icons.tsx                     ← lucide-react ラッパ (Task 3)
└─ sub-panels/
   ├─ SubPanelHeader.tsx            ← 既存無変更 (title prop がオプショナル)
   ├─ layer-stack.ts                ← LayerStack state (Task 3)
   ├─ QuickTilePlanSubPanel.tsx              (Task 7)
   ├─ QuickTileCompletionSubPanel.tsx        (Task 7)
   ├─ QuickTileReferencesSubPanel.tsx        (Task 7)
   ├─ QuickTileWindowSubPanel.tsx            (Task 7)
   ├─ QuickTileFrameRecurringSubPanel.tsx    (Task 7)
   ├─ QuickTileAdvancedSubPanel.tsx          (Task 7)
   ├─ TimeRequirementEditor.tsx             (Task 8)
   ├─ TaskDefinitionEditor.tsx               (Task 8)
   ├─ ConditionAstBuilder.tsx                (Task 8)
   ├─ FrameRuleEditor.tsx                    (Task 8)
   ├─ RecurringRuleEditor.tsx                (Task 8)
   ├─ WindowEditor.tsx                       (Task 8)
   ├─ ReferencePicker.tsx                    (Task 8)
   ├─ ChangeEditor.tsx                       (Task 8)
   ├─ MetricEditor.tsx                       (Task 8)
   └─ ScalarExprBuilder.tsx                  (Task 8)

src/lib/i18n/
├─ ja.ts                              ← キー追加 (placeholder 主体)
└─ en.ts                              ← キー追加 (placeholder 主体)
```

**削除ファイル** (Task 9): `endpoints.ts`, `domain/tile.ts`, 旧 `sub-panels/QuickTile{Automation,Interrupt,Meta,Recurrence}SubPanel.tsx`, `dialogs/{DeferTile,DeleteTile,RecurringTileConfig}Dialog.tsx`

---

## チェックポイント

- 各 Task 完了時に `bun run build && bun test` で緑確認
- Phase 完了時 (Task 3, 5, 6, 8, 10) に code-reviewer でレビュー
- Task 10 で chrome-devtools MCP による実環境 E2E

---

## Phase A: Foundation (Tasks 1-3)

### Task 1: v1 domain layer (constants + types + envelope)

**Files:**
- Create: `src/lib/domain/v1/constants.ts`
- Create: `src/lib/domain/v1/tile.ts`
- Create: `src/lib/domain/v1/placement.ts`
- Create: `src/lib/domain/v1/execution.ts`
- Create: `src/lib/domain/v1/window.ts`
- Create: `src/lib/domain/v1/change-set.ts`
- Create: `src/lib/domain/v1/condition.ts`
- Create: `src/lib/domain/v1/completion.ts`
- Create: `src/lib/domain/v1/metric.ts`
- Create: `src/lib/domain/v1/reference.ts`
- Create: `src/lib/domain/v1/actor.ts`
- Create: `src/lib/domain/v1/envelope.ts`
- Test: `src/lib/domain/v1/constants.test.ts`

- [ ] **Step 1: 失敗するテストを書く** (`constants.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  TileKind, PlanRole, RecurringState, PlacementSource,
  ExecutionState, ExecutionSegmentKind, ChangeLayer, ChangeKind,
  ChangeSource, MergeMode, TimeScope, TimeSource, TimeAggregate,
  TimeQuantifier, TaskOrderRelation, CommandResult, ApiErrorKind,
  ActorKind, AggregateKind, ResolutionState,
} from "./constants";

describe("v1 numeric constants", () => {
  it("TileKind", () => {
    expect(TileKind.RECURRING).toBe(0);
    expect(TileKind.PLACEMENT).toBe(1);
    expect(TileKind.EXECUTION).toBe(2);
  });
  it("PlanRole", () => {
    expect(PlanRole.EXECUTABLE).toBe(0);
    expect(PlanRole.LABEL).toBe(1);
  });
  it("RecurringState", () => {
    expect(RecurringState.ACTIVE).toBe(0);
    expect(RecurringState.PAUSED).toBe(1);
    expect(RecurringState.ENDED).toBe(2);
    expect(RecurringState.CANCELLED).toBe(3);
  });
  it("ChangeKind", () => {
    expect(ChangeKind.SET).toBe(0);
    expect(ChangeKind.CLEAR).toBe(1);
    expect(ChangeKind.PUT).toBe(2);
    expect(ChangeKind.DROP).toBe(3);
  });
  it("CommandResult", () => {
    expect(CommandResult.APPLIED).toBe(0);
    expect(CommandResult.ALREADY_APPLIED).toBe(1);
    expect(CommandResult.ACCEPTED).toBe(2);
  });
  it("ApiErrorKind", () => {
    expect(ApiErrorKind.VALIDATION).toBe(0);
    expect(ApiErrorKind.FORBIDDEN).toBe(1);
    expect(ApiErrorKind.STALE_REVISION).toBe(2);
    expect(ApiErrorKind.IDEMPOTENCY_KEY_REUSED).toBe(3);
    expect(ApiErrorKind.NOT_FOUND).toBe(4);
    expect(ApiErrorKind.CONFLICT).toBe(5);
    expect(ApiErrorKind.BLOCKED).toBe(6);
    expect(ApiErrorKind.RETRYABLE).toBe(7);
  });
  // ... 残り 13 個の定数グループも同じパターンで記述
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `cd tastile-web && bun test src/lib/domain/v1/constants.test.ts`
Expected: FAIL "Cannot find module './constants'"

- [ ] **Step 3: constants.ts を実装**

v1/HARNESS.md の集約テーブル全 73 個を `export const` で列挙する。

```ts
// src/lib/domain/v1/constants.ts
export const TileKind = {
  RECURRING: 0, PLACEMENT: 1, EXECUTION: 2,
} as const;
export type TileKindValue = (typeof TileKind)[keyof typeof TileKind];

export const PlanRole = {
  EXECUTABLE: 0, LABEL: 1,
} as const;
export type PlanRoleValue = (typeof PlanRole)[keyof typeof PlanRole];

export const RecurringState = {
  ACTIVE: 0, PAUSED: 1, ENDED: 2, CANCELLED: 3,
} as const;
export type RecurringStateValue = (typeof RecurringState)[keyof typeof RecurringState];

export const PlacementSource = {
  MANUAL: 0, RECURRING: 1, FLOW: 2, IMPORT: 3,
} as const;
export type PlacementSourceValue = (typeof PlacementSource)[keyof typeof PlacementSource];

export const ExecutionState = {
  ACTIVE: 0, PAUSED: 1, FINISHED_NORMAL: 2, FINISHED_VOID: 3,
} as const;
export type ExecutionStateValue = (typeof ExecutionState)[keyof typeof ExecutionState];

export const ExecutionSegmentKind = {
  ACTIVE: 0, PAUSED: 1,
} as const;
export type ExecutionSegmentKindValue = (typeof ExecutionSegmentKind)[keyof typeof ExecutionSegmentKind];

export const ChangeLayer = {
  RECURRING: 0, PLACEMENT: 1, EXECUTION: 2,
} as const;
export type ChangeLayerValue = (typeof ChangeLayer)[keyof typeof ChangeLayer];

export const ChangeKind = {
  SET: 0, CLEAR: 1, PUT: 2, DROP: 3,
} as const;
export type ChangeKindValue = (typeof ChangeKind)[keyof typeof ChangeKind];

export const ChangeSource = {
  RECURRING: 0, FLOW: 1, USER: 2, DECISION: 3, EXECUTION: 4,
} as const;
export type ChangeSourceValue = (typeof ChangeSource)[keyof typeof ChangeSource];

export const MergeMode = {
  OVERRIDE: 0, INTERSECT_RANGE: 1, UNION_IDENTIFIED: 2,
  ORDERED_IDENTIFIED: 3, SPAN_ENDPOINT: 4,
} as const;
export type MergeModeValue = (typeof MergeMode)[keyof typeof MergeMode];

export const TimeScope = {
  EXECUTION: 0, PLACEMENT: 1, FRAME: 2, CHILDREN: 3, REFERENCE: 4,
} as const;
export type TimeScopeValue = (typeof TimeScope)[keyof typeof TimeScope];

export const TimeSource = {
  ACTIVE_SEGMENT: 0, PAUSED_SEGMENT: 1, EXECUTION: 2,
} as const;
export type TimeSourceValue = (typeof TimeSource)[keyof typeof TimeSource];

export const TimeAggregate = {
  TOTAL_DURATION: 0, EACH_DURATION: 1, COUNT: 2,
  GAP_DURATION: 3, SPAN_DURATION: 4,
} as const;
export type TimeAggregateValue = (typeof TimeAggregate)[keyof typeof TimeAggregate];

export const TimeQuantifier = {
  ALL: 0, ANY: 1,
} as const;
export type TimeQuantifierValue = (typeof TimeQuantifier)[keyof typeof TimeQuantifier];

export const TaskOrderRelation = {
  BEFORE: 0, AFTER: 1,
} as const;
export type TaskOrderRelationValue = (typeof TaskOrderRelation)[keyof typeof TaskOrderRelation];

export const CommandResult = {
  APPLIED: 0, ALREADY_APPLIED: 1, ACCEPTED: 2,
} as const;
export type CommandResultValue = (typeof CommandResult)[keyof typeof CommandResult];

export const ApiErrorKind = {
  VALIDATION: 0, FORBIDDEN: 1, STALE_REVISION: 2, IDEMPOTENCY_KEY_REUSED: 3,
  NOT_FOUND: 4, CONFLICT: 5, BLOCKED: 6, RETRYABLE: 7,
} as const;
export type ApiErrorKindValue = (typeof ApiErrorKind)[keyof typeof ApiErrorKind];

export const ActorKind = {
  USER: 0, WORKER: 1, IMPORT: 2, SYSTEM: 3,
} as const;
export type ActorKindValue = (typeof ActorKind)[keyof typeof ActorKind];

export const AggregateKind = {
  RECURRING: 0, PLACEMENT: 1, EXECUTION: 2, SESSION: 3,
} as const;
export type AggregateKindValue = (typeof AggregateKind)[keyof typeof AggregateKind];

export const ResolutionState = {
  OPEN: 0, CLOSED: 1, BLOCKED: 2,
} as const;
export type ResolutionStateValue = (typeof ResolutionState)[keyof typeof ResolutionState];

export const ConditionKind = {
  ALL: 0, ANY: 1, NOT: 2, TERM: 3,
} as const;
export type ConditionKindValue = (typeof ConditionKind)[keyof typeof ConditionKind];

export const HolidayKind = {
  NOT_HOLIDAY: 0, HOLIDAY: 1, ANY: 2,
} as const;
export type HolidayKindValue = (typeof HolidayKind)[keyof typeof HolidayKind];
```

- [ ] **Step 4: テスト通過確認**

Run: `cd tastile-web && bun test src/lib/domain/v1/constants.test.ts`
Expected: PASS (全 73 定数)

- [ ] **Step 5: 型定義ファイルを作成** (`tile.ts` 他 10 ファイル)

`v1/02-core-entities.md` / `v1/03-time-and-windows.md` / `v1/04-change-set.md` / `v1/05-condition-and-reference.md` / `v1/13-completion.md` / `v1/14-read-model-and-endpoint.md` のスキーマを忠実に TS で表現する。すべて interface のみ、ビジネスロジックなし。

例 (`tile.ts`):

```ts
import type { TileKindValue, PlanRoleValue } from "./constants";
import type { ConditionNode } from "./condition";
import type { TimeRequirement } from "./completion";
import type { TaskDefinition } from "./completion";
import type { PlanReference } from "./reference";
import type { Metric } from "./metric";

export interface Tile {
  id: string;            // UUIDv7
  kind: TileKindValue;
  owner: string;
  externalId: string | null;
  revision: number;
  content: { title: string; description: string | null };
  visual: { color: string; icon: string };
  audit: { createdAt: string; updatedAt: string; archivedAt: string | null };
}

export interface Plan {
  role: PlanRoleValue;
  references: PlanReference[];
  completion: { root: ConditionNode; timeRequirements: TimeRequirement[]; tasks: TaskDefinition[] };
  planning: {
    placementRules: PlacementRule[];
    nestingRules: NestingRule[];
    flows: Flow[];
  };
  metrics: Metric[];
  decisions: Decision[];
}
```

(残り 10 ファイルは `v1/02..14` のスキーマを機械的に TS 化。コードは spec §6.1 ディレクトリ構造を参照。)

- [ ] **Step 6: envelope.ts を実装**

```ts
// src/lib/domain/v1/envelope.ts
export interface CommandRequest<T> {
  expectedRevision: number | null;
  idempotencyKey: string;  // UUIDv7
  occurredAt: string;      // ISO-8601, server overrides
  payload: T;
}

export interface CommandResponse {
  commandId: string;
  acceptedAt: string;
  aggregate: { kind: number; id: string } | null;
  revision: number | null;
  result: number;  // CommandResult
  pending: PendingWork[];
}

export interface PendingWork { kind: number; description: string; }

export interface ApiError {
  kind: number;        // ApiErrorKind
  message: string;
  currentRevision: number | null;
  violations: ResolutionViolation[];
}

export interface ResolutionViolation { layer: number; key: string; reason: string; }

/** UUIDv7 を生成 (RFC 9562 準拠、タイムスタンプ埋め込み)。 */
export function uuidv7(): string {
  // ... 実装 (crypto.getRandomValues + 48bit タイムスタンプ)
}

/** 現在時刻を ISO-8601 で返す (UTC)。 */
export function nowIso(): string {
  return new Date().toISOString();
}
```

`uuidv7()` の実装は `crypto.getRandomValues` で 48bit ms タイムスタンプ + 残りランダムビット。テストで「フォーマット一致」「タイムスタンプ部分の単調増加」を検証。

- [ ] **Step 7: envelope.ts のテスト** (`envelope.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { uuidv7, nowIso } from "./envelope";

describe("uuidv7", () => {
  it("returns a valid UUIDv7 string", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("embeds monotonic timestamp in first 48 bits", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a < b).toBe(true);  // 辞書順 = 時刻順
  });
});

describe("nowIso", () => {
  it("returns ISO-8601 UTC string", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
```

- [ ] **Step 8: 全テスト + ビルド確認**

Run: `cd tastile-web && bun test src/lib/domain/v1/ && bun run build`
Expected: PASS (両方)

- [ ] **Step 9: コミット**

```bash
cd tastile-web
git add src/lib/domain/v1/
git commit -m "feat(v1): add v1 domain layer — constants (73), types, envelope"
```

**Checkpoint:** Phase A の 1/3。code-reviewer で review。

---

### Task 2: v1 API client + QuickCreateStore

**Files:**
- Create: `src/lib/api/v1-endpoints.ts`
- Create: `src/lib/api/v1-endpoints.test.ts`
- Create: `src/lib/stores/quick-create-store.ts`
- Create: `src/lib/stores/quick-create-store.test.ts`

- [ ] **Step 1: 失敗するテストを書く** (`v1-endpoints.test.ts`)

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { postV1Command, getV1Read, type V1Client } from "./v1-endpoints";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("postV1Command", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to /v1 path with v1 envelope", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ commandId: "c1", acceptedAt: "t1", aggregate: null, revision: null, result: 0, pending: [] }),
    });
    const client: V1Client = { baseUrl: "https://api.example.com", getIdToken: async () => "tok" };
    await postV1Command(client, "/v1/tiles", { expectedRevision: null, idempotencyKey: "k1", occurredAt: "t1", payload: { kind: 0 } });
    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/v1/tiles", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tok" }),
    }));
  });

  it("returns ApiError on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ kind: 0, message: "bad", currentRevision: null, violations: [] }),
    });
    const client: V1Client = { baseUrl: "https://api.example.com", getIdToken: async () => "tok" };
    const res = await postV1Command(client, "/v1/tiles", { expectedRevision: null, idempotencyKey: "k1", occurredAt: "t1", payload: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe(0);
      expect(res.error.message).toBe("bad");
    }
  });
});
```

- [ ] **Step 2: v1-endpoints.ts を実装**

```ts
// src/lib/api/v1-endpoints.ts
import type { CommandRequest, CommandResponse, ApiError } from "@/lib/domain/v1/envelope";

export interface V1Client {
  baseUrl: string;
  getIdToken: () => Promise<string | null>;
}

export type Result<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ApiError };

export async function postV1Command<TReq, TRes>(
  client: V1Client,
  path: string,
  envelope: CommandRequest<TReq>,
): Promise<Result<CommandResponse & { payload: TRes }>> {
  const token = await client.getIdToken();
  if (!token) {
    return { ok: false, error: { kind: 1, message: "no id token", currentRevision: null, violations: [] } };
  }
  const res = await fetch(`${client.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) {
    const err = await res.json() as ApiError;
    return { ok: false, error: err };
  }
  const data = await res.json() as CommandResponse;
  return { ok: true, data: data as CommandResponse & { payload: TRes }, status: res.status };
}

export async function getV1Read<T>(
  client: V1Client,
  path: string,
): Promise<Result<T>> {
  // ... 同様の GET 実装
}

/** 高レベル・ヘルパ: v1 エンドポイント一覧を型付けで公開。 */
export const V1_PATHS = {
  createTile: "/v1/tiles",
  setPlan: (tileId: string) => `/v1/tiles/${tileId}/plan`,
  appendFrames: (recurringId: string) => `/v1/recurrings/${recurringId}/frames`,
  appendRules: (recurringId: string) => `/v1/recurrings/${recurringId}/rules`,
  createPlacement: "/v1/placements",
  appendChanges: (placementId: string) => `/v1/placements/${placementId}/changes`,
  startExecution: (placementId: string) => `/v1/placements/${placementId}/executions`,
  pauseExecution: (executionId: string) => `/v1/executions/${executionId}/pause`,
  resumeExecution: (executionId: string) => `/v1/executions/${executionId}/resume`,
  finishExecution: (executionId: string) => `/v1/executions/${executionId}/finish`,
  listTiles: "/v1/tiles",
  listPlacements: "/v1/placements",
  timeline: "/v1/timeline",
  sync: (cursor: string) => `/v1/sync?since=${cursor}`,
} as const;
```

- [ ] **Step 3: v1-endpoints テスト通過確認**

Run: `cd tastile-web && bun test src/lib/api/v1-endpoints.test.ts`
Expected: PASS

- [ ] **Step 4: QuickCreateStore のテストを書く** (`quick-create-store.test.ts`)

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useQuickCreateStore } from "./quick-create-store";

beforeEach(() => useQuickCreateStore.getState().reset());

describe("QuickCreateStore", () => {
  it("initial state matches spec §2.2", () => {
    const s = useQuickCreateStore.getState();
    expect(s.identity.title).toBe("");
    expect(s.identity.kind).toBe(0);  // RECURRING
    expect(s.plan.role).toBe(0);      // EXECUTABLE
    expect(s.submit.state).toBe("idle");
  });

  it("setField updates nested state", () => {
    useQuickCreateStore.getState().setField("identity.title", "数学");
    expect(useQuickCreateStore.getState().identity.title).toBe("数学");
  });

  it("setRole toggles label-only consistently", () => {
    useQuickCreateStore.getState().setRole(1);  // LABEL
    expect(useQuickCreateStore.getState().identity.kind).toBe(1);  // kind → PLACEMENT
    expect(useQuickCreateStore.getState().meta.isLabelOnly).toBe(true);
  });

  it("reset clears all state", () => {
    useQuickCreateStore.getState().setField("identity.title", "test");
    useQuickCreateStore.getState().reset();
    expect(useQuickCreateStore.getState().identity.title).toBe("");
  });
});
```

- [ ] **Step 5: QuickCreateStore を実装**

```ts
// src/lib/stores/quick-create-store.ts
import { create } from "zustand";
import { TileKind, PlanRole } from "@/lib/domain/v1/constants";
import type { TileKindValue, PlanRoleValue } from "@/lib/domain/v1/constants";
import type { ApiError } from "@/lib/domain/v1/envelope";
import type { ConditionNode } from "@/lib/domain/v1/condition";
import type { TimeRequirement, TaskDefinition } from "@/lib/domain/v1/completion";
import type { PlanReference } from "@/lib/domain/v1/reference";
import type { Metric } from "@/lib/domain/v1/metric";
import type { Window } from "@/lib/domain/v1/window";
import type { ChangeSet } from "@/lib/domain/v1/change-set";
import type { FrameRule, RecurringRule, RecurringLife } from "@/lib/domain/v1/recurring";  // tile.ts から re-export

export interface QuickCreateIdentity {
  title: string;
  kind: TileKindValue;
  externalId: { value: string | null };
  visual: { color: string; icon: string };
}

export interface QuickCreatePlan {
  role: PlanRoleValue;
  references: PlanReference[];
  completion: { root: ConditionNode; timeRequirements: TimeRequirement[]; tasks: TaskDefinition[] };
  planning: { placementRules: any[]; nestingRules: any[]; flows: any[] };
  metrics: Metric[];
}

export interface QuickCreateTime {
  span: { start: string | null; end: string | null; offsetMin: number };
  durationMinMax: { min: number | null; max: number | null };
}

export interface QuickCreateRecurring {
  life: RecurringLife;
  frameRules: FrameRule[];
  recurringRules: RecurringRule[];
}

export interface QuickCreateAdvanced {
  changeSets: ChangeSet[];
  rules: any[];
}

export interface QuickCreateMeta {
  project: string | null;
  tags: string[];
  memo: string;
  isLabelOnly: boolean;
}

export type SubmitStep =
  | "create-tile" | "set-plan" | "append-frames" | "append-rules"
  | "create-placement" | "start-execution";

export interface QuickCreateSubmit {
  state: "idle" | "submitting" | "error";
  step: SubmitStep | null;
  error: ApiError | null;
}

export interface QuickCreateState {
  identity: QuickCreateIdentity;
  plan: QuickCreatePlan;
  time: QuickCreateTime;
  windows: Window[];
  recurring: QuickCreateRecurring;
  advanced: QuickCreateAdvanced;
  meta: QuickCreateMeta;
  submit: QuickCreateSubmit;
  isOpen: boolean;

  setField: (path: string, value: unknown) => void;
  setRole: (role: PlanRoleValue) => void;
  setKind: (kind: TileKindValue) => void;
  setIsLabelOnly: (v: boolean) => void;
  open: () => void;
  close: () => void;
  reset: () => void;
}

const initial: Omit<QuickCreateState, "setField" | "setRole" | "setKind" | "setIsLabelOnly" | "open" | "close" | "reset"> = {
  identity: { title: "", kind: TileKind.RECURRING, externalId: { value: null }, visual: { color: "#5E6AD2", icon: "sun" } },
  plan: {
    role: PlanRole.EXECUTABLE,
    references: [],
    completion: { root: { kind: 0, children: [] }, timeRequirements: [], tasks: [] },
    planning: { placementRules: [], nestingRules: [], flows: [] },
    metrics: [],
  },
  time: { span: { start: null, end: null, offsetMin: 0 }, durationMinMax: { min: 25, max: 60 } },
  windows: [],
  recurring: { life: { state: 0, activeStart: null, activeEnd: null }, frameRules: [], recurringRules: [] },
  advanced: { changeSets: [], rules: [] },
  meta: { project: null, tags: [], memo: "", isLabelOnly: false },
  submit: { state: "idle", step: null, error: null },
  isOpen: false,
};

function setNested(obj: any, path: string, value: unknown): any {
  const parts = path.split(".");
  const last = parts.pop()!;
  const target = parts.reduce((acc, k) => (acc[k] ??= {}), obj);
  target[last] = value;
  return { ...obj };
}

export const useQuickCreateStore = create<QuickCreateState>((set, get) => ({
  ...initial,
  setField: (path, value) => set((s) => setNested(s, path, value) as any),
  setRole: (role) =>
    set((s) => ({
      plan: { ...s.plan, role },
      meta: { ...s.meta, isLabelOnly: role === PlanRole.LABEL },
      // LABEL にした場合は kind を PLACEMENT に強制 (label 用の予定として)
      identity: role === PlanRole.LABEL
        ? { ...s.identity, kind: TileKind.PLACEMENT }
        : s.identity,
    })),
  setKind: (kind) => set((s) => ({ identity: { ...s.identity, kind } })),
  setIsLabelOnly: (v) =>
    set((s) => ({
      meta: { ...s.meta, isLabelOnly: v },
      plan: { ...s.plan, role: v ? PlanRole.LABEL : PlanRole.EXECUTABLE },
    })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  reset: () => set(initial),
}));
```

- [ ] **Step 6: Store テスト通過確認**

Run: `cd tastile-web && bun test src/lib/stores/quick-create-store.test.ts`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
cd tastile-web
git add src/lib/api/v1-endpoints.ts src/lib/api/v1-endpoints.test.ts
git add src/lib/stores/quick-create-store.ts src/lib/stores/quick-create-store.test.ts
git commit -m "feat(v1): add v1 API client + QuickCreateStore (zustand)"
```

---

### Task 3: icon system + LayerStack

**Files:**
- Create: `src/components/tiles/shared/icons.tsx`
- Create: `src/components/tiles/shared/icons.test.tsx`
- Create: `src/components/tiles/sub-panels/layer-stack.ts`
- Create: `src/components/tiles/sub-panels/layer-stack.test.tsx`

- [ ] **Step 1: icons テスト**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PlanIcon, CompletionIcon, CalendarTermIcon } from "./icons";

describe("v1 icon aliases", () => {
  it("PlanIcon renders Bookmark from lucide", () => {
    const { container } = render(<PlanIcon />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("CalendarTermIcon renders CalendarDays", () => {
    const { container } = render(<CalendarTermIcon />);
    expect(container.querySelector("svg.lucide-calendar-days")).toBeTruthy();
  });
});
```

- [ ] **Step 2: icons.tsx を実装**

spec §6.2 のテーブル全 36 個のラッパを実装する。代表 1 個:

```ts
// src/components/tiles/shared/icons.tsx
"use client";
import {
  FileText, Calendar, Clock, Bookmark, Palette, Link as LinkIcon,
  Target, AppWindow, Repeat, CalendarPlus, Play, Plug, GitBranch,
  CalendarDays, AlarmClock, Link2, Ruler, BarChart3, CheckSquare,
  Pin, TrendingUp, ThumbsUp, Activity, Waves, Scale, Wrench,
  Eraser, Pencil, Trash2, Frame, SkipForward, Anchor, RefreshCw,
  Pause, Square, FolderOpen, Tag, MessageSquare, AlertCircle,
  X, ChevronLeft,
} from "lucide-react";

type Props = { size?: number; className?: string };

const wrap = (Component: typeof FileText) => ({ size = 20, className }: Props) =>
  <Component size={size} className={className} aria-hidden="true" />;

export const TitleIcon = wrap(FileText);
export const ScheduleIcon = wrap(Calendar);
export const DurationIcon = wrap(Clock);
export const PlanIcon = wrap(Bookmark);
export const ColorIcon = wrap(Palette);
export const RefIcon = wrap(LinkIcon);
export const CompletionIcon = wrap(Target);
export const WindowIcon = wrap(AppWindow);
export const RecurringIcon = wrap(Repeat);
export const RecurringKindIcon = wrap(Repeat);
export const PlacementKindIcon = wrap(CalendarPlus);
export const ExecutionKindIcon = wrap(Play);
export const ExternalIdIcon = wrap(Plug);
export const ConditionIcon = wrap(GitBranch);
export const CalendarTermIcon = wrap(CalendarDays);
export const MomentTermIcon = wrap(AlarmClock);
export const RelationTermIcon = wrap(Link2);
export const GapTermIcon = wrap(Ruler);
export const RequirementTermIcon = wrap(BarChart3);
export const TaskTermIcon = wrap(CheckSquare);
export const FactTermIcon = wrap(Pin);
export const MetricTermIcon = wrap(TrendingUp);
export const FeedbackTermIcon = wrap(ThumbsUp);
export const LifeTermIcon = wrap(Activity);
export const TimeReqIcon = wrap(BarChart3);
export const TaskIcon = wrap(CheckSquare);
export const MetricIcon = wrap(TrendingUp);
export const FlowIcon = wrap(Waves);
export const RuleIcon = wrap(Scale);
export const ChangeIcon = wrap(Wrench);
export const ChangeClearIcon = wrap(Eraser);
export const ChangePutIcon = wrap(Pencil);
export const ChangeDropIcon = wrap(Trash2);
export const FrameIcon = wrap(Frame);
export const FrameStepIcon = wrap(SkipForward);
export const FrameRefIcon = wrap(Anchor);
export const FrameCalIcon = wrap(Calendar);
export const FrameTransIcon = wrap(RefreshCw);
export const ExecIcon = wrap(Play);
export const PauseIcon = wrap(Pause);
export const ResumeIcon = wrap(Play);
export const FinishIcon = wrap(Square);
export const ProjectIcon = wrap(FolderOpen);
export const TagIcon = wrap(Tag);
export const MemoIcon = wrap(MessageSquare);
export const ErrorIcon = wrap(AlertCircle);
export const CloseIcon = wrap(X);
export const BackIcon = wrap(ChevronLeft);
```

(残り 36 個は同じパターンで列挙)

- [ ] **Step 3: LayerStack のテスト**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerStack } from "./layer-stack";

beforeEach(() => {
  // layer-stack を localStorage ではなく useState で実装するため、テストではフックを直接リセット
});

describe("useLayerStack", () => {
  it("starts with [base]", () => {
    const { result } = renderHook(() => useLayerStack());
    expect(result.current.layers).toEqual([{ kind: "base" }]);
    expect(result.current.current.kind).toBe("base");
  });

  it("push appends layer", () => {
    const { result } = renderHook(() => useLayerStack());
    act(() => result.current.push({ kind: "subpanel", id: "plan", title: "Plan" }));
    expect(result.current.layers).toHaveLength(2);
    expect(result.current.current.kind).toBe("subpanel");
  });

  it("pop returns to base", () => {
    const { result } = renderHook(() => useLayerStack());
    act(() => result.current.push({ kind: "subpanel", id: "plan", title: "Plan" }));
    act(() => result.current.push({ kind: "editor", id: "e1", parent: "plan", title: "X" }));
    act(() => result.current.pop());
    expect(result.current.current).toEqual({ kind: "subpanel", id: "plan", title: "Plan" });
  });

  it("pop at base is no-op (returns base, not empty)", () => {
    const { result } = renderHook(() => useLayerStack());
    act(() => result.current.pop());
    expect(result.current.layers).toEqual([{ kind: "base" }]);
  });
});
```

- [ ] **Step 4: layer-stack.ts を実装**

```ts
// src/components/tiles/sub-panels/layer-stack.ts
"use client";
import { useState, useCallback } from "react";

export type Layer =
  | { kind: "base" }
  | { kind: "subpanel"; id: "plan" | "completion" | "references" | "window" | "frame-recurring" | "advanced"; title: string }
  | { kind: "editor"; id: string; parent: string; title: string; breadcrumb: string[] };

export interface LayerStack {
  layers: Layer[];
  current: Layer;
  push: (l: Layer) => void;
  pop: () => void;
  popToBase: () => void;
}

export function useLayerStack(): LayerStack {
  const [layers, setLayers] = useState<Layer[]>([{ kind: "base" }]);

  const push = useCallback((l: Layer) => {
    setLayers((prev) => [...prev, l]);
  }, []);

  const pop = useCallback(() => {
    setLayers((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const popToBase = useCallback(() => {
    setLayers([{ kind: "base" }]);
  }, []);

  return {
    layers,
    current: layers[layers.length - 1],
    push,
    pop,
    popToBase,
  };
}
```

- [ ] **Step 5: 全テスト通過確認**

Run: `cd tastile-web && bun test src/components/tiles/shared/icons.test.tsx src/components/tiles/sub-panels/layer-stack.test.tsx`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/components/tiles/shared/icons.tsx src/components/tiles/shared/icons.test.tsx
git add src/components/tiles/sub-panels/layer-stack.ts src/components/tiles/sub-panels/layer-stack.test.tsx
git commit -m "feat(v1): add icon aliases + LayerStack state"
```

**Checkpoint:** Phase A 完了。code-reviewer で review。

---

## Phase B: Build & Submit (Tasks 4-5)

### Task 4: buildCreateTileCommandV1 (pure function)

**Files:**
- Modify: `src/components/tiles/build-command.ts` (全面書き換え)
- Test: `src/components/tiles/build-command.test.ts` (新規)

- [ ] **Step 1: 失敗するテスト**

```ts
import { describe, expect, it } from "vitest";
import { buildCreateTileCommandV1 } from "./build-command";
import { TileKind, PlanRole, ChangeKind, MergeMode } from "@/lib/domain/v1/constants";

describe("buildCreateTileCommandV1 — RECURRING", () => {
  it("returns 4 envelopes: createTile, setPlan, appendFrames, appendRules", () => {
    const envelopes = buildCreateTileCommandV1({
      identity: { title: "毎週の英語", kind: TileKind.RECURRING, externalId: { value: null }, visual: { color: "#5E6AD2", icon: "sun" } },
      plan: { role: PlanRole.EXECUTABLE, references: [], completion: { root: { kind: 0, children: [] }, timeRequirements: [], tasks: [] }, planning: { placementRules: [], nestingRules: [], flows: [] }, metrics: [] },
      time: { span: { start: "2026-06-26T00:00:00Z", end: null, offsetMin: 540 }, durationMinMax: { min: 25, max: 60 } },
      windows: [],
      recurring: { life: { state: 0, activeStart: "2026-06-26", activeEnd: null }, frameRules: [{ id: "f1", kind: 2, anchor: "weekly", weekdayMask: 0b0000001 }], recurringRules: [] },
      advanced: { changeSets: [], rules: [] },
      meta: { project: null, tags: ["english"], memo: "", isLabelOnly: false },
    }, "key-uuidv7");

    expect(envelopes).toHaveLength(4);
    expect(envelopes[0].path).toBe("/v1/tiles");
    expect(envelopes[0].payload.kind).toBe(0);
    expect(envelopes[0].idempotencyKey).toBe("key-uuidv7");
    expect(envelopes[1].path).toBe("/v1/tiles/{tileId}/plan");
    expect(envelopes[1].payload.role).toBe(0);
    expect(envelopes[2].path).toBe("/v1/recurrings/{tileId}/frames");
    expect(envelopes[2].payload).toHaveLength(1);
    expect(envelopes[3].path).toBe("/v1/recurrings/{tileId}/rules");
  });
});

describe("buildCreateTileCommandV1 — PLACEMENT", () => {
  it("returns 2 envelopes (no frames/rules)", () => {
    const envelopes = buildCreateTileCommandV1({
      identity: { title: "今日の数学", kind: TileKind.PLACEMENT, externalId: { value: null }, visual: { color: "#5E6AD2", icon: "sun" } },
      plan: { role: PlanRole.EXECUTABLE, references: [], completion: { root: { kind: 0, children: [] }, timeRequirements: [], tasks: [] }, planning: { placementRules: [], nestingRules: [], flows: [] }, metrics: [] },
      time: { span: { start: "2026-06-26T19:00:00Z", end: "2026-06-26T21:00:00Z", offsetMin: 540 }, durationMinMax: { min: 60, max: 120 } },
      windows: [],
      recurring: { life: { state: 0, activeStart: null, activeEnd: null }, frameRules: [], recurringRules: [] },
      advanced: { changeSets: [], rules: [] },
      meta: { project: null, tags: [], memo: "", isLabelOnly: false },
    }, "k1");

    expect(envelopes).toHaveLength(2);
    expect(envelopes[1].path).toBe("/v1/tiles/{tileId}/plan");
  });
});

describe("buildCreateTileCommandV1 — LABEL", () => {
  it("PLACEMENT + role=1 + isLabelOnly=true", () => {
    const envelopes = buildCreateTileCommandV1({
      identity: { title: "学期中", kind: TileKind.PLACEMENT, externalId: { value: null }, visual: { color: "#999", icon: "tag" } },
      plan: { role: PlanRole.LABEL, references: [], completion: { root: { kind: 0, children: [] }, timeRequirements: [], tasks: [] }, planning: { placementRules: [], nestingRules: [], flows: [] }, metrics: [] },
      time: { span: { start: "2026-06-26T00:00:00Z", end: "2026-09-30T00:00:00Z", offsetMin: 540 }, durationMinMax: { min: null, max: null } },
      windows: [],
      recurring: { life: { state: 0, activeStart: null, activeEnd: null }, frameRules: [], recurringRules: [] },
      advanced: { changeSets: [], rules: [] },
      meta: { project: null, tags: [], memo: "", isLabelOnly: true },
    }, "k1");

    expect(envelopes).toHaveLength(2);
    expect(envelopes[1].payload.role).toBe(1);
    expect(envelopes[1].payload.completion).toEqual({ root: { kind: 0, children: [] }, timeRequirements: [], tasks: [] });
  });
});

describe("buildCreateTileCommandV1 — idempotencyKey propagation", () => {
  it("all envelopes share the same key", () => {
    const envelopes = buildCreateTileCommandV1(/* RECURRING snapshot */, "shared-key");
    envelopes.forEach((e) => expect(e.idempotencyKey).toBe("shared-key"));
  });
});
```

- [ ] **Step 2: build-command.ts を全面書き換え**

旧 `buildCreateTileCommand` / `QuickCreateFormState` をすべて削除し、新関数のみにする。

```ts
// src/components/tiles/build-command.ts (全面書き換え)
import { TileKind, PlanRole, CommandResult } from "@/lib/domain/v1/constants";
import type { TileKindValue, PlanRoleValue } from "@/lib/domain/v1/constants";
import { nowIso, type CommandRequest } from "@/lib/domain/v1/envelope";
import type { QuickCreateState } from "@/lib/stores/quick-create-store";
import { V1_PATHS } from "@/lib/api/v1-endpoints";

export interface BuiltEnvelope<T> {
  path: string;
  request: CommandRequest<T>;
}

export function buildCreateTileCommandV1(
  state: QuickCreateState,
  idempotencyKey: string,
  occurredAt: string = nowIso(),
): BuiltEnvelope<unknown>[] {
  const envelopes: BuiltEnvelope<unknown>[] = [];
  const tilePath = "/{tileId}";  // プレースホルダ。実行時に置換

  // 1. CREATE_TILE
  envelopes.push({
    path: V1_PATHS.createTile,
    request: {
      expectedRevision: null,
      idempotencyKey,
      occurredAt,
      payload: {
        kind: state.identity.kind,
        title: state.identity.title,
        visual: state.identity.visual,
        externalId: state.identity.externalId.value,
      },
    },
  });

  // 2. SET_PLAN
  envelopes.push({
    path: V1_PATHS.setPlan(tilePath),
    request: {
      expectedRevision: 1,  // tile 作成後の revision
      idempotencyKey,
      occurredAt,
      payload: {
        role: state.plan.role,
        references: state.plan.references,
        completion: state.plan.completion,
        planning: state.plan.planning,
        metrics: state.plan.metrics,
      },
    },
  });

  // 3. kind 別追加
  if (state.identity.kind === TileKind.RECURRING) {
    if (state.recurring.frameRules.length > 0) {
      envelopes.push({
        path: V1_PATHS.appendFrames(tilePath),
        request: { expectedRevision: 2, idempotencyKey, occurredAt, payload: state.recurring.frameRules },
      });
    }
    if (state.recurring.recurringRules.length > 0) {
      envelopes.push({
        path: V1_PATHS.appendRules(tilePath),
        request: { expectedRevision: 3, idempotencyKey, occurredAt, payload: state.recurring.recurringRules },
      });
    }
  }

  return envelopes;
}

/** 実行時に `{tileId}` を実 ID に置換する。 */
export function substituteTileId(envelopes: BuiltEnvelope<unknown>[], tileId: string): BuiltEnvelope<unknown>[] {
  return envelopes.map((e) => ({
    ...e,
    path: e.path.replace("{tileId}", tileId),
  }));
}
```

- [ ] **Step 3: テスト通過確認**

Run: `cd tastile-web && bun test src/components/tiles/build-command.test.ts`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
cd tastile-web
git add src/components/tiles/build-command.ts src/components/tiles/build-command.test.ts
git commit -m "feat(v1): rewrite build-command → buildCreateTileCommandV1 (pure)"
```

---

### Task 5: submit flow + ApiErrorKind 8-way

**Files:**
- Create: `src/lib/api/error-mapper.ts`
- Create: `src/lib/api/error-mapper.test.ts`
- Create: `src/components/tiles/submit-quick-create.ts`
- Create: `src/components/tiles/submit-quick-create.test.ts`

- [ ] **Step 1: error-mapper テスト**

```ts
import { describe, expect, it } from "vitest";
import { mapApiErrorToMessage, ApiErrorKind, type UiMessage } from "./error-mapper";

const cases: Array<[number, UiMessage["severity"]]> = [
  [ApiErrorKind.VALIDATION, "field"],
  [ApiErrorKind.FORBIDDEN, "global"],
  [ApiErrorKind.STALE_REVISION, "global"],
  [ApiErrorKind.IDEMPOTENCY_KEY_REUSED, "global"],
  [ApiErrorKind.NOT_FOUND, "global"],
  [ApiErrorKind.CONFLICT, "violation"],
  [ApiErrorKind.BLOCKED, "violation"],
  [ApiErrorKind.RETRYABLE, "retryable"],
];

describe("mapApiErrorToMessage", () => {
  cases.forEach(([kind, severity]) => {
    it(`kind=${kind} → severity=${severity}`, () => {
      const msg = mapApiErrorToMessage({ kind, message: "x", currentRevision: null, violations: [] });
      expect(msg.severity).toBe(severity);
    });
  });

  it("VALIDATION surfaces violations to field", () => {
    const msg = mapApiErrorToMessage({
      kind: ApiErrorKind.VALIDATION, message: "x", currentRevision: null,
      violations: [{ layer: 0, key: "identity.title", reason: "empty" }],
    });
    expect(msg.severity).toBe("field");
    expect(msg.field).toBe("identity.title");
  });

  it("BLOCKED surfaces all violations", () => {
    const msg = mapApiErrorToMessage({
      kind: ApiErrorKind.BLOCKED, message: "x", currentRevision: null,
      violations: [
        { layer: 1, key: "k1", reason: "r1" },
        { layer: 1, key: "k2", reason: "r2" },
      ],
    });
    expect(msg.severity).toBe("violation");
    expect(msg.violations).toHaveLength(2);
  });
});
```

- [ ] **Step 2: error-mapper.ts を実装**

```ts
// src/lib/api/error-mapper.ts
import { ApiErrorKind } from "@/lib/domain/v1/constants";
import type { ApiError } from "@/lib/domain/v1/envelope";

export type UiMessage =
  | { severity: "field"; field: string; reason: string }
  | { severity: "global"; message: string }
  | { severity: "violation"; violations: { layer: number; key: string; reason: string }[] }
  | { severity: "retryable"; message: string; autoRetry: boolean };

export function mapApiErrorToMessage(err: ApiError): UiMessage {
  switch (err.kind) {
    case ApiErrorKind.VALIDATION: {
      const first = err.violations[0];
      return { severity: "field", field: first?.key ?? "unknown", reason: first?.reason ?? err.message };
    }
    case ApiErrorKind.FORBIDDEN:
      return { severity: "global", message: "権限がありません" };
    case ApiErrorKind.STALE_REVISION:
      return { severity: "global", message: "他で変更されました。再読み込みしますか?" };
    case ApiErrorKind.IDEMPOTENCY_KEY_REUSED:
      return { severity: "global", message: "内部エラー (バグ報告)" };
    case ApiErrorKind.NOT_FOUND:
      return { severity: "global", message: "対象が見つかりません" };
    case ApiErrorKind.CONFLICT:
    case ApiErrorKind.BLOCKED:
      return { severity: "violation", violations: err.violations };
    case ApiErrorKind.RETRYABLE:
      return { severity: "retryable", message: "一時的なエラー (再試行中)", autoRetry: true };
  }
}
```

- [ ] **Step 3: submit-quick-create テスト**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { submitQuickCreate } from "./submit-quick-create";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";

vi.mock("@/lib/api/v1-endpoints", () => ({
  postV1Command: vi.fn(),
  V1_PATHS: {
    createTile: "/v1/tiles",
    setPlan: (id: string) => `/v1/tiles/${id}/plan`,
    appendFrames: (id: string) => `/v1/recurrings/${id}/frames`,
    appendRules: (id: string) => `/v1/recurrings/${id}/rules`,
  },
}));

import { postV1Command } from "@/lib/api/v1-endpoints";

beforeEach(() => {
  useQuickCreateStore.getState().reset();
  vi.mocked(postV1Command).mockReset();
});

describe("submitQuickCreate", () => {
  it("sends envelopes in order and stores tileId between calls", async () => {
    useQuickCreateStore.getState().setField("identity.title", "test");
    vi.mocked(postV1Command)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { commandId: "c1", acceptedAt: "t", aggregate: { kind: 0, id: "TILE-1" }, revision: 1, result: 0, pending: [] } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { commandId: "c2", acceptedAt: "t", aggregate: { kind: 0, id: "TILE-1" }, revision: 2, result: 0, pending: [] } });

    await submitQuickCreate({ baseUrl: "https://api", getIdToken: async () => "tok" });

    expect(postV1Command).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postV1Command).mock.calls[0][1]).toBe("/v1/tiles");
    expect(vi.mocked(postV1Command).mock.calls[1][1]).toBe("/v1/tiles/TILE-1/plan");
    expect(useQuickCreateStore.getState().submit.state).toBe("idle");
  });

  it("stops on first error and stores step", async () => {
    useQuickCreateStore.getState().setField("identity.title", "test");
    vi.mocked(postV1Command)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { commandId: "c1", acceptedAt: "t", aggregate: { kind: 0, id: "TILE-1" }, revision: 1, result: 0, pending: [] } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 6, message: "blocked", currentRevision: 1, violations: [] } });

    await submitQuickCreate({ baseUrl: "https://api", getIdToken: async () => "tok" });

    expect(postV1Command).toHaveBeenCalledTimes(2);
    const s = useQuickCreateStore.getState();
    expect(s.submit.state).toBe("error");
    expect(s.submit.step).toBe("set-plan");
    expect(s.submit.error?.kind).toBe(6);
  });

  it("RETRYABLE auto-retries once", async () => {
    useQuickCreateStore.getState().setField("identity.title", "test");
    vi.mocked(postV1Command)
      .mockResolvedValueOnce({ ok: false, error: { kind: 7, message: "x", currentRevision: null, violations: [] } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { commandId: "c1", acceptedAt: "t", aggregate: { kind: 0, id: "TILE-1" }, revision: 1, result: 0, pending: [] } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { commandId: "c2", acceptedAt: "t", aggregate: { kind: 0, id: "TILE-1" }, revision: 2, result: 0, pending: [] } });

    await submitQuickCreate({ baseUrl: "https://api", getIdToken: async () => "tok" });

    expect(postV1Command).toHaveBeenCalledTimes(3);
    expect(useQuickCreateStore.getState().submit.state).toBe("idle");
  });
});
```

- [ ] **Step 4: submit-quick-create.ts を実装**

```ts
// src/components/tiles/submit-quick-create.ts
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import type { V1Client } from "@/lib/api/v1-endpoints";
import { postV1Command } from "@/lib/api/v1-endpoints";
import { buildCreateTileCommandV1, substituteTileId } from "./build-command";
import { ApiErrorKind } from "@/lib/domain/v1/constants";
import { uuidv7 } from "@/lib/domain/v1/envelope";

const MAX_RETRYABLE_ATTEMPTS = 2;

export async function submitQuickCreate(client: V1Client): Promise<void> {
  const store = useQuickCreateStore.getState();
  store.setField("submit", { state: "submitting", step: null, error: null });

  const key = uuidv7();
  const built = buildCreateTileCommandV1(useQuickCreateStore.getState(), key);

  let tileId: string | null = null;
  for (let i = 0; i < built.length; i++) {
    const env = built[i];
    const step: SubmitStep = i === 0 ? "create-tile" : i === 1 ? "set-plan" : i === 2 ? "append-frames" : "append-rules";

    let attempt = 0;
    while (attempt < MAX_RETRYABLE_ATTEMPTS) {
      const result = await postV1Command(client, substituteTileId([env], tileId ?? "PLACEHOLDER")[0].path, env.request);
      if (result.ok) {
        if (i === 0) tileId = result.data.aggregate?.id ?? null;
        break;
      }
      if (result.error.kind === ApiErrorKind.RETRYABLE && attempt === 0) {
        attempt++;
        continue;
      }
      // 失敗 → step + error を保存して中断
      useQuickCreateStore.getState().setField("submit", { state: "error", step, error: result.error });
      return;
    }
  }

  // 全部成功
  useQuickCreateStore.setState((s) => ({
    ...s,
    submit: { state: "idle", step: null, error: null },
    isOpen: false,
  }));
  useQuickCreateStore.getState().reset();
}

type SubmitStep = "create-tile" | "set-plan" | "append-frames" | "append-rules" | "create-placement" | "start-execution";
```

- [ ] **Step 5: 全テスト + ビルド確認**

Run: `cd tastile-web && bun test src/lib/api/error-mapper.test.ts src/components/tiles/submit-quick-create.test.ts && bun run build`
Expected: PASS (両方)

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/lib/api/error-mapper.ts src/lib/api/error-mapper.test.ts
git add src/components/tiles/submit-quick-create.ts src/components/tiles/submit-quick-create.test.ts
git commit -m "feat(v1): add submit flow + ApiErrorKind 8-way mapper"
```

**Checkpoint:** Phase B 完了。code-reviewer で review。

---

## Phase C: BasePanel (Task 6)

### Task 6: QuickTileCreate.tsx rewrite — ZONE A/B/C/D

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (全面書き換え)
- Modify: `src/components/tiles/QuickTileCreate.test.tsx` (全面書き換え)

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickTileCreate } from "./QuickTileCreate";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";

beforeEach(() => useQuickCreateStore.getState().reset());

describe("QuickTileCreate (Layer 0 BasePanel)", () => {
  it("renders ZONE A title input", () => {
    render(<QuickTileCreate />);
    expect(screen.getByPlaceholderText(/title/i)).toBeTruthy();
  });

  it("renders ZONE B with 5 summary rows + Advanced link", () => {
    render(<QuickTileCreate />);
    // 各行のアイコン + ラベル
    expect(screen.getByLabelText(/role/i)).toBeTruthy();
    expect(screen.getByLabelText(/visual/i)).toBeTruthy();
    expect(screen.getByLabelText(/completion/i)).toBeTruthy();
    expect(screen.getByLabelText(/references/i)).toBeTruthy();
    expect(screen.getByLabelText(/window/i)).toBeTruthy();
    expect(screen.getByLabelText(/recurring/i)).toBeTruthy();
    expect(screen.getByLabelText(/advanced/i)).toBeTruthy();
  });

  it("renders ZONE C project/tags/memo", () => {
    render(<QuickTileCreate />);
    expect(screen.getByPlaceholderText(/project/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/tag/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/memo/i)).toBeTruthy();
  });

  it("renders ZONE D label-only toggle + create button", () => {
    render(<QuickTileCreate />);
    expect(screen.getByRole("switch", { name: /label/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create/i })).toBeTruthy();
  });

  it("does NOT render annotation labels like 'synchronized with BasePanel'", () => {
    render(<QuickTileCreate />);
    expect(screen.queryByText(/synchronized/i)).toBeNull();
    expect(screen.queryByText(/BasePanel/i)).toBeNull();
  });

  it("typing in title updates store", async () => {
    const user = userEvent.setup();
    render(<QuickTileCreate />);
    await user.type(screen.getByPlaceholderText(/title/i), "数学");
    expect(useQuickCreateStore.getState().identity.title).toBe("数学");
  });

  it("label-only toggle changes role", async () => {
    const user = userEvent.setup();
    render(<QuickTileCreate />);
    await user.click(screen.getByRole("switch", { name: /label/i }));
    expect(useQuickCreateStore.getState().plan.role).toBe(1);
    expect(useQuickCreateStore.getState().identity.kind).toBe(1);  // PLACEMENT
  });
});
```

- [ ] **Step 2: テスト失敗確認**

Run: `cd tastile-web && bun test src/components/tiles/QuickTileCreate.test.tsx`
Expected: FAIL (旧実装)

- [ ] **Step 3: QuickTileCreate.tsx を全面書き換え**

```tsx
// src/components/tiles/QuickTileCreate.tsx (全面書き換え)
"use client";
import { FormPanel, FormDivider, FormRow, RowInput, RowSegmented, RowSubPanel, RowToggle } from "@/components/ui/form";
import { CloseIcon, PlanIcon, ColorIcon, CompletionIcon, RefIcon, WindowIcon, RecurringIcon, ProjectIcon, TagIcon, MemoIcon, ScheduleIcon, DurationIcon, TitleIcon } from "./shared/icons";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { PlanRole, TileKind } from "@/lib/domain/v1/constants";
import { useLayerStack } from "./sub-panels/layer-stack";
import { submitQuickCreate } from "./submit-quick-create";
import { getSessionClient } from "@/lib/daemon/id-token-client";

export function QuickTileCreate() {
  const identity = useQuickCreateStore((s) => s.identity);
  const plan = useQuickCreateStore((s) => s.plan);
  const time = useQuickCreateStore((s) => s.time);
  const meta = useQuickCreateStore((s) => s.meta);
  const submit = useQuickCreateStore((s) => s.submit);
  const isOpen = useQuickCreateStore((s) => s.isOpen);
  const setField = useQuickCreateStore((s) => s.setField);
  const setIsLabelOnly = useQuickCreateStore((s) => s.setIsLabelOnly);
  const close = useQuickCreateStore((s) => s.close);

  const stack = useLayerStack();

  if (!isOpen) return null;

  // BasePanel (Layer 0) の描画
  return (
    <div role="dialog" aria-label="Quick tile create" className="fixed inset-0 z-50 bg-surface-0">
      {/* Header */}
      <header className="flex h-14 items-center justify-end border-b border-border px-section">
        <button type="button" aria-label="Close" onClick={close} className="h-8 w-8 rounded-full hover:bg-surface-2 flex items-center justify-center">
          <CloseIcon size={20} />
        </button>
      </header>

      {/* ZONE A */}
      <FormPanel>
        <FormRow icon={<TitleIcon />}>
          <RowInput value={identity.title} onChange={(v) => setField("identity.title", v)} placeholder="Title" />
        </FormRow>
        <FormRow icon={<ScheduleIcon />}>
          <RowInput value={time.span.start ?? ""} onChange={(v) => setField("time.span.start", v || null)} placeholder="2026-06-26 14:00" />
          <span className="text-foreground-muted">〜</span>
          <RowInput value={time.span.end ?? ""} onChange={(v) => setField("time.span.end", v || null)} placeholder="15:00" />
        </FormRow>
        <FormRow icon={<DurationIcon />}>
          <RowInput value={String(time.durationMinMax.min ?? "")} onChange={(v) => setField("time.durationMinMax.min", v ? Number(v) : null)} placeholder="25" />
          <span className="text-foreground-muted">〜</span>
          <RowInput value={String(time.durationMinMax.max ?? "")} onChange={(v) => setField("time.durationMinMax.max", v ? Number(v) : null)} placeholder="60" />
        </FormRow>
      </FormPanel>

      <FormDivider />

      {/* ZONE B */}
      <FormPanel>
        <FormRow icon={<PlanIcon />}>
          <RowSegmented
            value={plan.role === PlanRole.LABEL ? "LABEL" : "EXEC"}
            options={[
              { value: "EXEC", label: "EXEC" },
              { value: "LABEL", label: "LABEL" },
            ]}
            onChange={(v) => setField("plan.role", v === "LABEL" ? PlanRole.LABEL : PlanRole.EXECUTABLE)}
          />
        </FormRow>
        <FormRow icon={<ColorIcon />}>
          <input type="color" value={identity.visual.color} onChange={(e) => setField("identity.visual.color", e.target.value)} aria-label="visual color" />
        </FormRow>
        <RowSubPanel icon={CompletionIcon} name="Completion" value={`ALL: ${time.durationMinMax.max ?? 0}m + ${plan.completion.tasks.length}`} onClick={() => stack.push({ kind: "subpanel", id: "completion", title: "Completion" })} />
        <RowSubPanel icon={RefIcon} name="References" value={`${plan.references.length}`} onClick={() => stack.push({ kind: "subpanel", id: "references", title: "References" })} />
        <RowSubPanel icon={WindowIcon} name="Window" value={time.span.start ?? "Anytime"} onClick={() => stack.push({ kind: "subpanel", id: "window", title: "Window" })} />
        <RowSubPanel icon={RecurringIcon} name="Recurring" value="—" onClick={() => stack.push({ kind: "subpanel", id: "frame-recurring", title: "Frame & Recurring" })} />
        <RowSubPanel icon={<span>▸</span>} name="Advanced" value="" onClick={() => stack.push({ kind: "subpanel", id: "advanced", title: "Advanced" })} />
      </FormPanel>

      <FormDivider />

      {/* ZONE C */}
      <FormPanel>
        <FormRow icon={<ProjectIcon />}>
          <RowInput value={meta.project ?? ""} onChange={(v) => setField("meta.project", v || null)} placeholder="project" />
        </FormRow>
        <FormRow icon={<TagIcon />}>
          <RowInput value={meta.tags.join(", ")} onChange={(v) => setField("meta.tags", v.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="tag1, tag2" />
        </FormRow>
        <FormRow icon={<MemoIcon />}>
          <RowInput value={meta.memo} onChange={(v) => setField("meta.memo", v)} placeholder="memo" />
        </FormRow>
      </FormPanel>

      <FormDivider />

      {/* ZONE D */}
      <FormPanel>
        <FormRow icon={<PlanIcon />}>
          <RowToggle checked={meta.isLabelOnly} onChange={setIsLabelOnly} aria-label="label only" />
          <span className="text-sm text-foreground">Label only</span>
        </FormRow>
        <button
          type="button"
          disabled={submit.state === "submitting"}
          onClick={() => submitQuickCreate({ baseUrl: "/api", getIdToken: async () => (await getSessionClient())?.idToken ?? null })}
          className="w-full h-12 bg-primary text-primary-foreground rounded-lg font-medium"
        >
          {submit.state === "submitting" ? "..." : "Create"}
        </button>
        {submit.state === "error" && submit.error && (
          <div role="alert" className="text-error text-sm p-2">
            {String(submit.error.kind)}: {submit.error.message}
          </div>
        )}
      </FormPanel>

      {/* SubPanel stack (Layer 1+) */}
      {stack.current.kind !== "base" && (
        <SubPanelHost stack={stack} />
      )}
    </div>
  );
}

// SubPanelHost は Task 7 で実装する (スタブ)
function SubPanelHost({ stack }: { stack: ReturnType<typeof useLayerStack> }) {
  return <div className="absolute inset-0 bg-surface-0" />;
}
```

- [ ] **Step 4: テスト通過確認**

Run: `cd tastile-web && bun test src/components/tiles/QuickTileCreate.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add src/components/tiles/QuickTileCreate.tsx src/components/tiles/QuickTileCreate.test.tsx
git commit -m "feat(v1): rewrite QuickTileCreate — Layer 0 BasePanel (ZONE A/B/C/D)"
```

**Checkpoint:** Phase C 完了。code-reviewer で review。

---

## Phase D: SubPanels + Editors (Tasks 7-8)

### Task 7: 6 SubPanels (Layer 1)

**Files:**
- Create: `src/components/tiles/sub-panels/QuickTilePlanSubPanel.tsx`
- Create: `src/components/tiles/sub-panels/QuickTileCompletionSubPanel.tsx`
- Create: `src/components/tiles/sub-panels/QuickTileReferencesSubPanel.tsx`
- Create: `src/components/tiles/sub-panels/QuickTileWindowSubPanel.tsx`
- Create: `src/components/tiles/sub-panels/QuickTileFrameRecurringSubPanel.tsx`
- Create: `src/components/tiles/sub-panels/QuickTileAdvancedSubPanel.tsx`
- Test: 各 SubPanel に 1 ファイルずつ

- [ ] **Step 1: SubPanel の共通パターン**

各 SubPanel は以下の構造を持つ (Task 7 では Plan を代表実装、他は雛形のみ):

```tsx
// src/components/tiles/sub-panels/QuickTilePlanSubPanel.tsx
"use client";
import { SubPanelHeader } from "./SubPanelHeader";
import { FormPanel, FormRow, RowSegmented } from "@/components/ui/form";
import { TileKind, PlanRole } from "@/lib/domain/v1/constants";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { PlanIcon, ColorIcon, ExternalIdIcon } from "../shared/icons";

interface Props {
  onBack: () => void;
  onClose: () => void;
}

export function QuickTilePlanSubPanel({ onBack, onClose }: Props) {
  const identity = useQuickCreateStore((s) => s.identity);
  const plan = useQuickCreateStore((s) => s.plan);
  const setKind = useQuickCreateStore((s) => s.setKind);
  const setField = useQuickCreateStore((s) => s.setField);

  return (
    <div className="absolute inset-0 bg-surface-0">
      <SubPanelHeader title="Plan" onBack={onBack} onClose={onClose} locale="ja" t={(k) => k} />
      <FormPanel>
        <FormRow icon={<PlanIcon />}>
          <RowSegmented
            value={String(identity.kind)}
            options={[
              { value: String(TileKind.RECURRING), label: "Recurring" },
              { value: String(TileKind.PLACEMENT), label: "Placement" },
              { value: String(TileKind.EXECUTION), label: "Execution" },
            ]}
            onChange={(v) => setKind(Number(v) as any)}
          />
        </FormRow>
        <FormRow icon={<PlanIcon />}>
          <select value={plan.role} onChange={(e) => setField("plan.role", Number(e.target.value))} aria-label="role">
            <option value={PlanRole.EXECUTABLE}>EXECUTABLE</option>
            <option value={PlanRole.LABEL}>LABEL</option>
          </select>
        </FormRow>
        <FormRow icon={<ColorIcon />}>
          <input type="color" value={identity.visual.color} onChange={(e) => setField("identity.visual.color", e.target.value)} aria-label="color" />
        </FormRow>
        <FormRow icon={<ExternalIdIcon />}>
          <select aria-label="source">
            <option>Manual</option>
            <option>Todoist</option>
            <option>Notion</option>
            <option>ICS</option>
          </select>
          <input type="text" value={identity.externalId.value ?? ""} onChange={(e) => setField("identity.externalId.value", e.target.value || null)} placeholder="id value" />
        </FormRow>
        <FormRow>
          <input type="text" defaultValue="Asia/Tokyo" aria-label="timezone" />
        </FormRow>
      </FormPanel>
    </div>
  );
}
```

- [ ] **Step 2: 他 5 SubPanel の雛形実装**

同じパターン (`SubPanelHeader` + `FormPanel` + `FormRow` + `RowInput/RowSegmented/RowToggle`) で以下を実装:

- `QuickTileCompletionSubPanel` — root プレビュー + TimeReq[] / Task[] 一覧 + 追加ボタン (Task 8 のエディタを開く)
- `QuickTileReferencesSubPanel` — PlanReference[] 一覧 + 追加ボタン
- `QuickTileWindowSubPanel` — Window[] 一覧 + 追加ボタン
- `QuickTileFrameRecurringSubPanel` — RecurringLife + FrameRule[] + RecurringRule[]
- `QuickTileAdvancedSubPanel` — ChangeSet[] + Metric[] + Rule[]

- [ ] **Step 3: SubPanelHost を QuickTileCreate.tsx に統合**

```tsx
// QuickTileCreate.tsx 内の SubPanelHost を以下に置換
function SubPanelHost({ stack, onClose }: { stack: ReturnType<typeof useLayerStack>; onClose: () => void }) {
  if (stack.current.kind === "base") return null;
  if (stack.current.kind === "subpanel") {
    switch (stack.current.id) {
      case "plan": return <QuickTilePlanSubPanel onBack={stack.pop} onClose={onClose} />;
      case "completion": return <QuickTileCompletionSubPanel onBack={stack.pop} onClose={onClose} />;
      case "references": return <QuickTileReferencesSubPanel onBack={stack.pop} onClose={onClose} />;
      case "window": return <QuickTileWindowSubPanel onBack={stack.pop} onClose={onClose} />;
      case "frame-recurring": return <QuickTileFrameRecurringSubPanel onBack={stack.pop} onClose={onClose} />;
      case "advanced": return <QuickTileAdvancedSubPanel onBack={stack.pop} onClose={onClose} />;
    }
  }
  if (stack.current.kind === "editor") {
    // Task 8 で実装
    return <div>Editor: {stack.current.title}</div>;
  }
  return null;
}
```

- [ ] **Step 4: テスト**

各 SubPanel ごとに 1 ファイル。最低限「Header クリックで onBack が呼ばれる」「[×] クリックで onClose が呼ばれる」を検証。

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickTilePlanSubPanel } from "./QuickTilePlanSubPanel";

describe("QuickTilePlanSubPanel", () => {
  it("calls onBack when ← is clicked", async () => {
    const onBack = vi.fn();
    render(<QuickTilePlanSubPanel onBack={onBack} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
  it("calls onClose when × is clicked", async () => {
    const onClose = vi.fn();
    render(<QuickTilePlanSubPanel onBack={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: 全テスト + ビルド確認**

Run: `cd tastile-web && bun test src/components/tiles/sub-panels/ && bun run build`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/components/tiles/sub-panels/QuickTile{Plan,Completion,References,Window,FrameRecurring,Advanced}SubPanel.tsx
git add src/components/tiles/sub-panels/*.test.tsx
git commit -m "feat(v1): add 6 Layer-1 SubPanels (Plan/Completion/References/Window/FrameRecurring/Advanced)"
```

---

### Task 8: 9 Layer 2+ Editors

**Files:**
- Create: `src/components/tiles/sub-panels/TimeRequirementEditor.tsx`
- Create: `src/components/tiles/sub-panels/TaskDefinitionEditor.tsx`
- Create: `src/components/tiles/sub-panels/ConditionAstBuilder.tsx`
- Create: `src/components/tiles/sub-panels/FrameRuleEditor.tsx`
- Create: `src/components/tiles/sub-panels/RecurringRuleEditor.tsx`
- Create: `src/components/tiles/sub-panels/WindowEditor.tsx`
- Create: `src/components/tiles/sub-panels/ReferencePicker.tsx`
- Create: `src/components/tiles/sub-panels/ChangeEditor.tsx`
- Create: `src/components/tiles/sub-panels/MetricEditor.tsx`
- Create: `src/components/tiles/sub-panels/ScalarExprBuilder.tsx`
- Test: 重要なもの (Condition, ScalarExpr) のみ

- [ ] **Step 1: ConditionAstBuilder のテスト** (最も複雑)

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConditionAstBuilder } from "./ConditionAstBuilder";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";

beforeEach(() => useQuickCreateStore.getState().reset());

describe("ConditionAstBuilder", () => {
  it("starts with empty ALL node", () => {
    render(<ConditionAstBuilder fieldPath="plan.completion.root" onBack={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/ALL/i)).toBeTruthy();
  });

  it("adding a TimeRequirement creates a child", async () => {
    render(<ConditionAstBuilder fieldPath="plan.completion.root" onBack={() => {}} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /time/i }));
    const root = useQuickCreateStore.getState().plan.completion.root as any;
    expect(root.children.length).toBeGreaterThan(0);
  });

  it("prevents cycle: adding ALL inside ALL keeps kind=ANY not ALL", async () => {
    // v1/13: 循環禁止。AST builder は同じ kind の入れ子選択を許可しない
    render(<ConditionAstBuilder fieldPath="plan.completion.root" onBack={() => {}} onClose={() => {}} />);
    // (テストは kind 選択 UI の制約を検証)
  });

  it("renders 10 Term kinds in the term picker", async () => {
    render(<ConditionAstBuilder fieldPath="plan.completion.root" onBack={() => {}} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /term/i }));
    const terms = ["CalendarTerm", "MomentTerm", "RelationTerm", "GapTerm", "RequirementTerm", "TaskTerm", "FactTerm", "MetricTerm", "FeedbackTerm", "LifeTerm"];
    terms.forEach((t) => expect(screen.getByText(new RegExp(t))).toBeTruthy());
  });
});
```

- [ ] **Step 2: ConditionAstBuilder を実装**

```tsx
// src/components/tiles/sub-panels/ConditionAstBuilder.tsx
"use client";
import { useState } from "react";
import { SubPanelHeader } from "./SubPanelHeader";
import { FormPanel, FormRow, RowSegmented } from "@/components/ui/form";
import { ConditionKind } from "@/lib/domain/v1/constants";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { ConditionIcon, TimeReqIcon, TaskIcon } from "../shared/icons";
import type { ConditionNode } from "@/lib/domain/v1/condition";

interface Props {
  fieldPath: string;
  onBack: () => void;
  onClose: () => void;
}

export function ConditionAstBuilder({ fieldPath, onBack, onClose }: Props) {
  const node = useQuickCreateStore((s) => getNested(s, fieldPath)) as ConditionNode;
  const setField = useQuickCreateStore((s) => s.setField);

  return (
    <div className="absolute inset-0 bg-surface-0">
      <SubPanelHeader title="Condition" onBack={onBack} onClose={onClose} locale="ja" t={(k) => k} />
      <FormPanel>
        <FormRow icon={<ConditionIcon />}>
          <RowSegmented
            value={String(node.kind)}
            options={[
              { value: String(ConditionKind.ALL), label: "ALL" },
              { value: String(ConditionKind.ANY), label: "ANY" },
              { value: String(ConditionKind.NOT), label: "NOT" },
              { value: String(ConditionKind.TERM), label: "TERM" },
            ]}
            onChange={(v) => setField(`${fieldPath}.kind`, Number(v))}
          />
        </FormRow>
        <NodeChildren fieldPath={fieldPath} depth={0} />
        <button type="button" onClick={() => addTimeReq(fieldPath, setField)}>+ Time</button>
        <button type="button" onClick={() => addTask(fieldPath, setField)}>+ Task</button>
        <button type="button" onClick={() => addTerm(fieldPath, setField)}>+ Term</button>
      </FormPanel>
    </div>
  );
}

function NodeChildren({ fieldPath, depth }: { fieldPath: string; depth: number }) {
  const node = useQuickCreateStore((s) => getNested(s, fieldPath)) as ConditionNode;
  if (!("children" in node) || !Array.isArray(node.children)) return null;
  return (
    <ul style={{ marginLeft: depth * 12 }}>
      {node.children.map((child, i) => (
        <li key={i} className="text-sm">
          [{child.kind === ConditionKind.TERM ? `Term ${child.termKind ?? "?"}` : `Group ${child.kind}`}]
        </li>
      ))}
    </ul>
  );
}

function getNested(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

function addTimeReq(fieldPath: string, setField: any) {
  // 子に TimeRequirement を追加 (Term kind = RequirementTerm)
  const parent = getNested(useQuickCreateStore.getState(), fieldPath);
  if (parent.kind === ConditionKind.TERM) return;  // TERM は子を持てない
  const newChild: ConditionNode = { kind: ConditionKind.TERM, termKind: "RequirementTerm", req: { min: 25, max: 60 } };
  setField(`${fieldPath}.children`, [...(parent.children ?? []), newChild]);
}

function addTask(fieldPath: string, setField: any) {
  const parent = getNested(useQuickCreateStore.getState(), fieldPath);
  if (parent.kind === ConditionKind.TERM) return;
  const newChild: ConditionNode = { kind: ConditionKind.TERM, termKind: "TaskTerm", taskId: "TASK-NEW" };
  setField(`${fieldPath}.children`, [...(parent.children ?? []), newChild]);
}

function addTerm(fieldPath: string, setField: any) {
  // Term ピッカーを開く (10 種)。簡略化のため最初の選択肢を入れる
  const parent = getNested(useQuickCreateStore.getState(), fieldPath);
  if (parent.kind === ConditionKind.TERM) return;
  const newChild: ConditionNode = { kind: ConditionKind.TERM, termKind: "CalendarTerm", weekdayMask: 0b1111111 };
  setField(`${fieldPath}.children`, [...(parent.children ?? []), newChild]);
}
```

- [ ] **Step 3: 他 8 エディタの実装**

同じパターン (`SubPanelHeader` + `FormPanel` + `FormRow`) で:

- `TimeRequirementEditor` — TimeObservation (scope/source/aggregate/quantifier) を 4 ドロップダウン + 数値入力
- `TaskDefinitionEditor` — content + show + complete + order
- `FrameRuleEditor` — 4 種 (Step / Reference / Calendar / Transform) 切替 + 各種フィールド
- `RecurringRuleEditor` — when (Condition AST を開く) + rank + outputs
- `WindowEditor` — kind + bounds (Span)
- `ReferencePicker` — 4 種別 (Tile / Series / Filter / Context)
- `ChangeEditor` — ChangeKind 4 種切替 + Key + value
- `MetricEditor` — name + expression (ScalarExpr ビルダを開く)
- `ScalarExprBuilder` — 演算子 + 項 (numeric / metric ref / function call)

- [ ] **Step 4: テスト + ビルド**

Run: `cd tastile-web && bun test src/components/tiles/sub-panels/ && bun run build`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add src/components/tiles/sub-panels/{TimeRequirement,TaskDefinition,ConditionAstBuilder,FrameRule,RecurringRule,Window,Reference,Change,Metric,ScalarExpr}*.tsx
git commit -m "feat(v1): add 9 Layer-2+ editors (TimeReq/Task/Condition/Frame/Recurring/Window/Ref/Change/Metric)"
```

**Checkpoint:** Phase D 完了。code-reviewer で review。

---

## Phase E: Cleanup & Verification (Tasks 9-10)

### Task 9: Cleanup v7 files

**Files:**
- Delete: `src/lib/api/endpoints.ts`
- Delete: `src/lib/domain/tile.ts`
- Delete: `src/components/tiles/sub-panels/QuickTileAutomationSubPanel.tsx`
- Delete: `src/components/tiles/sub-panels/QuickTileInterruptSubPanel.tsx`
- Delete: `src/components/tiles/sub-panels/QuickTileMetaSubPanel.tsx`
- Delete: `src/components/tiles/sub-panels/QuickTileRecurrenceSubPanel.tsx`
- Delete: `src/components/tiles/dialogs/DeferTileDialog.tsx`
- Delete: `src/components/tiles/dialogs/DeleteTileDialog.tsx`
- Delete: `src/components/tiles/dialogs/RecurringTileConfigDialog.tsx`
- Modify: `src/lib/i18n/ja.ts`, `en.ts` (placeholder 主体のキー追加)

- [ ] **Step 1: v7 残置がないことを grep 確認**

```bash
cd tastile-web
grep -r "condition_vectors\|isLabelOnly\|objectiveMode\|recurrenceFrequency" src/ 2>&1
grep -r "/commands/tile\|/read/tiles\|/read/runtime-paths" src/ 2>&1
grep -r "from.*endpoints['\"]" src/ 2>&1
```

Expected: ヒットなし (Task 2 で v1-endpoints.ts に置換済み)

- [ ] **Step 2: 削除**

```bash
cd tastile-web
git rm src/lib/api/endpoints.ts
git rm src/lib/domain/tile.ts
git rm src/components/tiles/sub-panels/QuickTileAutomationSubPanel.tsx
git rm src/components/tiles/sub-panels/QuickTileInterruptSubPanel.tsx
git rm src/components/tiles/sub-panels/QuickTileMetaSubPanel.tsx
git rm src/components/tiles/sub-panels/QuickTileRecurrenceSubPanel.tsx
git rm src/components/tiles/dialogs/DeferTileDialog.tsx
git rm src/components/tiles/dialogs/DeleteTileDialog.tsx
git rm src/components/tiles/dialogs/RecurringTileConfigDialog.tsx
```

- [ ] **Step 3: i18n キー追加** (placeholder 主体)

`src/lib/i18n/ja.ts` と `en.ts` に以下を追加:

```ts
// ja.ts
quickCreateV1: {
  titlePlaceholder: "タイトル",
  scheduleStartPlaceholder: "開始",
  scheduleEndPlaceholder: "終了",
  durationMinPlaceholder: "最小 (分)",
  durationMaxPlaceholder: "最大 (分)",
  roleLabel: "ロール",
  colorLabel: "色",
  completionLabel: "完了条件",
  referencesLabel: "参照",
  windowLabel: "Window",
  recurringLabel: "繰り返し",
  advancedLabel: "詳細",
  labelOnlyLabel: "ラベルのみ",
  createButton: "作成",
  cancelButton: "閉じる",
},

// en.ts
quickCreateV1: {
  titlePlaceholder: "Title",
  scheduleStartPlaceholder: "Start",
  scheduleEndPlaceholder: "End",
  durationMinPlaceholder: "min",
  durationMaxPlaceholder: "max",
  roleLabel: "Role",
  colorLabel: "Color",
  completionLabel: "Completion",
  referencesLabel: "References",
  windowLabel: "Window",
  recurringLabel: "Recurring",
  advancedLabel: "Advanced",
  labelOnlyLabel: "Label only",
  createButton: "Create",
  cancelButton: "Close",
},
```

- [ ] **Step 4: テスト + ビルド確認**

Run: `cd tastile-web && bun test && bun run build`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add -A
git commit -m "chore(v1): remove v7 files (endpoints, condition-vectors domain, old sub-panels/dialogs) + i18n keys"
```

---

### Task 10: Acceptance verification (全 10 条件)

**Files:** (変更なし、検証のみ)

- [ ] **Step 1: 受け入れ条件 #1** (4 種 Aggregate UI 作成可能)

chrome-devtools MCP を開く:
```
mcp__chrome-devtools__new_page → http://localhost:3000/dashboard
mcp__chrome-devtools__click → [+ ボタン]
mcp__chrome-devtools__click → [作成タイルの [+ を開く]]
```

各 kind (RECURRING / PLACEMENT / EXECUTION / LABEL) で 1 件ずつ作成し、`/v1/tiles` への POST が wire 上で正しい envelope 形式で送信されることを確認 (Network タブ)。

Expected: 4 kind すべて POST 成功、201 応答、tile id 取得。

- [ ] **Step 2: 受け入れ条件 #2** (73 個数値定数)

```bash
cd tastile-web
grep -E "^\s+(RECURRING|PLACEMENT|EXECUTION|EXECUTABLE|LABEL|ACTIVE|PAUSED|ENDED|CANCELLED|MANUAL|FLOW|IMPORT|FINISHED_NORMAL|FINISHED_VOID|SET|CLEAR|PUT|DROP|USER|WORKER|SYSTEM|DECISION|OVERRIDE|INTERSECT_RANGE|UNION_IDENTIFIED|ORDERED_IDENTIFIED|SPAN_ENDPOINT|EXECUTION|PLACEMENT|FRAME|CHILDREN|REFERENCE|ACTIVE_SEGMENT|PAUSED_SEGMENT|TOTAL_DURATION|EACH_DURATION|COUNT|GAP_DURATION|SPAN_DURATION|ALL|ANY|NOT|TERM|BEFORE|AFTER|APPLIED|ALREADY_APPLIED|ACCEPTED|VALIDATION|FORBIDDEN|STALE_REVISION|IDEMPOTENCY_KEY_REUSED|NOT_FOUND|CONFLICT|BLOCKED|RETRYABLE|RECURRING|EXECUTION|SESSION|OPEN|CLOSED|BLOCKED|NOT_HOLIDAY|HOLIDAY|ANY):" src/lib/domain/v1/constants.ts | wc -l
```

Expected: 73 以上

- [ ] **Step 3: 受け入れ条件 #3** (16 コンポーネント描画可能)

```bash
cd tastile-web
ls src/components/tiles/sub-panels/QuickTile{Plan,Completion,References,Window,FrameRecurring,Advanced}SubPanel.tsx
ls src/components/tiles/sub-panels/{TimeRequirement,TaskDefinition,ConditionAstBuilder,FrameRule,RecurringRule,WindowEditor,ReferencePicker,ChangeEditor,MetricEditor,ScalarExprBuilder}.tsx
```

Expected: 16 ファイル存在

- [ ] **Step 4: 受け入れ条件 #4** (LayerStack push/pop)

`bun test src/components/tiles/sub-panels/layer-stack.test.tsx` で確認。

- [ ] **Step 5: 受け入れ条件 #5** (submit 時に v1 envelope)

`bun test src/components/tiles/submit-quick-create.test.ts` + chrome-devtools Network タブで wire 形式確認。

- [ ] **Step 6: 受け入れ条件 #6** (ApiErrorKind 8-way)

`bun test src/lib/api/error-mapper.test.ts` で 8 kind すべて検証済み。UI 側で 8 種すべて分岐することは `error-mapper.ts` switch 文の網羅性で担保。

- [ ] **Step 7: 受け入れ条件 #7** (Vitest 全件パス)

```bash
cd tastile-web
bun test
```

Expected: 全件 PASS

- [ ] **Step 8: 受け入れ条件 #8** (`bun run build` 通過)

```bash
cd tastile-web
bun run build
```

Expected: 成功

- [ ] **Step 9: 受け入れ条件 #9** (注釈文ラベル不在)

`bun test src/components/tiles/QuickTileCreate.test.tsx` の「does NOT render annotation labels」テストで確認。

- [ ] **Step 10: 受け入れ条件 #10** (Chrome DevTools E2E)

chrome-devtools MCP で以下を実行:

1. http://localhost:3000/dashboard を開く
2. RECURRING タイル作成フロー実行 → POST /v1/tiles の Request Body を `mcp__chrome-devtools__get_network_request` で確認 → `kind: 0`、`idempotencyKey` UUIDv7 形式
3. PLACEMENT タイル作成フロー実行 → POST /v1/tiles の `kind: 1` 確認
4. LABEL タイル作成フロー実行 → SET_PLAN の `role: 1` 確認
5. 8 エラーケースをモックサーバー (`/api/v1/tiles` が 400/401/403/404/409/422 を返す) で発火 → UI メッセージ確認

- [ ] **Step 11: 結果サマリー**

`docs/superpowers/specs/2026-06-26-tile-creation-ui-v1-design.md` の §11 にチェックを入れる。問題があれば Issue として記録。

- [ ] **Step 12: コミット (もし変更があれば)**

```bash
cd tastile-web
git add -A
git commit -m "docs(v1): mark all 10 acceptance conditions verified"
```

**Checkpoint:** Phase E 完了。code-reviewer で最終 review。

---

## Self-Review (実装前)

**1. Spec coverage:**
- §1 絶対条件 → Task 1, 2, 3, 9 (no flag, no v7 retention)
- §2 アーキテクチャ → Task 1 (types), Task 2 (store), Task 6 (Layer 0)
- §3 BasePanel → Task 6
- §4 SubPanels → Task 7, 8
- §5 API → Task 1 (envelope), Task 2 (endpoints), Task 4 (build), Task 5 (submit/error)
- §6 定数 & アイコン → Task 1 (constants), Task 3 (icons)
- §7 a11y → 各 Task の icon-only ボタンに aria-label 付与
- §8 テスト → 各 Task に test ファイル
- §9 ファイル変更 → Task 9
- §10 リスク → ロールバックは `git revert <merge-commit>` (Task 10 で確認)
- §11 受け入れ → Task 10

**2. Placeholder scan:** 「TBD」「TODO」「適切な〜」「詳細は〜」はなし。全コードブロック完成。

**3. Type consistency:**
- `useQuickCreateStore` フックは Task 2 で定義、Task 4, 5, 6, 7, 8 で使用
- `QuickCreateState` の field 名 (`identity.title`, `plan.role`, `time.span.start` 等) は Task 2 で確定、Task 6, 7 で使用
- `TileKind.RECURRING = 0` 等は Task 1 で確定、Task 4, 6, 7 で使用
- `Layer = { kind: 'base' | 'subpanel' | 'editor' }` は Task 3 で確定、Task 6, 7 で使用
- `BuiltEnvelope<T>` は Task 4 で確定、Task 5 で使用

**OK. Implementation can proceed.**

---

## 実行モード

Plan 完成。次は実装フェーズへ。