# Dashboard Shell + Tile Creation Panel Polish — Design

> Date: 2026-07-29
> Target: `tastile-web` — shell components (`FloatingHeader`, `ActivityBar`, `SideToolPanel`, `BottomSheet`) and `QuickTileCreate.tsx`
> Source of truth for design system: `docs/DESIGN-SYSTEM.md` v2.0
> Source of truth for v1 domain: `tastile-core/v1/*` (no change)

## Goal

Two surfaces, one recipe:

1. **Dashboard shell** — visual hierarchy + accessibility polish. No layout/feature changes.
2. **Tile creation panel** — extract 8 subcomponents into their own files; bring them under the same tokens/hierarchy as the shell.

Two rule books, applied everywhere:

- **Concentric radii.** Outer radius = inner radius + padding. Existing `SEGMENT_STYLES` and `--surface-*` tokens are audited; mismatches are corrected.
- **Focus + ARIA.** Every interactive element has a visible focus ring; every region has a landmark role; every modal/sheet has a labelled `aria-describedby` error region.

## Non-Goals

- Domain model changes (`tastile-core` v1 schema is unchanged).
- API surface changes (no new endpoints, no new request shapes).
- Store schema rewrite (only 3 fields added: `submitState`, `canSubmit`, `submitBlockedReason`).
- i18n (existing translation keys cover all new strings).
- Calendar views (`DayView`/`WeekView`/`MonthView`) — only the shell that contains them.
- Motion library introduction (no `framer-motion` / `motion`; CSS transitions only).
- Performance work (no query-key/ memoization / prefetch rewrites).

---

## Section 1 — Tokens

Additions to `globals.css` (light/dark already governed by `:root` and `[data-theme="dark"]`):

```css
:root {
  --focus-ring: oklch(0.55 0.18 250 / 0.55);
  --ring-offset: 2px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.04);
  --shadow-2: 0 4px 8px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.04);
  --shadow-3: 0 8px 24px rgb(0 0 0 / 0.08), 0 24px 48px rgb(0 0 0 / 0.06);
  --surface-3: oklch(0.985 0 0);
  --surface-inset: oklch(0.97 0 0);
  --border-subtle: oklch(0 0 0 / 0.06);
  --border-default: oklch(0 0 0 / 0.1);
}
[data-theme="dark"] {
  --focus-ring: oklch(0.7 0.18 250 / 0.6);
  --surface-3: oklch(0.18 0 0);
  --surface-inset: oklch(0.15 0 0);
  --border-subtle: oklch(1 0 0 / 0.06);
  --border-default: oklch(1 0 0 / 0.1);
}
```

Universal focus rule:

```css
:where(button, a, [role="button"], input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: var(--ring-offset);
  border-radius: inherit;
}
```

Catches every focusable element globally. Mantine controls keep their own focus-visible styling; this rule covers the rest.

`prefers-reduced-motion` gate (transforms only):

```css
@media (prefers-reduced-motion: reduce) {
  :where([data-panel-anim]) {
    transition-property: opacity;
    transform: none !important;
  }
}
```

Applied to `SubPanelShell` and `BottomSheet`. Mantine keeps its own reduced-motion handling.

`panel-styles.ts` expanded:

```ts
export const SEGMENT_STYLES = { /* existing */ } as const;

export const FOCUS_RING_CLASS =
  "focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export const SURFACE_CLASSES = {
  raised: "bg-[var(--surface-1)] shadow-[var(--shadow-1)]",
  elevated: "bg-[var(--surface-3)] shadow-[var(--shadow-2)]",
  inset: "bg-[var(--surface-inset)]",
} as const;

export const INPUT_RADIUS = "rounded-md";  // 6px — matches Mantine default

export const PANEL_ANIM_ATTR = "data-panel-anim";
```

---

## Section 2 — Shell components

Four files. Each gets ARIA landmarks, focus-ring awareness, and a token audit.

| File | Change |
|---|---|
| `FloatingHeader.tsx` | Wrap in `<header role="banner">`; icon-only buttons get `aria-label`; user-name area gets `aria-live="polite"`; replace any `<div onClick>` with `<button>`. |
| `ActivityBar.tsx` | Nav landmark `<nav role="navigation" aria-label="Primary">`; pin/expand gets `aria-expanded`; active tool gets `aria-current="page"`; native `title` replaced by `aria-describedby` for tooltip. |
| `SideToolPanel.tsx` | `<aside role="complementary" aria-label="Detail">`; close button gets `aria-label`; restored content region gets `aria-label`. |
| `BottomSheet.tsx` | `aria-labelledby` set to the `title` heading id; Mantine's existing focus trap retained. |

