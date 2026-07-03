# UI/UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix 6 critical UI/UX issues: loading states, theme flash, keyboard shortcut text, color contrast, and interactive element clarity.

**Architecture:** Improve loading skeletons, add CSS color-scheme, fix theme initialization, update keyboard shortcut text, enhance button/interactive styles with better hover states and visual hierarchy.

**Tech Stack:** React 19, Tailwind CSS v4, Next.js 15, TypeScript

---

## Problems Identified

1. **Loading UI**: Text-only "Loading..." without skeleton placeholders
2. **Theme Flash**: White flash on page load before theme applies
3. **Rail Theme Delay**: Left rail theme changes lag behind main content
4. **Keyboard Shortcut**: "Cmd/Ctrl+N" text but browser blocks Ctrl+N
5. **Color Contrast**: Low contrast between surfaces makes elements hard to distinguish
6. **Interactive Elements**: Buttons/links don't look clickable (no clear hover states)

---

## Task 1: Add Skeleton Loading Component

**Files:**
- Create: `src/components/ui/Skeleton.tsx`
- Modify: `src/components/tiles/shared/LoadingCard.tsx:6-23`

**Goal:** Replace text-only loading with animated skeleton placeholders.

**Step 1: Create Skeleton component**

Create `src/components/ui/Skeleton.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils/cn'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-surface-2",
        className
      )}
    />
  )
}
```

**Step 2: Update LoadingCard to use Skeleton**

Modify `src/components/tiles/shared/LoadingCard.tsx`:

```tsx
'use client'

import { Skeleton } from '@/components/ui/Skeleton'
import { TILE_CARD_STYLES } from '@/lib/styles/tile-card-styles'
import { cn } from '@/lib/utils/cn'

interface LoadingCardProps {
  variant: 'compact' | 'expandable'
}

export function LoadingCard({ variant }: LoadingCardProps) {
  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        TILE_CARD_STYLES.base,
        isCompact ? TILE_CARD_STYLES.padding.compact : TILE_CARD_STYLES.padding.expandable
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          {!isCompact && <Skeleton className="h-3 w-1/2" />}
        </div>
        <Skeleton className="h-4 w-12" />
      </div>
    </div>
  )
}
```

**Step 3: Add page-level loading skeletons**

Modify `src/app/dashboard/tiles/page.tsx` line 60:

```tsx
if (loading) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <LoadingCard key={i} variant="expandable" />
        ))}
      </div>
    </div>
  )
}
```

Add imports:
```tsx
import { LoadingCard } from '@/components/tiles/shared/LoadingCard'
import { Skeleton } from '@/components/ui/Skeleton'
```

**Step 4: Update Execute page loading**

Modify `src/app/dashboard/execute/page.tsx` line 78:

```tsx
if (loading) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="rounded-xl bg-surface-1 p-4">
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-surface-1 p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <LoadingCard variant="compact" />
        </div>
        <div className="rounded-xl bg-surface-1 p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )
}
```

Add imports:
```tsx
import { LoadingCard } from '@/components/tiles/shared/LoadingCard'
import { Skeleton } from '@/components/ui/Skeleton'
```

**Step 5: Test loading states**

Run: `bun dev`
1. Open http://localhost:3000/dashboard/tiles
2. Hard refresh (Ctrl+Shift+R) to see loading state
3. Verify skeleton animations appear before content loads

Expected: Smooth skeleton placeholders, no text-only loading

**Step 6: Commit**

