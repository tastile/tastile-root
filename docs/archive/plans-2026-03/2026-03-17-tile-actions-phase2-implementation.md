# Tile Card Actions Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement functional tile action handlers (defer, interrupt, delete) and required dialogs to complete the tile card system.

**Architecture:** Add new commands to the Command/Event/Reducer system for defer and delete operations. Implement DeferTileDialog for time selection. Wire up action handlers in Tiles and Execute pages to dispatch actual commands instead of console.log placeholders.

**Tech Stack:** React 19, TypeScript, Zustand (dialog state), Tailwind CSS v4, Command/Event/Reducer pattern

---

## Context

Phase 1 completed all tile card UI components with placeholder action handlers:
- TileCardCompact, TileCardExpandable, TileCardDetailed ✅
- TileStatusIcon, TileActionButtons ✅
- Currently: defer/interrupt/edit/delete log to console

Phase 2 objectives:
- Add commands: `defer_tile`, `delete_tile`
- Add events: `TileDeferred`, `TileDeleted`
- Implement DeferTileDialog for scheduling
- Wire up real handlers in pages
- Note: `interrupt` is essentially `defer` + new task creation (deferred to later)
- Note: `edit` opens QuickTileCreate panel (separate feature)

---

## Task 1: Add defer_tile and delete_tile commands

**Files:**
- Modify: `tastile-web/src/lib/core/command.ts:4-21`
- Modify: `tastile-web/src/lib/core/event.ts` (add corresponding events)

**Step 1: Read current command.ts structure**

Verify existing commands: `create_tile`, `start_tile`, `complete_tile`

**Step 2: Add defer_tile and delete_tile command types**

In `tastile-web/src/lib/core/command.ts`, add to Command union:

```typescript
export type Command =
  | {
      type: 'create_tile'
      tile_id: TileId
      tile: Tile
    }
  | {
      type: 'start_tile'
      tile_id: TileId
      started_at: Date
      source: StartSource
    }
  | {
      type: 'complete_tile'
      tile_id: TileId
      completed_at: Date
      next_tile_id: TileId | null
    }
  | {
      type: 'defer_tile'
      tile_id: TileId
      deferred_at: Date
      next_start_at: Date | null
    }
  | {
      type: 'delete_tile'
      tile_id: TileId
      deleted_at: Date
    }
```

**Step 3: Add corresponding events to event.ts**

Read `tastile-web/src/lib/core/event.ts` and add:

```typescript
  | {
      type: 'TileDeferred'
      tile_id: TileId
      deferred_at: Date
      next_start_at: Date | null
    }
  | {
      type: 'TileDeleted'
      tile_id: TileId
      deleted_at: Date
    }
```

**Step 4: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors (reducers will be updated in next task)

**Step 5: Commit**

```bash
git add tastile-web/src/lib/core/command.ts tastile-web/src/lib/core/event.ts
git commit -m "feat(core): add defer_tile and delete_tile commands

- Add defer_tile command with next_start_at scheduling
- Add delete_tile command for tile removal
- Add TileDeferred and TileDeleted events

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Implement command handlers for defer and delete

**Files:**
- Modify: `tastile-web/src/lib/core/handler.ts` (add defer/delete handlers)

**Step 1: Read current handler.ts structure**

Understand existing handler pattern for `start_tile` and `complete_tile`

**Step 2: Add handleDeferTile function**

```typescript
function handleDeferTile(command: Extract<Command, { type: 'defer_tile' }>, state: AppState): Event[] {
  const tile = state.tiles.get(command.tile_id)
  if (!tile) {
    throw new Error(`Tile ${command.tile_id} not found`)
  }

  // Validation: Can't defer a completed tile
  if (tile.core.completedAt !== null) {
    throw new Error(`Cannot defer completed tile ${command.tile_id}`)
  }

  return [
    {
      type: 'TileDeferred',
      tile_id: command.tile_id,
      deferred_at: command.deferred_at,
      next_start_at: command.next_start_at,
    },
  ]
}
```

**Step 3: Add handleDeleteTile function**

```typescript
function handleDeleteTile(command: Extract<Command, { type: 'delete_tile' }>, state: AppState): Event[] {
  const tile = state.tiles.get(command.tile_id)
  if (!tile) {
    throw new Error(`Tile ${command.tile_id} not found`)
  }

  // Can delete any tile (no restrictions)

  return [
    {
      type: 'TileDeleted',
      tile_id: command.tile_id,
      deleted_at: command.deleted_at,
    },
  ]
}
```

**Step 4: Add cases to main handler switch**

In the main `handleCommand` function, add:

```typescript
case 'defer_tile':
  return handleDeferTile(command, state)
