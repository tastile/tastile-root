# Recurring Tile Edit Unification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the parallel `RecurringTileConfigDialog` by routing recurring-tile edits through `QuickTileCreate`'s unified edit view, with the Recurring sub-panel extended to handle the full `RecurrenceModel` (generator + window + selector).

**Architecture:**
- Add a `RecurrenceModel` slice to `useQuickCreateStore` alongside the existing `RecurringSlice` (lifecycle).
- New `loadFromRecurringTile(tileId)` action fetches the complete v7 `Tile` via `getTile(id)` and hydrates all 7 condition layers into the store (identity / time / windows / plan / recurring / meta).
- Extend `QuickTileCreate`'s "Recurring" sub-panel with two new subsections (Generator + Window) above the existing Lifecycle editor.
- New `submitUpdateTile({ client, tileId })` helper that issues a v7 `UPDATE_TILE` command with the full envelope (including `recurrence`) via the existing `updateTileCommand` builder.
- `ScheduleMain.tsx`'s row click switches from `openRecurringDialog(id)` to `loadFromRecurringTile(id)`.
- Delete `RecurringTileConfigDialog.tsx` and remove `recurringDialog` from `dialog-store.ts`.

**Tech Stack:** Next.js 15, React, TypeScript, Zustand, Vitest, @tastile/core command API (v7 envelopes), Tailwind.

---

## Task 0: Verify backend `updateTileCommand` carries `recurrence`

**Files:** Read only — no edits.

**Step 1: Inspect `src/lib/api/v1/tile-commands.ts` line ~98**

Read `tastile-web/src/lib/api/v1/tile-commands.ts`. Find the `updateTileCommand` function. Confirm:
- It accepts the full Tile envelope shape (or accepts a snapshot built from quick-create-store)
- Its payload includes `recurrence` (and what path: `recurrence` or `objective.recurrence`?)

If `updateTileCommand` does NOT include `recurrence`, note this and stop — we'll need to extend it as part of Task 4.

**Step 2: Inspect `src/lib/api/endpoints.ts` line ~317**

Read the `getTile` endpoint definition. Confirm the exact return shape:
- Path: `/read/tile/{id}`
- Method: `GET`
- Response shape: full `Tile` from `src/lib/domain/tile.ts`

**Step 3: Document findings**

Add a 5-line note to `docs/decisions.md` (append at the bottom under a new heading `## 2026-06-30 — Recurring tile edit unification discovery`):
- Whether `updateTileCommand` accepts recurrence (yes/no)
- Path of `getTile` endpoint
- Path of `updateTile` endpoint
- Confirmation that the data path is viable

**Step 4: Commit doc note**

```bash
git add docs/decisions.md
git commit -m "docs: record recurring-tile unification discovery findings"
```

---

## Task 1: Add `RecurrenceModel` slice + helpers to `quick-create-store`

**Files:**
- Modify: `tastile-web/src/lib/stores/quick-create-store.ts`

**Step 1: Add `RecurrenceSlice` import**

At top of `quick-create-store.ts`, add import (the `RecurrenceModel` already exists in `src/lib/domain/tile.ts:19-30`):

```ts
import type { RecurrenceModel } from "@/lib/domain/tile";
```

**Step 2: Extend `QuickCreateState` with `recurrence` slice**

After the existing `recurring: RecurringSlice` field in the state interface (around line 84), add:

```ts
recurrence: RecurrenceModel | null;
```

In `buildDefaultQuickCreateState` (around line 256), add:

```ts
recurrence: null,
```

**Step 3: Add `defaultRecurrence()` helper**

Above `buildDefaultQuickCreateState`, add:

```ts
function defaultRecurrence(): RecurrenceModel {
  return {
    generator: {
      kind: "time_based",
      step_min: 1440,
      anchor_epoch_min: null,
    },
    window: {
      weekday_mask: 0b0011111, // Mon–Fri
      start_offset_min: 9 * 60,
      end_offset_min: 18 * 60,
      exclusions: [],
    },
    selector: {
      expression: null,
    },
  };
}
```