```bash
git add src/components/ui/Skeleton.tsx src/components/tiles/shared/LoadingCard.tsx src/app/dashboard/tiles/page.tsx src/app/dashboard/execute/page.tsx
git commit -m "feat(ui): add skeleton loading placeholders

Replace text-only 'Loading...' with animated skeleton components.

Changes:
- Add Skeleton component with pulse animation
- Update LoadingCard to use Skeleton
- Add page-level loading skeletons for tiles and execute pages

Improves perceived performance and prevents layout shift.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix Theme Flash on Load

**Files:**
- Modify: `src/app/layout.tsx:1-50`
- Create: `src/lib/theme-script.ts`

**Goal:** Eliminate white flash by applying theme before React hydration.

**Step 1: Create inline theme script**

Create `src/lib/theme-script.ts`:

```ts
// This script runs BEFORE React hydrates to prevent theme flash
export const themeScript = `
(function() {
  try {
    const stored = localStorage.getItem('theme-storage');
    if (stored) {
      const { state } = JSON.parse(stored);
      const theme = state?.theme || 'light';
      document.documentElement.classList.add('theme-' + theme);
    } else {
      document.documentElement.classList.add('theme-light');
    }
  } catch (e) {
    document.documentElement.classList.add('theme-light');
  }
})();
`;
```

**Step 2: Add script to root layout**

Modify `src/app/layout.tsx` - add script tag in `<head>`:

Find the `<html>` tag and update:

```tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className={`${inter.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
```

Add import:
```tsx
import { themeScript } from '@/lib/theme-script'
```

**Step 3: Add CSS color-scheme**

Modify `src/app/globals.css` - add after line 34:

```css
:root {
  /* ... existing vars ... */
  color-scheme: light;
}

.theme-gray,
.theme-dark {
  color-scheme: dark;
}
```

**Step 4: Test theme flash**

Run: `bun dev`
1. Set theme to dark in settings
2. Hard refresh (Ctrl+Shift+R)
3. Verify NO white flash before dark theme appears

Expected: Theme applies instantly, no flash

**Step 5: Commit**

```bash
git add src/lib/theme-script.ts src/app/layout.tsx src/app/globals.css
git commit -m "fix(theme): eliminate white flash on page load

Add inline script that runs before React hydration to apply theme immediately.

Changes:
- Add theme-script.ts with localStorage theme detection
- Inject script in root layout <head>
- Add CSS color-scheme for browser UI theming

Prevents white flash when loading dark themes.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Fix Rail Theme Delay

**Files:**
- Modify: `src/components/layout/LeftTabs.tsx:1-150`

**Goal:** Rail theme applies synchronously with page theme.

**Step 1: Investigate LeftTabs implementation**

Read `src/components/layout/LeftTabs.tsx` to understand current structure.

**Step 2: Remove conditional theme class application**

The rail likely has a separate useEffect for theme. Ensure it uses the same theme class from documentElement.

Find any code like:
```tsx
useEffect(() => {
  // theme application
}, [theme])
```

Replace with direct class binding:
```tsx
className="theme-inherited ..."
```

And ensure globals.css has:
```css
.theme-light .theme-inherited { /* light styles */ }
.theme-gray .theme-inherited { /* gray styles */ }
.theme-dark .theme-inherited { /* dark styles */ }
```

**Step 3: Test rail theme sync**

Run: `bun dev`
1. Toggle theme in settings
2. Verify rail changes color at same time as main content

Expected: Rail and content theme change simultaneously

**Step 4: Commit**

```bash
git add src/components/layout/LeftTabs.tsx src/app/globals.css
git commit -m "fix(theme): synchronize rail theme with page theme

Remove delayed theme application in LeftTabs component.

Changes:
- Use CSS cascade instead of JS theme application
- Rail inherits theme from document root

Rail now changes theme instantly with rest of page.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Fix Keyboard Shortcut Text

**Files:**
- Modify: `src/app/dashboard/tiles/page.tsx:80`
- Modify: `src/app/dashboard/execute/page.tsx:134`
- Modify: `src/components/tiles/NextTileCard.tsx` (find Cmd/Ctrl+N text)

**Goal:** Remove misleading "Cmd/Ctrl+N" text since browser blocks Ctrl+N.

**Step 1: Update tiles page empty state**

Modify `src/app/dashboard/tiles/page.tsx` line 80:

```tsx
{state.tiles.size === 0 ? (
  <p className="text-sm text-foreground-muted">No tiles yet. Click the + button to create one.</p>
) : null}
```

**Step 2: Update execute page empty state**

Modify `src/app/dashboard/execute/page.tsx` line 134:

```tsx
{state.tiles.size === 0 ? (
  <p className="text-sm text-foreground-muted">No tiles yet. Click the + button to create one.</p>
) : null}
```

**Step 3: Update NextTileCard if it has shortcut text**

Read `src/components/tiles/NextTileCard.tsx` and find any "Cmd/Ctrl+N" references.

Replace with "Click the + button" or similar.

**Step 4: Verify all references removed**

Run:
```bash
cd tastile-web
grep -r "Cmd/Ctrl" src/
```

Expected: No matches

**Step 5: Test empty states**

Run: `bun dev`
1. Delete all tiles
2. Verify empty state message says "Click the + button"
3. Verify NO mention of Cmd/Ctrl+N

**Step 6: Commit**

```bash
git add src/app/dashboard/tiles/page.tsx src/app/dashboard/execute/page.tsx src/components/tiles/NextTileCard.tsx
git commit -m "fix(ui): remove misleading Ctrl+N keyboard shortcut text

Replace 'Cmd/Ctrl+N' with 'Click the + button' since browsers block Ctrl+N.

Changes:
- Update empty state text in tiles page
- Update empty state text in execute page
- Remove shortcut references from NextTileCard

Prevents user confusion about non-working shortcuts.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Improve Color Contrast

**Files:**
- Modify: `src/app/globals.css:1-150`

**Goal:** Increase contrast between surface layers for better visual hierarchy.

**Step 1: Analyze current contrast ratios**

Current light theme:
- surface-0: #fafafa
- surface-1: #fbfbfb (Δ1)
- surface-2: #f8f8f8 (Δ2 from 0)
- surface-elevated: #fcfcfc (Δ2 from 0)

Too subtle. Increase differences.

**Step 2: Update light theme surfaces**

Modify `src/app/globals.css` lines 8-14:

```css
:root {
  /* Surfaces - Increased contrast */
  --background: #f5f5f5;
  --surface-0: #f5f5f5;
  --surface-1: #fafafa;
  --surface-2: #efefef;
  --surface-elevated: #ffffff;

  /* Text - Stronger contrast */
  --foreground: #0a0a0a;
  --foreground-muted: #525252;
  --foreground-subtle: #a3a3a3;

  /* Borders */
  --border: #d4d4d4;
  --border-strong: #a3a3a3;

  /* Interactive - More obvious */
  --interactive-base: #171717;
  --interactive-hover: #404040;
  --interactive-active: #525252;

  /* Primary - Unchanged */
  --primary: #0a0a0a;
  --primary-foreground: #ffffff;
  --primary-hover: #262626;

  color-scheme: light;
}
```

**Step 3: Update gray theme surfaces**

Modify `src/app/globals.css` lines 39-65:

```css
.theme-gray {
  /* Surfaces - Increased contrast */
  --background: #171717;
  --surface-0: #171717;
  --surface-1: #1f1f1f;
  --surface-2: #141414;
  --surface-elevated: #262626;

  /* Text - Stronger contrast */
  --foreground: #fafafa;
  --foreground-muted: #a3a3a3;
  --foreground-subtle: #737373;

  /* Borders */
  --border: #404040;
  --border-strong: #737373;

  /* Interactive - More obvious */
  --interactive-base: #fafafa;
  --interactive-hover: #d4d4d4;
  --interactive-active: #a3a3a3;

  /* Primary - Unchanged */
  --primary: #fafafa;
  --primary-foreground: #0a0a0a;
  --primary-hover: #e5e5e5;

  color-scheme: dark;
}
```

**Step 4: Update dark theme surfaces**

Modify `src/app/globals.css` lines 70-96:

```css
.theme-dark {
  /* Surfaces - Increased contrast */
  --background: #000000;
  --surface-0: #000000;
  --surface-1: #0a0a0a;
  --surface-2: #050505;
  --surface-elevated: #171717;

  /* Text - Stronger contrast */
  --foreground: #ffffff;
  --foreground-muted: #a3a3a3;
  --foreground-subtle: #737373;

  /* Borders */
  --border: #262626;
  --border-strong: #525252;

  /* Interactive - More obvious */
  --interactive-base: #ffffff;
  --interactive-hover: #e5e5e5;
  --interactive-active: #d4d4d4;

  /* Primary - Unchanged */
  --primary: #ffffff;
  --primary-foreground: #000000;
  --primary-hover: #f5f5f5;

  color-scheme: dark;
}
```

**Step 5: Test contrast**

Run: `bun dev`
1. View dashboard in all 3 themes
2. Verify cards/sections are clearly distinguished
3. Verify text is readable

Expected: Clear visual hierarchy, elements distinguishable

**Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(theme): increase color contrast for better readability

Improve surface layer contrast and text legibility across all themes.

Changes:
- Increase surface color differences (4-5 steps instead of 1-2)
- Strengthen foreground-muted color (darker in light, lighter in dark)
- Make interactive states more obvious

Cards, sections, and text now clearly distinguishable.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Improve Interactive Element Clarity

**Files:**
- Modify: `src/lib/styles/tile-card-styles.ts`
- Create: `src/lib/styles/button-styles.ts`
- Modify: `src/components/tiles/TileCardCompact.tsx:44-54`
- Modify: `src/components/tiles/TileCardExpandable.tsx` (find action buttons)

**Goal:** Make clickable elements obvious with clear hover states and visual affordances.

**Step 1: Create button style constants**

Create `src/lib/styles/button-styles.ts`:

```ts
export const BUTTON_STYLES = {
  base: 'rounded-lg font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',

  variants: {
    primary: 'bg-primary text-primary-fg hover:bg-primary-hover active:bg-interactive-active focus-visible:outline-primary',
    secondary: 'bg-surface-2 text-foreground hover:bg-interactive-hover active:bg-interactive-active',
    ghost: 'bg-transparent text-foreground hover:bg-surface-2 active:bg-interactive-hover',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-600',
  },

  sizes: {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  },

  disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
} as const
```

**Step 2: Update TILE_CARD_STYLES hover**

Modify `src/lib/styles/tile-card-styles.ts`:

```ts
export const TILE_CARD_STYLES = {
  base: 'rounded-xl bg-surface-elevated border border-border',
  hover: 'transition-all hover:border-border-strong hover:shadow-sm hover:bg-surface-1 cursor-pointer',
  padding: {
    compact: 'p-3',
    expandable: 'p-4',
  },
} as const
```

**Step 3: Add hover ring to TileCardCompact**

Modify `src/components/tiles/TileCardCompact.tsx` line 44:

```tsx
return (
  <div
    onClick={handleCardClick}
    className={cn(
      "flex items-center gap-3 group",
      TILE_CARD_STYLES.base,
      TILE_CARD_STYLES.padding.compact,
      onClick && TILE_CARD_STYLES.hover,
      onClick && "cursor-pointer"
    )}
  >
    <TileStatusIcon
      lifecycle={lifecycle}
      onClick={lifecycle === 'ready' ? handleStatusClick : undefined}
      size={20}
      className={lifecycle === 'ready' ? 'cursor-pointer ring-2 ring-transparent hover:ring-primary/20 rounded-full transition-all' : ''}
    />

    <div className="flex-1 min-w-0">
      <h4 className={cn(
        "text-sm font-medium text-foreground truncate transition-colors",
        lifecycle === 'done' && "line-through opacity-60",
        onClick && "group-hover:text-interactive-hover"
      )}>
        {tile.core.title}
      </h4>
    </div>

    <div className="text-xs text-foreground-muted whitespace-nowrap">
      {formatDuration(tile.objective.targetWorkMin, locale)}
    </div>
  </div>
)
```

**Step 4: Update TileStatusIcon to accept className**

Modify `src/components/tiles/shared/TileStatusIcon.tsx` to accept and apply className prop:

```tsx
interface TileStatusIconProps {
  lifecycle: 'ready' | 'started' | 'done'
  size?: number
  onClick?: () => void
  className?: string
}

export function TileStatusIcon({ lifecycle, size = 24, onClick, className }: TileStatusIconProps) {
  // ... existing code ...

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex items-center justify-center rounded-full transition-all",
        onClick && "cursor-pointer hover:scale-110 active:scale-95",
        !onClick && "cursor-default",
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* ... existing icon rendering ... */}
    </button>
  )
}
```

**Step 5: Update action buttons in TileCardExpandable**

Find all button elements in `src/components/tiles/TileCardExpandable.tsx` and apply BUTTON_STYLES:

```tsx
import { BUTTON_STYLES } from '@/lib/styles/button-styles'
import { cn } from '@/lib/utils/cn'