case 'delete_tile':
  return handleDeleteTile(command, state)
```

**Step 5: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add tastile-web/src/lib/core/handler.ts
git commit -m "feat(core): implement defer and delete command handlers

- handleDeferTile: validates tile exists and not completed
- handleDeleteTile: no restrictions, allows any tile deletion
- Both generate corresponding events

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Implement event reducers for defer and delete

**Files:**
- Modify: `tastile-web/src/lib/core/reducer/index.ts` (add event reducers)

**Step 1: Read current reducer structure**

Understand how `TileStarted` and `TileCompleted` events update state

**Step 2: Add TileDeferred reducer**

```typescript
function reduceTileDeferred(state: AppState, event: Extract<Event, { type: 'TileDeferred' }>): void {
  const tile = state.tiles.get(event.tile_id)
  if (!tile) return

  // Update temporal.fixedStart with next_start_at
  if (event.next_start_at) {
    tile.temporal.fixedStart = event.next_start_at
  }

  // If tile was started, mark as not started (deferred while in progress)
  if (tile.core.startedAt !== null) {
    tile.core.startedAt = null
  }

  // Note: We don't remove from execution.activeTileId here
  // That should be handled by an interrupt flow if needed
}
```

**Step 3: Add TileDeleted reducer**

```typescript
function reduceTileDeleted(state: AppState, event: Extract<Event, { type: 'TileDeleted' }>): void {
  // Remove tile from state
  state.tiles.delete(event.tile_id)

  // If this was the active tile, clear execution state
  if (state.execution.activeTileId === event.tile_id) {
    state.execution.activeTileId = null
    state.execution.phaseKind = 'idle'
    state.execution.phaseStartedAt = null
    state.execution.phaseEndsAt = null
  }
}
```

**Step 4: Add cases to main reducer switch**

In the main `reduce` function, add:

```typescript
case 'TileDeferred':
  reduceTileDeferred(state, event)
  break
case 'TileDeleted':
  reduceTileDeleted(state, event)
  break
```

**Step 5: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add tastile-web/src/lib/core/reducer/index.ts
git commit -m "feat(core): implement defer and delete event reducers

- TileDeferred: updates fixedStart, clears startedAt if in progress
- TileDeleted: removes tile from state, clears execution if active
- Both maintain state consistency

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create dialog state management with Zustand

**Files:**
- Create: `tastile-web/src/lib/stores/dialog-store.ts`

**Step 1: Create dialog store**

```typescript
import { create } from 'zustand'
import type { Tile } from '../domain/tile'

interface DialogState {
  deferDialog: {
    open: boolean
    tile: Tile | null
    mode: 'defer' | 'interrupt'
  }
  deleteDialog: {
    open: boolean
    tile: Tile | null
  }
  openDeferDialog: (tile: Tile, mode: 'defer' | 'interrupt') => void
  closeDeferDialog: () => void
  openDeleteDialog: (tile: Tile) => void
  closeDeleteDialog: () => void
}

