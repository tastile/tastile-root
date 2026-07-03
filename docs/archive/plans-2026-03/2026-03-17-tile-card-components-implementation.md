# Tile Card Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 3 independent tile card components (Compact, Expandable, Detailed) with shared components and dialogs for unified tile display across Tastile.

**Architecture:** Build bottom-up starting with utilities, then shared components (TileStatusIcon, TileActionButtons, LoadingCard), then 3 card variants, then dialogs. Each component is self-contained with clear props interfaces.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react, Zustand (for dialog state)

---

## Task 1: Add translations for tile actions

**Files:**
- Modify: `tastile-web/src/lib/i18n/translations.ts:275`

**Step 1: Add tile action translations**

Extend the translations object with new `tiles` section:

```typescript
// In ja section (after common)
tiles: {
  actions: {
    start: '開始',
    complete: '完了',
    defer: '先送り',
    interrupt: '中断',
    edit: '編集',
    delete: '削除',
  },
  dialogs: {
    startTitle: 'タスクを開始',
    deferTitle: 'タスクを先送り',
    interruptTitle: 'タスクを中断',
    nextStartAt: '次の開始時刻',
    deleteConfirm: '本当に削除しますか？',
  },
  doneDefinition: '完了条件',
  startAt: '開始',
  endAt: '終了',
},

// In en section (after common)
tiles: {
  actions: {
    start: 'Start',
    complete: 'Complete',
    defer: 'Defer',
    interrupt: 'Interrupt',
    edit: 'Edit',
    delete: 'Delete',
  },
  dialogs: {
    startTitle: 'Start Task',
    deferTitle: 'Defer Task',
    interruptTitle: 'Interrupt Task',
    nextStartAt: 'Next start time',
    deleteConfirm: 'Are you sure you want to delete?',
  },
  doneDefinition: 'Done when',
  startAt: 'Start',
  endAt: 'End',
},
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/lib/i18n/translations.ts
git commit -m "feat(i18n): add tile card action translations

- Add tiles.actions (start, complete, defer, interrupt, edit, delete)
- Add tiles.dialogs (prompts for start, defer, interrupt)
- Add tile metadata labels (doneDefinition, startAt, endAt)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create tile formatter utilities

**Files:**
- Create: `tastile-web/src/lib/utils/tile-formatters.ts`

**Step 1: Create formatter utilities**

```typescript
export function formatDuration(minutes: number | null, locale: 'ja' | 'en' = 'ja'): string {
  if (minutes === null || minutes === undefined) return '--'

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (locale === 'ja') {
    if (hours > 0 && mins > 0) return `${hours}時間${mins}分`
    if (hours > 0) return `${hours}時間`
    return `${mins}分`
  }

  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export function formatDateTime(date: Date | null, locale: 'ja' | 'en' = 'ja'): string {
  if (!date) return '--'

  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function getCurrentLocalDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getCurrentLocalTime(): string {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function parseDateTimeParts(datePart: string, timePart: string): Date | null {
  if (!datePart || !timePart) return null
  const date = new Date(`${datePart}T${timePart}`)
  if (Number.isNaN(date.getTime())) return null
  return date
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/lib/utils/tile-formatters.ts
git commit -m "feat(utils): add tile formatting utilities

- formatDuration: format minutes to human-readable duration
- formatDateTime: format Date to localized string
- getCurrentLocalDate/Time: get current local date/time strings
- parseDateTimeParts: parse date+time strings to Date

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create tile card style constants

**Files:**
- Create: `tastile-web/src/lib/styles/tile-card-styles.ts`

**Step 1: Create style constants**

```typescript
export const TILE_CARD_STYLES = {
  base: "rounded-xl bg-surface-1 border border-surface-2 transition-colors",
  hover: "hover:bg-surface-2",
  padding: {
    compact: "p-3",
    comfortable: "p-3",
    detailed: "p-4",
  },
  gap: {
    compact: "gap-2",
    comfortable: "gap-3",
    detailed: "gap-4",
  },
  statusIcon: {
    size: {
      compact: 20,
      comfortable: 20,
      detailed: 24,
    }
  }
} as const

export const TILE_STATUS_COLORS = {
  ready: "text-foreground-muted",
  started: "text-green-500",
  done: "text-primary",
} as const
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/lib/styles/tile-card-styles.ts
git commit -m "feat(styles): add tile card style constants

- TILE_CARD_STYLES: base, hover, padding, gap, icon sizes
- TILE_STATUS_COLORS: ready, started, done colors

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create LoadingCard component

**Files:**
- Create: `tastile-web/src/components/tiles/shared/LoadingCard.tsx`

**Step 1: Create LoadingCard component**

```typescript
'use client'

import { useTranslation } from '@/lib/i18n/use-translation'
import { cn } from '@/lib/utils/cn'

interface LoadingCardProps {
  variant?: 'compact' | 'comfortable' | 'detailed'
}

export function LoadingCard({ variant = 'comfortable' }: LoadingCardProps) {
  const { t } = useTranslation()

  return (
    <div className={cn(
      "rounded-xl bg-surface-1 text-sm text-foreground-muted",
      variant === 'compact' && "p-3",
      variant === 'comfortable' && "p-3",
      variant === 'detailed' && "p-4"
    )}>
      {t('common.loading')}
    </div>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/shared/LoadingCard.tsx
git commit -m "feat(tiles): add LoadingCard component

- Displays loading state with variant-based padding
- Uses i18n translations

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create TileStatusIcon component

**Files:**
- Create: `tastile-web/src/components/tiles/shared/TileStatusIcon.tsx`

**Step 1: Create TileStatusIcon component**

```typescript
'use client'

import { Circle, CircleDot, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { TileLifecycle } from '@/lib/domain/tile'
import { TILE_STATUS_COLORS } from '@/lib/styles/tile-card-styles'

interface TileStatusIconProps {
  lifecycle: TileLifecycle
  onClick?: () => void
  disabled?: boolean
  size?: number
}

export function TileStatusIcon({ lifecycle, onClick, disabled = false, size = 20 }: TileStatusIconProps) {
  const IconComponent = lifecycle === 'ready'
    ? Circle
    : lifecycle === 'started'
    ? CircleDot
    : CheckCircle2

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled && onClick) {
      onClick()
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg transition-colors",
        !disabled && onClick && "hover:bg-surface-2",
        disabled && "opacity-50 cursor-not-allowed",
        TILE_STATUS_COLORS[lifecycle]
      )}
      aria-label={`Status: ${lifecycle}`}
    >
      <IconComponent size={size} />
    </button>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/shared/TileStatusIcon.tsx
git commit -m "feat(tiles): add TileStatusIcon component

- Circle (ready), CircleDot (started), CheckCircle2 (done)
- Clickable with stopPropagation
- Uses TILE_STATUS_COLORS constants

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create TileActionButtons component

**Files:**
- Create: `tastile-web/src/components/tiles/shared/TileActionButtons.tsx`

**Step 1: Create TileActionButtons component**

```typescript
'use client'

import { useTranslation } from '@/lib/i18n/use-translation'
import { getTileLifecycle, type Tile } from '@/lib/domain/tile'
import type { TileId } from '@/lib/domain/ids'
import { cn } from '@/lib/utils/cn'

interface TileActionButtonsProps {
  tile: Tile
  variant: 'compact' | 'full'
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}

export function TileActionButtons({ tile, variant, ...actions }: TileActionButtonsProps) {
  const { t } = useTranslation()
  const lifecycle = getTileLifecycle(tile)

  const ButtonBase = ({
    onClick,
    children,
    primary = false
  }: {
    onClick: () => void
    children: React.ReactNode
    primary?: boolean
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
        primary
          ? "bg-primary text-primary-fg hover:bg-primary/90"
          : "bg-surface-2 text-foreground hover:bg-surface-1"
      )}
    >
      {children}
    </button>
  )

  if (lifecycle === 'ready') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {actions.onStart && (
          <ButtonBase onClick={() => actions.onStart!(tile.core.id)} primary>
            {t('tiles.actions.start')}
          </ButtonBase>
        )}
        {variant === 'full' && (
          <>
            {actions.onDefer && (
              <ButtonBase onClick={() => actions.onDefer!(tile.core.id)}>
                {t('tiles.actions.defer')}
              </ButtonBase>
            )}
            {actions.onEdit && (
              <ButtonBase onClick={() => actions.onEdit!(tile.core.id)}>
                {t('tiles.actions.edit')}
              </ButtonBase>
            )}
            {actions.onDelete && (
              <ButtonBase onClick={() => actions.onDelete!(tile.core.id)}>
                {t('tiles.actions.delete')}
              </ButtonBase>
            )}
          </>
        )}
      </div>
    )
  }

  if (lifecycle === 'started') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {actions.onComplete && (
          <ButtonBase onClick={() => actions.onComplete!(tile.core.id)} primary>
            {t('tiles.actions.complete')}
          </ButtonBase>
        )}
        {variant === 'full' && (
          <>
            {actions.onInterrupt && (
              <ButtonBase onClick={() => actions.onInterrupt!(tile.core.id)}>
                {t('tiles.actions.interrupt')}
              </ButtonBase>
            )}
            {actions.onEdit && (
              <ButtonBase onClick={() => actions.onEdit!(tile.core.id)}>
                {t('tiles.actions.edit')}
              </ButtonBase>
            )}
            {actions.onDelete && (
              <ButtonBase onClick={() => actions.onDelete!(tile.core.id)}>
                {t('tiles.actions.delete')}
              </ButtonBase>
            )}
          </>
        )}
      </div>
    )
  }

  // done state
  if (variant === 'full' && actions.onDelete) {
    return (
      <div className="flex items-center gap-2">
        <ButtonBase onClick={() => actions.onDelete!(tile.core.id)}>
          {t('tiles.actions.delete')}
        </ButtonBase>
      </div>
    )
  }

  return null
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/shared/TileActionButtons.tsx
git commit -m "feat(tiles): add TileActionButtons component

- Lifecycle-aware action buttons (ready, started, done)
- Compact/full variants
- Stopropagation on button clicks

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create TileCardCompact component

**Files:**
- Create: `tastile-web/src/components/tiles/TileCardCompact.tsx`

**Step 1: Create TileCardCompact component**

```typescript
'use client'

import { getTileLifecycle, type Tile } from '@/lib/domain/tile'
import type { TileId } from '@/lib/domain/ids'
import { TileStatusIcon } from './shared/TileStatusIcon'
import { LoadingCard } from './shared/LoadingCard'
import { formatDuration } from '@/lib/utils/tile-formatters'
import { useTranslation } from '@/lib/i18n/use-translation'
import { TILE_CARD_STYLES } from '@/lib/styles/tile-card-styles'
import { cn } from '@/lib/utils/cn'

interface TileCardCompactProps {
  tile: Tile | null
  loading?: boolean
  onStart?: (tileId: TileId) => void
  onClick?: (tile: Tile) => void
}

export function TileCardCompact({ tile, loading, onStart, onClick }: TileCardCompactProps) {
  const { locale } = useTranslation()

  if (loading) {
    return <LoadingCard variant="compact" />
  }

  if (!tile) {
    return null
  }

  const lifecycle = getTileLifecycle(tile)

  const handleStatusClick = () => {
    if (lifecycle === 'ready' && onStart) {
      onStart(tile.core.id)
    }
  }

  const handleCardClick = () => {
    if (onClick) {
      onClick(tile)
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "flex items-center gap-3",
        TILE_CARD_STYLES.base,
        TILE_CARD_STYLES.padding.compact,
        onClick && TILE_CARD_STYLES.hover,
        onClick && "cursor-pointer"
      )}
    >
      <TileStatusIcon
        lifecycle={lifecycle}
        onClick={lifecycle === 'ready' ? handleStatusClick : undefined}
        size={TILE_CARD_STYLES.statusIcon.size.compact}
      />

      <div className="flex-1 min-w-0">
        <h4 className={cn(
          "text-sm font-medium text-foreground truncate",
          lifecycle === 'done' && "line-through opacity-60"
        )}>
          {tile.core.title}
        </h4>
      </div>

      <div className="text-xs text-foreground-muted whitespace-nowrap">
        {formatDuration(tile.objective.targetWorkMin, locale)}
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/TileCardCompact.tsx
git commit -m "feat(tiles): add TileCardCompact component

- Single-line tile display
- Status icon + title + duration
- Click handler for card and status icon
- Used in sidebar and dashboard

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create TileCardExpandable component

**Files:**
- Create: `tastile-web/src/components/tiles/TileCardExpandable.tsx`

**Step 1: Create TileCardExpandable component**

```typescript
'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { getTileLifecycle, type Tile } from '@/lib/domain/tile'
import type { TileId } from '@/lib/domain/ids'
import { TileStatusIcon } from './shared/TileStatusIcon'
import { TileActionButtons } from './shared/TileActionButtons'
import { LoadingCard } from './shared/LoadingCard'
import { formatDuration } from '@/lib/utils/tile-formatters'
import { useTranslation } from '@/lib/i18n/use-translation'
import { TILE_CARD_STYLES } from '@/lib/styles/tile-card-styles'
import { cn } from '@/lib/utils/cn'

interface TileCardExpandableProps {
  tile: Tile | null
  loading?: boolean
  defaultExpanded?: boolean
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}

export function TileCardExpandable(props: TileCardExpandableProps) {
  const { tile, loading, defaultExpanded = false, ...actions } = props
  const { locale } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (loading) {
    return <LoadingCard variant="comfortable" />
  }

  if (!tile) {
    return null
  }

  const lifecycle = getTileLifecycle(tile)

  const handleStatusClick = () => {
    if (lifecycle === 'ready' && actions.onStart) {
      actions.onStart(tile.core.id)
    }
  }

  const handleCardClick = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div className={cn(TILE_CARD_STYLES.base)}>
      {/* Header - always visible */}
      <div
        onClick={handleCardClick}
        className={cn(
          "flex items-center gap-3",
          TILE_CARD_STYLES.padding.comfortable,
          "cursor-pointer",
          TILE_CARD_STYLES.hover
        )}
      >
        <TileStatusIcon
          lifecycle={lifecycle}
          onClick={(e) => {
            if (lifecycle === 'ready') {
              handleStatusClick()
            }
          }}
          size={TILE_CARD_STYLES.statusIcon.size.comfortable}
        />

        <div className="flex-1 min-w-0">
          <h4 className={cn(
            "text-sm font-semibold text-foreground",
            lifecycle === 'done' && "line-through opacity-60"
          )}>
            {tile.core.title}
          </h4>
        </div>

        <div className="text-xs text-foreground-muted whitespace-nowrap">
          {formatDuration(tile.objective.targetWorkMin, locale)}
        </div>

        <ChevronRight
          className={cn(
            "h-4 w-4 transition-transform text-foreground-muted",
            isExpanded && "rotate-90"
          )}
        />
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className={cn(
          "border-t border-surface-2 space-y-3",
          TILE_CARD_STYLES.padding.comfortable
        )}>
          {/* Next Action */}
          {tile.core.nextAction && (
            <p className="text-xs text-foreground-muted">
              {tile.core.nextAction}
            </p>
          )}

          {/* Labels */}
          {tile.annotation.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tile.annotation.labels.map(label => {
                const isProject = label.startsWith('project:')
                return (
                  <span
                    key={label}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded-full",
                      isProject
                        ? "bg-primary/10 text-primary font-medium"
                        : "bg-surface-2 text-foreground-muted"
                    )}
                  >
                    {isProject ? label.replace('project:', '') : `#${label}`}
                  </span>
                )
              })}
            </div>
          )}

          {/* Action Buttons */}
          <TileActionButtons
            tile={tile}
            variant="full"
            {...actions}
          />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/TileCardExpandable.tsx