// Example for Start button:
<button
  onClick={() => onStart?.(tile.core.id)}
  className={cn(
    BUTTON_STYLES.base,
    BUTTON_STYLES.variants.primary,
    BUTTON_STYLES.sizes.sm
  )}
>
  Start
</button>

// Example for Delete button:
<button
  onClick={() => onDelete?.(tile.core.id)}
  className={cn(
    BUTTON_STYLES.base,
    BUTTON_STYLES.variants.danger,
    BUTTON_STYLES.sizes.sm
  )}
>
  Delete
</button>
```

**Step 6: Test interactive elements**

Run: `bun dev`
1. Hover over tile cards - should see border/shadow change
2. Hover over status icons - should see ring appear
3. Hover over action buttons - should see color change
4. Verify cursor changes to pointer on interactive elements

Expected: Clear visual feedback on all interactive elements

**Step 7: Commit**

```bash
git add src/lib/styles/button-styles.ts src/lib/styles/tile-card-styles.ts src/components/tiles/TileCardCompact.tsx src/components/tiles/TileCardExpandable.tsx src/components/tiles/shared/TileStatusIcon.tsx
git commit -m "feat(ui): improve interactive element clarity

Add clear hover states and visual affordances to all clickable elements.

Changes:
- Create BUTTON_STYLES constants for consistent button styling
- Enhance TILE_CARD_STYLES with stronger hover effects
- Add hover ring to clickable status icons
- Apply button styles to all action buttons
- Add group hover effects to tile cards

