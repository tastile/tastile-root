# Web study-life completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scenario A (create a test-study task on a weekly Mon-Fri 19:00-21:00 JST schedule, see the placement on Day view, start execution, finish) green end-to-end on the `tastile-web` package against the WSLC stack.

**Architecture:** Bottom-up. The `tastile-core` C1-C8 work is already shipped (commits 322f680 … 4742320). The real gaps on `main` are: (a) `submit.ts` overwrites `plan.completion.root` with a placeholder; (b) there is no dedicated DecisionPromptSheet surface reading real sessions; (c) no Playwright spec for scenario A. We fix submit first, split `AutomationPanel`/`ConditionEditor` into `SourceGenerationPanel` + `ConditionPanel`, build the Session sheet, add the E2E, and verify WSLC green. No core migration, no Android.

**Tech Stack:** Next.js 16 + React 19.2 + Mantine 9.4 + TanStack Query 5 + Zustand 5. Vitest 4 for unit, Playwright 1.62 for E2E, biome 2.5 + eslint 9 + tsc 5 for quality. Web's core API integration path goes through `NEXT_PUBLIC_TASTILE_CORE_V1_URL` (proxy `/api/proxy/v1` by default) per `playwright.config.ts` and `submit.ts:makeClient`. E2E bypass auth uses `NEXT_PUBLIC_E2E_BYPASS_AUTH=1` and the dev token `e2e-bypass-token` already in `submit.ts`.

---

## File structure (preview)

### Add (new files)
- `tastile-web/src/components/tiles/editor/SourceGenerationPanel.tsx` — top-level editor panel for `state.recurring` (occurrence kind, weekday, end date, offsetMin).
- `tastile-web/src/components/tiles/editor/ConditionPanel.tsx` — thin wrapper that exposes `state.plan.completion.root` via the existing `ConditionEditor`.
- `tastile-web/src/components/execution/DecisionPromptSheet.tsx` — renders pending Decision sessions as cards with answer buttons.
- `tastile-web/src/components/decision/InteractionTreeForm.tsx` — renders InteractionNode tree for one session's answer flow.
- `tastile-web/src/lib/hooks/use-pending-sessions.ts` — TanStack Query wrapper for the pending sessions list (data source decided in W3 probe).
- `tastile-web/src/lib/api/v1/sessions.ts` — `listPendingSessions`, `getSession`, `submitFeedback` (typed API calls).
- `tastile-web/src/lib/api/v1/submit.test.ts` — vitest unit.
- `tastile-web/src/components/tiles/editor/SourceGenerationPanel.test.tsx` — vitest component.
- `tastile-web/src/components/tiles/editor/ConditionPanel.test.tsx` — vitest component.
- `tastile-web/src/components/execution/DecisionPromptSheet.test.tsx` — vitest component.
- `tastile-web/e2e/scenario-A-test-study.spec.ts` — Playwright spec.
- `tastile-core/crates-v1/api/src/handlers/read_sessions.rs` (only if W3 probe requires) — minimal `list` handler.

### Modify
- `tastile-web/src/lib/api/v1/submit.ts` — drop placeholder, read `state.plan.completion.root` from store.
- `tastile-web/src/components/tiles/QuickTileCreate.tsx` — import the two new panels, swap inline duplicates for them.
- `tastile-web/src/components/tiles/editor/AutomationPanel.tsx` — re-export `SourceGenerationPanel` for back-compat.
- `tastile-web/src/app/app/prompt/page.tsx` — host `DecisionPromptSheet`.
- `tastile-web/src/components/notifications/NotificationsMenu.tsx` — wire one-click open to `DecisionPromptSheet`.

---

## Phase W1 — Submit path

### Task 1: Failing test for `storeToSnapshot` reading real `plan.completion.root`

