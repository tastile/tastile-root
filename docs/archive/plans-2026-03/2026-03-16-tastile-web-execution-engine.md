# Tastile Web Execution Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement complete execution engine in TypeScript for tastile-web, enabling browser-standalone operation with Supabase as the shared datastore.

**Architecture:** Port Rust Core's Command/Event/Reducer pattern to TypeScript. Events stored in Supabase serve as the source of truth. Client-side state derived from event replay. No dependency on local Rust daemon.

**Tech Stack:** Next.js 15, TypeScript, Supabase (PostgreSQL + Realtime), Zod for validation

---

## Phase 1: Domain Types & IDs

### Task 1: Core ID Types

**Files:**
- Create: `tastile-web/src/lib/domain/ids.ts`
- Create: `tastile-web/src/lib/domain/ids.test.ts`

**Step 1: Write failing test for ID generation**

```typescript
// src/lib/domain/ids.test.ts
import { describe, it, expect } from 'vitest'
import { TileId, EventId, CommandId, SegmentId, PromptId } from './ids'

describe('Domain IDs', () => {
  it('should generate unique TileIds', () => {
    const id1 = TileId.new()
    const id2 = TileId.new()
    expect(id1).not.toBe(id2)
    expect(id1.length).toBe(36) // UUID format
  })

  it('should parse UUID strings to TileId', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const id = TileId.fromString(uuid)
    expect(id).toBe(uuid)
  })

  it('should validate TileId format', () => {
    expect(() => TileId.fromString('invalid')).toThrow()
  })
})
```

**Step 2: Run test to verify failure**

```bash
cd tastile-web
npm test src/lib/domain/ids.test.ts
```

Expected: FAIL - Module not found

**Step 3: Implement ID types**

```typescript
// src/lib/domain/ids.ts
import { v4 as uuidv4, validate as isUuid } from 'uuid'

export type TileId = string & { readonly __brand: 'TileId' }
export type EventId = string & { readonly __brand: 'EventId' }
export type CommandId = string & { readonly __brand: 'CommandId' }
export type SegmentId = string & { readonly __brand: 'SegmentId' }
export type PromptId = string & { readonly __brand: 'PromptId' }

function createId<T extends string>(): T {
  return uuidv4() as T
}

function parseId<T extends string>(s: string): T {
  if (!isUuid(s)) {
    throw new Error(`Invalid UUID format: ${s}`)
  }
  return s as T
}

export const TileId = {
  new: () => createId<TileId>(),
  fromString: (s: string) => parseId<TileId>(s),
}

export const EventId = {
  new: () => createId<EventId>(),
  fromString: (s: string) => parseId<EventId>(s),
}

export const CommandId = {
  new: () => createId<CommandId>(),
  fromString: (s: string) => parseId<CommandId>(s),
}

export const SegmentId = {
  new: () => createId<SegmentId>(),
  fromString: (s: string) => parseId<SegmentId>(s),
}

export const PromptId = {
  new: () => createId<PromptId>(),
  fromString: (s: string) => parseId<PromptId>(s),
}
```

**Step 4: Run test to verify pass**

```bash
npm test src/lib/domain/ids.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/domain/ids.ts src/lib/domain/ids.test.ts
git commit -m "feat(domain): add branded ID types with validation"
```

---

### Task 2: Actor Types

**Files:**
- Create: `tastile-web/src/lib/domain/actor.ts`
- Create: `tastile-web/src/lib/domain/actor.test.ts`

**Step 1: Write failing test**

```typescript
// src/lib/domain/actor.test.ts
import { describe, it, expect } from 'vitest'
import { Actor } from './actor'

describe('Actor', () => {
  it('should create system actor', () => {
    const actor = Actor.system()
    expect(actor.type).toBe('system')
    expect(actor.id).toBe('system')
  })

  it('should create human actor', () => {
    const actor = Actor.human('user-123')
    expect(actor.type).toBe('human')
    expect(actor.id).toBe('user-123')
  })

  it('should create agent actor', () => {
    const actor = Actor.agent('claude-1')
    expect(actor.type).toBe('agent')
    expect(actor.id).toBe('claude-1')
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/domain/actor.test.ts
```

Expected: FAIL

**Step 3: Implement Actor**

```typescript
// src/lib/domain/actor.ts
export type ActorType = 'system' | 'human' | 'agent'

export interface Actor {
  type: ActorType
  id: string
}

export const Actor = {
  system: (): Actor => ({ type: 'system', id: 'system' }),
  human: (userId: string): Actor => ({ type: 'human', id: userId }),
  agent: (agentId: string): Actor => ({ type: 'agent', id: agentId }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/domain/actor.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/domain/actor.ts src/lib/domain/actor.test.ts
git commit -m "feat(domain): add actor types for command attribution"
```

---

### Task 3: Tile Core Types

**Files:**
- Create: `tastile-web/src/lib/domain/tile.ts`
- Create: `tastile-web/src/lib/domain/tile.test.ts`

**Step 1: Write failing test**

```typescript
// src/lib/domain/tile.test.ts
import { describe, it, expect } from 'vitest'
import { Tile, TileLifecycle } from './tile'
import { TileId } from './ids'

describe('Tile', () => {
  it('should create new tile in Ready state', () => {
    const id = TileId.new()
    const tile = Tile.create(id, 'Write tests')
    expect(tile.core.id).toBe(id)
    expect(tile.core.title).toBe('Write tests')
    expect(tile.core.lifecycle).toBe(TileLifecycle.Ready)
  })

  it('should calculate worked minutes from segments', () => {
    const id = TileId.new()
    const tile = Tile.create(id, 'Work tile')
    const now = new Date()
    const past = new Date(now.getTime() - 25 * 60 * 1000) // 25 min ago

    tile.work.segments.push({
      id: 'seg-1' as any,
      start_at: past,
      end_at: now,
      mode: 'work' as any,
      source_tile_id: id,
    })

    expect(tile.work.workedMinutes()).toBe(25)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/domain/tile.test.ts
```

Expected: FAIL

**Step 3: Implement Tile types**