Users can now clearly identify what is clickable.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Final Visual Polish

**Files:**
- Modify: `src/app/dashboard/layout-client.tsx` (Header execution state)
- Modify: `src/components/execution/ActiveExecutionBar.tsx`
- Modify: `src/components/layout/Header.tsx`

**Goal:** Add visual polish to header, execution bar, and overall spacing.

**Step 1: Enhance ActiveExecutionBar styling**

Modify `src/components/execution/ActiveExecutionBar.tsx`:

```tsx
return (
  <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-1 border border-border px-4 py-3">
    {/* Timer with stronger visual */}
    <div className="flex items-center gap-3">
      <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
      <span className="text-sm font-mono font-semibold text-foreground">
        {timeRemaining}
      </span>
    </div>

    {/* Title with truncation */}
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-foreground truncate">
        {activeTileTitle || 'No active tile'}
      </p>
    </div>

    {/* Phase indicator */}
    <div className="text-xs text-foreground-muted uppercase tracking-wide">
      {phaseKind === 'work' ? 'Focus' : phaseKind === 'break' ? 'Break' : 'Idle'}
    </div>
  </div>
)
```

**Step 2: Improve header execution badge**

Modify `src/components/execution/ActiveExecutionBadge.tsx`:

```tsx
return (
  <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-primary-fg shadow-sm">
    <div className="h-1.5 w-1.5 rounded-full bg-primary-fg animate-pulse" />
    <span className="text-xs font-mono font-semibold">
      {timeRemaining}
    </span>
  </div>
)
```