export const useDialogStore = create<DialogState>((set) => ({
  deferDialog: {
    open: false,
    tile: null,
    mode: 'defer',
  },
  deleteDialog: {
    open: false,
    tile: null,
  },
  openDeferDialog: (tile, mode) =>
    set({
      deferDialog: {
        open: true,
        tile,
        mode,
      },
    }),
  closeDeferDialog: () =>
    set({
      deferDialog: {
        open: false,
        tile: null,
        mode: 'defer',
      },
    }),
  openDeleteDialog: (tile) =>
    set({
      deleteDialog: {
        open: true,
        tile,
      },
    }),
  closeDeleteDialog: () =>
    set({
      deleteDialog: {
        open: false,
        tile: null,
      },
    }),
}))
```

**Step 2: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add tastile-web/src/lib/stores/dialog-store.ts
git commit -m "feat(stores): add dialog state management with Zustand

- Dialog state for defer and delete operations
- Typed actions for opening/closing dialogs
- Stores tile reference and mode (defer/interrupt)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create DeferTileDialog component

**Files:**
- Create: `tastile-web/src/components/tiles/dialogs/DeferTileDialog.tsx`

**Step 1: Create dialog component**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/use-translation'
import { useDialogStore } from '@/lib/stores/dialog-store'
import { getCurrentLocalDate, getCurrentLocalTime, parseDateTimeParts } from '@/lib/utils/tile-formatters'
import { cn } from '@/lib/utils/cn'

interface DeferTileDialogProps {
  onConfirm: (tileId: string, nextStartAt: Date) => void
}

export function DeferTileDialog({ onConfirm }: DeferTileDialogProps) {
  const { t } = useTranslation()
  const { deferDialog, closeDeferDialog } = useDialogStore()
  const [datePart, setDatePart] = useState('')
  const [timePart, setTimePart] = useState('')

  // Initialize with current date/time when dialog opens
  useEffect(() => {
    if (deferDialog.open) {
      setDatePart(getCurrentLocalDate())
      setTimePart(getCurrentLocalTime())
    }
  }, [deferDialog.open])

  if (!deferDialog.open || !deferDialog.tile) return null

  const handleConfirm = () => {
    const nextStartAt = parseDateTimeParts(datePart, timePart)
    if (!nextStartAt) {
      alert('Invalid date/time')
      return
    }

    onConfirm(deferDialog.tile.core.id, nextStartAt)
    closeDeferDialog()
  }

  const handleCancel = () => {
    closeDeferDialog()
  }

  const title = deferDialog.mode === 'defer' ? t('tiles.dialogs.deferTitle') : t('tiles.dialogs.interruptTitle')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleCancel}>
      <div
        className="w-full max-w-md rounded-xl bg-surface-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg p-1 text-foreground-muted hover:bg-surface-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tile info */}
        <div className="mb-4">
          <p className="text-sm text-foreground">{deferDialog.tile.core.title}</p>
          {deferDialog.tile.core.nextAction && (
            <p className="mt-1 text-xs text-foreground-muted">{deferDialog.tile.core.nextAction}</p>
          )}
        </div>

        {/* Date/Time inputs */}
        <div className="mb-6 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-foreground-muted">{t('tiles.dialogs.nextStartAt')}</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={datePart}
                onChange={(e) => setDatePart(e.target.value)}
                className="flex-1 rounded-lg border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-foreground"
              />
              <input
                type="time"
                value={timePart}
                onChange={(e) => setTimePart(e.target.value)}
                className="flex-1 rounded-lg border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-1"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary/90"
          >
            {t('common.confirm')}
          </button>
        </div>
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
git add tastile-web/src/components/tiles/dialogs/DeferTileDialog.tsx
git commit -m "feat(tiles): add DeferTileDialog component

- Date/time picker for scheduling deferred tiles
- Supports both defer and interrupt modes
- Uses Zustand dialog store for state management
- Accessible modal with backdrop click to close

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create DeleteTileDialog component

**Files:**
- Create: `tastile-web/src/components/tiles/dialogs/DeleteTileDialog.tsx`

**Step 1: Create dialog component**

```typescript
'use client'

