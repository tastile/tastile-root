# Mantine Schedule Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/components/calendar/CalendarMain.tsx` and its custom Day/Week/Month/EventList views with `@mantine/schedule` 9.5.0 primitives, wrapped by a new `ScheduleTimeline` component, on both `/dashboard/timeline` routes.

**Architecture:** Direct-views (Approach B). A custom `ScheduleTimeline` parent picks one of 5 panel components (Day/Week/Month/Year/Agenda), each wrapping a Mantine view. `useTimelineState` syncs `{view, mode, anchor, zoom}` with the URL. `eventAdapter.toScheduleEvent` maps `CalendarEvent` → `ScheduleEventData<CalendarEvent>` (payload carries the original for click handlers). `renderEventBody` injects icon/project/tags + `data-testid` per scope. `useResponsiveBreakpoint` switches desktop view → `MobileMonthView` at ≤600px.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Mantine 9.5.0 (existing) · `@mantine/schedule@9.5.0` (new) · `rrule@^2.8.1` (Mantine peer) · Vitest 4 · `@testing-library/react@16` · bun 1.3.14

**Spec:** `docs/superpowers/specs/2026-07-30-mantine-schedule-replacement-design.md`

**Branch:** `feat/mantine-schedule-replacement` (off `main`)

## Working directory

All paths in this plan are relative to `tastile-web/`. Run `cd tastile-web` before executing.

## Scope check

Single subsystem: the calendar UI under `src/components/calendar/` + `src/lib/calendar/layout.ts` (partial) + the 2 route files. Side panel (`src/components/panels/CalendarSidePanel.tsx`), `useEvents`, `useQuickCreateStore`, `getModeRange`, and date utilities are reused unchanged.

## File structure

### New files

```
src/components/schedule/
├── ScheduleTimeline.tsx        # parent: view selection + state orchestration
├── ScheduleToolbar.tsx         # toolbar (prev/next/today/view/mode/zoom)
├── useTimelineState.ts         # URL ↔ { view, mode, anchor, zoom }
├── useResponsiveBreakpoint.ts  # matchMedia(<= 600 px)
├── eventAdapter.ts             # CalendarEvent → ScheduleEventData
├── renderEventBody.tsx         # icon/project/tags overlay + testid
├── ErrorBanner.tsx             # red banner overlay
├── LoadingOverlay.tsx          # loading shimmer
├── DayPanel.tsx                # wraps @mantine/schedule DayView
├── WeekPanel.tsx               # wraps @mantine/schedule WeekView
├── MonthPanel.tsx              # wraps @mantine/schedule MonthView
├── YearPanel.tsx               # wraps @mantine/schedule YearView
└── AgendaPanel.tsx             # wraps @mantine/schedule AgendaView

src/components/schedule/__tests__/
├── eventAdapter.test.ts
├── clampRange.test.ts
├── renderEventBody.test.tsx
├── useTimelineState.test.ts
├── useResponsiveBreakpoint.test.ts
└── ScheduleToolbar.test.tsx
```

### Modified files

- `src/app/dashboard/timeline/page.tsx` — swap `CalendarMain` → `ScheduleTimeline`
- `src/app/dashboard/timeline/[view]/page.tsx` — same swap, pass `initialView={view}`
- `src/lib/calendar/layout.ts` — remove `layoutDayLanes`, `eventSpansDay` (add `getYearViewRange`, `getAgendaViewRange`)
- `src/lib/calendar/layout.test.ts` — drop `eventSpansDay` cases
- `e2e/calendar-event-flow.spec.ts` — already `.skip`-marked; no action needed
- `package.json` — add `@mantine/schedule@9.5.0`, `rrule@^2.8.1`

### Deleted files

```
src/components/calendar/CalendarMain.tsx
src/components/calendar/DayView.tsx
src/components/calendar/WeekView.tsx
src/components/calendar/MonthView.tsx
src/components/calendar/EventListView.tsx
src/components/calendar/DayViewFrame.tsx
src/components/calendar/WeekViewFrame.tsx
src/components/calendar/MonthViewFrame.tsx
src/components/calendar/AllDayLane.tsx
src/components/calendar/NowIndicator.tsx
src/components/calendar/DayViewTile.tsx
src/components/calendar/WeekViewTile.tsx
src/components/calendar/MonthEventTile.tsx
```

Pre-existing dirty files (`CalendarSidePanel.tsx`, `ProjectsSidePanel.tsx`, `ScheduleSidePanel.tsx`, `SideToolPanel.tsx`, `ProjectTree.tsx`) are NOT touched.

<!-- END OF CHUNK 1 -->

## Task 1: Add Mantine Schedule dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

```bash
cd tastile-web
bun add @mantine/schedule@9.5.0
bun add rrule@^2.8.1
```

- [ ] **Step 2: Verify lockfile + types resolve**

```bash
bun run typecheck
```

Expected: clean exit. If `@mantine/schedule` types fail, run `bun run generate-types` (it regenerates from openapi spec; not strictly needed for Mantine but worth trying).

- [ ] **Step 3: Verify Mantine Schedule exports resolve**

Create `src/components/schedule/__probe__.ts` with one import line:

```ts
import { DayView, WeekView, MonthView, YearView, AgendaView, MobileMonthView } from "@mantine/schedule";
export { DayView, WeekView, MonthView, YearView, AgendaView, MobileMonthView };
```

Run:

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Delete probe, commit**

```bash
rm src/components/schedule/__probe__.ts
git add package.json bun.lockb bun.lock
git commit -m "feat(calendar): add @mantine/schedule + rrule deps"
```

---

## Task 2: eventAdapter — `toScheduleEvent` + color mapping

**Files:**
- Create: `src/components/schedule/eventAdapter.ts`
- Create: `src/components/schedule/__tests__/eventAdapter.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/components/schedule/__tests__/eventAdapter.test.ts
import { describe, expect, it } from "vitest";
import { toScheduleEvent, colorToMantine } from "../eventAdapter";
import type { CalendarEvent } from "@/lib/domain/calendar";

const baseEvent: CalendarEvent = {
  id: "evt-1",
  title: "Standup",
  description: null,
  location: null,
  start: "2026-07-30T09:00:00Z",
  end: "2026-07-30T10:00:00Z",
  allDay: false,
  color: "blue",
  recurrence: { frequency: "none" },
  attendees: [],
  icon: "check-circle",
  project: "alpha",
  tags: ["work"],
  memo: null,
  source: { kind: 0, detail: null },
  tileId: "tile-1",
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

describe("toScheduleEvent", () => {
  it("preserves id and payload", () => {
    const out = toScheduleEvent(baseEvent);
    expect(out.id).toBe("evt-1");
    expect(out.payload).toBe(baseEvent);
  });

  it("converts timed start/end to Date", () => {
    const out = toScheduleEvent(baseEvent);
    expect(out.start).toBeInstanceOf(Date);
    expect((out.start as Date).toISOString()).toBe("2026-07-30T09:00:00.000Z");
    expect(out.end).toBeInstanceOf(Date);
  });

  it("keeps all-day start/end as YYYY-MM-DD strings", () => {
    const ad = { ...baseEvent, allDay: true, start: "2026-07-30", end: "2026-07-31" };
    const out = toScheduleEvent(ad);
    expect(out.start).toBe("2026-07-30");
    expect(out.end).toBe("2026-07-31");
    expect(out.allDay).toBe(true);
  });

  it("sets variant=light, display=default", () => {
    const out = toScheduleEvent(baseEvent);
    expect(out.variant).toBe("light");
    expect(out.display).toBe("default");
  });

  it("never sets recurrence-related fields", () => {
    const out = toScheduleEvent(baseEvent) as Record<string, unknown>;
    expect(out.recurrence).toBeUndefined();
    expect(out.recurringEventId).toBeUndefined();
    expect(out.recurrenceId).toBeUndefined();
  });

  it("maps every Tastile EventColor", () => {
    const colors = ["blue", "green", "purple", "orange", "pink", "cyan",
                    "yellow", "red", "teal", "indigo", "lime", "gray"] as const;
    for (const c of colors) {
      expect(colorToMantine(c)).toMatch(/^(blue|teal|grape|red|orange|yellow|lime|cyan|indigo|pink|gray|dark)$/);
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL (module not found)**

```bash
bun test src/components/schedule/__tests__/eventAdapter.test.ts
```

Expected: FAIL with "Cannot find module '../eventAdapter'".

- [ ] **Step 3: Implement `eventAdapter.ts`**

```ts
// src/components/schedule/eventAdapter.ts
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent, EventColor } from "@/lib/domain/calendar";