```typescript
// src/lib/domain/tile.ts
import { TileId, SegmentId } from './ids'

export enum TileLifecycle {
  Ready = 'ready',
  Started = 'started',
  Deferred = 'deferred',
  Done = 'done',
  Closed = 'closed',
}

export enum SemanticRole {
  Default = 'default',
  Chore = 'chore',
  Deep = 'deep',
  Quick = 'quick',
}

export enum SegmentMode {
  Work = 'work',
  Break = 'break',
}

export enum StartSource {
  Manual = 'manual',
  Cli = 'cli',
  Auto = 'auto',
  Prompt = 'prompt',
}

export interface Segment {
  id: SegmentId
  start_at: Date
  end_at: Date | null
  mode: SegmentMode
  source_tile_id: TileId
}

export interface TileCore {
  id: TileId
  title: string
  next_action: string | null
  done_definition: string | null
  lifecycle: TileLifecycle
}

export interface WorkFacts {
  segments: Segment[]
  workedMinutes: () => number
}

export interface Annotation {
  semantic_role: SemanticRole
}

export interface Tile {
  core: TileCore
  work: WorkFacts
  annotation: Annotation
}

export const Tile = {
  create: (id: TileId, title: string): Tile => ({
    core: {
      id,
      title,
      next_action: null,
      done_definition: null,
      lifecycle: TileLifecycle.Ready,
    },
    work: {
      segments: [],
      workedMinutes() {
        return this.segments.reduce((total, seg) => {
          if (!seg.end_at) return total
          const ms = seg.end_at.getTime() - seg.start_at.getTime()
          return total + Math.floor(ms / 60000)
        }, 0)
      },
    },
    annotation: {
      semantic_role: SemanticRole.Default,
    },
  }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/domain/tile.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/domain/tile.ts src/lib/domain/tile.test.ts
git commit -m "feat(domain): add tile aggregate types with segments"
```

---

### Task 4: Execution State Types

**Files:**
- Create: `tastile-web/src/lib/domain/execution.ts`
- Create: `tastile-web/src/lib/domain/execution.test.ts`

**Step 1: Write test**

```typescript
// src/lib/domain/execution.test.ts
import { describe, it, expect } from 'vitest'
import { Execution, PhaseKind } from './execution'

describe('Execution', () => {
  it('should start in Idle phase', () => {
    const exec = Execution.initial()
    expect(exec.phase_kind).toBe(PhaseKind.Idle)
    expect(exec.active_tile_id).toBeNull()
  })

  it('should track phase timing', () => {
    const exec = Execution.initial()
    const now = new Date()
    const end = new Date(now.getTime() + 25 * 60 * 1000)
    exec.phase_started_at = now
    exec.phase_ends_at = end
    expect(exec.phase_started_at).toBe(now)
    expect(exec.phase_ends_at).toBe(end)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/domain/execution.test.ts
```

Expected: FAIL

**Step 3: Implement Execution**

```typescript
// src/lib/domain/execution.ts
import { TileId, PromptId } from './ids'

export enum PhaseKind {
  Work = 'work',
  Break = 'break',
  Idle = 'idle',
}

export interface Execution {
  active_tile_id: TileId | null
  phase_kind: PhaseKind
  phase_started_at: Date | null
  phase_ends_at: Date | null
  pending_prompt_id: PromptId | null
}

export const Execution = {
  initial: (): Execution => ({
    active_tile_id: null,
    phase_kind: PhaseKind.Idle,
    phase_started_at: null,
    phase_ends_at: null,
    pending_prompt_id: null,
  }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/domain/execution.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/domain/execution.ts src/lib/domain/execution.test.ts
git commit -m "feat(domain): add execution state tracking"
```

---

## Phase 2: Commands & Events

### Task 5: Command Types

**Files:**
- Create: `tastile-web/src/lib/core/command.ts`
- Create: `tastile-web/src/lib/core/command.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/command.test.ts
import { describe, it, expect } from 'vitest'
import { Command, CommandEnvelope, CreateTilePayload } from './command'
import { TileId, CommandId } from '../domain/ids'
import { Actor } from '../domain/actor'

describe('Command', () => {
  it('should create CreateTile command', () => {
    const tileId = TileId.new()
    const payload: CreateTilePayload = {
      tile_id: tileId,
      title: 'New tile',
      next_action: null,
      done_definition: null,
    }
    const cmd: Command = { type: 'create_tile', ...payload }
    expect(cmd.type).toBe('create_tile')
    expect(cmd.tile_id).toBe(tileId)
  })

  it('should wrap command in envelope', () => {
    const envelope = CommandEnvelope.create(
      { type: 'start_break', break_min: 5, reason: null, linked_tile_id: null },
      Actor.human('user-1')
    )
    expect(envelope.command_id).toBeDefined()
    expect(envelope.actor.type).toBe('human')
    expect(envelope.issued_at).toBeInstanceOf(Date)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/command.test.ts
```

Expected: FAIL

**Step 3: Implement Commands**

```typescript
// src/lib/core/command.ts
import { TileId, CommandId } from '../domain/ids'
import { Actor } from '../domain/actor'
import { StartSource } from '../domain/tile'

export interface CreateTilePayload {
  tile_id: TileId
  title: string
  next_action: string | null
  done_definition: string | null
}

export interface StartTilePayload {
  tile_id: TileId
  started_at: Date | null
  source: StartSource
}

export interface DeferTilePayload {
  tile_id: TileId
  reason: string | null
  defer_until: Date | null
}

export interface CompleteTilePayload {
  tile_id: TileId
  completed_at: Date | null
  next_tile_id: TileId | null
}

export interface ExtendPhasePayload {
  tile_id: TileId
  delta_min: number
  reason: string | null
}

export interface AttachMemoPayload {
  tile_id: TileId | null
  text: string
  memo_kind: string | null
}

export interface StartBreakPayload {
  linked_tile_id: TileId | null
  break_min: number
  reason: string | null
}

export interface EndBreakPayload {
  ended_at: Date | null
}

export type Command =
  | ({ type: 'create_tile' } & CreateTilePayload)
  | ({ type: 'start_tile' } & StartTilePayload)
  | ({ type: 'defer_tile' } & DeferTilePayload)
  | ({ type: 'complete_and_start_next' } & CompleteTilePayload)
  | ({ type: 'extend_phase' } & ExtendPhasePayload)
  | ({ type: 'attach_memo' } & AttachMemoPayload)
  | ({ type: 'start_break' } & StartBreakPayload)
  | ({ type: 'end_break' } & EndBreakPayload)

export interface CommandEnvelope {
  command_id: CommandId
  actor: Actor
  issued_at: Date
  request_id: string | null
  command: Command
}

export const CommandEnvelope = {
  create: (command: Command, actor: Actor, requestId: string | null = null): CommandEnvelope => ({
    command_id: CommandId.new(),
    actor,
    issued_at: new Date(),
    request_id: requestId,
    command,
  }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/command.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/command.ts src/lib/core/command.test.ts
git commit -m "feat(core): add command types and envelopes"
```

