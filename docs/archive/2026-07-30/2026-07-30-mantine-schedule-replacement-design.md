# Mantine Schedule Replacement for /dashboard/timeline — Design

> Date: 2026-07-30
> Target: `tastile-web` — `/dashboard/timeline/*` route tree
> Source of truth for v1 domain: `tastile-core/v1/*` (no change)
> Source of truth for design system: `docs/DESIGN-SYSTEM.md` (no change)

## Goal

Replace the hand-built calendar stack under `src/components/calendar/` (CalendarMain + DayView / WeekView / MonthView / EventListView + their frame + tile leaf components) with the official Mantine Schedule 9.5.0 primitives (`@mantine/schedule`), wrapped by a thin `ScheduleTimeline` component, on both routes:

1. `/dashboard/timeline/page.tsx` — primary user-facing timeline.
2. `/dashboard/timeline/[view]/page.tsx` — debug view tree (Day/Week/Month/YearGrid + SummaryCard + raw JSON).

All current user-visible behaviour is preserved via adapters:

- DisplayMode (Scope / Around / Future) — anchored window logic retained.
- Continuous zoom — hour slot height controlled via Mantine's CSS variable.
- Tastile-specific event metadata (icon / project / tags / source.kind / tileId) — surfaced through `renderEventBody` and `payload`.
- Recurring-edit routing (`source.kind === 1` → `loadFromRecurringTile`) — handled in `onEventClick`.
- E2E `data-testid` parity (`day-event-*`, `week-event-*`, `month-event-*`, `cal-view-*`, `cal-prev` / `cal-next` / `cal-today` / `cal-mode-*` / `cal-error` / `day-loading`) — preserved by the adapter layer.
- Mobile breakpoint (≤ 600 px) — desktop view collapses to Mantine's `MobileMonthView`.

## Non-Goals

- Domain model changes (`tastile-core` v1 schema unchanged).
- API surface changes (`/v1/timeline`, `tastile-core/v1/14-read-model-and-endpoint.md` unchanged).
- Drag-to-move / drag-to-resize event editing (Tastile v1 does not expose these).
- Introducing a recurring-rule editor in the web client (recurring semantics remain owned by `tastile-core`).
- Replacing `CalendarSidePanel`, `useQuickCreateStore`, `useEvents`, or `getModeRange`.
- Replacing the iOS PWA `/app/*` routes (orthogonal — different stack).
- Theming / token changes (`docs/DESIGN-SYSTEM.md` is unchanged).
- Performance work (no memoisation overhaul, no query-key rewriting).

## Approach decision

Among three considered architectures (Wrapper / Direct-views / Static-orchestrator), **Direct-views (Approach B)** is chosen:

- Schedule wrapper would force toolbar / view-switcher / responsive-switching through Mantine's opinionated layout; we need full layout control to honour `mode` (Around/Future) and continuous zoom.
- Direct views (`DayView` / `WeekView` / `MonthView` / `YearView` / `AgendaView` / `MobileMonthView`) compose cleanly under a custom parent; the costs (responsive breakpoint hook, view-state sync, recurring-expansion we don't need) are bounded.

The cost is one custom `useResponsiveBreakpoint` hook and per-view wrapper panels. Recurrence expansion is not a cost because Tastile pre-expands occurrences at `/v1/timeline`.

---

## Section 1 — Architecture

### Directory layout

```
src/components/schedule/
├── ScheduleTimeline.tsx        # parent: view selection + state orchestration
├── ScheduleToolbar.tsx         # prev / next / today / view-switcher / mode-switcher / zoom +/-
├── useTimelineState.ts         # URL ↔ { view, mode, anchor, zoom }
├── useResponsiveBreakpoint.ts  # matchMedia(<= 600 px) → "mobile" | "desktop"
├── eventAdapter.ts             # CalendarEvent → ScheduleEventData
├── renderEventBody.tsx         # icon / project / tags overlay (per-view testid variants)
├── DayPanel.tsx                # wraps @mantine/schedule DayView
├── WeekPanel.tsx               # wraps @mantine/schedule WeekView
├── MonthPanel.tsx              # wraps @mantine/schedule MonthView
├── YearPanel.tsx               # wraps @mantine/schedule YearView (debug route)
└── AgendaPanel.tsx             # wraps @mantine/schedule AgendaView (replaces EventListView)
```

### State

| Field | Type | Default | URL param |
| --- | --- | --- | --- |
| `view` | `"day" \| "week" \| "month" \| "year" \| "agenda"` | `"day"` | `?view=` |
| `mode` | `"scope" \| "around" \| "future"` | `"scope"` | `?mode=` (omitted when `scope`) |
| `anchor` | `string` (YYYY-MM-DD) | today (local) | `?date=` (omitted when today) |
| `zoom` | `number` (24..160 px) | `56` | `?zoom=` (omitted when 56) |

`mode` ≠ `scope` forces the effective anchor to today regardless of `anchor`. `useEvents` reads `view` + `mode` + `effectiveAnchor` + `tzOffset` to compute the `[start, end]` window via the existing `getModeRange`.

### Responsive

`useResponsiveBreakpoint()` returns `"mobile"` when `window.matchMedia("(max-width: 600px)").matches`, else `"desktop"`. SSR returns `"desktop"` to avoid hydration mismatch. When mobile, `ScheduleTimeline` renders Mantine's `MobileMonthView` instead of the desktop `view`, regardless of the URL's `view` value. The URL keeps the desktop selection so the user returns to it after widening the window.

### Data flow (unchanged from current CalendarMain)

```
useTimelineState ──► useEvents(range, minMinutes, ownerIds) ──► events: CalendarEvent[]
                                                                 │
                                                                 ▼
                                            eventAdapter.toScheduleEvent
                                                                 │
                                                                 ▼
                                        DayPanel / WeekPanel / MonthPanel
                                        YearPanel / AgendaPanel / MobileMonthView
                                                                 │
                                                                 ▼
                                onEventClick / onTimeSlotClick / onSlotDragEnd
                                                                 │
                                                                 ▼
                                          useQuickCreateStore (open / load / edit)
```

---

## Section 2 — Adapters

### 2.1 `eventAdapter.ts`

```ts
import { type ScheduleEventData } from "@mantine/schedule";
import type { CalendarEvent } from "@/lib/domain/calendar";

export function toScheduleEvent(e: CalendarEvent): ScheduleEventData<CalendarEvent> {
  return {
    id: e.id,
    title: e.title,
    start: e.allDay ? e.start.slice(0, 10) : new Date(e.start),
    end:   e.allDay ? e.end.slice(0, 10)   : new Date(e.end),
    color: colorToMantine(e.color),
    variant: "light",
    display: "default",
    allDay: e.allDay,
    payload: e,
  };
}
```

- `payload` carries the full `CalendarEvent` so click handlers can recover `source.kind` and `tileId` without re-fetching.
- `colorToMantine` maps Tastile's 12-value `EventColor` enum onto Mantine's named palette (`blue`, `teal`, `grape`, `red`, `orange`, `yellow`, `lime`, `cyan`, `indigo`, `pink`, `gray`, `dark`). Visual proximity, not strict equality.
- `recurrence`, `recurringEventId`, `recurrenceId` are never set → Mantine's internal `rrule` expansion is bypassed; all events are single-shot occurrences supplied by `/v1/timeline`.

### 2.2 `renderEventBody.tsx`

```tsx
export function renderEventBody(
  event: ScheduleEventData<CalendarEvent>,
  scope: "day" | "week" | "month" | "agenda"
) {
  const e = event.payload!;
  return (
    <div data-testid={`${scope}-event-${e.id}`} className="flex items-center gap-1">
      {e.icon ? <IconByName name={e.icon} className="h-3 w-3" /> : null}
      <span className="truncate">{e.title}</span>
      {e.project ? <ProjectBadge project={e.project} /> : null}
      {e.tags?.length ? <TagDots tags={e.tags} /> : null}
    </div>
  );
}
```

- Four variants (`day`, `week`, `month`, `agenda`) each emit the corresponding `data-testid` so existing e2e selectors (`day-event-*`, `week-event-*`, `month-event-*`) match without test changes.
- `IconByName` resolves `e.icon` against `tastile-brands/icons/` registry; unknown names render nothing.
- `ProjectBadge` and `TagDots` are existing leaf components migrated unchanged from the deleted `*EventTile.tsx` files.

### 2.3 Click handling

```tsx
function handleEventClick(event: ScheduleEventData<CalendarEvent>) {
  const e = event.payload!;
  const colon = e.id.indexOf(":");
  const sourceId = colon > 0 ? e.id.slice(0, colon) : e.id;
  if (e.source?.kind === 1 && e.tileId) {
    void useQuickCreateStore.getState().loadFromRecurringTile(e.tileId);
    return;
  }
  useQuickCreateStore.getState().loadFromEvent({ ...e, id: sourceId });
  useQuickCreateStore.getState().openEdit(sourceId, e.tileId ?? null);
}
```

Identical routing logic to `CalendarMain.handleEditEvent` (lines 358–367). `:cursor` suffix on occurrence IDs is stripped before the edit submit; recurring-sourced placements re-route through `loadFromRecurringTile` which calls `GET /v1/tiles/{id}` and submits via `POST /v1/tiles/{id}/update`.

### 2.4 Zoom → slot height

```tsx
<div style={{ "--day-view-slot-height": `${zoom}px`,
              "--week-view-slot-height": `${Math.round(zoom * 1.5)}px` } as CSSProperties}>
  <DayView ... />
</div>
```

- Mantine `DayView` / `WeekView` honour `--day-view-slot-height` / `--week-view-slot-height` (px) per their published Styles API.
- `zoom` default 56, range 24..160; toolbar's `Zoom +` / `Zoom −` buttons step by 8.
- `useZoom()` (existing) is not used — its gesture handlers are replaced by simple +/- buttons (the existing wheel/touch handler is over-engineered for the new toolbar UX).

### 2.5 Slot click / drag → create

```tsx
<DayView
  onTimeSlotClick={({ slotStart, slotEnd }) => openCreate(slotStart, slotEnd)}
  onSlotDragEnd={(start, end) => openCreate(start, end)}
/>
```

`openCreate(start, end)` writes `time.span.start` / `time.span.end` directly to `useQuickCreateStore` and opens the create panel (replaces `CalendarMain.handleCreateAtSlot(anchor, hour)`).

### 2.6 Timezone

- Mantine `Date` objects render in the browser's local timezone.
- `/v1/timeline` returns UTC instants; conversion to `Date` is lossless.
- Visual localisation (JST vs browser TZ) shifts from `tzOffsetMinutes` to browser-local — this is a deliberate UX change to align with web norms; for users outside JST this resolves long-standing confusion about event placement.
- Backend storage remains UTC; `tzOffsetMinutes` is kept only for the `getModeRange` window math, not for display.

---

## Section 3 — Components

### 3.1 `useTimelineState.ts`

```ts
export function useTimelineState(initialView: ScheduleView = "day") {
  // reads ?view, ?mode, ?date, ?zoom with safe parsers (parseView, parseMode,
  // parseDate, parseZoom) that fall back to defaults on invalid input
  // exposes setView / setMode / setAnchor / setZoom / shiftAnchor
  // each calls syncUrl(next) which uses router.replace with scroll:false
}
```

- All callbacks wrapped in `useCallback` keyed by primitive deps; stable references keep `useEvents` from re-fetching.
- `shiftAnchor(delta)` computes `±1 day` / `±7 days` / `±1 month` from current `view`.

### 3.2 `useResponsiveBreakpoint.ts`

```ts
export function useResponsiveBreakpoint(): "mobile" | "desktop" {
  const [bp, setBp] = useState<"mobile" | "desktop">(() =>
    typeof window === "undefined" ? "desktop"
      : window.innerWidth <= 600 ? "mobile" : "desktop"
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const handler = (e: MediaQueryListEvent) => setBp(e.matches ? "mobile" : "desktop");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return bp;
}
```

### 3.3 `ScheduleToolbar.tsx`

Port of `CalendarMain.CalendarToolbar`, with these additions:

- View options extended from `[day, week, month, list]` → `[day, week, month, year, agenda]` (testid `cal-view-{value}`).
- Zoom `+` / `−` icons (`ZoomIn` / `ZoomOut` from `lucide-react`) at the far right; clicking step zoom by ±8 within [24, 160].
- `navDisabled` (gates prev/next/today) is true whenever `mode !== "scope"`.
- `modeLabel(view, mode)` keeps the existing `Today · ±12h` / `From now · 24h` etc. prefixes.

### 3.4 `DayPanel.tsx`

```tsx
<div style={zoomStyle}>
  <DayView
    date={effectiveAnchor}
    events={events.map(toScheduleEvent)}
    startTime={pad(hourOffsets.startHour) + ":00:00"}
    endTime="23:59:59"
    intervalMinutes={30}
    withCurrentTimeIndicator
    withEventsDragAndDrop={false}
    withEventResize={false}
    renderEventBody={(e) => renderEventBody(e, "day")}
    onEventClick={handleEventClick}
    onTimeSlotClick={({ slotStart, slotEnd }) => openCreate(slotStart, slotEnd)}
    onSlotDragEnd={(s, e) => openCreate(s, e)}
  />
</div>
```

- `intervalMinutes=30` matches current Tastile DayView granularity (Mantine default is 15).
- `withCurrentTimeIndicator` replaces the custom `NowIndicator` component.
- Drag / resize disabled — Tastile does not support event-time editing in v1.

### 3.5 `WeekPanel.tsx`

```tsx
<WeekView
  date={effectiveAnchor}
  events={events.map(toScheduleEvent)}
  firstDayOfWeek={1}
  withWeekendDays
  intervalMinutes={60}
  startTime="00:00:00"
  endTime="23:59:59"
  withCurrentTimeIndicator
  renderEventBody={(e) => renderEventBody(e, "week")}
  onEventClick={handleEventClick}
  onTimeSlotClick={({ slotStart, slotEnd }) => openCreate(slotStart, slotEnd)}
  onSlotDragEnd={(s, e) => openCreate(s, e)}
/>
```

### 3.6 `MonthPanel.tsx`

```tsx
<MonthView
  date={effectiveAnchor}
  events={events.map(toScheduleEvent)}
  firstDayOfWeek={1}
  withWeekendDays
  maxEventsPerDay={3}
  hideOutsideDates={false}
  renderEventBody={(e) => renderEventBody(e, "month")}
  onDayClick={(date) => { setView("day"); setAnchor(date); }}
  onSlotDragEnd={(s, e) => openCreate(s, e)}
/>
```

- `maxEventsPerDay=3` keeps the existing `+N more` count; Mantine renders the overflow chip natively.
- `onDayClick` is an improvement: tap a date to drill into Day view (the current Month view does not respond to date clicks).

### 3.7 `YearPanel.tsx` and `AgendaPanel.tsx`

```tsx
<YearView date={effectiveAnchor} events={events.map(toScheduleEvent)} />

<AgendaView
  date={effectiveAnchor}
  events={events.map(toScheduleEvent)}
  renderEventBody={(e) => renderEventBody(e, "agenda")}
  onEventClick={handleEventClick}
/>
```

- `YearView` powers the debug route's YearGrid replacement.
- `AgendaView` replaces `EventListView`; shows events grouped by date with the agenda header per range.

### 3.8 `ScheduleTimeline.tsx`

```tsx
export function ScheduleTimeline({ initialView = "day" }: { initialView?: ScheduleView }) {
  const state = useTimelineState(initialView);
  const bp = useResponsiveBreakpoint();
  const effectiveAnchor = state.mode === "scope" ? state.anchor : todayLocalIso();
  const range = useMemo(() => getModeRange(state.view, state.mode, effectiveAnchor, tzOffset), [...]);
  const { events, loading, error } = useEvents({ ...range, ... });

  const view = bp === "mobile" ? "mobile-month" : state.view;

  return (
    <div className="flex h-full flex-col" data-testid="calendar-main">
      <ScheduleToolbar {...state} />
      <ErrorBanner error={error} />
      <LoadingOverlay loading={loading}>
        {view === "mobile-month" ? <MobileMonthView ... /> : null}
        {view === "day"    ? <DayPanel    ... /> : null}
        {view === "week"   ? <WeekPanel   ... /> : null}
        {view === "month"  ? <MonthPanel  ... /> : null}
        {view === "year"   ? <YearPanel   ... /> : null}
        {view === "agenda" ? <AgendaPanel ... /> : null}
      </LoadingOverlay>
    </div>
  );
}
```

---

## Section 4 — Error handling and loading

### 4.1 Error categories

| Kind | Cause | UI |
| --- | --- | --- |
| `network` | fetch failure / timeout | red banner + retry |
| `auth` | 401 / 403 (Cognito expired / lost) | signin redirect (API client) |
| `range` | `/v1/timeline` window > 31 days | clamp to 31d; one-time `console.warn` |
| `parse` | malformed response | render empty; `console.error` |
| `event_id` | `loadFromRecurringTile` 404 | surfaced by `useQuickCreateStore`; no calendar-level UI |

### 4.2 `ErrorBanner`

Direct port of `CalendarMain`'s error overlay (lines 396–407):

```tsx
<div className="pointer-events-none absolute inset-x-4 top-2 z-20 flex justify-center">
  <Alert ... data-testid="cal-error" />
</div>
```

`pointer-events-none` on the wrapper so the underlying grid stays interactive; `pointer-events-auto` on the Alert itself.

### 4.3 `LoadingOverlay`

```tsx
<div className="relative h-full">
  {children}
  {loading && (
    <div data-testid="day-loading"
         className="pointer-events-none absolute inset-0 flex items-start justify-center
                    bg-surface-0/40 pt-4 text-[10px] uppercase tracking-wider
                    text-foreground-subtle">
      Loading…
    </div>
  )}
</div>
```

Wraps the active Panel. First render with empty `events` shows empty grid + overlay; once fetch resolves the grid fills.

### 4.4 Empty state

Mantine views render their default empty grids when `events` is empty. No special empty-state component is added; for `AgendaView` an empty-state line ("No events in this range") is rendered by the panel when `events.length === 0 && !loading && !error`.

### 4.5 Range clamping

```ts
export function clampRange(range: { start: string; end: string }, maxDays = 31) {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  const days = (endMs - startMs) / 86_400_000;
  if (days <= maxDays) return range;
  console.warn(`[schedule] range clamped from ${days.toFixed(1)}d to ${maxDays}d`);
  return { start: range.start, end: new Date(startMs + maxDays * 86_400_000).toISOString() };
}
```

Applied inside `useEvents` before the fetch. Current `CalendarMain.listRange` is already 31d; clamp is a safety net.

### 4.6 Race conditions

`useEvents` keeps its existing `requestId` pattern (incremented per fetch; stale responses discard). prev/next/today rapid clicks will not produce out-of-order `setEvents`.

### 4.7 Auth errors

`getCoreClient()` handles 401 by redirecting to Cognito signin. `ScheduleTimeline` does not surface auth errors as banners (would loop on every poll). `view`/`mode`/`anchor`/`zoom` stay in the URL through the redirect.

### 4.8 Parse failures

`parseView`, `parseMode`, `parseDate`, `parseZoom` all fall back to defaults on invalid input. Bad URLs do not break the UI.

---

## Section 5 — Tests and rollout

### 5.1 Files removed

| Path | Reason |
| --- | --- |
| `src/components/calendar/CalendarMain.tsx` | fully replaced |
| `src/components/calendar/DayView.tsx` | replaced by `DayPanel` |
| `src/components/calendar/WeekView.tsx` | replaced by `WeekPanel` |
| `src/components/calendar/MonthView.tsx` | replaced by `MonthPanel` |
| `src/components/calendar/EventListView.tsx` | replaced by `AgendaPanel` |
| `src/components/calendar/DayViewFrame.tsx`, `WeekViewFrame.tsx`, `MonthViewFrame.tsx` | Mantine renders its own frame |
| `src/components/calendar/AllDayLane.tsx`, `NowIndicator.tsx`, `DayViewTile.tsx`, `WeekViewTile.tsx`, `MonthEventTile.tsx` | merged into `renderEventBody` |
| `src/lib/calendar/layout.ts` — `layoutDayLanes`, `eventSpansDay` | Mantine handles overlap / spanning internally |

### 5.2 Files retained

| Path | Reason |
| --- | --- |
| `src/lib/calendar/layout.ts` — `getModeRange`, `getMonthViewDates`, `getWeekViewDates`, `getDayViewHourOffsets`, `todayLocalIso`, `padToFullWeeks` | date-window utilities |
| `src/lib/hooks/calendar/use-events.ts` | unchanged |
| `src/lib/hooks/use-zoom.ts` | reference, not imported by new code |
| `src/lib/hooks/minute-clock.ts` | re-used by `DayPanel` / `WeekPanel` via `withCurrentTimeIndicator` underlying clock |
| `src/lib/stores/quick-create-store.ts` | unchanged |
| `src/components/panels/CalendarSidePanel.tsx` | orthogonal; unchanged |

### 5.3 New unit tests

| Path | Covers |
| --- | --- |
| `src/components/schedule/eventAdapter.test.ts` | `toScheduleEvent` mapping: `payload` retention, `colorToMantine`, all-day start/end normalisation, `recurrence` never set |
| `src/components/schedule/useTimelineState.test.ts` | URL ↔ state round-trip; invalid-value fallbacks; `mode=scope` omitted; `zoom` default omitted; stable callback identity |
| `src/components/schedule/useResponsiveBreakpoint.test.ts` | 600-px boundary; SSR initial = `"desktop"`; effect cleanup removes listener |
| `src/components/schedule/ScheduleToolbar.test.tsx` | prev/next/today clicks; view switch; mode switch; zoom +/– within [24, 160]; `navDisabled` gates |
| `src/components/schedule/clampRange.test.ts` | 31-day cap; non-clamping pass-through; warn-once behaviour |
| `src/components/schedule/renderEventBody.test.tsx` | icon / project / tags rendering; `data-testid` per scope; missing fields degrade gracefully |

### 5.4 Existing tests updated

| Path | Change |
| --- | --- |
| `src/lib/calendar/layout.test.ts` | drop `eventSpansDay` cases; keep date-window cases |
| `e2e/calendar-event-flow.spec.ts` | `cal-view-list` → `cal-view-agenda` (1 selector) |
| `e2e/overlap-lanes.spec.ts`, `e2e/quick-tile-edit-delete.spec.ts`, `e2e/recurring-edit-title.spec.ts`, `e2e/quick-tile-timeline-display.spec.ts`, `e2e/quick-tile-sidebar-to-timeline.spec.ts` | no change (renderers emit same testids) |

### 5.5 E2E scenarios

Existing — pass without change:

- create from empty cell
- edit / delete event
- all-day event
- multi-day event
- recurring event (`source.kind === 1` → tile editor)
- recurring-occurrence title edit
- sidebar → timeline navigation

New:

- mobile breakpoint (≤ 600 px) → `MobileMonthView` shows; date tap → Day view
- Agenda view → date headers + grouped list
- Year view → 12-cell grid (debug route)
- Zoom `+` / `−` toolbar buttons step hour-slot height

### 5.6 Rollout (big-bang cutover, single branch)

```
Step 1: add @mantine/schedule@9.5.0 + rrule@2.8.1
Step 2: eventAdapter / renderEventBody / parsers / clampRange + unit tests
Step 3: useTimelineState + useResponsiveBreakpoint + unit tests
Step 4: DayPanel / WeekPanel / MonthPanel / YearPanel / AgendaPanel
Step 5: ScheduleToolbar + tests
Step 6: ScheduleTimeline parent assembly
Step 7: route swap (/dashboard/timeline/page.tsx, [view]/page.tsx) + delete legacy
Step 8: e2e (vitest + Playwright); update 1 selector
Step 9: chrome-devtools MCP manual QA across 5 views × 3 modes × zoom
```

Verification at each step: `bun run lint`, `bun run build`, `bun test src/components/schedule/`.

### 5.7 Branch / commit strategy

- Single branch: `feat/mantine-schedule-replacement` from `main`.
- One commit per Step above. Every commit leaves the tree build-green.
- Commit message format: `feat(calendar): Mantine Schedule replacement Step N — <summary>`.
- Pre-existing dirty files (`CalendarSidePanel.tsx`, `ProjectsSidePanel.tsx`, `ScheduleSidePanel.tsx`, `SideToolPanel.tsx`, `ProjectTree.tsx`) are untouched.

### 5.8 Verification commands

```bash
bun run lint
bun run build
bun test src/components/schedule/
bun test
bun test:e2e
bun dev      # → chrome-devtools MCP walkthrough
```

### 5.9 Rollback

- Pre-merge: branch deletion + redo.
- Post-merge: `git revert <merge>` restores prior state (legacy files remain in history).
- Partial rollback: `git checkout HEAD~1 -- src/components/calendar/`.

### 5.10 Risks and mitigations

- **`@mantine/schedule` API changes between Mantine minor versions.** Mitigation: pin `9.5.0` in `package.json`; update only with a deliberate Mantine bump.
- **CSS variable `--day-view-slot-height` precision differs across browsers at extreme zoom (24 px or 160 px).** Mitigation: clamp zoom to [24, 160]; smoke-test all values manually.
- **`MobileMonthView` interaction model differs from desktop Week view (tap-to-drill-in vs scroll).** Mitigation: explicit `onDayClick` → `setView("day")` to give mobile users the same drill-down affordance.
- **`getModeRange` window math uses `tzOffset` for window boundaries; display now uses browser-local TZ.** Mitigation: documented behaviour change; window math unaffected.
- **Test-parallelism: new unit tests reference shared `events` array shape; if shape drifts, multiple tests fail at once.** Mitigation: `eventAdapter.test.ts` covers the shape; treat its failures as a signal.

### 5.11 Out of scope (explicit)

- Domain model changes
- API surface changes
- Drag-to-move / drag-to-resize event editing
- Recurring-rule editor in the web client
- Replacement of `CalendarSidePanel`, `useQuickCreateStore`, `useEvents`, `getModeRange`
- iOS PWA `/app/*` routes
- Design-token / theming changes
- Performance / memoisation work
- Mantine minor-version bump