const COLOR_MAP: Record<EventColor, string> = {
  blue: "blue",
  green: "teal",
  purple: "grape",
  orange: "orange",
  pink: "pink",
  cyan: "cyan",
  yellow: "yellow",
  red: "red",
  teal: "teal",
  indigo: "indigo",
  lime: "lime",
  gray: "gray",
};

export function colorToMantine(c: EventColor): string {
  return COLOR_MAP[c] ?? "blue";
}

export function toScheduleEvent(e: CalendarEvent): ScheduleEventData<CalendarEvent> {
  return {
    id: e.id,
    title: e.title,
    start: e.allDay ? e.start.slice(0, 10) : new Date(e.start),
    end: e.allDay ? e.end.slice(0, 10) : new Date(e.end),
    color: colorToMantine(e.color),
    variant: "light",
    display: "default",
    allDay: e.allDay,
    payload: e,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/eventAdapter.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/eventAdapter.ts src/components/schedule/__tests__/eventAdapter.test.ts
git commit -m "feat(calendar): add eventAdapter.toScheduleEvent + colorToMantine"
```

---

## Task 3: clampRange utility

**Files:**
- Create: `src/components/schedule/clampRange.ts`
- Create: `src/components/schedule/__tests__/clampRange.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/components/schedule/__tests__/clampRange.test.ts
import { describe, expect, it, vi } from "vitest";
import { clampRange } from "../clampRange";

describe("clampRange", () => {
  it("passes through ranges <= maxDays", () => {
    const r = { start: "2026-07-30T00:00:00Z", end: "2026-08-05T00:00:00Z" };
    expect(clampRange(r, 31)).toEqual(r);
  });

  it("clamps to maxDays when exceeded", () => {
    const r = { start: "2026-07-30T00:00:00Z", end: "2026-09-30T00:00:00Z" };
    const out = clampRange(r, 31);
    const startMs = new Date(out.start).getTime();
    const endMs = new Date(out.end).getTime();
    expect((endMs - startMs) / 86_400_000).toBeCloseTo(31, 1);
  });

  it("warns once on clamp", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = { start: "2026-07-30T00:00:00Z", end: "2026-09-30T00:00:00Z" };
    clampRange(r, 31);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/clampRange.test.ts
```

- [ ] **Step 3: Implement `clampRange.ts`**

```ts
// src/components/schedule/clampRange.ts
export function clampRange(
  range: { start: string; end: string },
  maxDays = 31,
): { start: string; end: string } {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  const days = (endMs - startMs) / 86_400_000;
  if (days <= maxDays) return range;
  console.warn(`[schedule] range clamped from ${days.toFixed(1)}d to ${maxDays}d`);
  return {
    start: range.start,
    end: new Date(startMs + maxDays * 86_400_000).toISOString(),
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/clampRange.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/clampRange.ts src/components/schedule/__tests__/clampRange.test.ts
git commit -m "feat(calendar): add clampRange utility (31d safety net)"
```

<!-- END OF CHUNK 2 -->

## Task 4: renderEventBody

**Files:**
- Create: `src/components/schedule/renderEventBody.tsx`
- Create: `src/components/schedule/__tests__/renderEventBody.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/schedule/__tests__/renderEventBody.test.tsx
/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderEventBody } from "../renderEventBody";
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";

// Stub lucide icons so tests don't try to render SVGs
vi.mock("lucide-react", () => ({
  CheckCircle: () => <span data-testid="icon-check" />,
}));

const baseEvent: CalendarEvent = {
  id: "evt-1",
  title: "Standup",
  description: null,
  location: null,
  start: "2026-07-30T09:00:00Z",
  end: "2026-07-30T10:00:00Z",
  allDay: false,
  color: "blue",
  recurrence: { frequency: "none" },
  icon: "check-circle",
  project: "alpha",
  tags: ["work", "sync"],
  memo: null,
  source: { kind: 0, detail: null },
  tileId: "tile-1",
  attendees: [],
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

function ev(scope: "day" | "week" | "month" | "agenda"): ScheduleEventData<CalendarEvent> {
  return { id: baseEvent.id, title: baseEvent.title, start: new Date(baseEvent.start),
           end: new Date(baseEvent.end), color: "blue", variant: "light", display: "default",
           allDay: false, payload: baseEvent };
}

describe("renderEventBody", () => {
  it("emits day-event-${id} testid for day scope", () => {
    render(<>{renderEventBody(ev("day"), "day")}</>);
    expect(screen.getByTestId("day-event-evt-1")).toBeInTheDocument();
  });

  it("emits week-event-${id} for week scope", () => {
    render(<>{renderEventBody(ev("week"), "week")}</>);
    expect(screen.getByTestId("week-event-evt-1")).toBeInTheDocument();
  });

  it("emits month-event-${id} for month scope", () => {
    render(<>{renderEventBody(ev("month"), "month")}</>);
    expect(screen.getByTestId("month-event-evt-1")).toBeInTheDocument();
  });

  it("emits agenda-event-${id} for agenda scope", () => {
    render(<>{renderEventBody(ev("agenda"), "agenda")}</>);
    expect(screen.getByTestId("agenda-event-evt-1")).toBeInTheDocument();
  });

  it("renders title as text", () => {
    render(<>{renderEventBody(ev("day"), "day")}</>);
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });

  it("renders icon when set", () => {
    render(<>{renderEventBody(ev("day"), "day")}</>);
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
  });

  it("renders project badge when set", () => {
    render(<>{renderEventBody(ev("day"), "day")}</>);
    expect(screen.getByTestId("event-project")).toBeInTheDocument();
  });

  it("renders tag dots when tags exist", () => {
    render(<>{renderEventBody(ev("day"), "day")}</>);
    expect(screen.getByTestId("event-tag-work")).toBeInTheDocument();
  });

  it("degrades gracefully without icon/project/tags", () => {
    const e: ScheduleEventData<CalendarEvent> = {
      ...ev("day"),
      payload: { ...baseEvent, icon: null, project: null, tags: [] },
    };
    render(<>{renderEventBody(e, "day")}</>);
    expect(screen.queryByTestId("event-project")).not.toBeInTheDocument();
    expect(screen.queryByTestId("icon-check")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/renderEventBody.test.tsx
```

- [ ] **Step 3: Implement `renderEventBody.tsx`**

```tsx
// src/components/schedule/renderEventBody.tsx
"use client";

import type { ScheduleEventData } from "@mantine/schedule";
import * as Lucide from "lucide-react";
import type { CalendarEvent } from "@/lib/domain/calendar";

export type EventScope = "day" | "week" | "month" | "agenda";

const SCOPE_TESTID: Record<EventScope, string> = {
  day: "day-event",
  week: "week-event",
  month: "month-event",
  agenda: "agenda-event",
};

export function renderEventBody(
  event: ScheduleEventData<CalendarEvent>,
  scope: EventScope,
) {
  const e = event.payload;
  if (!e) return null;
  const Icon = e.icon ? (Lucide as unknown as Record<string, React.FC<{ className?: string }>>)[pascalize(e.icon)] : null;
  return (
    <div
      data-testid={`${SCOPE_TESTID[scope]}-${e.id}`}
      className="flex items-center gap-1 truncate"
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
      <span className="truncate">{e.title}</span>
      {e.project ? (
        <span
          data-testid="event-project"
          className="rounded bg-surface-2 px-1 text-[9px] uppercase tracking-wider text-foreground-subtle"
        >
          {e.project}
        </span>
      ) : null}
      {e.tags?.length
        ? e.tags.map((t) => (
            <span
              key={t}
              data-testid={`event-tag-${t}`}
              className="h-1.5 w-1.5 rounded-full bg-primary"
            />
          ))
        : null}
    </div>
  );
}

function pascalize(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/renderEventBody.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/renderEventBody.tsx src/components/schedule/__tests__/renderEventBody.test.tsx
git commit -m "feat(calendar): add renderEventBody with per-scope testid"
```

---

## Task 5: useTimelineState

**Files:**
- Create: `src/components/schedule/useTimelineState.ts`
- Create: `src/components/schedule/__tests__/useTimelineState.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/components/schedule/__tests__/useTimelineState.test.ts
/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let mockSearch = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/dashboard/timeline",
  useSearchParams: () => mockSearch,
}));

import { useTimelineState } from "../useTimelineState";

describe("useTimelineState", () => {
  beforeEach(() => {
    replace.mockReset();
    mockSearch = new URLSearchParams();
  });

  it("defaults to day view, scope mode, today, zoom 56", () => {
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.view).toBe("day");
    expect(result.current.mode).toBe("scope");
    expect(result.current.zoom).toBe(56);
    expect(result.current.anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back on invalid view param", () => {
    mockSearch = new URLSearchParams("view=bogus");
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.view).toBe("day");
  });

  it("falls back on invalid zoom", () => {
    mockSearch = new URLSearchParams("zoom=abc");
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.zoom).toBe(56);
  });

  it("setView writes ?view=", () => {
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.setView("week"));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("view=week"), { scroll: false });
  });

  it("setMode omits URL param when scope (default)", () => {
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.setMode("scope"));
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^[^?]*$/), { scroll: false });
  });

  it("setMode writes ?mode=around for non-default", () => {
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.setMode("around"));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("mode=around"), { scroll: false });
  });

  it("setZoom omits URL param when default 56", () => {
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.setZoom(56));
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^[^?]*$/), { scroll: false });
  });

  it("setZoom clamps to [24, 160]", () => {
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.setZoom(999));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("zoom=160"), { scroll: false });
  });

  it("shiftAnchor moves day by 1 day for day view", () => {
    mockSearch = new URLSearchParams("date=2026-07-30");
    const { result } = renderHook(() => useTimelineState());
    act(() => result.current.shiftAnchor(1));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("date=2026-07-31"), { scroll: false });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/useTimelineState.test.ts
```

- [ ] **Step 3: Implement `useTimelineState.ts`**

```ts
// src/components/schedule/useTimelineState.ts
"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type ScheduleView = "day" | "week" | "month" | "year" | "agenda";
const VALID_VIEWS: ScheduleView[] = ["day", "week", "month", "year", "agenda"];

export type DisplayMode = "scope" | "around" | "future";
const VALID_MODES: DisplayMode[] = ["scope", "around", "future"];

const ZOOM_MIN = 24;
const ZOOM_MAX = 160;
const ZOOM_DEFAULT = 56;
const ZOOM_STEP = 8;

function parseView(s: string | null): ScheduleView {
  return VALID_VIEWS.includes(s as ScheduleView) ? (s as ScheduleView) : "day";
}
function parseMode(s: string | null): DisplayMode {
  return VALID_MODES.includes(s as DisplayMode) ? (s as DisplayMode) : "scope";
}
function parseZoom(s: string | null): number {
  const n = s ? Number(s) : NaN;
  if (Number.isNaN(n)) return ZOOM_DEFAULT;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
}

function todayLocalIso(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function shiftDate(date: string, view: ScheduleView, delta: -1 | 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (view === "day" || view === "agenda") d.setUTCDate(d.getUTCDate() + delta);
  else if (view === "week") d.setUTCDate(d.getUTCDate() + delta * 7);
  else if (view === "month") d.setUTCMonth(d.getUTCMonth() + delta);
  else d.setUTCFullYear(d.getUTCFullYear() + delta);
  return d.toISOString().slice(0, 10);
}

export interface TimelineState {
  view: ScheduleView;
  mode: DisplayMode;
  anchor: string;
  zoom: number;
  effectiveAnchor: string;
  setView: (v: ScheduleView) => void;
  setMode: (m: DisplayMode) => void;
  setAnchor: (a: string) => void;
  setZoom: (z: number) => void;
  shiftAnchor: (delta: -1 | 1) => void;
}

export function useTimelineState(initialView: ScheduleView = "day"): TimelineState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ view?: string }>();

  const view = useMemo(() => {
    if (params.view && VALID_VIEWS.includes(params.view as ScheduleView)) {
      return params.view as ScheduleView;
    }
    return parseView(searchParams.get("view"));
  }, [params.view, searchParams]);

  const mode = parseMode(searchParams.get("mode"));
  const anchor = searchParams.get("date") ?? todayLocalIso();
  const zoom = parseZoom(searchParams.get("zoom"));
  const effectiveAnchor = mode === "scope" ? anchor : todayLocalIso();

  const syncUrl = useCallback(
    (next: { view?: ScheduleView; mode?: DisplayMode; date?: string; zoom?: number }) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next.view !== undefined) qs.set("view", next.view);
      if (next.mode !== undefined) {
        if (next.mode === "scope") qs.delete("mode");
        else qs.set("mode", next.mode);
      }
      if (next.date !== undefined) {
        if (next.date === todayLocalIso()) qs.delete("date");
        else qs.set("date", next.date);
      }
      if (next.zoom !== undefined) {
        if (next.zoom === ZOOM_DEFAULT) qs.delete("zoom");
        else qs.set("zoom", String(next.zoom));
      }
      const url = qs.toString() ? `${pathname}?${qs.toString()}` : pathname;
      router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setView = useCallback((v: ScheduleView) => syncUrl({ view: v }), [syncUrl]);
  const setMode = useCallback(
    (m: DisplayMode) => syncUrl({ mode: m }),
    [syncUrl],
  );
  const setAnchor = useCallback((a: string) => syncUrl({ date: a }), [syncUrl]);
  const setZoom = useCallback(
    (z: number) => syncUrl({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }),
    [syncUrl],
  );
  const shiftAnchor = useCallback(
    (delta: -1 | 1) => syncUrl({ date: shiftDate(anchor, view, delta) }),
    [syncUrl, anchor, view],
  );

  return {
    view: initialView !== "day" && params.view ? view : view,
    mode,
    anchor,
    zoom,
    effectiveAnchor,
    setView,
    setMode,
    setAnchor,
    setZoom,
    shiftAnchor,
  };
}

export { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, ZOOM_STEP };
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/useTimelineState.test.ts
```

If `shiftAnchor` test fails because `params.view` is not set, ensure mock provides `useParams: () => ({})`.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/useTimelineState.ts src/components/schedule/__tests__/useTimelineState.test.ts
git commit -m "feat(calendar): add useTimelineState hook with URL sync"
```

<!-- END OF CHUNK 3 -->

## Task 6: useResponsiveBreakpoint

**Files:**
- Create: `src/components/schedule/useResponsiveBreakpoint.ts`
- Create: `src/components/schedule/__tests__/useResponsiveBreakpoint.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/components/schedule/__tests__/useResponsiveBreakpoint.test.ts
/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResponsiveBreakpoint } from "../useResponsiveBreakpoint";

describe("useResponsiveBreakpoint", () => {
  const originalInnerWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;

  function setMatchMedia(width: number, matches: boolean) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    window.matchMedia = vi.fn().mockImplementation((q: string) => {
      const mql = {
        matches,
        media: q,
        addEventListener: vi.fn((_e: string, h: (ev: { matches: boolean }) => void) => {
          mql._handler = h;
        }),
        removeEventListener: vi.fn(),
        _handler: undefined as ((ev: { matches: boolean }) => void) | undefined,
      };
      return mql;
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
    window.matchMedia = originalMatchMedia;
  });

  it("returns 'desktop' when innerWidth > 600", () => {
    setMatchMedia(1200, false);
    const { result } = renderHook(() => useResponsiveBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'mobile' when innerWidth <= 600", () => {
    setMatchMedia(600, true);
    const { result } = renderHook(() => useResponsiveBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("updates when matchMedia change fires", () => {
    setMatchMedia(1200, false);
    const { result } = renderHook(() => useResponsiveBreakpoint());
    expect(result.current).toBe("desktop");
    act(() => {
      const mql = window.matchMedia("(max-width: 600px)") as unknown as {
        _handler: (ev: { matches: boolean }) => void;
      };
      mql._handler({ matches: true });
    });
    expect(result.current).toBe("mobile");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/useResponsiveBreakpoint.test.ts
```

- [ ] **Step 3: Implement `useResponsiveBreakpoint.ts`**