Skip-link at top of `layout.tsx`:

```tsx
<a href="#main" className="sr-only focus:not-sr-only ...">Skip to main</a>
```

No layout size changes. Header remains 48px (`pt-12`). Sidebar remains 56px collapsed / 240px expanded.

**Concentric radius audit (verify alignment; no new tokens):**

- `FloatingHeader` search bar (rounded-full 9999px) — inner input keeps same radius.
- `ActivityBar` rail (rounded-md 6px) — inner nav items use rounded (4px).
- `SideToolPanel` (rounded-lg 8px) — inner cards use rounded-md (6px).
- `QuickTileCreate` panel (rounded-xl 12px) — inner StagedSection uses rounded-lg (8px).

---

## Section 3 — Tile creation panel subcomponents

### File layout

```
src/components/tiles/editor/
  SubPanelShell.tsx          (~80 lines, NEW)
  StagedSection.tsx          (~140 lines, NEW)
  FieldRow.tsx               (~60 lines, NEW)
  SubmitBar.tsx              (~120 lines, NEW)
  PanelErrorBanner.tsx       (~50 lines, NEW)
  panel-styles.ts            (expanded to ~80 lines)
```

All existing sub-panels (`RelationPanel`, `SchedulePanel`, `FlowSequencePanel`, etc.) keep their current files; they render via `<SubPanelShell>` instead of inlining the slide-in logic.

### Components

**SubPanelShell** — slide-in wrapper, ARIA, keyboard.

```tsx
type SubPanelKey =
  | "base" | "intent" | "time" | "duration" | "recurring"
  | "source-rules" | "relations" | "flows" | "tasks";

interface Props {
  panelKey: SubPanelKey;
  activeKey: SubPanelKey | null;
  onClose: () => void;
  headingId: string;
  title: string;
  description?: string;
  children: ReactNode;
  layout: "drawer" | "sheet";   // desktop = right slide, mobile = bottom slide
}
```

Responsibilities:
- Owns `translate-x-full` / `translate-x-0` and `translate-y-full` / `translate-y-0` swap.
- Renders `aria-hidden` and `inert` uniformly.
- `aria-labelledby={headingId}` on the `<section>`.
- `Esc` close at top level; nested Esc returns to base when a child sub-panel is open.
- `PANEL_ANIM_ATTR` set on the root so the reduced-motion CSS targets it.

**StagedSection** — collapsible row + chip digest.

```tsx
interface Props {
  title: string;
  required?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  digest?: ReactNode;
  children: ReactNode;
  onOpenSubPanel?: (key: SubPanelKey) => void;
}
```

Single `aria-expanded` source of truth. ChevronRight ↔ ChevronDown is centrally controlled. Digest (chip row) renders only when collapsed.

**FieldRow** — label + control + inline error.

```tsx
interface Props {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}
```

- `aria-describedby` for hint, `aria-errormessage` for error.
- 4px gap label→control, 6px gap control→error, 12px between fields.

**SubmitBar** — presentational footer + submit gate.

```tsx
interface Props {
  canSubmit: boolean;
  blockedReason: string | null;
  isSubmitting: boolean;
  serverError: { title: string; body: string } | null;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  cancelLabel: string;
}
```

- Submit uses Mantine `loading` state.
- `serverError` rendered via `PanelErrorBanner` above buttons.
- `blockedReason` rendered muted text below the button (under it, not in a tooltip).

**PanelErrorBanner** — single error presentation.

```tsx
interface Props {
  title: string;
  body: string;
  onDismiss?: () => void;
}
```

Renders `role="alert"`, close button when `onDismiss` is provided.

### `QuickTileCreate.tsx` after refactor

Becomes ~600 lines: imports, store wiring, state machine for `activePanel`, keyboard shortcuts, render of header + `<SubmitBar>` + body sections + sub-panel map. Each sub-panel still lives in its own file but renders through `<SubPanelShell>`.

---

## Section 4 — Data flow & state

### Three rules

1. **The Zustand store is the only source of truth** for form values. No local `useState` for form fields. Every field write goes through `setField` on the dotted path. The 2026-07-27 redesign already enforces this for tasks; we extend it uniformly.
2. **`canSubmit` is computed in the store, not the component.** Today it lives in `QuickTileCreate.tsx` as a derived variable. After extraction it lives in the store as a memoized selector plus an exported `submitBlocked` reason.
3. **The submit flow is unchanged.** `submitCreateTile` is called only from `SubmitBar`. `loading` and `serverError` come from the submit promise's resolution.

### `SubmitState` state machine

```ts
type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; reason: ApiErrorKind; message: string }
  | { kind: "success" };
```

