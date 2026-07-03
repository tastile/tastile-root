# Tastile Web - Functional Implementation Plan

**Date:** 2026-03-16
**Approach:** Feature-by-feature incremental implementation
**Goal:** Connect UI to real data progressively, not build entire core upfront

---

## Philosophy

Instead of implementing the entire Command/Event/Reducer architecture before connecting to UI, we implement **minimal core for each feature**, validate it works with UI, then move to the next feature.

This approach:
- Provides visible progress at each step
- Allows early validation
- Reduces risk of over-engineering unused parts
- Maintains architectural integrity while staying pragmatic

---

## Phase 1: Tile List (Read-Only)

### Goal
Display actual tiles from Supabase, replacing mock data.

### Minimal Domain Model
```typescript
// Simplified Tile - just enough for display
interface TileCore {
  id: string
  title: string
  nextAction: string | null
}

interface Tile {
  core: TileCore
}
```

### Implementation
1. Create `src/lib/domain/tile.ts` with minimal Tile type
2. Create `src/lib/storage/tile-repository.ts` for Supabase read
3. Update `/dashboard/tiles/page.tsx` to fetch real tiles
4. Remove mock data dependencies

### Success Criteria
- `/dashboard/tiles` shows tiles from Supabase `tiles` table
- No mock data imports
- Read-only, no mutations yet

---

## Phase 2: Tile Creation

### Goal
Create tiles through UI and persist to Supabase using Command/Event pattern.

### Core Implementation Needed
```typescript
// Command
interface CreateTileCommand {
  tileId: string
  title: string
  nextAction?: string
}

// Event
interface TileCreatedEvent {
  tileId: string
  tile: Tile
  occurredAt: string
}

// Minimal AppState
interface AppState {
  tiles: Map<string, Tile>
}
```

### Implementation
1. Create `src/lib/core/command.ts` - CreateTile command type
2. Create `src/lib/core/event.ts` - TileCreated event type
3. Create `src/lib/core/state.ts` - AppState with tiles map
4. Create `src/lib/core/handler.ts` - handle CreateTile → generate TileCreated
5. Create `src/lib/core/reducer/tile-reducer.ts` - apply TileCreated to AppState
6. Update `EventStore.append()` to persist events
7. Connect `QuickTileCreate` component to execute CreateTile command
8. Update `use-execution-engine` hook to replay events on load

### Success Criteria
- Can create tile through UI
- Event persisted to Supabase `events` table
- Tile appears in list immediately
- Page refresh shows same tiles (event replay works)

---

## Phase 3: Tile Execution (Start/Complete)

### Goal
Start and complete tiles, showing active execution state.

### Domain Expansion
```typescript
// Add lifecycle to Tile
interface TileCore {
  id: string
  title: string
  nextAction: string | null
  startedAt: string | null  // NEW
  completedAt: string | null // NEW
}

// Add Execution state
interface Execution {
  activeTileId: string | null
  phaseKind: 'work' | 'break' | 'idle'
  phaseStartedAt: string | null
}

interface AppState {
  tiles: Map<string, Tile>
  execution: Execution  // NEW
}
```

### Commands & Events
```typescript
// Commands
interface StartTileCommand {
  tileId: string
  startedAt?: string
}

interface CompleteTileCommand {
  tileId: string
  completedAt?: string
}

// Events
interface TileStartedEvent {
  tileId: string
  startedAt: string
}

interface TileCompletedEvent {
  tileId: string
  completedAt: string
}
```

### Implementation
1. Add StartTile/CompleteTile commands
2. Add TileStarted/TileCompleted events
3. Create `src/lib/core/reducer/execution-reducer.ts`
4. Add validation: can't start completed tile, can't have 2 active tiles
5. Connect `ActiveExecutionBar` to `execution.activeTileId`
6. Add start/complete buttons to UI

### Success Criteria
- Can start a tile → becomes active, shows in ActiveExecutionBar
- Can complete active tile → no longer active
- Only 1 tile can be active at a time
- Lifecycle derived correctly: ready → started → done

---

## Phase 4: Timeline (Work Segments)

### Goal
Record and display execution history as work segments.

### Domain Expansion
```typescript
interface Segment {
  id: string
  startAt: string
  endAt: string | null
  mode: 'work' | 'break'
  sourceTileId: string
}

interface WorkFacts {
  segments: Segment[]
}

interface Tile {
  core: TileCore
  work: WorkFacts  // NEW
}
```

### Events
```typescript
interface SegmentStartedEvent {
  segmentId: string
  tileId: string
  mode: 'work' | 'break'
  startedAt: string
}

interface SegmentEndedEvent {
  segmentId: string
  tileId: string
  endedAt: string
}
```

### Implementation
1. Modify StartTile → also emit SegmentStarted(work)
2. Modify CompleteTile → also emit SegmentEnded
3. Add segment reducer logic
4. Create projection: `buildTimelineView(appState)` → timeline data
5. Connect `TimelineView` to real segments

### Success Criteria
- Starting tile creates work segment
- Completing tile closes segment
- Timeline shows actual work history
- Can see duration of past work segments

---

## Phase 5: Next Tile Suggestion (Simple JIT)

### Goal
System suggests next tile to work on.

### Simple Algorithm
```typescript
function selectNextTile(state: AppState, now: Date): Tile | null {
  // Simple scoring:
  // - Not completed
  // - Not currently active
  // - Has nextAction defined
  // - Highest priority: most recently started but not completed
  // - Fallback: any ready tile
}
```

### Implementation
1. Create `src/lib/scheduler/simple-jit.ts`
2. Connect `NextTileCard` to call `selectNextTile()`
3. Display suggestion with reason

### Success Criteria
- After completing a tile, system suggests next
- Suggestion appears in NextTileCard
- Clicking suggestion starts that tile

---

## Phase 6+: Future Enhancements (Not in Initial Plan)

These are deferred until Phase 1-5 are working:
- Break segments
- Tile conditions (temporal, objective, etc.)
- Interruption handling
- Full JIT scoring with all condition vectors
- Prompt system
- AI integration

---

## Implementation Strategy

### For Each Phase:
1. **Design** - Define minimal types needed
2. **Implement Core** - Command/Event/Reducer for this feature
3. **Test** - Unit test reducer logic
4. **Connect UI** - Update React components
5. **Validate** - Manual testing in browser
6. **Commit** - Small, focused commits

### Validation Gates:
- Each phase must have working UI before moving to next
- No "placeholder implementations" - each phase is shippable
- Reducer logic must be deterministic and tested

---

## Technical Constraints

### Must Follow:
- Events are append-only (never update/delete)
- State is derived from events (event replay)
- No `status` field in Tile (derive from startedAt/completedAt)
- Commands have actor (human/agent/system)
- Event Store persists to Supabase before state update

### Can Simplify (Initially):
- Full 7-layer Tile conditions → start with just core
- Complex validation → start with basic checks
- Prompt system → manual start/complete buttons first
- Full Actor model → just use `{ type: 'human', id: userId }` initially

---

## Success Definition

Phase 1-5 complete when:
- ✅ Can view tiles from Supabase
- ✅ Can create new tiles through UI
- ✅ Can start and complete tiles
- ✅ Active execution shows correctly
- ✅ Timeline displays work history
- ✅ System suggests next tile

At this point, tastile-web has a **minimal but real** execution engine connected to UI.