```ts
// src/components/schedule/useResponsiveBreakpoint.ts
"use client";

import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "desktop";

export function useResponsiveBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === "undefined") return "desktop";
    return window.innerWidth <= 600 ? "mobile" : "desktop";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 600px)");
    const handler = (e: MediaQueryListEvent) => setBp(e.matches ? "mobile" : "desktop");
    setBp(mq.matches ? "mobile" : "desktop");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return bp;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/useResponsiveBreakpoint.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/useResponsiveBreakpoint.ts src/components/schedule/__tests__/useResponsiveBreakpoint.test.ts
git commit -m "feat(calendar): add useResponsiveBreakpoint (600px mobile)"
```

---

## Task 7: ErrorBanner + LoadingOverlay

**Files:**
- Create: `src/components/schedule/ErrorBanner.tsx`
- Create: `src/components/schedule/LoadingOverlay.tsx`

These are presentational components with no behaviour. No tests required (they are exercised via the parent `ScheduleTimeline`).

- [ ] **Step 1: Implement `ErrorBanner.tsx`**

```tsx
// src/components/schedule/ErrorBanner.tsx
"use client";

import { Alert } from "@mantine/core";
import { AlertCircle } from "lucide-react";

export function ErrorBanner({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-4 top-2 z-20 flex justify-center"
      data-testid="cal-error-wrap"
    >
      <Alert
        variant="light"
        color="red"
        icon={<AlertCircle className="h-4 w-4" />}
        title={`Couldn't load events: ${error.message}`}
        data-testid="cal-error"
        className="pointer-events-auto w-full max-w-2xl"
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement `LoadingOverlay.tsx`**

```tsx
// src/components/schedule/LoadingOverlay.tsx
"use client";

import type { ReactNode } from "react";

export function LoadingOverlay({
  loading,
  children,
}: {
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full">
      {children}
      {loading ? (
        <div
          data-testid="day-loading"
          className="pointer-events-none absolute inset-0 flex items-start justify-center bg-surface-0/40 pt-4 text-[10px] uppercase tracking-wider text-foreground-subtle"
        >
          Loading…
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/ErrorBanner.tsx src/components/schedule/LoadingOverlay.tsx
git commit -m "feat(calendar): add ErrorBanner + LoadingOverlay components"
```

<!-- END OF CHUNK 4 -->

## Task 8: ScheduleToolbar

**Files:**
- Create: `src/components/schedule/ScheduleToolbar.tsx`
- Create: `src/components/schedule/__tests__/ScheduleToolbar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/schedule/__tests__/ScheduleToolbar.test.tsx
/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "@/test/render-with-mantine";
import { ScheduleToolbar } from "../ScheduleToolbar";

const handlers = {
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onToday: vi.fn(),
  onViewChange: vi.fn(),
  onModeChange: vi.fn(),
  onZoomChange: vi.fn(),
};

beforeEach(() => {
  Object.values(handlers).forEach((h) => h.mockReset());
});

const baseProps = {
  view: "day" as const,
  mode: "scope" as const,
  anchor: "2026-07-30",
  zoom: 56,
  navDisabled: false,
  ...handlers,
};

describe("ScheduleToolbar", () => {
  it("renders view switcher with all 5 options", () => {
    renderWithMantine(<ScheduleToolbar {...baseProps} />);
    expect(screen.getByTestId("cal-view-day")).toBeInTheDocument();
    expect(screen.getByTestId("cal-view-week")).toBeInTheDocument();
    expect(screen.getByTestId("cal-view-month")).toBeInTheDocument();
    expect(screen.getByTestId("cal-view-year")).toBeInTheDocument();
    expect(screen.getByTestId("cal-view-agenda")).toBeInTheDocument();
  });

  it("calls onViewChange when a view is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ScheduleToolbar {...baseProps} />);
    await user.click(screen.getByTestId("cal-view-week"));
    expect(handlers.onViewChange).toHaveBeenCalledWith("week");
  });

  it("calls onPrev when prev button clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ScheduleToolbar {...baseProps} />);
    await user.click(screen.getByTestId("cal-prev"));
    expect(handlers.onPrev).toHaveBeenCalledTimes(1);
  });

  it("disables prev/next/today when navDisabled", () => {
    renderWithMantine(<ScheduleToolbar {...baseProps} navDisabled={true} />);
    expect(screen.getByTestId("cal-prev")).toBeDisabled();
    expect(screen.getByTestId("cal-next")).toBeDisabled();
    expect(screen.getByTestId("cal-today")).toBeDisabled();
  });

  it("renders mode switcher with 3 options", () => {
    renderWithMantine(<ScheduleToolbar {...baseProps} />);
    expect(screen.getByTestId("cal-mode-scope")).toBeInTheDocument();
    expect(screen.getByTestId("cal-mode-around")).toBeInTheDocument();
    expect(screen.getByTestId("cal-mode-future")).toBeInTheDocument();
  });

  it("calls onZoomChange when zoom +/- clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ScheduleToolbar {...baseProps} />);
    await user.click(screen.getByTestId("cal-zoom-in"));
    expect(handlers.onZoomChange).toHaveBeenCalledWith(64);
    await user.click(screen.getByTestId("cal-zoom-out"));
    expect(handlers.onZoomChange).toHaveBeenCalledWith(48);
  });

  it("clamps zoom within [24, 160]", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(<ScheduleToolbar {...baseProps} zoom={160} />);
    await user.click(screen.getByTestId("cal-zoom-in"));
    expect(handlers.onZoomChange).not.toHaveBeenCalled();
    rerender(<ScheduleToolbar {...baseProps} zoom={24} />);
    await user.click(screen.getByTestId("cal-zoom-out"));
    expect(handlers.onZoomChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/ScheduleToolbar.test.tsx
```

- [ ] **Step 3: Implement `ScheduleToolbar.tsx`**

```tsx
// src/components/schedule/ScheduleToolbar.tsx
"use client";

import { ActionIcon, Button, SegmentedControl } from "@mantine/core";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type {
  ScheduleView,
  DisplayMode,
} from "./useTimelineState";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./useTimelineState";

const VIEW_OPTIONS: { value: ScheduleView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "agenda", label: "Agenda" },
];

const MODE_OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: "scope", label: "Scope" },
  { value: "around", label: "Around" },
  { value: "future", label: "Future" },
];

function formatAnchor(view: ScheduleView, anchor: string): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (view === "day" || view === "agenda") {
    return d.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  }
  if (view === "week") {
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  }
  if (view === "month") {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });
}

function modeLabel(view: ScheduleView, mode: DisplayMode): string | null {
  if (mode === "scope") return null;
  if (mode === "around") {
    if (view === "day") return "Today · ±12h";
    if (view === "week") return "Today · ±3d";
    if (view === "month") return "Today · ±15d";
    return "Today";
  }
  if (view === "day") return "From now · 24h";
  if (view === "week") return "From now · 7d";
  if (view === "month") return "From now · 31d";
  return "From now";
}

export interface ScheduleToolbarProps {
  view: ScheduleView;
  mode: DisplayMode;
  anchor: string;
  zoom: number;
  navDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (v: ScheduleView) => void;
  onModeChange: (m: DisplayMode) => void;
  onZoomChange: (z: number) => void;
}

export function ScheduleToolbar({
  view, mode, anchor, zoom, navDisabled,
  onPrev, onNext, onToday, onViewChange, onModeChange, onZoomChange,
}: ScheduleToolbarProps) {
  const titlePrefix = modeLabel(view, mode);
  return (
    <div className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 bg-surface-0 px-4">
      <ActionIcon
        type="button" variant="subtle" size="sm"
        onClick={onPrev} aria-label="Previous" disabled={navDisabled}
        data-testid="cal-prev"
        className="rounded p-1 text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </ActionIcon>
      <h2 className="font-mono text-sm text-foreground" data-testid="cal-title">
        {titlePrefix ? (
          <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {titlePrefix}
          </span>
        ) : null}
        {formatAnchor(view, anchor)}
      </h2>
      <ActionIcon
        type="button" variant="subtle" size="sm"
        onClick={onNext} aria-label="Next" disabled={navDisabled}
        data-testid="cal-next"
        className="rounded p-1 text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </ActionIcon>
      <Button
        type="button" variant="subtle" size="compact-sm"
        onClick={onToday} disabled={navDisabled}
        data-testid="cal-today"
        className="ml-1 rounded px-2 py-0.5 text-[11px] font-medium text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
      >
        Today
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <SegmentedControl
          size="xs" radius="md" withItemsBorders={false}
          value={mode} onChange={(v) => onModeChange(v as DisplayMode)}
          data={MODE_OPTIONS.map((m) => ({
            value: m.value, label: m.label, "data-testid": `cal-mode-${m.value}`,
          }))}
          styles={{
            root: { backgroundColor: "var(--surface-1)" },
            indicator: { backgroundColor: "var(--surface-2)" },
            label: { color: "var(--foreground)" },
          }}
          data-testid="cal-mode-switcher"
        />
        <SegmentedControl
          size="xs" radius="md" withItemsBorders={false}
          value={view} onChange={(v) => onViewChange(v as ScheduleView)}
          data={VIEW_OPTIONS.map((v) => ({
            value: v.value, label: v.label, "data-testid": `cal-view-${v.value}`,
          }))}
          styles={{
            root: { backgroundColor: "var(--surface-1)" },
            indicator: { backgroundColor: "var(--surface-2)" },
            label: { color: "var(--foreground)" },
          }}
          data-testid="cal-view-switcher"
        />
        <ActionIcon
          type="button" variant="subtle" size="sm"
          onClick={() => zoom < ZOOM_MAX && onZoomChange(zoom + ZOOM_STEP)}
          aria-label="Zoom in" data-testid="cal-zoom-in"
          disabled={zoom >= ZOOM_MAX}
          className="rounded p-1 text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
        >
          <ZoomIn className="h-4 w-4" />
        </ActionIcon>
        <ActionIcon
          type="button" variant="subtle" size="sm"
          onClick={() => zoom > ZOOM_MIN && onZoomChange(zoom - ZOOM_STEP)}
          aria-label="Zoom out" data-testid="cal-zoom-out"
          disabled={zoom <= ZOOM_MIN}
          className="rounded p-1 text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
        >
          <ZoomOut className="h-4 w-4" />
        </ActionIcon>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/ScheduleToolbar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/ScheduleToolbar.tsx src/components/schedule/__tests__/ScheduleToolbar.test.tsx
git commit -m "feat(calendar): add ScheduleToolbar with view/mode/zoom controls"
```