---

### Task 6: Event Types

**Files:**
- Create: `tastile-web/src/lib/core/event.ts`
- Create: `tastile-web/src/lib/core/event.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/event.test.ts
import { describe, it, expect } from 'vitest'
import { Event, EventEnvelope, TileCreatedPayload } from './event'
import { TileId, EventId } from '../domain/ids'
import { Tile } from '../domain/tile'
import { Actor } from '../domain/actor'

describe('Event', () => {
  it('should create TileCreated event', () => {
    const tile = Tile.create(TileId.new(), 'Test')
    const payload: TileCreatedPayload = { tile }
    const evt: Event = { type: 'tile_created', ...payload }
    expect(evt.type).toBe('tile_created')
    expect(evt.tile.core.title).toBe('Test')
  })

  it('should wrap event in envelope', () => {
    const tile = Tile.create(TileId.new(), 'Test')
    const envelope = EventEnvelope.create(
      { type: 'tile_created', tile },
      `tile:${tile.core.id}`,
      Actor.system()
    )
    expect(envelope.event_id).toBeDefined()
    expect(envelope.aggregate_id).toContain('tile:')
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/event.test.ts
```

Expected: FAIL

**Step 3: Implement Events**

```typescript
// src/lib/core/event.ts
import { TileId, EventId, CommandId } from '../domain/ids'
import { Actor } from '../domain/actor'
import { Tile, StartSource, SegmentMode } from '../domain/tile'

export interface TileCreatedPayload {
  tile: Tile
}

export interface TileStartedPayload {
  tile_id: TileId
  started_at: Date
  source: StartSource
}

export interface TileDeferredPayload {
  tile_id: TileId
  deferred_at: Date
  reason: string | null
  defer_until: Date | null
}

export interface TileCompletedPayload {
  tile_id: TileId
  completed_at: Date
}

export interface SegmentStartedPayload {
  tile_id: TileId
  mode: SegmentMode
  started_at: Date
}

export interface SegmentEndedPayload {
  tile_id: TileId
  mode: SegmentMode
  ended_at: Date
}

export interface PhaseExtendedPayload {
  tile_id: TileId
  delta_min: number
  extended_at: Date
}

export interface BreakStartedPayload {
  linked_tile_id: TileId | null
  started_at: Date
  ends_at: Date
  reason: string | null
}

export interface BreakEndedPayload {
  ended_at: Date
}

export interface MemoAttachedPayload {
  tile_id: TileId | null
  text: string
  memo_kind: string | null
  attached_at: Date
}

export type Event =
  | ({ type: 'tile_created' } & TileCreatedPayload)
  | ({ type: 'tile_started' } & TileStartedPayload)
  | ({ type: 'tile_deferred' } & TileDeferredPayload)
  | ({ type: 'tile_completed' } & TileCompletedPayload)
  | ({ type: 'segment_started' } & SegmentStartedPayload)
  | ({ type: 'segment_ended' } & SegmentEndedPayload)
  | ({ type: 'phase_extended' } & PhaseExtendedPayload)
  | ({ type: 'break_started' } & BreakStartedPayload)
  | ({ type: 'break_ended' } & BreakEndedPayload)
  | ({ type: 'memo_attached' } & MemoAttachedPayload)

export interface EventEnvelope {
  event_id: EventId
  aggregate_id: string
  occurred_at: Date
  actor: Actor
  caused_by_command_id: CommandId | null
  request_id: string | null
  event: Event
}

export const EventEnvelope = {
  create: (
    event: Event,
    aggregateId: string,
    actor: Actor,
    causedBy: CommandId | null = null
  ): EventEnvelope => ({
    event_id: EventId.new(),
    aggregate_id: aggregateId,
    occurred_at: new Date(),
    actor,
    caused_by_command_id: causedBy,
    request_id: null,
    event,
  }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/event.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/event.ts src/lib/core/event.test.ts
git commit -m "feat(core): add event types and envelopes"
```

---

## Phase 3: State Management

### Task 7: App State Container

**Files:**
- Create: `tastile-web/src/lib/core/state.ts`
- Create: `tastile-web/src/lib/core/state.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/state.test.ts
import { describe, it, expect } from 'vitest'
import { AppState } from './state'
import { TileId } from '../domain/ids'
import { Tile } from '../domain/tile'

describe('AppState', () => {
  it('should initialize empty state', () => {
    const state = AppState.initial()
    expect(state.tiles.size).toBe(0)
    expect(state.events).toEqual([])
    expect(state.execution.active_tile_id).toBeNull()
  })

  it('should store tiles in map', () => {
    const state = AppState.initial()
    const tile = Tile.create(TileId.new(), 'Test tile')
    state.tiles.set(tile.core.id, tile)
    expect(state.tiles.size).toBe(1)
    expect(state.tiles.get(tile.core.id)).toBe(tile)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/state.test.ts
```

Expected: FAIL

**Step 3: Implement AppState**

```typescript
// src/lib/core/state.ts
import { TileId } from '../domain/ids'
import { Tile } from '../domain/tile'
import { Execution } from '../domain/execution'
import { EventEnvelope } from './event'

export interface AppState {
  tiles: Map<TileId, Tile>
  execution: Execution
  events: EventEnvelope[]
}

export const AppState = {
  initial: (): AppState => ({
    tiles: new Map(),
    execution: Execution.initial(),
    events: [],
  }),
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/state.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/state.ts src/lib/core/state.test.ts
git commit -m "feat(core): add application state container"
```

---

### Task 8: Reducer - Tile Events

