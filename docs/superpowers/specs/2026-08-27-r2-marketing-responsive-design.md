# R2 — Marketing Responsive Design Spec

**Date:** 2026-08-27
**Status:** Draft (brainstorm approved, awaiting writing-plans)
**Author:** R2 spec generation (subagent-driven-development)
**Predecessor:** R1 (Responsive Breakpoint Unification, complete at commit `a4fbe8b6`)
**Successor plans:** R3 (Dashboard responsive + tablet), regression coverage

---

## Goal

Make every marketing page on the tastile-web dashboard render cleanly and readably on mobile viewports (320–639px). Establish a per-component mobile-first design baseline that the dashboard tier can inherit.

## Scope (in)

### Pages (7)
- `/` (home — composes `LandingPage`)
- `/pricing`
- `/download`
- `/privacy`
- `/terms`
- `/tokushoho`
- `/docs`

### Components (11)
- `src/features/marketing/ui/Hero.tsx`
- `src/features/marketing/ui/ConditionBento.tsx`
- `src/features/marketing/ui/LifecycleLoop.tsx`
- `src/features/marketing/ui/Manifesto.tsx`
- `src/features/marketing/ui/PricingTeaser.tsx`
- `src/features/marketing/ui/Faq.tsx`
- `src/features/marketing/ui/CtaSection.tsx`
- `src/features/marketing/ui/PricingCard.tsx` (used on `/pricing`)
- `src/features/marketing/ui/ProductPreview.tsx`
- `src/features/marketing/ui/DemoSiteBanner.tsx`
- `src/features/marketing/ui/LocaleSwitcher.tsx`

### Styles (1)
- `src/features/marketing/ui/marketing.css` — owns the `mkt-*` keyframes and utility classes; verify no horizontal-scroll-causing animations remain at mobile widths

### Tests (2)
- `e2e/mobile-marketing-render.spec.ts` — extend with 3-5 new mobile-specific assertions
- `e2e/helpers/marketing.ts` — add reusable helpers as needed

## Scope (out)

- **Tablet tier (768–1023px)** — explicitly deferred to R3 per the brainstorming decision
- **Desktop pixel-perfect tweaks** — R1 already aligned desktop breakpoints; this plan is mobile-focused
- **New design tokens, type scale, or `@theme` extensions** — Tailwind v4 defaults are SoT; no marketing-specific tokens
- **MarketingShell wrapper abstraction** — explicitly rejected in brainstorming; ad-hoc Tailwind utilities per component is the chosen pattern
- **Refactoring marketing content** (copy, animations, visual brand) — only layout/responsive changes
- **Dashboard pages** — R3's scope

## Architecture

**Pattern:** ad-hoc Tailwind utilities per component, building on R1's `TAILWIND_BREAKPOINTS = { sm:640, md:768, lg:1024, xl:1280, "2xl":1536 }` SoT.

**Mobile-first cascade:** each component already has a base (mobile) state; this plan adds `sm:`, `md:`, `lg:` modifiers where needed to recover desktop behavior. Components that already work at mobile width stay untouched except for verification.

**Enforcement:** R1's `scripts/audit-responsive-breakpoints.sh` already gates `bun run check`; no new audit script is needed. The audit catches misaligned `@media (max-width: Npx)` literals.

**Per-component mobile design rules:**

