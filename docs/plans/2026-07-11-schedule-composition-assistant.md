# Schedule Composition Assistant Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional composition-assistance layer that helps first-time users turn their own scheduling intent into an inspectable, editable Tastile aggregate draft, while keeping the core tile editor as the authoritative direct editor.

**Architecture:** The editor and assistant are separate surfaces over one server-owned `ScheduleDefinitionDraft`. The assistant never writes Tile/Plan/Window/Flow directly and never replaces the editor; it proposes typed draft operations with explanations. The user can accept all, accept individual changes, edit directly, or discard the draft. Only the existing aggregate command publishes an accepted draft atomically.

**Tech Stack:** Rust v1 domain/storage/api, PostgreSQL, Next.js 16/React 19/TypeScript, Vitest, Playwright.

---

## 1. Non-negotiable boundaries

### 1.1 Assistant is not a scheduling template system

- Do not add “meeting”, “homework”, “semester task”, or other task-type enums.
- Do not store a natural-language interpretation as an opaque JSON source of truth.
- Do not add a separate “assistant schedule” model.
- Do not bypass v1 command validation, Window resolution, completion evaluation, or Flow materialization.

### 1.2 Editor remains independently complete

- Every accepted draft operation maps to one visible direct-editor panel.
- A user can build the same aggregate without the assistant.
- Assistant availability, model failure, or refusal must never block direct creation/editing.
- The assistant may propose structure; it never silently publishes, deletes, or materializes a Placement.

### 1.3 One canonical write boundary

```text
Assistant draft operations / direct editor operations
                     ↓
          ScheduleDefinitionDraft (server-owned)
                     ↓
       validate + explain + preview projection
                     ↓
   PublishScheduleDefinition command (one transaction)
                     ↓
Tile + Plan + Window + Reference + Rules + Flow
```

---

## 2. Concrete UI design

### 2.1 Entry point

The editor header has a secondary button: **「組み立てを手伝ってもらう」**.

- It opens a separate full-height assistant sheet, not a replacement for the editor.
- Closing it returns to the unchanged editor draft.
- The editor remains available at all times.

### 2.2 Assistant sheet layout

```text
┌─────────────────────────────────────────────────────────┐
│ ← タイル編集に戻る              組み立てを手伝う        │
├──────────────────────┬──────────────────────────────────┤
│ Intent conversation  │ Draft preview                    │
│                      │                                  │
│ [自由入力]           │ 競プロ                           │
│ 「一学期中に…」      │ ・必要時間: 20時間               │
│                      │ ・可能時間: 一学期 / 平日夜      │
│ Assistant question   │ ・完了: 合計20時間               │
│ 「一学期」は既存の   │ ・配置: 条件を満たす空きへ提案   │
│ ラベルですか？       │                                  │
│ [既存から選ぶ]       │ Changes                          │
│ [新しい期間を作る]   │ + LABEL_SPAN Window              │
│                      │ + CALENDAR Window                │
│                      │ + TimeRequirement                │
│                      │ + Flow candidate                 │
│                      │                                  │
│                      │ [各変更を適用] [すべて適用]       │
└──────────────────────┴──────────────────────────────────┘
```

### 2.3 Input behavior

1. User writes free text or begins from a blank draft.
2. Assistant extracts only *candidate concepts*: title, duration/range, time phrase, deadline phrase, completion phrase, possible references.
3. If a candidate has multiple valid mappings or needs a target, ask one concise disambiguation question.
4. Render a typed operation list, each with:
   - human summary,
   - affected editor section,
   - schema target,
   - validation state,
   - accept/reject/edit action.
5. Accepted operations mutate `ScheduleDefinitionDraft`; the editor projection updates immediately.
6. User publishes from the editor, not from conversation.

### 2.4 Reference-selection interaction

For phrases such as “一学期”, “授業の後”, “レポート提出まで”:

- Never create a hidden reference from text.
- Show compatible catalog results with type, date range/status, and owner.
- Actions:
  - select an existing compatible target;
  - create a new Label/Placement in a dedicated mini-flow;
  - keep unresolved as a visible draft question.
- An unresolved reference prevents only dependent operations from being accepted, not unrelated draft edits.

---

## 3. Draft schema and API contract

### 3.1 Draft

```text
ScheduleDefinitionDraft
├─ id: UUIDv7
├─ ownerId: UUIDv7
├─ base: TileBaseDraft
├─ plan: PlanDraft
├─ windows: DraftNode<Window>[]
├─ references: DraftNode<Reference>[]
├─ placementRules: DraftNode<PlacementRule>[]
├─ nestingRules: DraftNode<NestingRule>[]
├─ recurring: DraftNode<Recurring> | null
├─ flows: DraftNode<Flow>[]
├─ operations: DraftOperation[]
├─ unresolved: DraftQuestion[]
└─ revision: Int64
```

`DraftNode` contains typed v1-shaped values plus `origin = DIRECT | ASSISTED`, explanation text, and validation diagnostics. It is a draft/read model only; normalized v1 tables remain the published source of truth.

### 3.2 Operations

```text
DraftOperation
├─ id: UUIDv7
├─ kind: SET_BASE | PUT_WINDOW | PUT_REFERENCE | PUT_COMPLETION
│       | PUT_PLACEMENT_RULE | PUT_NESTING_RULE | PUT_RECURRING | PUT_FLOW
├─ target: typed node key
├─ value: typed payload
├─ explanation: localized human text
├─ dependencies: DraftOperationId[]
├─ state: PROPOSED | ACCEPTED | REJECTED | BLOCKED
└─ diagnostics[]
```

`value` is normalized typed request data, not JSONB persistence. Operation kinds are numeric in the core registry; names above are documentation labels only.

### 3.3 Endpoints

| Endpoint | Purpose | Writes published data? |
|---|---|---|
| `POST /v1/schedule-drafts` | Create empty draft | No |
| `GET /v1/schedule-drafts/{id}` | Editor/assistant projection | No |
| `POST /v1/schedule-drafts/{id}/operations` | Add direct or assisted typed operations | No |
| `POST /v1/schedule-drafts/{id}/resolve-reference` | Bind a catalog target | No |
| `POST /v1/schedule-drafts/{id}/preview` | Validate and show effective composition | No |
| `POST /v1/schedule-drafts/{id}/publish` | Atomic aggregate creation/update | Yes |
| `GET /v1/reference-catalog?... ` | Compatible labels/placements/plans | No |

The language-model/intent service is behind a server adapter. Its output must be validated into `DraftOperation` before it can affect a draft. It has no database credentials and cannot call publish.

---

## 4. Implementation order

### Phase A — Aggregate publishing foundation (P0)

**Goal:** Publish a complete ScheduleDefinition atomically without creating a fixed Placement.

1. Define `PublishScheduleDefinition` command and typed child payloads in domain.
2. Add domain validation:
   - UUIDv7 only;
   - valid Window/reference target kinds;
   - no nesting cycle;
   - Range validity;
   - Flow proposal references a compatible Plan/Scope;
   - no unresolved operation at publish.
3. Implement storage transaction and API handler.
4. Add Domain Unit, PostgreSQL integration, and command-worker E2E tests.

**Exit criteria:**
- The “semester label → label-span window → 20h requirement → flow proposal” aggregate publishes in one transaction.
- No Placement is created until materialization.
- A validation error writes no partial aggregate.

### Phase B — Editor projection and direct panels (P1)

**Goal:** Direct editing can construct every supported composition node without UUID/number inputs.

1. Build read projection and compatible reference catalog.
2. Replace raw IDs/numeric controls with typed pickers and human labels.
3. Split `QuickTileCreate` into shell plus Schedule, Completion, Relationships, Automation panels.
4. Make base summary read-only for each panel-owned property.

**Exit criteria:**
- Every published node can be reopened, understood, and edited from its owning panel.
- A user can create the semester-label path without the assistant.