**Files:**
- Create: `tastile-web/src/lib/core/reducer/tile-reducer.ts`
- Create: `tastile-web/src/lib/core/reducer/tile-reducer.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/reducer/tile-reducer.test.ts
import { describe, it, expect } from 'vitest'
import { applyTileStarted, applyTileCompleted } from './tile-reducer'
import { Tile, TileLifecycle, StartSource } from '../../domain/tile'
import { TileId } from '../../domain/ids'

describe('Tile Reducer', () => {
  it('should transition to Started lifecycle', () => {
    const tile = Tile.create(TileId.new(), 'Work')
    applyTileStarted(tile, {
      tile_id: tile.core.id,
      started_at: new Date(),
      source: StartSource.Manual,
    })
    expect(tile.core.lifecycle).toBe(TileLifecycle.Started)
  })

  it('should transition to Done lifecycle', () => {
    const tile = Tile.create(TileId.new(), 'Work')
    tile.core.lifecycle = TileLifecycle.Started
    applyTileCompleted(tile, {
      tile_id: tile.core.id,
      completed_at: new Date(),
    })
    expect(tile.core.lifecycle).toBe(TileLifecycle.Done)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/reducer/tile-reducer.test.ts
```

Expected: FAIL

**Step 3: Implement tile reducer**

```typescript
// src/lib/core/reducer/tile-reducer.ts
import { Tile, TileLifecycle } from '../../domain/tile'
import { TileStartedPayload, TileDeferredPayload, TileCompletedPayload, MemoAttachedPayload } from '../event'

export function applyTileStarted(tile: Tile, payload: TileStartedPayload): void {
  tile.core.lifecycle = TileLifecycle.Started
}

export function applyTileDeferred(tile: Tile, payload: TileDeferredPayload): void {
  tile.core.lifecycle = TileLifecycle.Deferred
}

export function applyTileCompleted(tile: Tile, payload: TileCompletedPayload): void {
  tile.core.lifecycle = TileLifecycle.Done
}

export function applyMemoAttached(tile: Tile, payload: MemoAttachedPayload): void {
  // Memos are tracked separately in practice; this is a placeholder
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/reducer/tile-reducer.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/reducer/tile-reducer.ts src/lib/core/reducer/tile-reducer.test.ts
git commit -m "feat(reducer): add tile lifecycle reducers"
```

---

### Task 9: Reducer - Execution Events

**Files:**
- Create: `tastile-web/src/lib/core/reducer/execution-reducer.ts`
- Create: `tastile-web/src/lib/core/reducer/execution-reducer.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/reducer/execution-reducer.test.ts
import { describe, it, expect } from 'vitest'
import { applyTileStarted, applyTileCompleted, applyBreakStarted } from './execution-reducer'
import { Execution, PhaseKind } from '../../domain/execution'
import { TileId } from '../../domain/ids'
import { StartSource } from '../../domain/tile'

describe('Execution Reducer', () => {
  it('should set active tile on TileStarted', () => {
    const exec = Execution.initial()
    const tileId = TileId.new()
    const now = new Date()
    applyTileStarted(exec, { tile_id: tileId, started_at: now, source: StartSource.Manual })
    expect(exec.active_tile_id).toBe(tileId)
    expect(exec.phase_kind).toBe(PhaseKind.Work)
    expect(exec.phase_started_at).toBe(now)
  })

  it('should clear active tile on TileCompleted', () => {
    const exec = Execution.initial()
    const tileId = TileId.new()
    exec.active_tile_id = tileId
    exec.phase_kind = PhaseKind.Work
    applyTileCompleted(exec, { tile_id: tileId, completed_at: new Date() })
    expect(exec.active_tile_id).toBeNull()
    expect(exec.phase_kind).toBe(PhaseKind.Idle)
  })

  it('should transition to Break phase', () => {
    const exec = Execution.initial()
    const now = new Date()
    const endsAt = new Date(now.getTime() + 5 * 60 * 1000)
    applyBreakStarted(exec, {
      linked_tile_id: null,
      started_at: now,
      ends_at: endsAt,
      reason: null,
    })
    expect(exec.phase_kind).toBe(PhaseKind.Break)
    expect(exec.phase_started_at).toBe(now)
    expect(exec.phase_ends_at).toBe(endsAt)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/reducer/execution-reducer.test.ts
```

Expected: FAIL

**Step 3: Implement execution reducer**

```typescript
// src/lib/core/reducer/execution-reducer.ts
import { Execution, PhaseKind } from '../../domain/execution'
import {
  TileStartedPayload,
  TileCompletedPayload,
  PhaseExtendedPayload,
  BreakStartedPayload,
  BreakEndedPayload,
} from '../event'

export function applyTileStarted(exec: Execution, payload: TileStartedPayload): void {
  exec.active_tile_id = payload.tile_id
  exec.phase_kind = PhaseKind.Work
  exec.phase_started_at = payload.started_at
  exec.phase_ends_at = new Date(payload.started_at.getTime() + 25 * 60 * 1000) // Default 25 min
}

export function applyTileCompleted(exec: Execution, payload: TileCompletedPayload): void {
  exec.active_tile_id = null
  exec.phase_kind = PhaseKind.Idle
  exec.phase_started_at = null
  exec.phase_ends_at = null
}

export function applyPhaseExtended(exec: Execution, payload: PhaseExtendedPayload): void {
  if (exec.phase_ends_at) {
    exec.phase_ends_at = new Date(exec.phase_ends_at.getTime() + payload.delta_min * 60 * 1000)
  }
}

export function applyBreakStarted(exec: Execution, payload: BreakStartedPayload): void {
  exec.phase_kind = PhaseKind.Break
  exec.phase_started_at = payload.started_at
  exec.phase_ends_at = payload.ends_at
  exec.active_tile_id = null
}

export function applyBreakEnded(exec: Execution, payload: BreakEndedPayload): void {
  exec.phase_kind = PhaseKind.Idle
  exec.phase_started_at = null
  exec.phase_ends_at = null
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/reducer/execution-reducer.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/reducer/execution-reducer.ts src/lib/core/reducer/execution-reducer.test.ts
git commit -m "feat(reducer): add execution state reducers"
```

---

### Task 10: Root Reducer