**Step 4: Verify typecheck**

```bash
cd tastile-web && bun run typecheck
```

Expected: PASS (no other consumers of the state shape should break since we're only adding a field).

**Step 5: Commit**

```bash
git add tastile-web/src/lib/stores/quick-create-store.ts
git commit -m "feat(store): add RecurrenceModel slice to quick-create-store"
```

---

## Task 2: Add `loadFromRecurringTile` action

**Files:**
- Modify: `tastile-web/src/lib/stores/quick-create-store.ts`

**Step 1: Extend `QuickCreateState` interface with action**

In the state interface (around line 75), add the action signature alongside `loadFromEvent`:

```ts
/**
 * Hydrate the form from an existing recurring Tile so the panel can be
 * reused for editing. Fetches the full v7 Tile via getTile(id), maps all
 * 7 condition layers into the store, sets mode="edit" with editingId=tileId.
 * Returns the fetched Tile or null on error.
 */
loadFromRecurringTile: (tileId: string) => Promise<unknown | null>;
```

**Step 2: Implement the action**

Below the existing `loadFromEvent` implementation (around line 327), add:

```ts
loadFromRecurringTile: async (tileId: string) => {
  try {
    const { getCoreClient } = await import("@/lib/api/endpoints");
    const res = await getCoreClient().call<unknown>("getTile", {
      pathParams: { id: tileId },
    });
    if (!res.ok || !res.data) return null;
    const tile = res.data as {
      core?: { title?: string; description?: string | null };
      temporal?: { releaseAt?: string | null; dueAt?: string | null };
      objective?: { recurrence?: unknown };
      annotation?: { labels?: string[]; project?: string | null; memo?: string | null };
    };
    set({
      mode: "edit" as const,
      editingId: tileId,
      isOpen: true,
      identity: {
        kind: 1, // RECURRING (TileKind.RECURRING)
        title: tile.core?.title ?? "",
        description: tile.core?.description ?? null,
        externalId: null,
        visual: { color: "#5e6ad2", icon: "Repeat" },
      },
      time: {
        span: {
          start: tile.temporal?.releaseAt ?? "",
          end: tile.temporal?.dueAt ?? "",
        },
        durationMinMax: { minMs: 30 * 60_000, maxMs: 90 * 60_000 },
      },
      meta: {
        project: tile.annotation?.project ?? null,
        tags: Array.isArray(tile.annotation?.labels)
          ? (tile.annotation!.labels as string[])
          : [],
        memo: tile.annotation?.memo ?? "",
      },
      recurrence: (tile.objective?.recurrence as never) ?? null,
    });
    return tile;
  } catch {
    return null;
  }
},
```

Note: We import `getCoreClient` lazily inside the function to avoid a circular import (endpoints.ts pulls from this store via `quick-create-store` indirectly).

**Step 3: Verify typecheck**

```bash
cd tastile-web && bun run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add tastile-web/src/lib/stores/quick-create-store.ts
git commit -m "feat(store): loadFromRecurringTile hydrates 7-layer Tile into store"
```

---

## Task 3: Add `submitUpdateTile` helper

**Files:**
- Modify: `tastile-web/src/lib/api/v1/submit.ts` (or `tile-commands.ts` depending on Task 0 discovery)

**Step 1: Read existing `submitCreateTile`**

Open `tastile-web/src/lib/api/v1/submit.ts`. Find the body of `submitCreateTile` and mirror its structure (client.makeRequest, error handling, return shape).

**Step 2: Read existing `updateTileCommand` in `tile-commands.ts:98`**

Confirm signature and payload shape. If it accepts the full snapshot, use it directly. If not, extend it.

**Step 3: Add `submitUpdateTile`**

If `updateTileCommand` already supports recurrence (Task 0 confirmed), add to `submit.ts`:

```ts
export async function submitUpdateTile(options: {
  client: ApiClient;
  tileId: string;
}): Promise<SubmitV1Result> {
  const { client, tileId } = options;
  try {
    const state = useQuickCreateStore.getState();
    const result = await client.makeRequest({
      method: "POST",
      path: "/commands/tile/update",
      body: {
        tile_id: tileId,
        ...buildUpdateTilePayload(state),
      },
    });
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "exception",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
```

If `updateTileCommand` does NOT support recurrence, extend `tile-commands.ts` first by adding `recurrence` to its emitted payload, then proceed.

**Step 4: Add `buildUpdateTilePayload`**

Mirror `buildCreateTileCommand` output but include `recurrence`. Location: `submit.ts` or `build-command.ts` (next to `buildCreateTileCommand`).

```ts
function buildUpdateTilePayload(state: QuickCreateState): Record<string, unknown> {
  return {
    kind: state.identity.kind,
    title: state.identity.title,
    description: state.identity.description,
    color: state.identity.visual.color || null,
    icon: state.identity.visual.icon || null,
    external_id: state.identity.externalId?.value ?? null,
    plan_role: state.plan.role,
    span: state.time.span,
    duration_min_max: state.time.durationMinMax,
    windows: state.windows,
    life: state.recurring.life,
    frame_rules: state.recurring.frameRules,
    rules: state.recurring.rules,
    recurrence: state.recurrence,
  };
}
```

**Step 5: Verify typecheck + existing tests**

```bash
cd tastile-web && bun run typecheck
cd tastile-web && bun test src/components/tiles/QuickTileCreate.test.tsx
```

Expected: typecheck PASS; existing 52 tests still PASS (we haven't changed `submitCreateTile`).

**Step 6: Commit**

```bash
git add tastile-web/src/lib/api/v1/
git commit -m "feat(submit): add submitUpdateTile with full envelope + recurrence"
```

---

## Task 4: Extend Recurring sub-panel with Generator + Window editors

**Files:**
- Modify: `tastile-web/src/components/tiles/QuickTileCreate.tsx` (around line 1069-1115, the existing `subPanelClass("recurring")` block)

**Step 1: Add new state for which sub-editor is active**

In `QuickTileCreate.tsx`, change the `activePanel` union type (around line 291) to include new sub-editors OR add a separate local state. Recommendation: add separate local state to keep the existing type clean:

```ts
const [recurringTab, setRecurringTab] = useState<"lifecycle" | "generator" | "window">("lifecycle");
```

**Step 2: Render tab navigation in the Recurring sub-panel**

Inside the existing `<section className={subPanelClass("recurring")}>` (line 1069), after the `<FormPanel>` opening tag, add tab buttons that switch `recurringTab`:

```tsx
<div className="flex gap-2 border-b border-border px-section py-2">
  {(["lifecycle", "generator", "window"] as const).map((tab) => (
    <button
      key={tab}
      type="button"
      onClick={() => setRecurringTab(tab)}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium",
        recurringTab === tab
          ? "bg-primary text-primary-fg"
          : "text-foreground-muted hover:bg-surface-2"
      )}
    >
      {tab === "lifecycle" ? t("quickCreate.recurringTabLifecycle") :
       tab === "generator" ? t("quickCreate.recurringTabGenerator") :
       t("quickCreate.recurringTabWindow")}
    </button>
  ))}
</div>
```

**Step 3: Wire conditional rendering of existing Lifecycle editor**

Wrap the existing `<RecurringLifeEditor>` and `<FrameRulesList>` (lines 1092-1113) in:

```tsx
{recurringTab === "lifecycle" && (
  <>
    <RecurringLifeEditor ... />
    <FrameRulesList ... />
  </>
)}
```

**Step 4: Add `GeneratorEditor` component**

Above `QuickTileCreate` (or below it), add a new component:

```tsx
function GeneratorEditor({
  recurrence,
  onChange,
  t,
}: {
  recurrence: RecurrenceModel | null;
  onChange: (next: RecurrenceModel) => void;
  t: (k: string) => string;
}) {
  if (!recurrence) {
    return (
      <Button
        type="button"
        size="small"
        variant="default"
        rounded
        onClick={() => onChange(defaultRecurrence())}
      >
        {t("quickCreate.recurrenceEnable")}
      </Button>
    );
  }
  const gen = recurrence.generator;
  return (
    <>
      <RowSegmented
        icon={Repeat}
        options={[
          { value: "time_based", label: t("quickCreate.generatorTimeBased") },
          { value: "focus_block_based", label: t("quickCreate.generatorFocusBlockBased") },
        ]}
        value={gen.kind}
        onChange={(v) => {
          if (v === "time_based") {
            onChange({
              ...recurrence,
              generator: { kind: "time_based", step_min: 1440, anchor_epoch_min: null },
            });
          } else {
            onChange({
              ...recurrence,
              generator: { kind: "focus_block_based", phases: [{ focus_min: 25, break_min: 5 }] },
            });
          }
        }}
      />
      {gen.kind === "time_based" ? (
        <FormRow icon={<Clock size={20} />}>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-foreground-muted text-xs">{t("quickCreate.stepMin")}</span>
              <input
                type="number"
                min={1}
                value={gen.step_min}
                onChange={(e) => onChange({
                  ...recurrence,
                  generator: { ...gen, step_min: Number(e.target.value) || 1 },
                })}
                className="w-24 rounded-md bg-surface-2 px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>
        </FormRow>
      ) : (
        <div className="space-y-2">
          {gen.phases.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border-l-2 border-surface-2 pl-3">
              <label className="space-y-1">
                <span className="block text-xs text-foreground-muted">{t("quickCreate.focusMin")}</span>
                <input
                  type="number"
                  min={1}
                  value={p.focus_min}
                  onChange={(e) => {
                    const phases = gen.phases.slice();
                    phases[i] = { ...p, focus_min: Number(e.target.value) || 1 };
                    onChange({ ...recurrence, generator: { kind: "focus_block_based", phases } });
                  }}
                  className="w-full rounded-md bg-surface-2 px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-foreground-muted">{t("quickCreate.breakMin")}</span>
                <input
                  type="number"
                  min={0}
                  value={p.break_min}
                  onChange={(e) => {
                    const phases = gen.phases.slice();
                    phases[i] = { ...p, break_min: Number(e.target.value) || 0 };
                    onChange({ ...recurrence, generator: { kind: "focus_block_based", phases } });
                  }}
                  className="w-full rounded-md bg-surface-2 px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            </div>
          ))}
          <Button
            type="button"
            size="small"
            variant="default"
            rounded
            iconLeft={<Plus size={12} aria-hidden="true" />}
            onClick={() => onChange({
              ...recurrence,
              generator: {
                kind: "focus_block_based",
                phases: [...gen.phases, { focus_min: 25, break_min: 5 }],
              },
            })}
          >
            {t("quickCreate.addPhase")}
          </Button>
        </div>
      )}
    </>
  );
}
```

**Step 5: Add `WindowEditor` component**

```tsx
function WindowEditor({
  recurrence,
  onChange,
  t,
}: {
  recurrence: RecurrenceModel | null;
  onChange: (next: RecurrenceModel) => void;
  t: (k: string) => string;
}) {
  if (!recurrence) return <p className="text-xs text-foreground-muted">{t("quickCreate.empty")}</p>;
  const win = recurrence.window;
  const weekdays = [
    false, false, false, false, false, false, false,
  ].map((_, i) => (win.weekday_mask & (1 << i)) !== 0);
  const toggle = (i: number) => {
    const next = weekdays.slice();
    next[i] = !next[i];
    let mask = 0;
    next.forEach((v, idx) => { if (v) mask |= 1 << idx; });
    onChange({ ...recurrence, window: { ...win, weekday_mask: mask } });
  };
  const setTime = (key: "start_offset_min" | "end_offset_min", h: number, m: number) => {
    onChange({ ...recurrence, window: { ...win, [key]: h * 60 + m } });
  };
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {["月", "火", "水", "木", "金", "土", "日"].map((label, i) => (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={weekdays[i]}
            onClick={() => toggle(i)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs",
              weekdays[i]
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-surface-1 text-foreground-muted"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
            {t("quickCreate.windowStartAt")}
          </span>
          <input
            type="time"
            value={`${String(Math.floor(win.start_offset_min / 60)).padStart(2, "0")}:${String(win.start_offset_min % 60).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              setTime("start_offset_min", h || 0, m || 0);
            }}
            className="w-full rounded-md bg-surface-2 px-2 py-1 outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
            {t("quickCreate.windowEndAt")}
          </span>
          <input
            type="time"
            value={`${String(Math.floor(win.end_offset_min / 60)).padStart(2, "0")}:${String(win.end_offset_min % 60).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              setTime("end_offset_min", h || 0, m || 0);
            }}
            className="w-full rounded-md bg-surface-2 px-2 py-1 outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
      </div>
    </>
  );
}
```

**Step 6: Mount Generator and Window editors conditionally**

Inside the existing `<FormPanel>` of the Recurring sub-panel, add:

```tsx
{recurringTab === "generator" && (
  <GeneratorEditor
    recurrence={recurrence}
    onChange={(next) => setField("recurrence", next)}
    t={t}
  />
)}
{recurringTab === "window" && (
  <WindowEditor
    recurrence={recurrence}
    onChange={(next) => setField("recurrence", next)}
    t={t}
  />
)}
```

**Step 7: Read recurrence from store at the top**

Around line 282, alongside other `useQuickCreateStore` calls:

```ts
const recurrence = useQuickCreateStore((s) => s.recurrence);
```

**Step 8: Verify typecheck + tests**

```bash
cd tastile-web && bun run typecheck
cd tastile-web && bun test src/components/tiles/QuickTileCreate.test.tsx
```

Expected: typecheck PASS; existing tests still PASS.

**Step 9: Commit**

```bash
git add tastile-web/src/components/tiles/QuickTileCreate.tsx
git commit -m "feat(quick-create): extend Recurring panel with Generator + Window editors"
```

---

## Task 5: Wire `loadFromRecurringTile` into `ScheduleMain`

**Files:**
- Modify: `tastile-web/src/components/schedule/ScheduleMain.tsx`

**Step 1: Replace the row click handler**

In `ScheduleMain.tsx` around line 203, change:

```ts
onClick={() => openRecurringDialog(template.id)}
```

to:

```ts
onClick={() => {
  const { loadFromRecurringTile } = useQuickCreateStore.getState();
  void loadFromRecurringTile(template.id);
}}
```

**Step 2: Add `useQuickCreateStore` import**

At the top of `ScheduleMain.tsx`, add (alongside existing `useDialogStore` import):

```ts
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
```

**Step 3: Verify typecheck**

```bash
cd tastile-web && bun run typecheck
```

Expected: PASS.

**Step 4: Run full test suite**

```bash
cd tastile-web && bun test
```

Expected: All existing tests PASS.

**Step 5: Commit**

```bash
git add tastile-web/src/components/schedule/ScheduleMain.tsx
git commit -m "feat(schedule): route recurring tile edits through QuickTileCreate"
```

---

## Task 6: Remove `RecurringTileConfigDialog` and `recurringDialog` store slice

**Files:**
- Modify: `tastile-web/src/lib/stores/dialog-store.ts`
- Delete: `tastile-web/src/components/tiles/dialogs/RecurringTileConfigDialog.tsx`
- Modify: `tastile-web/src/components/schedule/ScheduleMain.tsx` (remove the `<RecurringTileConfigDialog />` mount at line 256)

**Step 1: Find all references to `RecurringTileConfigDialog` and `recurringDialog`**

```bash
cd tastile-web && grep -rn "RecurringTileConfigDialog\|recurringDialog\|openRecurringDialog\|closeRecurringDialog" src/
```

Expected matches: `dialog-store.ts`, `ScheduleMain.tsx`, `RecurringTileConfigDialog.tsx`, possibly test files. List each.

**Step 2: Remove from `dialog-store.ts`**

Delete:
- The `recurringDialog` state field (line 18-23)
- The `openRecurringDialog` and `closeRecurringDialog` actions (line 70-77)
- Any related types

**Step 3: Remove mount from `ScheduleMain.tsx`**

Delete line 256: `<RecurringTileConfigDialog />`. Also remove the import at line 6.

**Step 4: Delete `RecurringTileConfigDialog.tsx`**

```bash
git rm tastile-web/src/components/tiles/dialogs/RecurringTileConfigDialog.tsx
```

**Step 5: Verify nothing else references it**

```bash
cd tastile-web && grep -rn "RecurringTileConfigDialog\|openRecurringDialog\|closeRecurringDialog" src/
```

Expected: no matches.

**Step 6: Verify typecheck + tests**

```bash
cd tastile-web && bun run typecheck
cd tastile-web && bun test
```

Expected: typecheck PASS; all tests PASS.

**Step 7: Commit**

```bash
git add tastile-web/src/lib/stores/dialog-store.ts tastile-web/src/components/schedule/ScheduleMain.tsx
git commit -m "refactor: remove RecurringTileConfigDialog and recurringDialog store"
git commit -m "refactor: delete standalone RecurringTileConfigDialog component"  --allow-empty
```

---

## Task 7: Browser verification

**Files:** none — verification only.

**Step 1: Start dev server in background**

```bash
cd tastile-web && bun dev
```

Wait for `http://localhost:3000` to be ready.

**Step 2: Open dashboard in browser via chrome-devtools MCP**

Use `mcp__chrome-devtools__new_page` with the dashboard URL.

**Step 3: Navigate to Recurring Tiles view**

Click into the schedule page → recurring tab. Verify the templates list still renders.

**Step 4: Click a template row**

Confirm the QuickTileCreate panel opens in edit mode with the recurrence fields populated. Take a screenshot.

**Step 5: Edit the weekday chips**

Toggle a weekday off. Confirm the change reflects in the store (via `setField("recurrence", ...)`). Screenshot.

**Step 6: Edit the start time**

Change the start time. Confirm. Screenshot.

**Step 7: Switch to Generator tab**

Click "Generator". Confirm the kind picker shows "time_based" (or "focus_block_based" if applicable). Edit step_min. Screenshot.

**Step 8: Save and reload**

Click commit. Reload the page. Confirm the changes persist.

**Step 9: Stop dev server**

```bash
# kill the bun dev process started in step 1
```

---

## Task 8: Final review

**Files:** none — verification only.

**Step 1: Re-run all tests**

```bash
cd tastile-web && bun test
```

Expected: all PASS.

**Step 2: Lint**

```bash
cd tastile-web && bun run lint
```

Expected: no new warnings.

**Step 3: Summarize**

Report:
- Files changed: 5 (or 6 with task 0 doc note)
- Files deleted: 1
- New i18n keys added: list them
- Any deviations from the plan
- Rollback: `git revert` the last 7 commits; or restore from `RecurringTileConfigDialog.tsx` git history.

---

## Risks & Rollback

**Risks**:
1. **Backend dependency**: Tasks assume `getTile` and `updateTile` accept the v7 envelope shape. If backend rejects, save will fail. Mitigation: Task 0 verification step.
2. **Mapping completeness**: `loadFromRecurringTile` maps the most-used 7 layers but may miss edge cases (e.g., `interruption`, `automation` condition layers). Mitigation: defaults applied via `reset()` for unmapped layers.
3. **Existing tests**: `QuickTileCreate.test.tsx` has 52 tests; we touched the Recurring sub-panel but kept Lifecycle untouched. Run the test suite after each task.
4. **i18n**: New strings (e.g., `recurringTabLifecycle`, `stepMin`) need ja/en translations. Add to `src/lib/i18n/`.

**Rollback**:
- Each task is a separate commit. `git revert <commit>` undoes independently.
- Worst case: revert Task 6 to restore `RecurringTileConfigDialog` + `recurringDialog` state; revert Task 5 to restore the old click handler.

**Frequency of commits**: One commit per task. 8 commits total. Each commit passes typecheck and tests.