**Files:**
- Test: `tastile-web/src/lib/api/v1/submit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tastile-web/src/lib/api/v1/submit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { ConditionKind } from "@/lib/domain/v1/constants";
import { submitCreateTile } from "./submit";

describe("submitCreateTile — plan.completion.root passthrough", () => {
  beforeEach(() => {
    useQuickCreateStore.getState().resetAll?.();
  });

  it("POSTs plan.completion.root from the store, not a placeholder ALL", async () => {
    const store = useQuickCreateStore.getState();
    store.setField("identity.title", "Test study");
    store.setField("identity.kind", "RECURRING");
    store.setField("time.span.start", "2026-07-27T19:00:00.000Z");
    store.setField("time.span.end", null);
    store.setField("time.offsetMin", 540);
    store.setField("time.durationMinMax.minMs", 60 * 60 * 1000);
    store.setField("time.durationMinMax.maxMs", 150 * 60 * 1000);
    store.setField("plan.completion.root", {
      kind: ConditionKind.ALL,
      children: [{ kind: ConditionKind.TERM, term: { kind: "calendar", value: { weekdayMask: 0x1f } }, children: [], term: null }],
      term: null,
    });

    const captured: { body: string } = { body: "" };
    const client = {
      baseUrl: "http://stub",
      useProxyBridge: false,
      getIdToken: async () => "e2e-bypass-token",
      post: async (path: string, body: unknown) => {
        captured.body = JSON.stringify(body);
        return { ok: true, status: 200 };
      },
    };
    const apiClient = { ...client, post: client.post } as unknown as Parameters<typeof submitCreateTile>[0]["client"];

    const result = await submitCreateTile({ client: apiClient });
    expect(result.ok).toBe(true);
    const posted = JSON.parse(captured.body);
    expect(posted.plan.completion.root.kind).toBe(ConditionKind.ALL);
    expect(posted.plan.completion.root.children).toHaveLength(1);
    expect(posted.plan.completion.root.children[0].kind).toBe(ConditionKind.TERM);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/lib/api/v1/submit.test.ts`
Expected: FAIL — `expected posted.plan.completion.root.children to have length 1, but got 0` because `submit.ts` currently overwrites with `{ kind: ALL, children: [], term: null }`.

- [ ] **Step 3: Implement the fix in `submit.ts`**

Edit `tastile-web/src/lib/api/v1/submit.ts`:
- Remove the block that declares `const completionRoot = { kind: ConditionKind.ALL, children: [], term: null };`.
- Replace `root: completionRoot` with `root: state.plan.completion.root`.
- Remove the now-unused import of `ConditionKind` if it has no other use in the file. Leave any other references intact.

```ts
function storeToSnapshot(): QuickCreateSnapshot {
  const state = useQuickCreateStore.getState();
  return {
    identity: { /* unchanged */ },
    plan: {
      role: state.plan.role,
      references: state.plan.references,
      completion: {
        root: state.plan.completion.root,
        timeRequirements: state.plan.completion.timeRequirements,
        tasks: tasksForSubmission(state.plan.completion.tasks),
      },
      planning: state.plan.planning,
      metrics: state.plan.metrics,
    },
    time: { /* unchanged */ },
    windows: state.windows,
    recurring: { /* unchanged */ },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/lib/api/v1/submit.test.ts`
Expected: PASS, 1 passed.

- [ ] **Step 5: Confirm no other tests regressed**

Run: `bun run test:unit`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
cd tastile-web
git add src/lib/api/v1/submit.ts src/lib/api/v1/submit.test.ts
git commit -m "fix(web): submit storeToSnapshot no longer drops plan.completion.root"
```

---

## Phase W2 — Panel split

### Task 2: Failing test for `SourceGenerationPanel` writing weekday to `state.recurring`

**Files:**
- Create: `tastile-web/src/components/tiles/editor/SourceGenerationPanel.tsx`
- Test: `tastile-web/src/components/tiles/editor/SourceGenerationPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tastile-web/src/components/tiles/editor/SourceGenerationPanel.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { SourceGenerationPanel } from "./SourceGenerationPanel";