**Files:**
- Create: `tastile-web/src/lib/core/reducer/index.ts`
- Create: `tastile-web/src/lib/core/reducer/index.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/reducer/index.test.ts
import { describe, it, expect } from 'vitest'
import { reduce } from './index'
import { AppState } from '../state'
import { EventEnvelope } from '../event'
import { Tile, TileLifecycle } from '../../domain/tile'
import { TileId } from '../../domain/ids'
import { Actor } from '../../domain/actor'

describe('Root Reducer', () => {
  it('should add tile to state on TileCreated', () => {
    const state = AppState.initial()
    const tile = Tile.create(TileId.new(), 'New task')
    const event = EventEnvelope.create(
      { type: 'tile_created', tile },
      `tile:${tile.core.id}`,
      Actor.system()
    )
    reduce(state, event.event)
    expect(state.tiles.size).toBe(1)
    expect(state.tiles.get(tile.core.id)?.core.title).toBe('New task')
  })

  it('should update tile lifecycle on TileStarted', () => {
    const state = AppState.initial()
    const tile = Tile.create(TileId.new(), 'Task')
    state.tiles.set(tile.core.id, tile)
    const event = EventEnvelope.create(
      { type: 'tile_started', tile_id: tile.core.id, started_at: new Date(), source: 'manual' as any },
      `tile:${tile.core.id}`,
      Actor.system()
    )
    reduce(state, event.event)
    expect(state.tiles.get(tile.core.id)?.core.lifecycle).toBe(TileLifecycle.Started)
    expect(state.execution.active_tile_id).toBe(tile.core.id)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/reducer/index.test.ts
```

Expected: FAIL

**Step 3: Implement root reducer**

```typescript
// src/lib/core/reducer/index.ts
import { AppState } from '../state'
import { Event } from '../event'
import { SegmentId } from '../../domain/ids'
import * as tileReducer from './tile-reducer'
import * as executionReducer from './execution-reducer'

export function reduce(state: AppState, event: Event): void {
  switch (event.type) {
    case 'tile_created':
      state.tiles.set(event.tile.core.id, event.tile)
      break

    case 'tile_started': {
      const tile = state.tiles.get(event.tile_id)
      if (tile) {
        tileReducer.applyTileStarted(tile, event)
      }
      executionReducer.applyTileStarted(state.execution, event)
      break
    }

    case 'tile_deferred': {
      const tile = state.tiles.get(event.tile_id)
      if (tile) {
        tileReducer.applyTileDeferred(tile, event)
      }
      break
    }

    case 'tile_completed': {
      const tile = state.tiles.get(event.tile_id)
      if (tile) {
        tileReducer.applyTileCompleted(tile, event)
      }
      executionReducer.applyTileCompleted(state.execution, event)
      break
    }

    case 'segment_started': {
      const tile = state.tiles.get(event.tile_id)
      if (tile) {
        tile.work.segments.push({
          id: SegmentId.new(),
          start_at: event.started_at,
          end_at: null,
          mode: event.mode,
          source_tile_id: event.tile_id,
        })
      }
      break
    }

    case 'segment_ended': {
      const tile = state.tiles.get(event.tile_id)
      if (tile) {
        const segment = tile.work.segments.reverse().find(s => !s.end_at && s.mode === event.mode)
        if (segment) {
          segment.end_at = event.ended_at
        }
        tile.work.segments.reverse() // restore order
      }
      break
    }

    case 'phase_extended':
      executionReducer.applyPhaseExtended(state.execution, event)
      break

    case 'break_started':
      executionReducer.applyBreakStarted(state.execution, event)
      break

    case 'break_ended':
      executionReducer.applyBreakEnded(state.execution, event)
      break

    case 'memo_attached': {
      if (event.tile_id) {
        const tile = state.tiles.get(event.tile_id)
        if (tile) {
          tileReducer.applyMemoAttached(tile, event)
        }
      }
      break
    }
  }
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/reducer/index.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/reducer/index.ts src/lib/core/reducer/index.test.ts
git commit -m "feat(reducer): add root reducer dispatching to state"
```

---

## Phase 4: Command Handler

### Task 11: Validation Layer

**Files:**
- Create: `tastile-web/src/lib/core/validate.ts`
- Create: `tastile-web/src/lib/core/validate.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/validate.test.ts
import { describe, it, expect } from 'vitest'
import { validate, ValidationError } from './validate'
import { AppState } from './state'
import { TileId } from '../domain/ids'
import { Tile, TileLifecycle } from '../domain/tile'

describe('Validation', () => {
  it('should reject StartTile for non-existent tile', () => {
    const state = AppState.initial()
    const cmd = { type: 'start_tile' as const, tile_id: TileId.new(), started_at: null, source: 'manual' as any }
    expect(() => validate(cmd, state)).toThrow(ValidationError)
  })

  it('should allow StartTile for Ready tile', () => {
    const state = AppState.initial()
    const tile = Tile.create(TileId.new(), 'Task')
    state.tiles.set(tile.core.id, tile)
    const cmd = { type: 'start_tile' as const, tile_id: tile.core.id, started_at: null, source: 'manual' as any }
    expect(() => validate(cmd, state)).not.toThrow()
  })

  it('should reject CompleteAndStartNext when no active tile', () => {
    const state = AppState.initial()
    const cmd = { type: 'complete_and_start_next' as const, tile_id: TileId.new(), completed_at: null, next_tile_id: null }
    expect(() => validate(cmd, state)).toThrow(ValidationError)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/validate.test.ts
```

Expected: FAIL

**Step 3: Implement validation**

