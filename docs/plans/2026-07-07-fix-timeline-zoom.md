# Timeline Zoom Fix Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken Ctrl/Cmd+wheel and two-finger pinch zoom in Day/Week timeline views by correcting the `useZoom` hook's event listener attachment, and add zoom support to the `[view]` route's DayGrid.

**Architecture:** The `useZoom` hook has a React lifecycle bug: the `useEffect` that attaches wheel/touch listeners depends only on `[applyAnchored]` (a stable callback), so it runs once on mount when `elRef.current` is still `null`. Listeners are never attached. Fix: re-run the effect when the ref'd element changes. Additionally, the `/dashboard/calendar/[view]` route's `DayGrid` component lacks zoom entirely — add `useZoom` there.

**Tech Stack:** React 19, TypeScript, Vitest

---

### Task 1: Fix `useZoom` hook — event listener attachment bug

**Files:**
- Modify: `tastile-web/src/lib/hooks/use-zoom.ts:132-210`

**Step 1: Identify the bug**

The `useEffect` at line 132 has dependency `[applyAnchored]`. Since `applyAnchored` is a `useCallback([], [])`, it never changes, so the effect runs exactly once — at mount time when `elRef.current` is `null`. The `if (!el) return;` at line 134 bails out, and listeners are never attached.

**Step 2: Fix the dependency array**

Change the `useEffect` dependency from `[applyAnchored]` to `[applyAnchored, _attachedTick]`. The `_attachedTick` state increments every time the ref callback fires with a new element (line 75), so the effect will re-run when the element is attached/changed.

```typescript
// Line 210: change [applyAnchored] → [applyAnchored, _attachedTick]
  }, [applyAnchored, _attachedTick]);
```

**Step 3: Run existing tests**

```bash
cd tastile-web && bun test src/lib/hooks/use-zoom
```

Expected: PASS (or no test file exists — that's fine, we'll add one in Task 2).

**Step 4: Verify with manual test**

Open `/dashboard/calendar` in browser, switch to Day or Week view, hold Ctrl and scroll wheel — the grid should zoom in/out with the content under the cursor staying stationary.

---

### Task 2: Add unit test for `useZoom` event listener attachment

**Files:**
- Create: `tastile-web/src/lib/hooks/use-zoom.test.tsx`

**Step 1: Write the test**

```tsx
import { render, fireEvent } from "@testing-library/react";
import { useZoom } from "./use-zoom";

function TestComponent() {
  const { ref, zoom } = useZoom<HTMLDivElement>({ initial: 56, min: 32, max: 192, step: 8 });
  return (
    <div data-testid="scroll-parent" style={{ overflowY: "auto", height: 400 }}>
      <div ref={ref} data-testid="grid" style={{ height: 24 * 56 }}>
        <div style={{ height: 1000 }} />
      </div>
    </div>
  );
}

describe("useZoom", () => {
  it("attaches wheel listener after ref callback fires", () => {
    const { getByTestId } = render(<TestComponent />);
    const grid = getByTestId("grid");

    // Ctrl+wheel up should increase zoom
    fireEvent.wheel(grid, { deltaY: -100, ctrlKey: true });
    // After fix, zoom should change from 56 → 64
    // (Before fix, zoom stays at 56 because listener was never attached)
  });

  it("does not zoom without ctrlKey", () => {
    const { getByTestId } = render(<TestComponent />);
    const grid = getByTestId("grid");
    fireEvent.wheel(grid, { deltaY: -100, ctrlKey: false });
    // zoom should remain 56
  });
});
```

**Step 2: Run test**

```bash
cd tastile-web && bun test src/lib/hooks/use-zoom.test.tsx
```

Expected: PASS after Task 1 fix is applied.

---

### Task 3: Add zoom support to `[view]` route's DayGrid

**Files:**
- Modify: `tastile-web/src/app/dashboard/calendar/[view]/page.tsx:261-285`

**Step 1: Add useZoom import and integrate into DayGrid**

The current `DayGrid` uses fixed `min-h-[44px]` rows. Replace with zoom-aware hour height.

```tsx
import { useZoom } from "@/lib/hooks/use-zoom";

const HOUR_HEIGHT_DEFAULT = 56;

function DayGrid({ blocks }: { blocks: CalendarBlock[] }) {
  const { ref: gridRef, zoom: hourHeight } = useZoom<HTMLDivElement>({
    initial: HOUR_HEIGHT_DEFAULT,
  });
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div ref={gridRef} className="grid grid-cols-[60px_1fr]" style={{ height: `${24 * hourHeight}px` }}>
      {/* ... existing content, replace min-h-[44px] with hourHeight ... */}
    </div>
  );
}
```

**Step 2: Update hour row height**

Change the hour row container from `min-h-[44px]` to use `hourHeight`:

```tsx
<div
  className="relative border-b border-border px-4 py-1.5"
  style={{ height: `${hourHeight}px` }}
>
```

**Step 3: Run lint**

```bash
cd tastile-web && bun run lint
```

Expected: No errors.

**Step 4: Run tests**

```bash
cd tastile-web && bun test
```

Expected: All tests pass.

---

### Task 4: Add zoom support to `[view]` route's WeekGrid (optional)

**Note:** The current `WeekGrid` is a 7-column card layout (not an hourly grid), so zoom is less meaningful. Skip unless the user specifically requests it.

---

## Verification Checklist

- [ ] Ctrl+wheel zooms in/out on Day view (`/dashboard/calendar`)
- [ ] Ctrl+wheel zooms in/out on Week view (`/dashboard/calendar`)
- [ ] Two-finger pinch zooms on touch devices
- [ ] Content under cursor/pinch midpoint stays stationary during zoom
- [ ] Zoom level is clamped to 32–192 px/hour
- [ ] `/dashboard/calendar/day` route also supports zoom
- [ ] No lint errors
- [ ] All tests pass