Stored in `useQuickCreateStore.submitState`. Resets to `idle` on `close()`.

### Store additions

```ts
interface QuickCreateState {
  // ... existing fields unchanged
  submitState: SubmitState;
  canSubmit: boolean;
  submitBlockedReason: string | null;
  getFieldError: (path: string) => string | null;
}
```

`canSubmit` and `submitBlockedReason` are recomputed in a single `useEffect` that watches the relevant store fields. They're also stored as plain values so consumers don't run their own effects.

### `activePanel` lifecycle

- On open: `open()` action sets `activePanel = "base"`.
- On sub-panel open (chip click in StagedSection): `setActivePanel(key)`.
- On any "Done" / "← Back": `setActivePanel("base")`.
- On close: `setActivePanel(null)`, `submitState` reset to `idle`.
- Esc at top → close; Esc inside sub-panel → base. Centralized in `SubPanelShell`.

### Field-level error sourcing

`fieldErrors: Map<string, string>` keyed by dotted path. Empty title, span order, duration range, task cycle each push a key. `FieldRow` reads `error={getFieldError(path)}`. `submitBlockedReason` is the summary version (one short phrase under the button); both come from the same map.

### Submit flow (unchanged surface)

```
SubmitBar.onClick
  → submitCreateTile(state)
  → success: setSubmitState({ kind: "success" }), close after 200ms
  → validation error: setSubmitState({ kind: "error", reason, message })
  → network error: setSubmitState({ kind: "error", reason: "NETWORK", message })
  → submitBlocked: blockedReason shows under button (no submit attempted)
```

### Backwards compatibility

- Existing tests pass: `<div className={subPanelClass(...)}>` is replaced with `<SubPanelShell panelKey="...">`. The className strings are now generated inside `SubPanelShell`.
- Existing store consumers keep working; we add fields, never remove.

---

## Section 5 — Testing, verification, out-of-scope

### Test layers

**Unit (Vitest + RTL):**

| File | Coverage |
|---|---|
| `SubPanelShell.test.tsx` | renders active, hides+inerts idle, transform class, Esc→onClose, `aria-labelledby`, reduced-motion |
| `StagedSection.test.tsx` | `aria-expanded`, digest collapse, expand body, chip→onOpenSubPanel |
| `FieldRow.test.tsx` | label/hint/error, `aria-describedby`/`aria-errormessage`, required indicator, for/id |
| `SubmitBar.test.tsx` | canSubmit gate, blockedReason, loading spinner, serverError→PanelErrorBanner, onClose |
| `PanelErrorBanner.test.tsx` | title+body, `role="alert"`, dismiss |
| `panel-styles.test.ts` | constant values, no runtime side effects |

**Existing tests stay green:** `QuickTileCreate.test.tsx`, `TileCardCompact.test.tsx`, editor sub-panel tests.

**Browser (chrome-devtools MCP):** walk every state at 10% animation speed, capture screenshots:
- header collapsed → expanded
- sidebar collapsed → expanded
- tile creation panel open
- sub-panel transitions (base → intent → tasks)
- task detail sub-panel
- submit-blocked, submit-error, submit-success
- dark mode focus ring
- `prefers-reduced-motion` (no transforms)

**Accessibility (axe-core via Playwright):** four screens (`/dashboard`, `/dashboard/tasks`, QuickTileCreate base, QuickTileCreate sub-panel). 0 critical / 0 serious.

### Verification checklist

- [ ] `bun run lint` clean
- [ ] `bun run typecheck` clean
- [ ] `bun run test:unit` all green (existing + new)
- [ ] `bun run knip` no new unused exports
- [ ] `bun run build` succeeds
- [ ] chrome-devtools MCP walkthrough; screenshots in `evidence/`
- [ ] axe-core: 0 critical/serious on the 4 screens
- [ ] Visual-contract parity: before/after screenshots of `QuickTileCreate` match (modulo token swaps)

### Risks and mitigations

- **Extraction subtly shifts z-index or transform timing.** Mitigation: visual-contract tests with screenshots before/after each subcomponent extraction.
- **Global focus-ring clashes with Mantine internal focus.** Mitigation: use `:focus-visible` only; override Mantine `data-focused` only if audit shows a conflict.
- **chrome-devtools MCP unavailable.** Mitigation: fall back to JS console + manual screenshot.
- **`prefers-reduced-motion` bypass for Mantine animations.** Mitigation: scope the reduced-motion media query to our `data-panel-anim` elements only; let Mantine handle its own.

### Out of scope (explicit)

- Domain model changes
- API surface changes
- Store schema rewrite
- i18n keys
- Calendar view internals
- Theming overhaul
- Motion library
- Mobile-first redesign
- Performance work