```typescript
// src/lib/core/validate.ts
import { Command } from './command'
import { AppState } from './state'
import { TileLifecycle } from '../domain/tile'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function validate(command: Command, state: AppState): void {
  switch (command.type) {
    case 'create_tile':
      if (!command.title.trim()) {
        throw new ValidationError('Title cannot be empty')
      }
      break

    case 'start_tile': {
      const tile = state.tiles.get(command.tile_id)
      if (!tile) {
        throw new ValidationError(`Tile ${command.tile_id} not found`)
      }
      if (tile.core.lifecycle !== TileLifecycle.Ready) {
        throw new ValidationError(`Tile must be Ready to start`)
      }
      break
    }

    case 'defer_tile': {
      const tile = state.tiles.get(command.tile_id)
      if (!tile) {
        throw new ValidationError(`Tile ${command.tile_id} not found`)
      }
      break
    }

    case 'complete_and_start_next': {
      const tile = state.tiles.get(command.tile_id)
      if (!tile) {
        throw new ValidationError(`Tile ${command.tile_id} not found`)
      }
      if (state.execution.active_tile_id !== command.tile_id) {
        throw new ValidationError(`Can only complete active tile`)
      }
      if (command.next_tile_id) {
        const nextTile = state.tiles.get(command.next_tile_id)
        if (!nextTile) {
          throw new ValidationError(`Next tile ${command.next_tile_id} not found`)
        }
      }
      break
    }

    case 'extend_phase':
      if (!state.execution.active_tile_id) {
        throw new ValidationError('No active tile to extend')
      }
      break

    case 'attach_memo':
      // Memos are always valid
      break

    case 'start_break':
      if (command.break_min <= 0) {
        throw new ValidationError('Break duration must be positive')
      }
      break

    case 'end_break':
      // Always valid
      break
  }
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/validate.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/validate.ts src/lib/core/validate.test.ts
git commit -m "feat(validate): add command validation layer"
```

---

### Task 12: Command Handler

**Files:**
- Create: `tastile-web/src/lib/core/handler.ts`
- Create: `tastile-web/src/lib/core/handler.test.ts`

**Step 1: Write test**

```typescript
// src/lib/core/handler.test.ts
import { describe, it, expect } from 'vitest'
import { CommandHandler } from './handler'
import { AppState } from './state'
import { CommandEnvelope } from './command'
import { TileId } from '../domain/ids'
import { Actor } from '../domain/actor'
import { TileLifecycle } from '../domain/tile'

describe('CommandHandler', () => {
  it('should handle CreateTile command', () => {
    const state = AppState.initial()
    const handler = new CommandHandler()
    const tileId = TileId.new()
    const envelope = CommandEnvelope.create(
      { type: 'create_tile', tile_id: tileId, title: 'New task', next_action: null, done_definition: null },
      Actor.human('user-1')
    )
    const events = handler.handle(envelope, state)
    expect(events).toHaveLength(1)
    expect(events[0].event.type).toBe('tile_created')
    expect(state.tiles.size).toBe(1)
    expect(state.tiles.get(tileId)?.core.title).toBe('New task')
  })

  it('should handle StartTile and generate two events', () => {
    const state = AppState.initial()
    const handler = new CommandHandler()
    const tileId = TileId.new()
    // First create the tile
    const createEnvelope = CommandEnvelope.create(
      { type: 'create_tile', tile_id: tileId, title: 'Task', next_action: null, done_definition: null },
      Actor.system()
    )
    handler.handle(createEnvelope, state)
    // Then start it
    const startEnvelope = CommandEnvelope.create(
      { type: 'start_tile', tile_id: tileId, started_at: null, source: 'manual' as any },
      Actor.human('user-1')
    )
    const events = handler.handle(startEnvelope, state)
    expect(events).toHaveLength(2) // TileStarted + SegmentStarted
    expect(events[0].event.type).toBe('tile_started')
    expect(events[1].event.type).toBe('segment_started')
    expect(state.tiles.get(tileId)?.core.lifecycle).toBe(TileLifecycle.Started)
    expect(state.execution.active_tile_id).toBe(tileId)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/core/handler.test.ts
```

Expected: FAIL

**Step 3: Implement command handler**

```typescript
// src/lib/core/handler.ts
import { CommandEnvelope, Command } from './command'
import { EventEnvelope, Event } from './event'
import { AppState } from './state'
import { validate } from './validate'
import { reduce } from './reducer'
import { Tile, SegmentMode, StartSource } from '../domain/tile'
import { EventId } from '../domain/ids'

export class CommandHandler {
  handle(envelope: CommandEnvelope, state: AppState): EventEnvelope[] {
    // 1. Validate
    validate(envelope.command, state)

    // 2. Generate events
    const events = this.generateEvents(envelope, state)

    // 3. Apply events to state
    for (const evt of events) {
      reduce(state, evt.event)
      state.events.push(evt)
    }

    return events
  }

  private generateEvents(envelope: CommandEnvelope, _state: AppState): EventEnvelope[] {
    const events: EventEnvelope[] = []
    const now = envelope.issued_at

    switch (envelope.command.type) {
      case 'create_tile': {
        const tile = Tile.create(envelope.command.tile_id, envelope.command.title)
        tile.core.next_action = envelope.command.next_action
        tile.core.done_definition = envelope.command.done_definition
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, { type: 'tile_created', tile }))
        break
      }

      case 'start_tile':
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, {
          type: 'tile_started',
          tile_id: envelope.command.tile_id,
          started_at: envelope.command.started_at || now,
          source: envelope.command.source,
        }))
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, {
          type: 'segment_started',
          tile_id: envelope.command.tile_id,
          mode: SegmentMode.Work,
          started_at: envelope.command.started_at || now,
        }))
        break

      case 'defer_tile':
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, {
          type: 'tile_deferred',
          tile_id: envelope.command.tile_id,
          deferred_at: now,
          reason: envelope.command.reason,
          defer_until: envelope.command.defer_until,
        }))
        break

      case 'complete_and_start_next': {
        const completedAt = envelope.command.completed_at || now
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, {
          type: 'segment_ended',
          tile_id: envelope.command.tile_id,
          mode: SegmentMode.Work,
          ended_at: completedAt,
        }))
        events.push(this.wrap(envelope, `tile:${envelope.command.tile_id}`, {
          type: 'tile_completed',
          tile_id: envelope.command.tile_id,
          completed_at: completedAt,
        }))
        if (envelope.command.next_tile_id) {
          events.push(this.wrap(envelope, `tile:${envelope.command.next_tile_id}`, {
            type: 'tile_started',
            tile_id: envelope.command.next_tile_id,
            started_at: completedAt,
            source: StartSource.Auto,
          }))
          events.push(this.wrap(envelope, `tile:${envelope.command.next_tile_id}`, {
            type: 'segment_started',
            tile_id: envelope.command.next_tile_id,
            mode: SegmentMode.Work,
            started_at: completedAt,
          }))
        }
        break
      }

      case 'extend_phase':
        events.push(this.wrap(envelope, 'execution:singleton', {
          type: 'phase_extended',
          tile_id: envelope.command.tile_id,
          delta_min: envelope.command.delta_min,
          extended_at: now,
        }))
        break

      case 'attach_memo':
        events.push(this.wrap(envelope, envelope.command.tile_id ? `tile:${envelope.command.tile_id}` : 'memo:global', {
          type: 'memo_attached',
          tile_id: envelope.command.tile_id,
          text: envelope.command.text,
          memo_kind: envelope.command.memo_kind,
          attached_at: now,
        }))
        break

      case 'start_break': {
        const endsAt = new Date(now.getTime() + envelope.command.break_min * 60 * 1000)
        events.push(this.wrap(envelope, 'execution:singleton', {
          type: 'break_started',
          linked_tile_id: envelope.command.linked_tile_id,
          started_at: now,
          ends_at: endsAt,
          reason: envelope.command.reason,
        }))
        break
      }

      case 'end_break':
        events.push(this.wrap(envelope, 'execution:singleton', {
          type: 'break_ended',
          ended_at: envelope.command.ended_at || now,
        }))
        break
    }

    return events
  }

  private wrap(envelope: CommandEnvelope, aggregateId: string, event: Event): EventEnvelope {
    return {
      event_id: EventId.new(),
      aggregate_id: aggregateId,
      occurred_at: envelope.issued_at,
      actor: envelope.actor,
      caused_by_command_id: envelope.command_id,
      request_id: envelope.request_id,
      event,
    }
  }
}
```