import { X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/use-translation'
import { useDialogStore } from '@/lib/stores/dialog-store'

interface DeleteTileDialogProps {
  onConfirm: (tileId: string) => void
}

export function DeleteTileDialog({ onConfirm }: DeleteTileDialogProps) {
  const { t } = useTranslation()
  const { deleteDialog, closeDeleteDialog } = useDialogStore()

  if (!deleteDialog.open || !deleteDialog.tile) return null

  const handleConfirm = () => {
    onConfirm(deleteDialog.tile.core.id)
    closeDeleteDialog()
  }

  const handleCancel = () => {
    closeDeleteDialog()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleCancel}>
      <div
        className="w-full max-w-md rounded-xl bg-surface-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t('tiles.actions.delete')}</h2>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg p-1 text-foreground-muted hover:bg-surface-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Confirmation message */}
        <div className="mb-6">
          <p className="text-sm text-foreground">{t('tiles.dialogs.deleteConfirm')}</p>
          <p className="mt-2 text-sm font-medium text-foreground">{deleteDialog.tile.core.title}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-1"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t('common.delete')}
          </button>
        </div>
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
git add tastile-web/src/components/tiles/dialogs/DeleteTileDialog.tsx
git commit -m "feat(tiles): add DeleteTileDialog component

- Confirmation dialog for tile deletion
- Shows tile title for verification
- Red destructive action button
- Uses Zustand dialog store

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Wire up action handlers in Tiles page

**Files:**
- Modify: `tastile-web/src/app/dashboard/tiles/page.tsx`

**Step 1: Read current page implementation**

Verify placeholder handlers: `console.log('Defer', id)`, etc.

**Step 2: Add dialog imports and store**

At top of file:

```typescript
import { useDialogStore } from '@/lib/stores/dialog-store'
import { DeferTileDialog } from '@/components/tiles/dialogs/DeferTileDialog'
import { DeleteTileDialog } from '@/components/tiles/dialogs/DeleteTileDialog'
```

**Step 3: Replace placeholder handlers**

Inside `TilesPage` component, replace console.log handlers:

```typescript
const { openDeferDialog, openDeleteDialog } = useDialogStore()

async function handleDefer(tileId: string) {
  const tile = state.tiles.get(tileId)
  if (!tile) return
  openDeferDialog(tile, 'defer')
}

async function handleInterrupt(tileId: string) {
  const tile = state.tiles.get(tileId)
  if (!tile) return
  openDeferDialog(tile, 'interrupt')
}

async function handleDeferConfirm(tileId: string, nextStartAt: Date) {
  await execute(
    { type: 'defer_tile', tile_id: tileId, deferred_at: new Date(), next_start_at: nextStartAt },
    Actor.human('self')
  )
}

async function handleDelete(tileId: string) {
  const tile = state.tiles.get(tileId)
  if (!tile) return
  openDeleteDialog(tile)
}

async function handleDeleteConfirm(tileId: string) {
  await execute(
    { type: 'delete_tile', tile_id: tileId, deleted_at: new Date() },
    Actor.human('self')
  )
}
```

**Step 4: Update TileCardExpandable props**

Replace:

```typescript
onDefer={(id) => console.log('Defer', id)}
onInterrupt={(id) => console.log('Interrupt', id)}
onEdit={(id) => console.log('Edit', id)}
onDelete={(id) => console.log('Delete', id)}
```

With:

```typescript
onDefer={handleDefer}
onInterrupt={handleInterrupt}
onEdit={(id) => console.log('Edit', id)} // Keep placeholder for now
onDelete={handleDelete}
```

**Step 5: Add dialogs to JSX**

At the end of the return statement, before closing `</div>`:

```typescript
{/* Dialogs */}
<DeferTileDialog onConfirm={handleDeferConfirm} />
<DeleteTileDialog onConfirm={handleDeleteConfirm} />
```

**Step 6: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 7: Commit**

```bash
git add tastile-web/src/app/dashboard/tiles/page.tsx
git commit -m "feat(tiles): wire up defer and delete action handlers

- Replace console.log placeholders with real handlers
- Open dialogs for defer/interrupt/delete actions
- Dispatch commands to execution engine
- Add dialog components to page

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Wire up action handlers in Execute page

**Files:**
- Modify: `tastile-web/src/app/dashboard/execute/page.tsx`

**Step 1: Add same imports as Tiles page**

```typescript
import { useDialogStore } from '@/lib/stores/dialog-store'
import { DeferTileDialog } from '@/components/tiles/dialogs/DeferTileDialog'
import { DeleteTileDialog } from '@/components/tiles/dialogs/DeleteTileDialog'
```

**Step 2: Add same handlers as Tiles page**

Copy the handlers from Task 7 (handleDefer, handleInterrupt, handleDeferConfirm, handleDelete, handleDeleteConfirm)

**Step 3: Update TileCardExpandable props**

Replace placeholder handlers in the Ready Tiles section

**Step 4: Add dialogs to JSX**

Add at end of return statement before closing `</div>`

**Step 5: Verify TypeScript compilation**

Run: `cd tastile-web && npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add tastile-web/src/app/dashboard/execute/page.tsx
git commit -m "feat(execute): wire up defer and delete action handlers

- Replace console.log placeholders with real handlers
- Consistent with Tiles page implementation
- Add dialog components to page

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add delete button translation

**Files:**
- Modify: `tastile-web/src/lib/i18n/translations.ts`

**Step 1: Verify common.delete exists**

Check if `common.delete` translation exists. If not, add:

```typescript
// In common section
delete: '削除',  // ja
delete: 'Delete', // en
```

**Step 2: Verify common.confirm and common.cancel exist**

Check if these exist. If not, add them.

**Step 3: Commit if changes made**

```bash
git add tastile-web/src/lib/i18n/translations.ts
git commit -m "feat(i18n): add common action translations

- Add confirm/cancel/delete if missing
- Used by dialog components

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria

After all tasks complete:

1. **Commands dispatched:** defer_tile and delete_tile commands successfully dispatch
2. **State updates:** Tiles are deferred with scheduled time, deleted tiles removed from state
3. **Dialogs work:** DeferTileDialog and DeleteTileDialog open and close correctly
4. **UI updates:** Tiles page and Execute page reflect state changes immediately
5. **No console errors:** All TypeScript types resolve correctly

---

## Testing Checklist

Manual testing steps:

1. **Defer a ready tile:**
   - Open Tiles page
   - Expand a tile
   - Click "Defer" button
   - Select future date/time in dialog
   - Confirm
   - Verify tile's fixedStart updates

2. **Delete a tile:**
   - Click "Delete" button on any tile
   - Confirm in dialog
   - Verify tile disappears from list

3. **Interrupt a started tile:**
   - Start a tile in Execute page
   - Click "Interrupt" in expanded view
   - Schedule next start time
   - Verify tile returns to ready state with scheduled time

4. **Edge cases:**
   - Try to defer/delete non-existent tile (should error gracefully)
   - Cancel dialogs (should close without action)
   - Invalid date/time in defer dialog (should show alert)

---

## Next Steps (Future Work)

After Phase 2 complete:

1. **Interrupt with new task:** Currently interrupt only defers. Implement task splitting (create continuation tile)
2. **Edit action:** Wire up edit button to open QuickTileCreate panel with tile data
3. **Delete cleanup:** Remove deleted tile from Supabase (currently only local state)
4. **Undo/Redo:** Add command history for undoing defer/delete actions
5. **Optimistic updates:** Show UI changes before command completes
6. **Error handling:** Show toast notifications for command failures

---

## Rollback Plan

If issues arise:

```bash
# Revert all Phase 2 changes
git log --oneline --grep="Phase 2"
git revert <commit-range>

# Or revert specific task
git revert <task-commit-sha>
```

Individual components are independent - can revert specific tasks without breaking others.
