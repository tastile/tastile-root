# Phase 1: Tile List (Read-Only) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display actual tiles from Supabase on `/dashboard/tiles` page, replacing mock data.

**Architecture:** Minimal domain model (Tile with core fields only), server-side data fetching from Supabase, display in React Server Component. No Command/Event/Reducer yet - just read path.

**Tech Stack:** Next.js 15 App Router (RSC), Supabase Client, TypeScript

---

## Task 1: Create Minimal Tile Domain Type

**Files:**
- Create: `tastile-web/src/lib/domain/tile.ts`
- Create: `tastile-web/src/lib/domain/ids.ts`

**Step 1: Create branded ID types**

```typescript
// tastile-web/src/lib/domain/ids.ts
export type TileId = string & { readonly __brand: 'TileId' }
export type UserId = string & { readonly __brand: 'UserId' }

export function createTileId(id: string): TileId {
  return id as TileId
}

export function createUserId(id: string): UserId {
  return id as UserId
}
```

**Step 2: Create minimal Tile type**

```typescript
// tastile-web/src/lib/domain/tile.ts
import { TileId } from './ids'

export interface TileCore {
  id: TileId
  title: string
  nextAction: string | null
  doneDefinition: string | null
}

export interface Tile {
  core: TileCore
}

// Helper to derive lifecycle state (NO stored status field!)
export function getTileLifecycle(tile: Tile): 'ready' | 'started' | 'done' {
  // For Phase 1, we don't have startedAt/completedAt yet
  // So all tiles are 'ready'
  return 'ready'
}
```

**Step 3: Commit**

```bash
git add src/lib/domain/tile.ts src/lib/domain/ids.ts
git commit -m "feat(domain): add minimal Tile type for Phase 1

- Branded TileId type
- TileCore with id, title, nextAction, doneDefinition
- No status field (will be derived later)
- getTileLifecycle() helper for future use

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Tile Repository (Supabase Read)

**Files:**
- Create: `tastile-web/src/lib/storage/tile-repository.ts`

**Step 1: Create repository with read method**

```typescript
// tastile-web/src/lib/storage/tile-repository.ts
import { SupabaseClient } from '@supabase/supabase-js'
import { Tile, TileCore } from '../domain/tile'
import { createTileId } from '../domain/ids'

export class TileRepository {
  constructor(private supabase: SupabaseClient) {}

  async listTiles(userId: string): Promise<Tile[]> {
    const { data, error } = await this.supabase
      .from('tiles')
      .select('id, local_tile_id, title, next_action, done_definition')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to load tiles: ${error.message}`)
    }

    return (data || []).map(row => this.deserialize(row))
  }

  private deserialize(row: any): Tile {
    const core: TileCore = {
      id: createTileId(row.local_tile_id),
      title: row.title,
      nextAction: row.next_action || null,
      doneDefinition: row.done_definition || null,
    }

    return { core }
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/storage/tile-repository.ts
git commit -m "feat(storage): add TileRepository for Supabase reads

- listTiles(userId) method
- Deserialize DB rows to Tile domain type
- Filter out soft-deleted tiles
- Order by created_at desc

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Tiles Page to Use Real Data

**Files:**
- Modify: `tastile-web/src/app/dashboard/tiles/page.tsx`

**Step 1: Make page async and fetch tiles**

```typescript
// tastile-web/src/app/dashboard/tiles/page.tsx
import { createClient } from '@/lib/supabase/server'
import { TileRepository } from '@/lib/storage/tile-repository'

export default async function TilesPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Tiles</h1>
        <p className="mt-2 text-red-600">認証が必要です</p>
      </div>
    )
  }

  // Fetch tiles
  const repository = new TileRepository(supabase)
  const tiles = await repository.listTiles(user.id)

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Tiles</h1>
      <p className="mt-2 text-zinc-600">
        タイル一覧管理 - {tiles.length} tiles
      </p>

      {tiles.length === 0 ? (
        <div className="mt-8 p-6 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-center">
          <p className="text-zinc-500">タイルがありません</p>
          <p className="text-sm text-zinc-400 mt-1">Create your first tile to get started</p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {tiles.map(tile => (
            <div
              key={tile.core.id}
              className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm"
            >
              <h3 className="font-semibold text-lg">{tile.core.title}</h3>
              {tile.core.nextAction && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  次: {tile.core.nextAction}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Test in browser**

1. Start dev server: `cd tastile-web && bun dev`
2. Navigate to `http://localhost:3000/dashboard/tiles`
3. Expected:
   - If no tiles in DB: "タイルがありません" message
   - If tiles exist: List of tiles with title and nextAction

**Step 3: Commit**

```bash
git add src/app/dashboard/tiles/page.tsx
git commit -m "feat(dashboard): connect tiles page to real Supabase data

- Async Server Component
- Fetch tiles via TileRepository
- Display tile list with title and nextAction
- Empty state message

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Manual Test Tile (Optional)

**Purpose:** Insert a test tile directly into Supabase to verify display works.

**Step 1: Insert test tile via Supabase Dashboard or SQL**

Go to Supabase Dashboard → SQL Editor → Run:

```sql
INSERT INTO public.tiles (
  user_id,
  local_tile_id,
  title,
  next_action,
  done_definition
) VALUES (
  (SELECT id FROM auth.users LIMIT 1),
  'test-tile-1',
  'Test Tile',
  'Verify display works',
  'Tile appears on /dashboard/tiles'
);
```

**Step 2: Refresh browser**

Expected: Test tile appears in list

**Step 3: Document**

No commit needed - this is just manual verification.

---

## Task 5: Remove Mock Data Dependencies

**Files:**
- Check: All files importing from `@/lib/mock-data`
- Modify: Any components using `mockTiles`

**Step 1: Search for mock data imports**

```bash
cd tastile-web
grep -r "from '@/lib/mock-data'" src/
grep -r "mockTiles" src/
```

**Step 2: Verify tiles page doesn't import mock data**

Expected: No imports of mock-data in tiles page

**Step 3: Commit cleanup (if any changes)**

If you removed any mock imports:

```bash
git add <modified-files>
git commit -m "refactor(dashboard): remove mock data from tiles page

Phase 1 complete - tiles page now uses real Supabase data

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Validation Checklist

**Before moving to Phase 2, verify:**

- ✅ `/dashboard/tiles` displays tiles from Supabase
- ✅ Empty state shows when no tiles exist
- ✅ Tile title and nextAction display correctly
- ✅ No mock data imports in tiles page
- ✅ Page works after browser refresh (server-side fetch)
- ✅ TypeScript compiles with no errors
- ✅ All changes committed to git

**Test Commands:**

```bash
# Type check
cd tastile-web && npx tsc --noEmit

# Build check
bun run build

# Dev server
bun dev
```

---

## Phase 1 Complete

**What we built:**
- Minimal Tile domain type (core fields only)
- TileRepository for Supabase reads
- Real data display on `/dashboard/tiles`

**What we deferred:**
- startedAt/completedAt fields (Phase 3)
- Full 7-layer condition model (later)
- Command/Event/Reducer (Phase 2+)
- Event sourcing (Phase 2+)

**Next:** Phase 2 - Tile Creation with Command/Event pattern