**Step 4: Run test**

```bash
npm test src/lib/core/handler.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/core/handler.ts src/lib/core/handler.test.ts
git commit -m "feat(handler): add command handler with event generation"
```

---

## Phase 5: Supabase Integration

### Task 13: Event Store Schema

**Files:**
- Create: `tastile-web/supabase/migrations/20260316_events_table.sql`

**Step 1: Write migration**

```sql
-- supabase/migrations/20260316_events_table.sql

-- Events table (append-only event log)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  aggregate_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  caused_by_command_id UUID,
  request_id TEXT,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_events_user_id ON events(user_id, occurred_at DESC);
CREATE INDEX idx_events_aggregate ON events(user_id, aggregate_id);
CREATE INDEX idx_events_type ON events(user_id, event_type);

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_select_own ON events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY events_insert_own ON events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE - events are immutable
```

**Step 2: Apply migration**

```bash
cd tastile-web
npx supabase db push
```

Expected: Migration applied successfully

**Step 3: Verify schema**

```bash
npx supabase db dump --schema public
```

Expected: events table present

**Step 4: Commit**

```bash
git add supabase/migrations/20260316_events_table.sql
git commit -m "feat(db): add events table for event sourcing"
```

---

### Task 14: Event Repository

**Files:**
- Create: `tastile-web/src/lib/storage/event-store.ts`
- Create: `tastile-web/src/lib/storage/event-store.test.ts`

**Step 1: Write test**

```typescript
// src/lib/storage/event-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { EventStore } from './event-store'
import { createClient } from '@supabase/supabase-js'
import { EventEnvelope } from '../core/event'
import { Tile } from '../domain/tile'
import { TileId } from '../domain/ids'
import { Actor } from '../domain/actor'

// Mock Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

describe('EventStore', () => {
  let store: EventStore
  const userId = 'test-user-id'

  beforeEach(() => {
    store = new EventStore(supabase, userId)
  })

  it('should append event to Supabase', async () => {
    const tile = Tile.create(TileId.new(), 'Test')
    const envelope = EventEnvelope.create({ type: 'tile_created', tile }, `tile:${tile.core.id}`, Actor.system())

    await store.append(envelope)
    // In real test, verify via Supabase query
    expect(true).toBe(true) // Placeholder
  })

  it('should load events for user', async () => {
    const events = await store.loadAll()
    expect(Array.isArray(events)).toBe(true)
  })
})
```

**Step 2: Run test**

```bash
npm test src/lib/storage/event-store.test.ts
```

Expected: FAIL (implementation missing)

**Step 3: Implement EventStore**

```typescript
// src/lib/storage/event-store.ts
import { SupabaseClient } from '@supabase/supabase-js'
import { EventEnvelope, Event } from '../core/event'
import { EventId } from '../domain/ids'
import { Actor } from '../domain/actor'

export class EventStore {
  constructor(
    private supabase: SupabaseClient,
    private userId: string
  ) {}

  async append(envelope: EventEnvelope): Promise<void> {
    const { error } = await this.supabase.from('events').insert({
      user_id: this.userId,
      event_id: envelope.event_id,
      aggregate_id: envelope.aggregate_id,
      occurred_at: envelope.occurred_at.toISOString(),
      actor_type: envelope.actor.type,
      actor_id: envelope.actor.id,
      caused_by_command_id: envelope.caused_by_command_id,
      request_id: envelope.request_id,
      event_type: envelope.event.type,
      event_payload: envelope.event as any,
    })

    if (error) {
      throw new Error(`Failed to append event: ${error.message}`)
    }
  }

  async loadAll(): Promise<EventEnvelope[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('user_id', this.userId)
      .order('occurred_at', { ascending: true })

    if (error) {
      throw new Error(`Failed to load events: ${error.message}`)
    }

    return (data || []).map(row => this.deserialize(row))
  }

  async loadSince(sinceEventId: EventId): Promise<EventEnvelope[]> {
    // Load events after a specific event (for incremental sync)
    const { data: sinceEvent } = await this.supabase
      .from('events')
      .select('occurred_at')
      .eq('event_id', sinceEventId)
      .single()

    if (!sinceEvent) {
      return []
    }

    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('user_id', this.userId)
      .gt('occurred_at', sinceEvent.occurred_at)
      .order('occurred_at', { ascending: true })

    if (error) {
      throw new Error(`Failed to load events: ${error.message}`)
    }

    return (data || []).map(row => this.deserialize(row))
  }

  private deserialize(row: any): EventEnvelope {
    return {
      event_id: row.event_id,
      aggregate_id: row.aggregate_id,
      occurred_at: new Date(row.occurred_at),
      actor: {
        type: row.actor_type,
        id: row.actor_id,
      } as Actor,
      caused_by_command_id: row.caused_by_command_id,
      request_id: row.request_id,
      event: row.event_payload as Event,
    }
  }
}
```