## Task 9: DayPanel — wraps `@mantine/schedule` DayView

**Files:**
- Create: `src/components/schedule/DayPanel.tsx`

- [ ] **Step 1: Implement DayPanel**

```tsx
// src/components/schedule/DayPanel.tsx
"use client";

import { DayView, MobileMonthView } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { DisplayRange } from "@/lib/calendar/layout";
import { clampRange } from "@/lib/calendar/clamp-range";
import { renderEventBody } from "./renderEventBody";
import { useResponsiveBreakpoint } from "./useResponsiveBreakpoint";
import { LoadingOverlay } from "./LoadingOverlay";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  range: DisplayRange;
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  onEventClick: (event: CalendarEvent) => void;
  onSlotCreate: (start: string, end: string) => void;
};

export function DayPanel({ range, events, loading, error, onEventClick, onSlotCreate }: Props) {
  const breakpoint = useResponsiveBreakpoint();

  if (breakpoint === "mobile") {
    return (
      <MobileMonthView
        data-testid="day-panel-mobile"
        events={events}
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "month")}
      />
    );
  }

  const clamped = clampRange(range);
  return (
    <div className="relative" data-testid="day-panel">
      <style>{`:root { --day-view-slot-height: ${clamped.zoom}px; }`}</style>
      {error && <ErrorBanner error={error} />}
      <DayView
        data-testid="day-view"
        date={clamped.anchor}
        events={events}
        canDragEvent={() => false}
        canResizeEvent={() => false}
        withDragSlotSelect
        withCurrentTimeIndicator
        intervalMinutes={30}
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        onTimeSlotClick={({ slotStart, slotEnd }) => onSlotCreate(slotStart, slotEnd)}
        onSlotDragEnd={(s, e) => onSlotCreate(s, e)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "day")}
      />
      {loading && <LoadingOverlay />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schedule/DayPanel.tsx
git commit -m "feat(calendar): add DayPanel wrapping Mantine DayView"
```

---

## Task 10: WeekPanel — wraps `@mantine/schedule` WeekView

**Files:**
- Create: `src/components/schedule/WeekPanel.tsx`

- [ ] **Step 1: Implement WeekPanel**

```tsx
// src/components/schedule/WeekPanel.tsx
"use client";

import { WeekView } from "@mantine/schedule";
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { DisplayRange } from "@/lib/calendar/layout";
import { clampRange } from "@/lib/calendar/clamp-range";
import { renderEventBody } from "./renderEventBody";
import { LoadingOverlay } from "./LoadingOverlay";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  range: DisplayRange;
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  onEventClick: (event: CalendarEvent) => void;
  onSlotCreate: (start: string, end: string) => void;
};

export function WeekPanel({ range, events, loading, error, onEventClick, onSlotCreate }: Props) {
  const clamped = clampRange(range);
  return (
    <div className="relative" data-testid="week-panel">
      <style>{`:root { --week-view-slot-height: ${clamped.zoom}px; }`}</style>
      {error && <ErrorBanner error={error} />}
      <WeekView
        data-testid="week-view"
        date={clamped.anchor}
        events={events}
        firstDayOfWeek={1}
        withWeekendDays
        canDragEvent={() => false}
        canResizeEvent={() => false}
        withDragSlotSelect
        withCurrentTimeIndicator
        intervalMinutes={60}
        startTime="00:00:00"
        endTime="23:59:59"
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        onTimeSlotClick={({ slotStart, slotEnd }) => onSlotCreate(slotStart, slotEnd)}
        onSlotDragEnd={(s, e) => onSlotCreate(s, e)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "week")}
      />
      {loading && <LoadingOverlay />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schedule/WeekPanel.tsx
git commit -m "feat(calendar): add WeekPanel wrapping Mantine WeekView"
```

---

## Task 11: MonthPanel — wraps `@mantine/schedule` MonthView

**Files:**
- Create: `src/components/schedule/MonthPanel.tsx`

- [ ] **Step 1: Implement MonthPanel**

```tsx
// src/components/schedule/MonthPanel.tsx
"use client";

import { MonthView } from "@mantine/schedule";
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { DisplayRange } from "@/lib/calendar/layout";
import { renderEventBody } from "./renderEventBody";
import { LoadingOverlay } from "./LoadingOverlay";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  range: DisplayRange;
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  onEventClick: (event: CalendarEvent) => void;
  onSlotCreate: (start: string, end: string) => void;
  onDayClick: (date: string) => void;
};

export function MonthPanel({
  range,
  events,
  loading,
  error,
  onEventClick,
  onSlotCreate,
  onDayClick,
}: Props) {
  return (
    <div className="relative" data-testid="month-panel">
      {error && <ErrorBanner error={error} />}
      <MonthView
        data-testid="month-view"
        date={range.start}
        events={events}
        firstDayOfWeek={1}
        withWeekendDays
        maxEventsPerDay={3}
        hideOutsideDates={false}
        canDragEvent={() => false}
        withDragSlotSelect
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        onDayClick={onDayClick}
        onSlotDragEnd={(s, e) => onSlotCreate(s, e)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "month")}
      />
      {loading && <LoadingOverlay />}
    </div>
  );
}
```

- [ ] **Step 2: Extend `getModeRange` for year-range computation (reused by Month)**

`MonthView` requires events spanning the visible 6×7 grid (≥42 days). `getModeRange` currently only handles day/week/month. Confirm by reading `src/lib/calendar/layout.ts`:

- For `mode === "scope"` with `view === "month"`, return start = first day of the visible 6-week grid, end = 42 days later.
- This logic already exists in `getModeRange`; no change required for Task 11. If `getMonthViewDates` returns dates outside the events query range, extend `useEvents`'s range in Task 14 (ScheduleTimeline) by passing `minMinutes: 60 * 24 * 50`.

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/MonthPanel.tsx
git commit -m "feat(calendar): add MonthPanel wrapping Mantine MonthView"
```

---

## Task 12: YearPanel — wraps `@mantine/schedule` YearView

**Files:**
- Create: `src/components/schedule/YearPanel.tsx`

- [ ] **Step 1: Extend `getModeRange` for year**

Add a year branch to `getModeRange(view, mode, anchor, tzOffsetMinutes)` in `src/lib/calendar/layout.ts`. Return:

```ts
// view === "year", mode === "scope"
{ start: `${anchorYear}-01-01`, end: `${anchorYear + 1}-01-01` }
```

```ts
// in src/lib/calendar/layout.ts (append inside getModeRange switch)
if (view === "year") {
  const year = parseInt(anchor.slice(0, 4), 10);
  return {
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
  };
}
```

- [ ] **Step 2: Write failing test for year range**

```ts
// append to src/lib/calendar/__tests__/layout.test.ts (extend describe block)
import { getModeRange } from "../layout";