**Step 3: Add spacing polish to dashboard pages**

Verify all dashboard pages have consistent spacing:
- Heading: `text-2xl font-bold mb-6`
- Sections: `space-y-6`
- Cards: `space-y-2` or `space-y-3`

**Step 4: Test overall visual consistency**

Run: `bun dev`
1. Navigate through all dashboard pages
2. Verify consistent spacing, borders, shadows
3. Verify execution indicators are prominent
4. Test all 3 themes for consistency

Expected: Polished, professional appearance

**Step 5: Commit**

```bash
git add src/components/execution/ActiveExecutionBar.tsx src/components/execution/ActiveExecutionBadge.tsx
git commit -m "polish(ui): enhance execution indicators and spacing

Improve visual prominence of active execution state.

Changes:
- Add pulsing dot to execution indicators
- Strengthen execution bar styling with borders
- Improve timer typography (font-mono, font-semibold)
- Ensure consistent spacing across dashboard pages

Execution state now clearly visible in header and dashboard.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Verification and Testing

**Goal:** Comprehensive manual testing of all improvements.

**Step 1: Test loading states**

1. Hard refresh each page (Ctrl+Shift+R)
2. Verify skeleton placeholders appear smoothly
3. Verify NO text-only "Loading..." anywhere

**Step 2: Test theme flash**

1. Set theme to dark
2. Hard refresh
3. Verify NO white flash
4. Toggle theme in settings
5. Verify rail changes instantly with page

**Step 3: Test keyboard shortcut text**

1. Delete all tiles
2. Verify empty state says "Click the + button"
3. Grep codebase: `grep -r "Cmd/Ctrl" src/`
4. Verify NO matches

**Step 4: Test color contrast**

1. View dashboard in all 3 themes
2. Verify cards are clearly distinguishable
3. Verify text is readable
4. Take screenshots for comparison

**Step 5: Test interactive elements**

1. Hover over every clickable element
2. Verify hover state appears
3. Verify cursor changes to pointer
4. Click elements to verify they work

**Step 6: Document results**

Create `docs/verification/2026-03-17-ui-ux-improvements.md`:

```markdown
# UI/UX Improvements Verification