describe("SourceGenerationPanel", () => {
  beforeEach(() => {
    useQuickCreateStore.getState().resetAll?.();
  });

  it("writes the weekday mask to state.recurring when the Mon chip is toggled on", () => {
    render(<SourceGenerationPanel t={(k) => k} />);
    const monButton = screen.getByRole("button", { name: /mon/i });
    fireEvent.click(monButton);
    const mask = useQuickCreateStore.getState().recurring.frameRules[0]?.weekdayMask ?? 0;
    expect(mask & 0x01).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/components/tiles/editor/SourceGenerationPanel.test.tsx`
Expected: FAIL with `Cannot find module './SourceGenerationPanel'`.

- [ ] **Step 3: Implement `SourceGenerationPanel`**

Create `tastile-web/src/components/tiles/editor/SourceGenerationPanel.tsx`. Reuse the controls already in `AutomationPanel.tsx` (occurrence kind tabs `Once|Daily|Weekly|Interval|Condition`, weekday row, end-date `Switch`, offset `NumberInput`). Re-implement these in the new file via Mantine primitives used in the project (`SegmentedControl`, `Chip.Group`, `Switch`, `NumberInput`). Wire writes to `useQuickCreateStore` via existing actions: `setRecurringKind`, `setWeekdayMask(bit)`, `setEndDate`, `setOffsetMin`. These four actions already exist on the store — confirm by reading `lib/stores/quick-create-store.ts` then use as-is.

```tsx
"use client";
import { Chip, NumberInput, SegmentedControl, Switch } from "@mantine/core";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";

const WEEKDAYS = [
  { key: "sun", bit: 0x01 },
  { key: "mon", bit: 0x02 },
  { key: "tue", bit: 0x04 },
  { key: "wed", bit: 0x08 },
  { key: "thu", bit: 0x10 },
  { key: "fri", bit: 0x20 },
  { key: "sat", bit: 0x40 },
] as const;

export function SourceGenerationPanel({ t }: { t: (k: string) => string }) {
  const recurring = useQuickCreateStore((s) => s.recurring);
  const setField = useQuickCreateStore((s) => s.setField);

  const currentMask = recurring.frameRules[0]?.weekdayMask ?? 0;

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={recurring.kind}
        onChange={(v) =>
          setField("recurring.kind", v as typeof recurring.kind)
        }
        data={[
          { value: "ONCE", label: t("quickCreate.occurrenceOnce") },
          { value: "DAILY", label: t("quickCreate.occurrenceDaily") },
          { value: "WEEKLY", label: t("quickCreate.occurrenceWeekly") },
          { value: "INTERVAL", label: t("quickCreate.occurrenceInterval") },
          { value: "CONDITION", label: t("quickCreate.occurrenceCondition") },
        ]}
      />
      {recurring.kind === "WEEKLY" ? (
        <Chip.Group
          multiple
          value={WEEKDAYS.filter((d) => currentMask & d.bit).map((d) => d.key)}
          onChange={(keys) => {
            let mask = 0;
            for (const k of keys) {
              const day = WEEKDAYS.find((d) => d.key === k);
              if (day) mask |= day.bit;
            }
            setField("recurring.frameRules", [
              {
                ...(recurring.frameRules[0] ?? {}),
                kind: "WEEKDAY_MASK",
                weekdayMask: mask,
              } as typeof recurring.frameRules[number],
            ]);
          }}
        >
          <Group>
            {WEEKDAYS.map((d) => (
              <Chip key={d.key} value={d.key}>
                {t(`quickCreate.weekday${d.key}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      ) : null}
      <Switch
        checked={Boolean(recurring.endDate)}
        onChange={(e) =>
          setField(
            "recurring.endDate",
            e.currentTarget.checked ? new Date().toISOString() : "",
          )
        }
        label={t("quickCreate.endDate")}
      />
      <NumberInput
        value={recurring.offsetMin}
        onChange={(v) =>
          setField("recurring.offsetMin", typeof v === "number" ? v : 0)
        }
        min={-720}
        max={840}
        step={15}
        label={t("quickCreate.offsetMin")}
      />
    </div>
  );
}
```

Note: the panel writes through `setField` only — if `setField`'s signature cannot reach a path like `"recurring.frameRules"` (deep assignment), read the store helper for the closest equivalent and adapt that one call. Confirm by reading `quick-create-store.ts` for a `updateRecurringFrameRules` / `setFrameRule` helper if available, falling back to calling `useQuickCreateStore.setState({ recurring: { …next, frameRules: […] } })` directly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/components/tiles/editor/SourceGenerationPanel.test.tsx`
Expected: PASS, 1 passed.

- [ ] **Step 5: Run unit suite**

Run: `bun run test:unit`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
cd tastile-web
git add src/components/tiles/editor/SourceGenerationPanel.tsx src/components/tiles/editor/SourceGenerationPanel.test.tsx
git commit -m "feat(web): add SourceGenerationPanel editor"
```

---

### Task 3: Failing test for `ConditionPanel` writing `plan.completion.root.kind`

**Files:**
- Create: `tastile-web/src/components/tiles/editor/ConditionPanel.tsx`
- Test: `tastile-web/src/components/tiles/editor/ConditionPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tastile-web/src/components/tiles/editor/ConditionPanel.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { ConditionKind } from "@/lib/domain/v1/constants";
import { ConditionPanel } from "./ConditionPanel";

describe("ConditionPanel", () => {
  beforeEach(() => {
    useQuickCreateStore.getState().resetAll?.();
  });

  it("switching kind updates plan.completion.root.kind in the store", () => {
    render(<ConditionPanel t={(k) => k} />);
    const any = screen.getByRole("radio", { name: /any/i });
    fireEvent.click(any);
    const root = useQuickCreateStore.getState().plan.completion.root;
    expect(root.kind).toBe(ConditionKind.ANY);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/components/tiles/editor/ConditionPanel.test.tsx`
Expected: FAIL `Cannot find module './ConditionPanel'`.

- [ ] **Step 3: Implement `ConditionPanel`**

Create `tastile-web/src/components/tiles/editor/ConditionPanel.tsx`. Compose `ConditionEditor` (already exists at `src/components/tiles/editor/ConditionEditor.tsx`) and a top-level `SegmentedControl` for kind. Wire writes to `state.plan.completion.root` via the existing `useQuickCreateStore.setField("plan.completion.root", next)`.

```tsx
"use client";
import { SegmentedControl } from "@mantine/core";
import { ConditionEditor } from "./ConditionEditor";
import { ConditionKind } from "@/lib/domain/v1/constants";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";

export function ConditionPanel({ t }: { t: (k: string) => string }) {
  const root = useQuickCreateStore((s) => s.plan.completion.root);
  const setField = useQuickCreateStore((s) => s.setField);

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={String(root.kind)}
        onChange={(v) =>
          setField("plan.completion.root", {
            ...root,
            kind: Number(v) as ConditionKind,
            children: Number(v) === ConditionKind.TERM ? [] : root.children,
            term: Number(v) === ConditionKind.TERM ? (root.term ?? null) : null,
          })
        }
        data={[
          { value: String(ConditionKind.ALL), label: t("quickCreate.conditionAll") },
          { value: String(ConditionKind.ANY), label: t("quickCreate.conditionAny") },
          { value: String(ConditionKind.NOT), label: t("quickCreate.conditionNot") },
          { value: String(ConditionKind.TERM), label: t("quickCreate.conditionTerm") },
        ]}
      />
      <ConditionEditor
        node={root}
        onChange={(next) => setField("plan.completion.root", next)}
        t={t}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/components/tiles/editor/ConditionPanel.test.tsx`
Expected: PASS, 1 passed.

- [ ] **Step 5: Run unit suite**

Run: `bun run test:unit`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
cd tastile-web
git add src/components/tiles/editor/ConditionPanel.tsx src/components/tiles/editor/ConditionPanel.test.tsx
git commit -m "feat(web): add ConditionPanel wrapper for plan.completion.root"
```

---

### Task 4: Wire panels into QuickTileCreate; re-export from AutomationPanel

**Files:**
- Modify: `tastile-web/src/components/tiles/QuickTileCreate.tsx`
- Modify: `tastile-web/src/components/tiles/editor/AutomationPanel.tsx`

- [ ] **Step 1: Find current import sites**

Run inside `tastile-web`:
```bash
grep -n "AutomationPanel\|ConditionEditor" src/components/tiles/QuickTileCreate.tsx
```
Replace each `AutomationPanel` usage inside QuickTileCreate with `SourceGenerationPanel` (when the section intends recurrence authoring) and replace any inline condition authoring with `ConditionPanel`. Preserve the existing section ordering and titles — only swap the components.

- [ ] **Step 2: Edit `QuickTileCreate.tsx`**

Add import at the top:
```tsx
import { SourceGenerationPanel } from "@/components/tiles/editor/SourceGenerationPanel";
import { ConditionPanel } from "@/components/tiles/editor/ConditionPanel";
```

Replace existing recurrence section body with:
```tsx
<SourceGenerationPanel t={t} />
```

Replace any inline condition section body with:
```tsx
<ConditionPanel t={t} />
```

Do NOT change other section bodies.

- [ ] **Step 3: Edit `AutomationPanel.tsx`**

Add re-export at the bottom:
```tsx
export { SourceGenerationPanel } from "./SourceGenerationPanel";
```
(Leave the existing `AutomationPanel` function intact so other callers don't regress.)

- [ ] **Step 4: Run unit suite**

Run: `bun run test:unit`
Expected: PASS, no regressions.

- [ ] **Step 5: Run typecheck/lint**

Run: `bun run check`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd tastile-web
git add src/components/tiles/QuickTileCreate.tsx src/components/tiles/editor/AutomationPanel.tsx
git commit -m "refactor(web): QuickTileCreate composes SourceGenerationPanel + ConditionPanel"
```

---

## Phase W3 — Decision loop surface

### Task 5: Probe existing session data path

**Files:**
- Read-only: `tastile-web/src/lib/hooks/execution-engine-context.tsx`, `tastile-web/src/components/.../ExecutionControls`, `tastile-core/crates-v1/api/src/main.rs`

- [ ] **Step 1: Inspect `useExecutionEngineContext` data sources**

Run inside `tastile-web`:
```bash
grep -n "fetch\|getV1\|/v1/" src/lib/hooks/execution-engine-context.tsx | head -30
```
Expected output: one or more path strings.

- [ ] **Step 2: Check core API for `/v1/sessions` list endpoint**

Run inside `tastile-core/crates-v1/api/src`:
```bash
grep -rn '"/v1/sessions"' .
```
Two known paths exist:
- a route bound to `post(handlers::commands::create_session)` (create)
- a route bound to `get(handlers::read::read_session)` (read one)

If BOTH exist and NEITHER is a `GET /v1/sessions` list endpoint, decide based on what `useExecutionEngineContext` polled in step 1:
- If it polls something already listing sessions → wire to that.
- Else → add the route (Task 5b).

- [ ] **Step 3: Record the decision as `// NOTE(session-source): …` comment**

Add this comment at the top of `useExecutionEngineContext.tsx` (find the `pendingPrompt` field):
```ts
// NOTE(session-source): pending sessions come from <path-or-noop>.
```
This makes the data source findable for future readers.

- [ ] **Step 4: Commit (if comment added)**

```bash
cd tastile-web
git add src/lib/hooks/execution-engine-context.tsx
git commit -m "docs(web): annotate useExecutionEngineContext session data source"
```

---

### Task 5b (conditional): Add `GET /v1/sessions` to core

Only execute this task if Step 2 returned no real list source. Read the storage layer before editing:

- [ ] **Step 1: Read existing session tables**

Run inside `tastile-core`:
```bash
grep -n "v1_session\|workflow_session\|feedback_session" crates-v1/storage/migrations/*.sql | head -20
```
Identify the workflow session table name. If `v1_decision_run` already exists, prefer to read sessions by joining through it.

- [ ] **Step 2: Write the list query**

Add to `crates-v1/storage/src/session_repo.rs` (or `decision_repo.rs` — whichever file already owns the table):
```rust
pub async fn list_open_sessions(
    pool: &PgPool,
    owner_id: Uuid,
) -> Result<Vec<OpenSession>, sqlx::Error> { /* SQL: SELECT … WHERE status = 'open' AND owner_id = $1 */ }
```
Exact field names follow the existing row mapping in the same file. No migration — re-use existing columns.

- [ ] **Step 3: Add handler `read_sessions`**

Add to `crates-v1/api/src/handlers/read.rs` (or the relevant split if `read_sessions.rs` exists):
```rust
pub async fn read_sessions(
    State(state): State<Arc<AppState>>,
    Extension(owner): Extension<Uuid>,
    Query(params): Query<ListSessionsParams>,
) -> Result<Json<Vec<OpenSession>>, ApiError> {
    let sessions = access_session_repo::list_open_sessions(&state.pool, owner).await?;
    Ok(Json(sessions))
}
```

- [ ] **Step 4: Wire route in `main.rs`**

Add alongside the existing `/v1/sessions` routes:
```rust
.route("/v1/sessions", get(handlers::read::read_sessions))
```
(Exact import style follows the surrounding code.)

- [ ] **Step 5: Update openapi**

Append to `crates-v1/api/openapi.yaml`:
```yaml
/v1/sessions:
  get:
    operationId: listSessions
    parameters:
      - in: query
        name: status
        schema: { type: string, enum: [open, closed, all] }
    responses:
      '200':
        description: ok
        content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Session' } } } }
```

- [ ] **Step 6: Test in WSLC**

Run inside the wslc container:
```bash
cargo fmt --manifest-path crates-v1/Cargo.toml --all -- --check
cargo clippy --manifest-path crates-v1/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path crates-v1/Cargo.toml -p v1-storage --test at_session_list_open -- --test-threads=1
```
Expected: green. Add the integration test in `crates-v1/storage/tests/at_session_list_open.rs` that seeds 2 owners / 3 sessions / 2 statuses and asserts one owner sees only their open sessions.

- [ ] **Step 7: Commit**

```bash
cd tastile-core
git add crates-v1/api/src/handlers/read.rs crates-v1/api/src/main.rs crates-v1/storage/src/session_repo.rs crates-v1/api/openapi.yaml crates-v1/storage/tests/at_session_list_open.rs
git commit -m "feat(core): GET /v1/sessions lists open sessions for owner"
```

---

### Task 6: `use-pending-sessions` hook + `sessions.ts` API client

**Files:**
- Create: `tastile-web/src/lib/api/v1/sessions.ts`
- Create: `tastile-web/src/lib/hooks/use-pending-sessions.ts`

- [ ] **Step 1: Implement `sessions.ts`**

```ts
// tastile-web/src/lib/api/v1/sessions.ts
import type { ApiClient } from "./endpoints";

export interface SessionView {
  id: string;
  status: "open" | "closed";
  prompt: { title: string; body: string; why?: string };
  interactionTree: InteractionNode;
  baseRevision: number;
}

export type InteractionNode =
  | { kind: "input"; id: string; label: string; value: string | null }
  | { kind: "option"; id: string; label: string; options: Array<{ id: string; label: string }> };

export async function listPendingSessions(client: ApiClient): Promise<SessionView[]> {
  const res = await fetch(`${client.baseUrl}/v1/sessions?status=open`, {
    headers: { Authorization: `Bearer ${await client.getIdToken() ?? ""}` },
  });
  if (!res.ok) throw new Error(`listPendingSessions failed: ${res.status}`);
  return res.json();
}

export async function getSession(client: ApiClient, id: string): Promise<SessionView> {
  const res = await fetch(`${client.baseUrl}/v1/sessions/${id}`, {
    headers: { Authorization: `Bearer ${await client.getIdToken() ?? ""}` },
  });
  if (!res.ok) throw new Error(`getSession failed: ${res.status}`);
  return res.json();
}

export async function submitFeedback(
  client: ApiClient,
  sessionId: string,
  payload: { answers: Record<string, string>; baseRevision: number },
): Promise<void> {
  const res = await fetch(`${client.baseUrl}/v1/sessions/${sessionId}/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await client.getIdToken() ?? ""}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 204) throw new Error(`submitFeedback failed: ${res.status}`);
}
```

- [ ] **Step 2: Implement `use-pending-sessions.ts`**

```ts
// tastile-web/src/lib/hooks/use-pending-sessions.ts
import { useQuery } from "@tanstack/react-query";
import { makeClient } from "@/lib/api/v1/submit";
import { listPendingSessions, type SessionView } from "@/lib/api/v1/sessions";

export function usePendingSessions() {
  return useQuery<SessionView[]>({
    queryKey: ["v1", "sessions", "pending"],
    queryFn: async () => listPendingSessions(makeClient()),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd tastile-web
git add src/lib/api/v1/sessions.ts src/lib/hooks/use-pending-sessions.ts
git commit -m "feat(web): add session API client + usePendingSessions hook"
```

---

### Task 7: `InteractionTreeForm` + `DecisionPromptSheet`

**Files:**
- Create: `tastile-web/src/components/decision/InteractionTreeForm.tsx`
- Create: `tastile-web/src/components/execution/DecisionPromptSheet.tsx`
- Test: `tastile-web/src/components/execution/DecisionPromptSheet.test.tsx`

- [ ] **Step 1: Implement `InteractionTreeForm.tsx`**

```tsx
// tastile-web/src/components/decision/InteractionTreeForm.tsx
"use client";
import { useState } from "react";
import type { InteractionNode } from "@/lib/api/v1/sessions";

export function InteractionTreeForm({
  node,
  onSubmit,
}: {
  node: InteractionNode;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (node.kind === "input") {
    return (
      <label className="block space-y-1">
        <span className="text-sm font-medium">{node.label}</span>
        <input
          className="w-full rounded-md border px-3 py-2"
          value={answers[node.id] ?? node.value ?? ""}
          onChange={(e) => setAnswers((a) => ({ ...a, [node.id]: e.target.value }))}
        />
        <button
          className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          onClick={() => onSubmit(answers)}
          type="button"
        >
          Continue
        </button>
      </label>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{node.label}</p>
      {node.options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className="mr-2 rounded-md border px-3 py-1.5 text-sm hover:bg-surface-1"
          onClick={() => onSubmit({ [node.id]: opt.id })}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `DecisionPromptSheet.tsx`**

```tsx
// tastile-web/src/components/execution/DecisionPromptSheet.tsx
"use client";
import { useState } from "react";
import { usePendingSessions } from "@/lib/hooks/use-pending-sessions";
import { getSession, submitFeedback } from "@/lib/api/v1/sessions";
import { makeClient } from "@/lib/api/v1/submit";
import { InteractionTreeForm } from "@/components/decision/InteractionTreeForm";

export function DecisionPromptSheet() {
  const client = makeClient();
  const { data: sessions, refetch } = usePendingSessions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeNode, setActiveNode] = useState<Awaited<ReturnType<typeof getSession>> | null>(null);

  if (!sessions || sessions.length === 0) {
    return <p className="text-foreground-muted">No pending prompts.</p>;
  }

  if (activeNode) {
    return (
      <InteractionTreeForm
        node={activeNode.interactionTree}
        onSubmit={async (answers) => {
          await submitFeedback(client, activeNode.id, { answers, baseRevision: activeNode.baseRevision });
          setActiveId(null);
          setActiveNode(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={async () => {
            setActiveId(s.id);
            setActiveNode(await getSession(client, s.id));
          }}
          className="block w-full rounded-xl bg-surface-elevated p-4 text-left hover:bg-surface-1"
        >
          <p className="text-sm font-medium">{s.prompt.title}</p>
          <p className="mt-2 text-foreground-muted">{s.prompt.body}</p>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write failing test for `DecisionPromptSheet`**

```tsx
// tastile-web/src/components/execution/DecisionPromptSheet.test.tsx
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DecisionPromptSheet } from "./DecisionPromptSheet";

vi.mock("@/lib/api/v1/sessions", () => ({
  listPendingSessions: vi.fn().mockResolvedValue([
    { id: "s1", status: "open", prompt: { title: "Test prompt", body: "Why?" }, interactionTree: { kind: "option", id: "i1", label: "Pick one", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, baseRevision: 1 },
  ]),
  getSession: vi.fn(),
  submitFeedback: vi.fn().mockResolvedValue(undefined),
}));

function wrapper(children: React.ReactNode) {
  const q = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={q}>{children}</QueryClientProvider>;
}

describe("DecisionPromptSheet", () => {
  it("renders pending sessions and offers answer options", async () => {
    render(wrapper(<DecisionPromptSheet />));
    expect(await screen.findByText("Test prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test prompt"));
    expect(await screen.findByText("Pick one")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/components/execution/DecisionPromptSheet.test.tsx`
Expected: PASS, 1 passed.

- [ ] **Step 5: Run unit suite + typecheck**

Run: `bun run check`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd tastile-web
git add src/components/decision/InteractionTreeForm.tsx src/components/execution/DecisionPromptSheet.tsx src/components/execution/DecisionPromptSheet.test.tsx
git commit -m "feat(web): DecisionPromptSheet surfaces pending sessions"
```

---

### Task 8: Wire `DecisionPromptSheet` into `/app/prompt` and NotificationsMenu

**Files:**
- Modify: `tastile-web/src/app/app/prompt/page.tsx`
- Modify: `tastile-web/src/components/notifications/NotificationsMenu.tsx`

- [ ] **Step 1: Edit `prompt/page.tsx`**

Replace the placeholder body:
```tsx
"use client";
import { DecisionPromptSheet } from "@/components/execution/DecisionPromptSheet";

export default function PromptPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-[590] text-foreground">Pending Prompts</h1>
      <DecisionPromptSheet />
    </div>
  );
}
```

- [ ] **Step 2: Edit `NotificationsMenu.tsx`**

Inside the notification render, when `notification.kind === "decision"` (verify the discriminator name by reading the file — keep the existing one, do not introduce new fields), render a link using `next/link` that navigates to `/app/prompt?sessionId=${notification.sessionId ?? notification.id}`. Use the `Link` import that already exists in the file. Title and routing source come from existing notification payload fields.

- [ ] **Step 3: Run unit suite + typecheck**

Run: `bun run check`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
cd tastile-web
git add src/app/app/prompt/page.tsx src/components/notifications/NotificationsMenu.tsx
git commit -m "feat(web): route decision notifications through DecisionPromptSheet"
```

---

## Phase E2E — Playwright scenario A

### Task 9: Write `e2e/scenario-A-test-study.spec.ts`

**Files:**
- Create: `tastile-web/e2e/scenario-A-test-study.spec.ts`

- [ ] **Step 1: Read existing helper module**

Run inside `tastile-web`:
```bash
ls e2e/helpers/
head -30 e2e/helpers/v1.ts 2>/dev/null
```
Use `v1AuthHeaders`, `getV1`, `postCommand` etc. if they exist. The existing `at-030-execution.spec.ts` shows the import style.

- [ ] **Step 2: Write the spec**

```ts
// tastile-web/e2e/scenario-A-test-study.spec.ts
import { test, expect } from "@playwright/test";

test("scenario A — create a test-study task, see placement, execute, finish", async ({ page }) => {
  // 1. open dashboard
  await page.goto("/dashboard");

  // 2. open QuickTileCreate
  await page.getByRole("button", { name: /create/i }).first().click();

  // 3. set title
  await page.getByLabel(/title/i).fill("Test study");

  // 4. weekly; weekdays Mon-Fri
  await page.getByRole("radio", { name: /weekly/i }).check();
  for (const d of ["mon", "tue", "wed", "thu", "fri"]) {
    await page.getByRole("button", { name: new RegExp(`^${d}$`, "i") }).click();
  }

  // 5. offset +540 min, duration 60/150 min
  await page.getByLabel(/offset/i).fill("540");
  await page.getByLabel(/min duration/i).fill("60");
  await page.getByLabel(/max duration/i).fill("150");

  // 6. submit
  await page.getByRole("button", { name: /^save$|submit|create/i }).first().click();

  // 7. wait for placement on DayView (text contains "Test study")
  const placement = page.locator('[data-testid="placement-card"]', { hasText: "Test study" }).first();
  await expect(placement).toBeVisible({ timeout: 30_000 });

  // 8. open placement → ExecutionControls
  await placement.click();
  await expect(page.getByRole("button", { name: /start/i })).toBeVisible();

  // 9. start
  await page.getByRole("button", { name: /start/i }).click();
  await expect(page.getByTestId("active-execution-bar")).toContainText("Test study");

  // 10. finish
  await page.getByRole("button", { name: /finish/i }).click();
  await expect(page.getByTestId("active-execution-bar")).toBeHidden({ timeout: 30_000 });
});
```

- [ ] **Step 3: Add `data-testid` hooks to allow Playwright selection**

In `tastile-web/src/components/calendar/PlacementCard.tsx` (or wherever the placement renderer is — locate via grep), add `data-testid="placement-card"` to the root element. In `ActiveExecutionBar.tsx`, add `data-testid="active-execution-bar"`. In `QuickTileCreate.tsx`, ensure the save button has `aria-label="Save"`. Use exact existing i18n keys for labels.

- [ ] **Step 4: Run the spec once and observe**

Run inside WSLC (per CLAUDE.md "WSLC内で"):
```bash
cd /workspace/tastile-web
bun run test:e2e -- e2e/scenario-A-test-study.spec.ts --project=chromium
```
Expected: PASS, 1 passed. If the spec fails, debug the DOM selectors using `page.locator("body").innerHTML()` debug helpers, do NOT change the production code without writing the rationale in this file.

- [ ] **Step 5: Commit**

```bash
cd tastile-web
git add e2e/scenario-A-test-study.spec.ts src/components/calendar/PlacementCard.tsx src/components/execution/ActiveExecutionBar.tsx src/components/tiles/QuickTileCreate.tsx
git commit -m "test(e2e): scenario A — test-study task end-to-end"
```

---

## Phase Gates — WSLC green

### Task 10: Run all web gates

- [ ] **Step 1: Run quality gates**

Run inside `tastile-web`:
```bash
bun install --frozen-lockfile
bun run check
bun run check:release
```
Expected: all exit 0. `check:release` must produce a Next.js build artifact.

- [ ] **Step 2: Run full vitest suite**

Run:
```bash
bun run test:unit
```
Expected: all 100+ existing tests + the 4 new ones in this plan are green.

- [ ] **Step 3: Run core gates inside WSLC**

Run inside `tastile-core` wslc clone:
```bash
cd /workspace/tastile-core
cargo fmt --manifest-path crates-v1/Cargo.toml --all -- --check
cargo clippy --manifest-path crates-v1/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path crates-v1/Cargo.toml --workspace -- --test-threads=1
```
Expected: all green; all integration tests reach a reachable PostgreSQL.

- [ ] **Step 4: Run full Playwright suite**

Run inside the wslc container:
```bash
cd /workspace/tastile-web
bun run test:e2e
```
Expected: every existing `at-0xx-*.spec.ts` + `active-tile-query.spec.ts` + `quick-tile-*.spec.ts` + the new `scenario-A-test-study.spec.ts` are green.

- [ ] **Step 5: Tag and report (no commit — let user decide on commit/PR shape)**

Output to console:
- `bun run check:release` exit code
- `cargo test` summary line
- Playwright summary line including `scenario-A-test-study.spec.ts`
- commit SHAs from each task

---

## Stop conditions (per handoff §0.3)

The session is allowed to stop only when one of these:
1. Repository access is lost (network git error).
2. Required production secrets are missing for some external operation.
3. User's uncommitted changes are in logical conflict with this plan.
4. GitHub / AWS / Google Play itself is down.

Any other failure mode is debuggable. Apply `superpowers:systematic-debugging`.

---

## Out-of-scope reminders

- No Android work this session.
- No production deploy probe.
- No CI workflow edits.
- No core schema migration (unless §5b forced one — Task 5b explicitly avoids it).
- Scenarios B / C / D and the 7 omitted editor panels (`SourceWindowPanel`, `PlacementRulesPanel`, etc.) are tracked for follow-up plans.