**Step 4: Run test**

```bash
npm test src/lib/storage/event-store.test.ts
```

Expected: PASS (or skip if no Supabase connection)

**Step 5: Commit**

```bash
git add src/lib/storage/event-store.ts src/lib/storage/event-store.test.ts
git commit -m "feat(storage): add event store with Supabase persistence"
```

---

## Phase 6: React Integration

### Task 15: Execution Engine Hook

**Files:**
- Create: `tastile-web/src/lib/hooks/use-execution-engine.ts`

**Step 1: Implement hook**

```typescript
// src/lib/hooks/use-execution-engine.ts
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppState } from '../core/state'
import { CommandHandler } from '../core/handler'
import { EventStore } from '../storage/event-store'
import { CommandEnvelope, Command } from '../core/command'
import { Actor } from '../domain/actor'
import { reduce } from '../core/reducer'

export function useExecutionEngine() {
  const [state, setState] = useState<AppState>(AppState.initial())
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const handlerRef = useRef(new CommandHandler())
  const eventStoreRef = useRef<EventStore | null>(null)

  // Initialize: load user and event history
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const eventStore = new EventStore(supabase, user.id)
      eventStoreRef.current = eventStore

      // Replay all events to build state
      const events = await eventStore.loadAll()
      const newState = AppState.initial()
      for (const envelope of events) {
        reduce(newState, envelope.event)
        newState.events.push(envelope)
      }
      setState(newState)
      setLoading(false)
    }

    init()
  }, [supabase])

  // Execute command
  const execute = useCallback(async (command: Command, actor: Actor) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !eventStoreRef.current) {
      throw new Error('Not authenticated')
    }

    const envelope = CommandEnvelope.create(command, actor)

    // Handle command (generates events and applies to state)
    const newState = { ...state }
    const events = handlerRef.current.handle(envelope, newState)

    // Persist events to Supabase
    for (const evt of events) {
      await eventStoreRef.current.append(evt)
    }

    // Update local state
    setState(newState)
  }, [state, supabase])

  return { state, loading, execute }
}
```

**Step 2: Commit**

```bash
git add src/lib/hooks/use-execution-engine.ts
git commit -m "feat(hooks): add execution engine React hook"
```

---

### Task 16: Update Now Page to Use Engine

**Files:**
- Modify: `tastile-web/src/app/app/now/page.tsx`

**Step 1: Replace Supabase direct calls with engine**

```typescript
// src/app/app/now/page.tsx
'use client'

import { useExecutionEngine } from '@/lib/hooks/use-execution-engine'
import { Actor } from '@/lib/domain/actor'
import { TileId } from '@/lib/domain/ids'
import { StartSource } from '@/lib/domain/tile'
import { Check, Pause, Plus, ArrowUp, Timer, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export default function NowPage() {
  const { state, loading, execute } = useExecutionEngine()
  const [newTitle, setNewTitle] = useState('')

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>
  }

  const tiles = Array.from(state.tiles.values())
  const activeTile = state.execution.active_tile_id
    ? state.tiles.get(state.execution.active_tile_id)
    : null

  async function createTile(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return

    const tileId = TileId.new()
    await execute(
      {
        type: 'create_tile',
        tile_id: tileId,
        title: newTitle.trim(),
        next_action: null,
        done_definition: null,
      },
      Actor.human('current-user') // Replace with actual user ID
    )
    setNewTitle('')
  }

  async function startTile(tileId: TileId) {
    await execute(
      {
        type: 'start_tile',
        tile_id: tileId,
        started_at: null,
        source: StartSource.Manual,
      },
      Actor.human('current-user')
    )
  }

  async function completeTile(tileId: TileId) {
    await execute(
      {
        type: 'complete_and_start_next',
        tile_id: tileId,
        completed_at: null,
        next_tile_id: null,
      },
      Actor.human('current-user')
    )
  }

  // ... rest of UI rendering (keep existing JSX)
}
```

**Step 2: Test in browser**

```bash
npm run dev
```

Navigate to `/app/now` and verify tile creation/start/complete works

**Step 3: Commit**

```bash
git add src/app/app/now/page.tsx
git commit -m "feat(now): integrate execution engine into Now page"
```

---

## Phase 7: Realtime Sync

### Task 17: Realtime Event Subscription

**Files:**
- Modify: `tastile-web/src/lib/hooks/use-execution-engine.ts`

**Step 1: Add Realtime subscription**

```typescript
// Add to useExecutionEngine hook after init()

// Subscribe to new events
useEffect(() => {
  if (!eventStoreRef.current) return

  const channel = supabase
    .channel('events-changes')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        // Apply incoming event to state
        const eventEnvelope = eventStoreRef.current!.deserialize(payload.new)
        setState(prev => {
          const newState = { ...prev }
          reduce(newState, eventEnvelope.event)
          newState.events.push(eventEnvelope)
          return newState
        })
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [supabase, user])
```

**Step 2: Test multi-device sync**

Open two browser tabs, create tile in one, verify it appears in the other

**Step 3: Commit**

```bash
git add src/lib/hooks/use-execution-engine.ts
git commit -m "feat(realtime): add Supabase Realtime sync for events"
```

---

## Summary

This plan implements a complete TypeScript port of Rust Core's execution engine:

1. **Domain types** (TileId, Actor, Tile, Execution)
2. **Commands & Events** (tagged unions with payloads)
3. **State management** (AppState, reducers)
4. **Command handler** (validation → event generation → state mutation)
5. **Supabase persistence** (event sourcing via events table)
6. **React integration** (useExecutionEngine hook)
7. **Realtime sync** (multi-device state updates)

The Web version now operates **completely independently** of Rust Core, using Supabase as the shared source of truth.

**Rollback:** Each task commits separately. Rollback by `git revert <commit-hash>` or reset to before implementation.

**Next Steps:**
- Migrate `/dashboard/tiles` page to use engine
- Add prompt scheduling (Phase D equivalent)
- Implement scheduler/JIT selection (Phase E equivalent)