git commit -m "feat(tiles): add TileCardExpandable component

- Click to expand/collapse
- Header: status + title + duration + chevron
- Expanded: nextAction, labels, full action buttons
- Used in Tiles list and Execute page

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Create TileCardDetailed component

**Files:**
- Create: `tastile-web/src/components/tiles/TileCardDetailed.tsx`

**Step 1: Create TileCardDetailed component**

```typescript
'use client'

import { getTileLifecycle, type Tile } from '@/lib/domain/tile'
import type { TileId } from '@/lib/domain/ids'
import { TileStatusIcon } from './shared/TileStatusIcon'
import { TileActionButtons } from './shared/TileActionButtons'
import { LoadingCard } from './shared/LoadingCard'
import { formatDuration, formatDateTime } from '@/lib/utils/tile-formatters'
import { useTranslation } from '@/lib/i18n/use-translation'
import { TILE_CARD_STYLES } from '@/lib/styles/tile-card-styles'
import { cn } from '@/lib/utils/cn'

interface TileCardDetailedProps {
  tile: Tile | null
  loading?: boolean
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}

export function TileCardDetailed(props: TileCardDetailedProps) {
  const { tile, loading, ...actions } = props
  const { t, locale } = useTranslation()

  if (loading) {
    return <LoadingCard variant="detailed" />
  }

  if (!tile) {
    return null
  }

  const lifecycle = getTileLifecycle(tile)

  const handleStatusClick = () => {
    if (lifecycle === 'ready' && actions.onStart) {
      actions.onStart(tile.core.id)
    }
  }

  return (
    <div className={cn(
      TILE_CARD_STYLES.base,
      TILE_CARD_STYLES.padding.detailed,
      "space-y-4"
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <TileStatusIcon
          lifecycle={lifecycle}
          onClick={handleStatusClick}
          size={TILE_CARD_STYLES.statusIcon.size.detailed}
        />

        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "text-base font-semibold text-foreground",
            lifecycle === 'done' && "line-through opacity-60"
          )}>
            {tile.core.title}
          </h3>

          {tile.core.nextAction && (
            <p className="mt-1 text-sm text-foreground-muted">
              {tile.core.nextAction}
            </p>
          )}
        </div>

        <div className="text-sm text-foreground-muted whitespace-nowrap">
          {formatDuration(tile.objective.targetWorkMin, locale)}
        </div>
      </div>

      {/* Done Definition */}
      {tile.core.doneDefinition && (
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-foreground-muted">
            <span className="font-medium">{t('tiles.doneDefinition')}:</span>{' '}
            {tile.core.doneDefinition}
          </p>
        </div>
      )}

      {/* Labels */}
      {tile.annotation.labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tile.annotation.labels.map(label => {
            const isProject = label.startsWith('project:')
            return (
              <span
                key={label}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-full",
                  isProject
                    ? "bg-primary/10 text-primary font-medium"
                    : "bg-surface-2 text-foreground-muted"
                )}
              >
                {isProject ? label.replace('project:', '') : `#${label}`}
              </span>
            )
          })}
        </div>
      )}

      {/* Time Information */}
      {(tile.temporal.fixedStart || tile.temporal.fixedEnd) && (
        <div className="space-y-1 text-xs text-foreground-muted">
          {tile.temporal.fixedStart && (
            <div>
              <span className="opacity-60">{t('tiles.startAt')}:</span>{' '}
              {formatDateTime(tile.temporal.fixedStart, locale)}
            </div>
          )}
          {tile.temporal.fixedEnd && (
            <div>
              <span className="opacity-60">{t('tiles.endAt')}:</span>{' '}
              {formatDateTime(tile.temporal.fixedEnd, locale)}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="pt-2 border-t border-surface-2">
        <TileActionButtons
          tile={tile}
          variant="full"
          {...actions}
        />
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/tiles/TileCardDetailed.tsx
git commit -m "feat(tiles): add TileCardDetailed component

- Always-expanded detailed display
- Shows: title, nextAction, doneDefinition, labels, time info
- Full action buttons always visible
- Used for detailed tile view

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Replace NextTileCard with TileCardCompact

**Files:**
- Modify: `tastile-web/src/components/layout/RightSidebar.tsx:1-47`

**Step 1: Update import and usage**

Replace:
```typescript
import { NextTileCard } from '@/components/tiles/NextTileCard'
```

With:
```typescript
import { TileCardCompact } from '@/components/tiles/TileCardCompact'
```

Replace:
```typescript
<NextTileCard tile={nextTile} reason={nextReason} onStart={onStartSuggested} loading={loading} />
```

With:
```typescript
<TileCardCompact tile={nextTile} onStart={onStartSuggested} loading={loading} />
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/components/layout/RightSidebar.tsx
git commit -m "refactor(sidebar): replace NextTileCard with TileCardCompact

- Use new unified tile card system
- Remove reason prop (not needed in compact view)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Update Tiles page to use TileCardExpandable

**Files:**
- Modify: `tastile-web/src/app/dashboard/tiles/page.tsx:1-68`

**Step 1: Replace inline card with TileCardExpandable**

Replace entire file content:

```typescript
'use client'

import { useExecutionEngine } from '@/lib/hooks/use-execution-engine'
import { TileCardExpandable } from '@/components/tiles/TileCardExpandable'
import { Actor } from '@/lib/domain/actor'

export default function TilesPage() {
  const { state, loading, execute } = useExecutionEngine()

  async function handleStart(tileId: string) {
    await execute(
      { type: 'start_tile', tile_id: tileId, started_at: new Date(), source: 'manual' },
      Actor.human('self')
    )
  }

  async function handleComplete(tileId: string) {
    await execute(
      { type: 'complete_tile', tile_id: tileId, completed_at: new Date(), next_tile_id: null },
      Actor.human('self')
    )
  }

  if (loading) return <p className="text-zinc-500 dark:text-zinc-400">Loading...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Tiles</h1>
      <div className="space-y-2">
        {Array.from(state.tiles.values()).map(tile => (
          <TileCardExpandable
            key={tile.core.id}
            tile={tile}
            onStart={handleStart}
            onComplete={handleComplete}
            onDefer={(id) => console.log('Defer', id)}
            onInterrupt={(id) => console.log('Interrupt', id)}
            onEdit={(id) => console.log('Edit', id)}
            onDelete={(id) => console.log('Delete', id)}
          />
        ))}
      </div>
      {state.tiles.size === 0 ? (
        <p className="text-sm text-foreground-muted">No tiles yet. Use Cmd/Ctrl+N to create one.</p>
      ) : null}
    </div>
  )
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/app/dashboard/tiles/page.tsx
git commit -m "refactor(tiles): use TileCardExpandable in tiles list

- Replace inline card implementation
- Add placeholder handlers for defer/interrupt/edit/delete
- Cleaner expandable card UI

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Update Execute page to use TileCardExpandable

**Files:**
- Modify: `tastile-web/src/app/dashboard/execute/page.tsx:80-100`

**Step 1: Replace inline card with TileCardExpandable in Ready Tiles section**

Replace the inline tile rendering (lines 80-100):

```typescript
<div className="space-y-2">
  {Array.from(state.tiles.values())
    .filter(tile => getTileLifecycle(tile) !== 'done')
    .map(tile => (
      <TileCardExpandable
        key={tile.core.id}
        tile={tile}
        defaultExpanded={false}
        onStart={startTile}
        onComplete={completeActive}
        onDefer={(id) => console.log('Defer', id)}
        onInterrupt={(id) => console.log('Interrupt', id)}
        onEdit={(id) => console.log('Edit', id)}
        onDelete={(id) => console.log('Delete', id)}
      />
    ))}
  {state.tiles.size === 0 ? (
    <p className="text-sm text-foreground-muted">No tiles yet. Create one with Cmd/Ctrl+N.</p>
  ) : null}
</div>
```

Add import at top:
```typescript
import { TileCardExpandable } from '@/components/tiles/TileCardExpandable'
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/app/dashboard/execute/page.tsx
git commit -m "refactor(execute): use TileCardExpandable for ready tiles

- Replace inline implementation with expandable cards
- Add placeholder handlers for actions
- Consistent UI with tiles page

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria Verification

**Step 1: Visual inspection**

Start dev server: `cd tastile-web && npm run dev`
Navigate to:
- `/dashboard/execute` - verify RightSidebar shows compact card, Ready Tiles show expandable cards
- `/dashboard/tiles` - verify expandable cards work

**Step 2: Test status icon clicks**

Click status icons on ready tiles - verify console logs (dialogs will be added in phase 2)

**Step 3: Test expand/collapse**

Click expandable cards to expand/collapse - verify smooth animation

**Step 4: Test i18n**

Switch language in settings - verify all labels translate correctly

---

## Next Steps (Phase 2)

After this plan is complete:
1. Implement dialogs (StartTileDialog, DeferTileDialog, DeleteTileDialog)
2. Wire up defer/interrupt/edit/delete handlers properly
3. Add proper dialog state management with Zustand
4. Connect edit action to QuickTileCreate panel