### Phase C — Draft system (P2)

**Goal:** Direct editor and assistant share a server-owned draft safely.

1. Add draft tables, repository, revision/idempotency rules, and API endpoints.
2. Implement `DraftOperation` validation, dependencies, rejection, and preview diagnostics.
3. Connect direct editor edits to draft operations.
4. Add conflict/stale-revision tests.

**Exit criteria:**
- Discarding a draft never changes published schedule data.
- Editor and assistant views converge to the same draft revision.
- One rejected operation never discards independent accepted operations.

### Phase D — Assistant adapter and sheet (P3)

**Goal:** Translate user intent into reviewable operations, never opaque writes.

1. Build assistant sheet and conversation state.
2. Add intent adapter contract:
   - input: text + current draft projection + allowed catalog summaries;
   - output: proposed operations and explicit questions only.
3. Validate every proposed operation through the same draft endpoint.
4. Add catalog resolution mini-flow and per-operation accept/reject/edit controls.
5. Ensure assistant failures leave the draft/editor usable.

**Exit criteria:**
- The assistant can propose, but cannot publish.
- Every accepted suggestion appears immediately in the direct editor.
- An ambiguous phrase results in a question or unresolved draft item, never a guessed hidden reference.

### Phase E — Browser acceptance and accessibility (P4)

1. Test keyboard-only operation of the assistant sheet and editor.
2. Test no console errors, no background publish, no duplicate controls.
3. Test the four acceptance scenarios below on desktop and mobile widths.

---

## 5. Acceptance scenarios

### AT-UI-001: Explicit fixed meeting

Input: “明日 14:00–15:00 に会議”.

Expected:
- Assistant may propose a fixed Placement.
- User sees start/end before accepting.
- Published result has one Placement span and no Flow is required.

### AT-UI-002: Semester-bounded flexible task

Input: “一学期中に競プロを20時間終える”.

Expected:
- Assistant asks to select/create “一学期” if unresolved.
- Accepted draft contains a LABEL_SPAN Window, TimeRequirement, and Flow proposal.
- No fixed Placement exists before materialization.

### AT-UI-003: Deadline-bounded homework

Input: “レポートを7月20日までに終える。90分必要”.

Expected:
- Assistant proposes a deadline/milestone condition, 90-minute requirement, and asks for allowed windows only if missing.
- Deadline is represented by reference/condition, not by silently creating a full-day Placement.

### AT-UI-004: Daily 22:00 study

Input: “毎日22時に競プロを1時間する”.

Expected:
- Draft contains a daily Frame, CALENDAR Window at 22:00, 60-minute requirement, and Flow proposal.
- User can revise recurrence/window independently in direct panels.

### AT-UI-005: Direct editor parity

For every accepted assistant operation:
- the corresponding direct editor panel displays the same value;
- changing it directly changes the draft projection;
- no duplicate field edits the same value.

### AT-UI-006: Safety

- Assistant timeout/error leaves draft unchanged.
- Unresolved/cyclic/deleted reference cannot publish.
- Partial publish never occurs.
- Assistant text cannot cause a command outside the typed operation allowlist.

---

## 6. Definition of done

This work is complete only when all conditions hold:

1. A user can create, reopen, and edit the four acceptance scenarios without seeing UUIDs, numeric kind values, AST term names, or raw Flow payloads.
2. The direct editor remains fully functional without assistant access.
3. Assistant suggestions are individually reviewable, reversible before publish, and mapped to one direct-editor location.
4. Core publishes the whole aggregate atomically; no flexible task receives a fabricated Placement span.
5. Reference selection is catalog-based and validates compatibility/cycles.
6. Domain Unit, PostgreSQL Integration, Command-Worker E2E, web unit, and browser acceptance suites pass.
7. The browser console has no errors, and keyboard navigation works for both editor and assistant sheet.
8. No generic Advanced accordion, no duplicate controls, no user-facing raw IDs/numeric constants remain.