Tested on: 2026-03-17
Browser: Chrome 120, Firefox 121

## Loading States
✅ Skeleton placeholders appear on all pages
✅ No text-only loading states
✅ Smooth animation transitions

## Theme Flash
✅ No white flash on page load
✅ Rail theme syncs with page theme
✅ Theme persists across refreshes

## Keyboard Shortcuts
✅ No Cmd/Ctrl+N text in UI
✅ Empty states reference + button

## Color Contrast
✅ Light theme: Clear surface hierarchy
✅ Gray theme: Clear surface hierarchy
✅ Dark theme: Clear surface hierarchy
✅ Text readable in all themes

## Interactive Elements
✅ All buttons have clear hover states
✅ Tile cards show hover effects
✅ Status icons show hover rings
✅ Cursor changes to pointer

## Overall
All 6 issues resolved. UI is now clear, consistent, and accessible.
```

**Step 7: Final commit**

```bash
git add docs/verification/2026-03-17-ui-ux-improvements.md
git commit -m "docs: add UI/UX improvements verification report

All 6 issues verified as resolved:
1. Loading states - skeleton placeholders
2. Theme flash - eliminated
3. Rail theme delay - fixed
4. Keyboard shortcut text - corrected
5. Color contrast - improved
6. Interactive elements - clear hover states

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

**8 tasks total:**
1. Add skeleton loading component (5 steps)
2. Fix theme flash on load (5 steps)
3. Fix rail theme delay (4 steps)
4. Fix keyboard shortcut text (6 steps)
5. Improve color contrast (6 steps)
6. Improve interactive element clarity (7 steps)
7. Final visual polish (5 steps)
8. Verification and testing (7 steps)

**Estimated time:** 2-3 hours

**All problems addressed:**
- ✅ Loading UI: Skeleton placeholders
- ✅ Theme flash: Inline script prevents flash
- ✅ Rail delay: Synchronous theme application
- ✅ Keyboard text: Removed Cmd/Ctrl+N references
- ✅ Color contrast: Increased surface/text contrast
- ✅ Interactive clarity: Clear hover states

**Result:** Professional, accessible, user-friendly interface.