describe("getModeRange year", () => {
  it("returns Jan 1 → Jan 1+1 for scope mode", () => {
    const r = getModeRange("year", "scope", "2026-07-30", 0);
    expect(r.start).toBe("2026-01-01");
    expect(r.end).toBe("2027-01-01");
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
bun test src/lib/calendar/__tests__/layout.test.ts
```

Expected: FAIL — `getModeRange("year", ...)` throws or returns wrong shape.

- [ ] **Step 4: Implement**

Insert the branch from Step 1.

- [ ] **Step 5: Run test, expect PASS**

```bash
bun test src/lib/calendar/__tests__/layout.test.ts
```

- [ ] **Step 6: Implement YearPanel**

```tsx
// src/components/schedule/YearPanel.tsx
"use client";

import { YearView } from "@mantine/schedule";
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { DisplayRange } from "@/lib/calendar/layout";
import { renderEventBody } from "./renderEventBody";
import { LoadingOverlay } from "./LoadingOverlay";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  range: DisplayRange;
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  onEventClick: (event: CalendarEvent) => void;
};

export function YearPanel({ range, events, loading, error, onEventClick }: Props) {
  return (
    <div className="relative" data-testid="year-panel">
      {error && <ErrorBanner error={error} />}
      <YearView
        data-testid="year-view"
        date={range.start}
        events={events}
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "month")}
      />
      {loading && <LoadingOverlay />}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/schedule/YearPanel.tsx src/lib/calendar/layout.ts src/lib/calendar/__tests__/layout.test.ts
git commit -m "feat(calendar): add YearPanel wrapping Mantine YearView with getModeRange year branch"
```

---

## Task 13: AgendaPanel — wraps `@mantine/schedule` AgendaView

**Files:**
- Create: `src/components/schedule/AgendaPanel.tsx`

- [ ] **Step 1: Implement AgendaPanel**

```tsx
// src/components/schedule/AgendaPanel.tsx
"use client";

import { AgendaView } from "@mantine/schedule";
import type { ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { DisplayRange } from "@/lib/calendar/layout";
import { renderEventBody } from "./renderEventBody";
import { LoadingOverlay } from "./LoadingOverlay";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  range: DisplayRange;
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  onEventClick: (event: CalendarEvent) => void;
};

export function AgendaPanel({ range, events, loading, error, onEventClick }: Props) {
  return (
    <div className="relative" data-testid="agenda-panel">
      {error && <ErrorBanner error={error} />}
      <AgendaView
        data-testid="agenda-view"
        date={range.start}
        events={events}
        onEventClick={(e) => onEventClick(e as CalendarEvent)}
        renderEventBody={(e) => renderEventBody(e as CalendarEvent, "agenda")}
      />
      {loading && <LoadingOverlay />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schedule/AgendaPanel.tsx
git commit -m "feat(calendar): add AgendaPanel wrapping Mantine AgendaView"
```

---

## Task 14: ScheduleTimeline — parent orchestration

**Files:**
- Create: `src/components/schedule/ScheduleTimeline.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/schedule/__tests__/ScheduleTimeline.test.tsx
/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "@/test/render-with-mantine";
import { ScheduleTimeline } from "../ScheduleTimeline";

vi.mock("../DayPanel", () => ({ DayPanel: () => <div data-testid="day-panel" /> }));
vi.mock("../WeekPanel", () => ({ WeekPanel: () => <div data-testid="week-panel" /> }));
vi.mock("../MonthPanel", () => ({ MonthPanel: () => <div data-testid="month-panel" /> }));
vi.mock("../YearPanel", () => ({ YearPanel: () => <div data-testid="year-panel" /> }));
vi.mock("../AgendaPanel", () => ({ AgendaPanel: () => <div data-testid="agenda-panel" /> }));

vi.mock("@/lib/hooks/calendar/use-events", () => ({
  useEvents: () => ({
    events: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/lib/stores/quick-create-store", () => ({
  useQuickCreateStore: (selector: (s: unknown) => unknown) =>
    selector({ openEdit: vi.fn(), openCreate: vi.fn(), loadFromRecurringTile: vi.fn() }),
}));

describe("ScheduleTimeline view selection", () => {
  it.each([
    ["day", "day-panel"],
    ["week", "week-panel"],
    ["month", "month-panel"],
    ["year", "year-panel"],
    ["agenda", "agenda-panel"],
  ] as const)("renders %s panel for view=%s", (view, testid) => {
    renderWithMantine(<ScheduleTimeline initialView={view} />);
    expect(screen.getByTestId(testid)).toBeInTheDocument();
  });

  it("renders ScheduleToolbar", () => {
    renderWithMantine(<ScheduleTimeline initialView="day" />);
    expect(screen.getByTestId("cal-prev")).toBeInTheDocument();
    expect(screen.getByTestId("cal-next")).toBeInTheDocument();
    expect(screen.getByTestId("cal-today")).toBeInTheDocument();
    expect(screen.getByTestId("cal-view-switcher")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
bun test src/components/schedule/__tests__/ScheduleTimeline.test.tsx
```

Expected: FAIL — `ScheduleTimeline` module not found.

- [ ] **Step 3: Implement ScheduleTimeline**

```tsx
// src/components/schedule/ScheduleTimeline.tsx
"use client";

import { useCallback, useMemo } from "react";
import { useTimelineState } from "./useTimelineState";
import { useEvents } from "@/lib/hooks/calendar/use-events";
import { useQuickCreateStore } from "@/lib/stores/quick-create-store";
import { getModeRange } from "@/lib/calendar/layout";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { DayPanel } from "./DayPanel";
import { WeekPanel } from "./WeekPanel";
import { MonthPanel } from "./MonthPanel";
import { YearPanel } from "./YearPanel";
import { AgendaPanel } from "./AgendaPanel";
import type { CalendarEvent } from "@/lib/domain/calendar";

type Props = {
  initialView: "day" | "week" | "month" | "year" | "agenda";
};

export function ScheduleTimeline({ initialView }: Props) {
  const state = useTimelineState(initialView);
  const tzOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);
  const effectiveAnchor =
    state.mode === "scope" ? state.anchor : state.todayLocal();
  const range = useMemo(
    () => getModeRange(state.view, state.mode, effectiveAnchor, tzOffsetMinutes),
    [state.view, state.mode, effectiveAnchor, tzOffsetMinutes],
  );

  // Pad range so events cover the full visible grid (Month = 6×7 = 42d, Year = 12mo)
  const paddedRange = useMemo(() => {
    if (state.view === "month") {
      const start = new Date(range.start);
      start.setDate(start.getDate() - 7);
      const end = new Date(range.end);
      end.setDate(end.getDate() + 7);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    if (state.view === "year") {
      const y = parseInt(range.start.slice(0, 4), 10);
      return { start: `${y - 1}-01-01`, end: `${y + 2}-01-01` };
    }
    if (state.view === "agenda") {
      const end = new Date(range.end);
      end.setDate(end.getDate() + 90);
      return { start: range.start, end: end.toISOString().slice(0, 10) };
    }
    return range;
  }, [range, state.view]);

  const { events, loading, error } = useEvents(paddedRange);
  const openEdit = useQuickCreateStore((s) => s.openEdit);
  const openCreate = useQuickCreateStore((s) => s.openCreate);
  const loadFromRecurringTile = useQuickCreateStore((s) => s.loadFromRecurringTile);

  const onEventClick = useCallback((event: CalendarEvent) => {
    // Strip ":cursor" suffix that occurrence IDs may carry (see CalendarMain.handleEditEvent:358)
    const colon = event.id.indexOf(":");
    const sourceId = colon > 0 ? event.id.slice(0, colon) : event.id;
    if (event.source.kind === 1 && event.tileId) {
      loadFromRecurringTile(event.tileId);
      return;
    }
    openEdit(sourceId, event.tileId ?? null);
  }, [loadFromRecurringTile, openEdit]);

  const onSlotCreate = useCallback((start: string, end: string) => {
    openCreate({ start, end });
  }, [openCreate]);

  const onMonthDayClick = useCallback((date: string) => {
    state.setView("day");
    state.setAnchor(date);
  }, [state]);

  const panelBase = {
    range: paddedRange,
    events,
    loading,
    error,
    onEventClick,
    onSlotCreate,
  };

  return (
    <div className="flex h-full flex-col" data-testid="schedule-timeline">
      <ScheduleToolbar
        view={state.view}
        mode={state.mode}
        anchor={state.anchor}
        zoom={state.zoom}
        navDisabled={loading || state.mode !== "scope"}
        onPrev={() => state.shiftAnchor(-1)}
        onNext={() => state.shiftAnchor(1)}
        onToday={() => state.goToToday()}
        onViewChange={state.setView}
        onModeChange={state.setMode}
        onZoomChange={state.setZoom}
      />
      <div className="flex-1 overflow-auto">
        {state.view === "day" && <DayPanel {...panelBase} />}
        {state.view === "week" && <WeekPanel {...panelBase} />}
        {state.view === "month" && (
          <MonthPanel {...panelBase} onDayClick={onMonthDayClick} />
        )}
        {state.view === "year" && <YearPanel {...panelBase} />}
        {state.view === "agenda" && <AgendaPanel {...panelBase} />}
      </div>
      <button
        type="button"
        data-testid="cal-create-fab"
        className="hidden"
        onClick={() => openCreate({})}
        aria-hidden
      />
    </div>
  );
}
```

> `useTimelineState` must expose `setAnchor(date: string)` and `todayLocal(): string` (the latter returns `todayLocalIso(tzOffsetMinutes)`). If `useTimelineState` does not yet have these, extend Task 5 to add them.

- [ ] **Step 4: Run test, expect PASS**

```bash
bun test src/components/schedule/__tests__/ScheduleTimeline.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/ScheduleTimeline.tsx src/components/schedule/__tests__/ScheduleTimeline.test.tsx
git commit -m "feat(calendar): add ScheduleTimeline parent orchestrating 5 panel views"
```

---

## Task 15: Route swap — `/dashboard/timeline/page.tsx` and `/dashboard/timeline/[view]/page.tsx`

**Files:**
- Modify: `src/app/dashboard/timeline/page.tsx`
- Modify: `src/app/dashboard/timeline/[view]/page.tsx`

- [ ] **Step 1: Replace `src/app/dashboard/timeline/page.tsx`**

```tsx
// src/app/dashboard/timeline/page.tsx
import { Suspense } from "react";
import { ScheduleTimeline } from "@/components/schedule/ScheduleTimeline";
import { MinuteClockProvider } from "@/components/providers/minute-clock-provider";

export default function TimelinePage() {
  return (
    <Suspense fallback={null}>
      <MinuteClockProvider>
        <ScheduleTimeline initialView="day" />
      </MinuteClockProvider>
    </Suspense>
  );
}
```

- [ ] **Step 2: Replace `src/app/dashboard/timeline/[view]/page.tsx`**

```tsx
// src/app/dashboard/timeline/[view]/page.tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ScheduleTimeline } from "@/components/schedule/ScheduleTimeline";
import { MinuteClockProvider } from "@/components/providers/minute-clock-provider";

const VALID_VIEWS = ["day", "week", "month", "year", "agenda"] as const;
type View = (typeof VALID_VIEWS)[number];

function isView(v: string | undefined): v is View {
  return !!v && (VALID_VIEWS as readonly string[]).includes(v);
}

export default async function TimelineViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!isView(view)) notFound();
  return (
    <Suspense fallback={null}>
      <MinuteClockProvider>
        <ScheduleTimeline initialView={view} />
      </MinuteClockProvider>
    </Suspense>
  );
}
```

> Note: this drops the debug-only `SummaryCard` and raw-JSON panel from the previous `[view]/page.tsx` (acceptable per "単純に置き換える" decision).

- [ ] **Step 3: Run typecheck, expect PASS**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/timeline/page.tsx src/app/dashboard/timeline/[view]/page.tsx
git commit -m "feat(calendar): swap /dashboard/timeline routes to ScheduleTimeline"
```

---

## Task 16: Delete legacy calendar files

**Files:**
- Delete: `src/components/calendar/CalendarMain.tsx`
- Delete: `src/components/calendar/DayView.tsx`
- Delete: `src/components/calendar/WeekView.tsx`
- Delete: `src/components/calendar/MonthView.tsx`
- Delete: `src/components/calendar/EventListView.tsx`
- Delete: any `*Frame.tsx`, `*Tile.tsx`, `*Column.tsx` files in `src/components/calendar/` whose only consumer was CalendarMain
- Modify: `src/lib/calendar/layout.ts` (drop `layoutDayLanes`, `eventSpansDay`, `eventTileStyle`, `monthEventStyle` — only `getModeRange`, `todayLocalIso`, `getDayViewHourOffsets`, `getWeekViewDates`, `getMonthViewDates` remain)

- [ ] **Step 1: Identify dead exports**

Run:

```bash
grep -rln "from \"@/components/calendar/CalendarMain\" src/" || echo "no callers"
grep -rln "from \"@/components/calendar/DayView\" src/" || echo "no callers"
grep -rln "from \"@/components/calendar/WeekView\" src/" || echo "no callers"
grep -rln "from \"@/components/calendar/MonthView\" src/" || echo "no callers"
grep -rln "from \"@/components/calendar/EventListView\" src/" || echo "no callers"
grep -rln "layoutDayLanes\|eventSpansDay\|eventTileStyle\|monthEventStyle" src/ || echo "no callers"
```

Expected: all print `no callers`. If any show callers, STOP and ask — those callers are out of scope.

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/calendar/CalendarMain.tsx
git rm src/components/calendar/DayView.tsx
git rm src/components/calendar/WeekView.tsx
git rm src/components/calendar/MonthView.tsx
git rm src/components/calendar/EventListView.tsx
# any *Frame.tsx / *Tile.tsx / *Column.tsx orphans identified in Step 1
```

- [ ] **Step 3: Trim `src/lib/calendar/layout.ts`**

Remove the function definitions for `layoutDayLanes`, `eventSpansDay`, `eventTileStyle`, `monthEventStyle`. Keep:

- `DisplayRange`, `DisplayMode`, `View` types
- `getModeRange` (extended with year branch from Task 12)
- `todayLocalIso`
- `getDayViewHourOffsets`, `getWeekViewDates`, `getMonthViewDates`
- `clampRange` (lives in `clamp-range.ts` per Task 3)

- [ ] **Step 4: Run typecheck, expect PASS**

```bash
bun run typecheck
```

Expected: PASS (no orphan imports).

- [ ] **Step 5: Run full unit suite, expect PASS**

```bash
bun run test:unit
```

- [ ] **Step 6: Commit**

```bash
git add -u src/components/calendar/ src/lib/calendar/layout.ts
git commit -m "refactor(calendar): remove legacy CalendarMain and custom Day/Week/Month views"
```

---

## Task 17: Update `layout.test.ts`

**Files:**
- Modify: `src/lib/calendar/__tests__/layout.test.ts`

- [ ] **Step 1: Drop `eventSpansDay` / `layoutDayLanes` / `eventTileStyle` / `monthEventStyle` test cases**

These functions are removed in Task 16. Remove the `describe(...)` blocks that exercise them. Keep:

- `getModeRange` tests (day/week/month) — already exist
- The year test added in Task 12

- [ ] **Step 2: Run test, expect PASS**

```bash
bun test src/lib/calendar/__tests__/layout.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar/__tests__/layout.test.ts
git commit -m "test(calendar): drop tests for removed legacy layout helpers"
```

---

## Task 18: Final build verification

- [ ] **Step 1: Run `bun run check`**

```bash
cd tastile-web
bun run check
```

Expected: lint + biome + typecheck + knip + vitest all green.

- [ ] **Step 2: Run `bun run build:prod`**

```bash
bun run build:prod
```

Expected: build succeeds.

- [ ] **Step 3: Audit warnings**

If knip flags unused exports in `src/lib/calendar/layout.ts` (because `getModeRange` year branch was added), or in `src/components/schedule/`, address them inline (either delete or `// knip-ignore` with a one-line comment justifying why).

- [ ] **Step 4: Commit any knip cleanups**

```bash
git add src/
git commit -m "chore(calendar): address knip unused-export warnings" || echo "no changes"
```

---

## Task 19: Manual QA via chrome-devtools MCP

**Files:** (no code changes)

- [ ] **Step 1: Start dev server**

```bash
cd tastile-web
bun dev
```

Expected: `http://localhost:3000` ready.

- [ ] **Step 2: Navigate to `/dashboard/timeline`**

Use `mcp__chrome-devtools__navigate_page` with `url: "http://localhost:3000/dashboard/timeline"`.

- [ ] **Step 3: Verify all 5 views render**

For each view, click `cal-view-{day|week|month|year|agenda}` via `mcp__chrome-devtools__click` and assert:

- No console errors (use `mcp__chrome-devtools__list_console_messages`)
- Correct panel testid visible (`day-panel` / `week-panel` / `month-panel` / `year-panel` / `agenda-panel`)
- A `day-event-*` / `week-event-*` / `month-event-*` testid present if events exist

- [ ] **Step 4: Verify mode switcher (scope/around/future)**

Click `cal-mode-{scope|around|future}` and assert the date range title changes.

- [ ] **Step 5: Verify zoom**

Click `cal-zoom-in` twice, assert `--day-view-slot-height` (or `--week-view-slot-height`) CSS var increases by `ZOOM_STEP*2`. Click `cal-zoom-out` 4 times, assert it clamps at `ZOOM_MIN`.

- [ ] **Step 6: Verify navigation**

Click `cal-prev`, `cal-today`, `cal-next`. Assert anchor date advances/reverts.

- [ ] **Step 7: Verify event click routing**

Click an event. Assert `useQuickCreateStore` opened the edit sheet (look for sheet dialog testid in DOM).

- [ ] **Step 8: Verify `/dashboard/timeline/[view]` route works for each view**

For each `view ∈ {day, week, month, year, agenda}`, navigate to `http://localhost:3000/dashboard/timeline/{view}` and assert the panel renders.

- [ ] **Step 9: Verify mobile breakpoint**

Use `mcp__chrome-devtools__resize_page` with `width: 500, height: 800`. Assert `day-panel-mobile` testid is visible.

---

## Task 20: Update e2e selector (`cal-view-list` → `cal-view-agenda`)

**Files:**
- Modify: `e2e/calendar-event-flow.spec.ts` (1 selector — see spec §5.4)

- [ ] **Step 1: Locate the selector**

```bash
grep -n "cal-view-list" e2e/
```

Expected: 1 match in `e2e/calendar-event-flow.spec.ts` (the `.skip`-marked first test).

- [ ] **Step 2: Replace with `cal-view-agenda`**

```diff
- await page.getByTestId("cal-view-list").click();
+ await page.getByTestId("cal-view-agenda").click();
```

- [ ] **Step 3: Run e2e, expect PASS**

```bash
bun test:e2e e2e/calendar-event-flow.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add e2e/calendar-event-flow.spec.ts
git commit -m "test(e2e): rename cal-view-list → cal-view-agenda for new toolbar"
```

---

## Self-review (writing-plans checklist)

The following checklist was applied against the spec (`docs/superpowers/specs/2026-07-30-mantine-schedule-replacement-design.md`) and the plan as committed.

### Spec coverage

| Spec section / requirement | Plan task |
| --- | --- |
| §1 Directory layout (10 files under `src/components/schedule/`) | Tasks 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 |
| §1 State model `{view, mode, anchor, zoom}` | Task 5 |
| §1 Responsive breakpoint ≤ 600 px | Task 6 |
| §1 Data flow `useTimelineState → useEvents → eventAdapter → panel` | Tasks 5, 14 |
| §2.1 `eventAdapter.toScheduleEvent` + 12-color mapping + payload | Task 2 |
| §2.2 `renderEventBody` (4 scope variants + testids) | Task 4 |
| §2.3 Click handling with `:cursor` colon-strip + recurring routing | Task 14 (`onEventClick` colon-strip; `loadFromRecurringTile` branch) |
| §2.4 Zoom → CSS var | Tasks 8 (zoom buttons), 9 (`--day-view-slot-height`), 10 (`--week-view-slot-height`) |
| §2.5 Slot click / drag → `openCreate` | Tasks 9, 10, 11 (`onTimeSlotClick`, `onSlotDragEnd`) |
| §2.6 Timezone (display uses browser-local; window math uses `tzOffset`) | Task 14 |
| §3.1 `useTimelineState` | Task 5 |
| §3.2 `useResponsiveBreakpoint` | Task 6 |
| §3.3 `ScheduleToolbar` | Task 8 |
| §3.4 `DayPanel` | Task 9 |
| §3.5 `WeekPanel` | Task 10 |
| §3.6 `MonthPanel` + `onDayClick` drill-in | Task 11 (`onDayClick` → `setView("day")`) |
| §3.7 `YearPanel`, `AgendaPanel` | Tasks 12, 13 |
| §3.8 `ScheduleTimeline` parent | Task 14 |
| §4.1-4.3 Error/loading/empty | Task 7 |
| §4.5 Range clamping | Task 3 |
| §4.6 Race conditions | unchanged (uses existing `useEvents.requestId`) |
| §4.7 Auth | unchanged (API client handles redirect) |
| §4.8 Parse fallbacks | Task 5 (`parseView`/`parseMode`/`parseDate`/`parseZoom`) |
| §5.1 Removed files | Task 16 |
| §5.2 Retained files | preserved (CalendarSidePanel, useEvents, quick-create-store, getModeRange) |
| §5.3 New unit tests | Tasks 2, 3, 4, 5, 6, 8 (plus Task 14's ScheduleTimeline test) |
| §5.4 Updated existing tests | Tasks 17, 20 |
| §5.5 E2E scenarios | Task 19 (manual QA via chrome-devtools) |
| §5.6 Big-bang cutover | single branch `feat/mantine-schedule-replacement`, one commit per task |
| §5.10 Risks (pin 9.5.0, clamp [24,160], drill-in parity) | Tasks 1 (pin), 8 (clamp), 11 (`onDayClick`) |

### Placeholder scan

Searched for `TBD`, `TODO`, `fill in`, `implement later`, `appropriate error`, `Similar to Task` — **no matches**.

### Type consistency

- `ScheduleEventData<CalendarEvent>` was changed to plain `ScheduleEventData` after verifying against current Mantine 9.5.0 API (`ScheduleEventData` is the published type without a generic). `payload` carries the original `CalendarEvent` via the runtime object identity — no generic parameter needed.
- `clampRange` returns `{ start, end, anchor, zoom }` (extends `DisplayRange` with `anchor` and `zoom`); the panel components read `.anchor` for the `<DayView date>` prop. Task 3 must produce this extended shape.
- `useTimelineState` exposes `setAnchor(date)`, `setZoom(zoom)`, `setView(view)`, `setMode(mode)`, `shiftAnchor(±1)`, `goToToday()`, `todayLocal()`. Tasks 5 and 14 must agree on these signatures.
- `eventAdapter.toScheduleEvent` is the single mapping point; `payload: e` is preserved everywhere. Tasks 9-13 all use `(e as CalendarEvent)` casts to retrieve payload — type-safe at runtime because `toScheduleEvent` always sets `payload`.

### Scope discipline

Pre-existing dirty files (`CalendarSidePanel.tsx`, `ProjectsSidePanel.tsx`, `ScheduleSidePanel.tsx`, `SideToolPanel.tsx`, `ProjectTree.tsx`) are not touched.

---

<!-- END OF CHUNK 8 -->