1. **No horizontal overflow** at 320–639px viewport (Tailwind `sm:` boundary)
2. **Headings scale down** — hero `h1` should not exceed `text-5xl`/`text-6xl` on mobile; clamp via `text-3xl sm:text-5xl lg:text-display-1`
3. **CTAs stack vertically with full-width on mobile** — `flex-col sm:flex-row` + `w-full sm:w-auto`
4. **Multi-column grids collapse to single-column under `md:`** — `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
5. **Padding/margin use mobile-first scale** — `px-4 sm:px-6 lg:px-8`
6. **Product previews respect parent width** — `max-w-full overflow-hidden`
7. **Bleed animations** (`mkt-pierce-stroke`, `mkt-giant-numeral`) — wrap with `overflow-x-hidden` or limit `text-[clamp(...)]` so they don't force horizontal scroll
8. **Type scale uses Tailwind defaults** — no new tokens

## Mobile E2E coverage extensions

Add to `e2e/mobile-marketing-render.spec.ts` (existing file, extending not duplicating):

1. **Hero CTA visibility** — on `/`, `/pricing`, `/download`, the primary CTA button is visible (not clipped, not off-screen) at iPhone viewport
2. **PricingTeaser card stack** — on `/`, all teaser cards are full-width (single column) at iPhone viewport; on `/pricing`, `PricingCard` components stack
3. **Footer no overflow** — `expectNoHorizontalScroll` already exists; extend to assert footer links wrap correctly (no overflow on small viewports)
4. **Static pages no horizontal scroll** — `/privacy`, `/terms`, `/tokushoho`, `/docs` pass `expectNoHorizontalScroll` at iPhone + Pixel viewports
5. **Bleed animations don't cause overflow** — `body` `scrollWidth ≤ clientWidth` on home page at mobile widths

Existing assertions (`expectHeaderPresent`, `expectMainContent`, `expectFooterPresent`, `expectNoHorizontalScroll`, `expectPageHeading`) remain unchanged; new assertions extend, don't replace.

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Aggressive mobile changes regress desktop visuals | Medium | High | Per-component commits; Playwright desktop test suite must still pass; visual diff review |
| `mkt-pierce-stroke` animation overflows horizontally | High | Medium | Wrap with `overflow-x-hidden` on section; clamp font size with `text-clamp()` |
| `mkt-giant-numeral` "00" overflows on small screens | Medium | Low | Add `max-w-full` + `text-[clamp(8rem,30vw,20rem)]` |
| New tests flake due to dynamic content | Low | Medium | Use `getByRole` / semantic locators, not arbitrary CSS selectors |
| Bundle from per-component Tailwind additions | Medium | Low | Tailwind v4 purges unused utilities at build time; no runtime impact |

## Acceptance criteria

1. **All 7 marketing pages pass `expectNoHorizontalScroll` at iPhone (390×844) and Pixel (393×851) viewports** (Playwright `mobile-iphone` + `mobile-pixel` projects)
2. **All 7 marketing pages render `expectHeaderPresent` + `expectFooterPresent` + `expectMainContent` + `expectPageHeading` at both mobile viewports** (existing assertions, no regression)
3. **New mobile assertions pass**: 5 new test cases described above
4. **All 4 desktop marketing specs still pass**: `e2e/marketing-home.spec.ts`, `marketing-pricing.spec.ts`, `marketing-download.spec.ts`, `marketing-privacy.spec.ts`, `marketing-terms.spec.ts`, `marketing-tokushoho.spec.ts` (6 desktop specs)
5. **No new npm packages**
6. **R1 enforcement gates still pass**: `bun run knip`, `bun run audit:responsive`, `bun run typecheck` (exit 0)
7. **Audit script finds no new offenders** — R1's `scripts/audit-responsive-breakpoints.sh` exits 0 after R2 changes
8. **No horizontal overflow on `body` element** at 320, 360, 390, 393, 414, 480 viewport widths (Playwright assertion in `mobile-marketing-render.spec.ts`)

## File ownership (disjoint per task)

Per SDD protocol, R2 implementation splits into disjoint file-ownership tasks:

- **R2-1**: `Hero.tsx` + `ProductPreview.tsx` (both used in home hero section)
- **R2-2**: `ConditionBento.tsx` + `CtaSection.tsx`
- **R2-3**: `LifecycleLoop.tsx` (largest component, 221 LOC, owns its own state)
- **R2-4**: `Manifesto.tsx` + `Faq.tsx`
- **R2-5**: `PricingTeaser.tsx` + `PricingCard.tsx` (pricing-specific)
- **R2-6**: `DemoSiteBanner.tsx` + `LocaleSwitcher.tsx` (small UI primitives)
- **R2-7**: `marketing.css` (single-file ownership for the keyframe/util layer)
- **R2-8**: static pages (`/privacy`, `/terms`, `/tokushoho`, `/docs`) — single task covering all 4 since they share layout shell
- **R2-9**: Playwright test extensions in `e2e/mobile-marketing-render.spec.ts` + `e2e/helpers/marketing.ts`
- **R2-Final**: whole-branch review

Each task is a fresh implementer subagent + task reviewer + (if needed) fix rounds.

## Non-negotiables

- Branch: `main` only — no feature branches or worktrees
- No new npm packages
- English code / comments / commit messages
- Pre-existing uncommitted diff in `git status --short` MUST NOT be touched
- Disjoint file ownership per subagent — never two subagents editing the same file in parallel
- Per-file commit pattern with structured briefs/reports
- i18n hardcoded literals MUST NOT be added (i18n-literal-guard skill active)
- `src/lib/vendored/mantine-schedule` MUST NOT be touched
- Pre-commit review of agent-initiated commits must go through `.agents/skills/tastile-precommit-review`

## Design decisions (resolved during brainstorming)

- **Hero desktop layout**: preserve `lg:grid-cols-[1.05fr_1fr]` 1.05fr/1fr split (existing brand); only make single-column on mobile. Implementer must NOT change the desktop split.
- **Bleed animation overflow**: belt-and-suspenders — apply both `text-[clamp(...)]` on the pierced text AND `overflow-x-hidden` on the section wrapper.
- **Pricing page on mobile**: `PricingCard` components stack vertically (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`); each card full-width on mobile, two-up on tablet, three-up on desktop.
- **Static pages (`/privacy`, `/terms`, `/tokushoho`, `/docs`)**: typography-focused layout; mobile fix is essentially `prose-sm sm:prose-base` and `px-4 sm:px-6` on the main wrapper.