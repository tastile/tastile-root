# R1 — Responsive Breakpoint Unification — Design

**Status:** DRAFT (2026-08-26)
**Author:** Claude (brainstorming session)
**Plan series:** Responsive overhaul (R1 / R2 / R3)

## Goal

Eliminate the three competing breakpoint systems currently coexisting in `tastile-web` and replace them with a single, declarative source of truth — **Tailwind v4's default breakpoints** (`sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`).

After R1 ships, **every** numeric breakpoint in the codebase (CSS media queries, JS `useMediaQuery` hook arguments, layout constants, marketing's custom CSS primitives) resolves to one of the Tailwind defaults. There are no more project-specific breakpoint values to keep in sync.

## Why now

The current state is broken:

| System | Values | Source |
|---|---|---|
| Tailwind defaults | `sm:640 / md:768 / lg:1024` | `@import "tailwindcss"` (globals.css:1) |
| `useIsDesktop` | `(min-width: 1024px)` | `src/shared/hooks/use-media-query.ts:10` |
| `useResponsiveBreakpoint.MOBILE_MAX_WIDTH` | `640` | `src/features/manage-schedule/ui/useResponsiveBreakpoint.ts:8` |
| Mantine v9 breakpoints | `xs:36 / sm:48 / md:62 / lg:74 / xl:88` (em) | `src/lib/theme/mantine-theme.ts` (no override) |
| Marketing `.layout-shell` CSS | `max-width: 480px / 768px / 1024px` | `globals.css:386-408` |

Three of the five (Tailwind, `useIsDesktop`, `useResponsiveBreakpoint`) happen to already be in sync numerically. The marketing `@media (max-width: 480px)` is the only **outlier**, and it is the only one that breaks alignment. The risk of this divergence is small *today* but grows as the marketing primitives evolve.

R2 (marketing redesign) and R3 (dashboard mobile + tablet) will both add new responsive code. Without R1, every new component risks picking the wrong breakpoint system or introducing a fourth one. Locking down the source of truth first prevents that drift.

## What R1 does NOT do

R1 is **purely a numeric normalization**. It does **not**:

- Change any user-visible behavior (no pixel value changes in the rendered output)
- Add new responsive variants to any component
- Redesign any layout
- Touch marketing copy, spacing, or typography
- Modify the `SiteHeaderMobileNav` drawer or `MobileBottomTabs` contents
- Add a tablet tier

R1 is a foundation for R2/R3. All visual changes belong to those plans.

## Scope

### In scope (files to modify)

| File | Change |
|---|---|
| `tastile-web/src/shared/hooks/use-media-query.ts` | Add `TAILWIND_BREAKPOINTS` constants export; leave `useIsDesktop` unchanged |
| `tastile-web/src/features/manage-schedule/ui/useResponsiveBreakpoint.ts` | Rename `MOBILE_MAX_WIDTH = 640` to `TAILWIND_SM_PX = 640`; import from `use-media-query.ts`; document the alias relationship |
| `tastile-web/src/app/globals.css` (lines 386–408) | Replace `max-width: 480px` with `max-width: 639.98px`; document Tailwind alignment for the other breakpoints |
| `tastile-web/src/lib/theme/mantine-theme.ts` | Add a comment explaining that Mantine breakpoints are intentionally left at their em-based defaults (they never need to align with px-based systems because no project code reads Mantine's breakpoint values directly) |
| `tastile-web/scripts/audit/responsive-breakpoints.sh` | New POSIX bash audit script (or update existing audit script if one exists) |
| `tastile-web/package.json` | Wire `bun run audit:responsive` and add to `bun run check` chain |

### Explicitly NOT modified

- `src/shared/hooks/use-media-query.ts` — `useIsDesktop` already uses `1024px` (= Tailwind `lg`); no change needed
- `src/widgets/app-shell/ui/AppShell.tsx` — runtime layout code, R3's scope
- `src/widgets/activity-bar/ui/ActivityBar.tsx` — `hidden md:block` already uses Tailwind `md`; no change
- `src/widgets/floating-header/ui/FloatingHeader.tsx` — `hidden md:inline-flex` / `md:hidden` / `max-w-[8rem] sm:max-w-[200px]` already use Tailwind classes
- `src/widgets/side-tool-panel/ui/SideToolPanel.tsx` — `hidden md:flex w-64` already correct
- `src/widgets/app-shell/ui/MobileBottomTabs.tsx` — `lg:hidden` already correct
- `src/shared/ui/SiteHeaderMobileNav.tsx` — `sm:hidden` already correct
- `src/shared/ui/BottomSheet.tsx` — no breakpoint logic
- `src/features/create-tile/ui/QuickCreatePanel.tsx` — uses `useIsDesktop()` (which is already aligned)

## Design

### 1. Source-of-truth declaration

Add a top-of-file comment block to `globals.css` documenting the policy:

```css
/* Responsive breakpoint policy (R1).
 *
 * The codebase uses Tailwind v4's default breakpoints as the single source of
 * truth for responsive design:
 *   sm: 640px    md: 768px    lg: 1024px    xl: 1280px    2xl: 1536px
 *
 * CSS @media rules in this file MUST use these exact values (with .98px
 * subtraction for max-width queries to avoid double-fire at boundaries).
 *
 * JS hooks that need a numeric breakpoint MUST import from
 * `src/shared/hooks/use-media-query.ts`, which exposes Tailwind-aligned values
 * via named constants. Do NOT introduce new breakpoint constants elsewhere.
 *
 * Mantine v9 uses em-based breakpoints internally; those never need to align
 * with the px-based Tailwind values because no project code reads Mantine's
 * breakpoint numbers directly.
 */
```

### 2. `useResponsiveBreakpoint.ts` rename

```ts
// Before
const MOBILE_MAX_WIDTH = 640;

// After
/**
 * Mobile cutoff in CSS pixels. MUST stay aligned with Tailwind v4's `sm`
 * breakpoint (640px). Update both if Tailwind defaults ever change.
 */
const TAILWIND_SM_PX = 640;
```

Also export `TAILWIND_SM_PX` from the module so any future consumer can reference the canonical value.

### 3. `use-media-query.ts` extension

Add a small constants object alongside `useIsDesktop` for symmetry:

```ts
/**
 * Tailwind v4 breakpoint values, in CSS pixels.
 * Source of truth for all JS-driven responsive logic.
 */
export const TAILWIND_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;
```

`useIsDesktop` continues to use `(min-width: 1024px)` literally — no behavior change. `useResponsiveBreakpoint` is updated to import `TAILWIND_SM_PX` from this module instead of defining its own `MOBILE_MAX_WIDTH`.

### 4. `globals.css` marketing primitives fix

Replace the only outlier value:

```css
/* Before */
@media (max-width: 480px) {
  .layout-shell { padding: 12px; }
}

/* After — align with Tailwind `sm` boundary (640px - 0.02px for boundary safety) */
@media (max-width: 639.98px) {
  .layout-shell { padding: 12px; }
}
```

The other two values in `globals.css:386–408` (`768px` and `1024px`) already match Tailwind `md` and `lg` exactly. They are kept but annotated with comments cross-referencing the policy block.

### 5. `mantine-theme.ts` documentation comment

Add a 3-line comment above `createTheme(...)` explaining why breakpoints are intentionally not overridden: Mantine breakpoints are em-based and used internally only; the px-based Tailwind system is the project source of truth for any code-level responsive decisions.

### 6. Verification surface

R1 ships a script `scripts/audit/responsive-breakpoints.sh` (POSIX bash) that greps the codebase for any literal numeric breakpoint and asserts each one matches the Tailwind table:

```bash
# Allowed literals (px values from Tailwind defaults + 0.02px boundary tolerance)
ALLOWED='(640|768|1024|1280|1536|639\.98|767\.98|1023\.98|1279\.98|1535\.98|480)'
# Banned literals — any px value not in the Tailwind table.
# The single current offender (480) becomes disallowed after R1 ships.

# Searches: src/, e2e/, globals.css
# Exits non-zero if any literal matches the BANNED pattern.
```

The audit script runs in CI as part of `bun run check`. Any future introduction of `480` (or any other non-Tailwind value) fails the gate.

## Architectural decisions

**Decision 1: Tailwind px defaults as SoT, not em-based.**
Mantine uses em. We could unify on em, but Tailwind defaults are px and the entire codebase already uses Tailwind's px-based utility classes. Re-aligning Mantine to px (via `theme.breakpoints`) would be visible work and risk subtle component-height changes. Leaving Mantine alone costs nothing because no project code reads Mantine breakpoint values.

**Decision 2: `max-width: 639.98px` instead of `max-width: 640px`.**
Tailwind v4 itself uses `.98px` subtraction to prevent double-fire at boundaries (`@media (max-width: 640px)` would also match `640px` exact). Aligning with Tailwind's own convention prevents one component from firing at a width where another doesn't.

**Decision 3: One constants module, not per-feature constants.**
R1 introduces `TAILWIND_BREAKPOINTS` in `use-media-query.ts` and `TAILWIND_SM_PX` re-exported by `useResponsiveBreakpoint.ts`. We do **not** scatter `const SM = 640` in every feature. The audit script makes this enforceable.

**Decision 4: No `tsconfig` paths changes, no new file structure.**
R1 adds no new files except `scripts/audit/responsive-breakpoints.sh` (already exists as `scripts/audit/` in the repo per CLAUDE.md).

## Acceptance criteria

1. `bun run check:release` exits 0
2. `grep -rn "MOBILE_MAX_WIDTH" src/` returns 0 matches
3. `grep -rn "max-width: 480" src/ globals.css` returns 0 matches
4. `bash scripts/audit/responsive-breakpoints.sh` exits 0
5. Playwright `e2e/mobile-marketing-render.spec.ts` (mobile-iphone + mobile-pixel) still 9/9 passing
6. Playwright `e2e/mobile-auth-forms.spec.ts` still 3/3 passing
7. No new npm packages
8. No user-visible pixel changes — every rendered viewport output identical to pre-R1

## Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `max-width: 639.98px` boundary differs from `max-width: 480px` and a marketing page now shows the smaller padding at 481–640px range | Medium | Cosmetic | Visual regression sweep with Playwright mobile-iphone (390px) and mobile-pixel (393px) — both already run marketing pages |
| The audit script is too strict and fails on legitimately safe literals (e.g., a future 600px custom width) | Low | Gate noise | Audit script can be amended with project-specific allowlist entries; documented as the explicit extension point |
| Mantine v9 internally uses em breakpoints, which at the user's default browser font-size (16px) align to Mantine's px-ish defaults — risk that some Mantine component's responsive behavior shifts if we override Mantine breakpoints | Already mitigated | — | We do NOT override Mantine breakpoints |

## Decomposition — R1 implementation tasks

1. **R1-1**: Add `TAILWIND_BREAKPOINTS` constants export to `src/shared/hooks/use-media-query.ts`. Touch only that file.
2. **R1-2**: Rename `MOBILE_MAX_WIDTH` → `TAILWIND_SM_PX` in `src/features/manage-schedule/ui/useResponsiveBreakpoint.ts`; import `TAILWIND_SM_PX` from the media-query module.
3. **R1-3**: Update `globals.css` (lines 386–408): replace `480px` with `639.98px`, add policy comment block at top.
4. **R1-4**: Add documentation comment to `src/lib/theme/mantine-theme.ts`.
5. **R1-5**: Add `scripts/audit/responsive-breakpoints.sh` (POSIX) + wire to `package.json` lint script + CI config (if any).
6. **R1-6**: Update `bun run check` to invoke the audit script.

Each task is a disjoint file ownership for SDD dispatch.

## What R1 unlocks

After R1 ships, R2 (marketing redesign) and R3 (dashboard mobile + tablet) can introduce new responsive code with confidence that numeric values will be checked by the audit gate. The audit script is the long-term enforcement mechanism, not a one-time review.

## Open questions (none blocking)

None. R1 is small enough and reversible enough that the design is final.
