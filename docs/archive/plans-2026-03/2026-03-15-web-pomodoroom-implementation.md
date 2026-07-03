# Web版 Pomodoroom 完全実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** tastile-web の `/app/*` ルートに、pomodoroom のタイムライン・タイマー・タスク管理・スケジューリング機能をフル実装し、Web単体で動作する実行制御アプリにする

**Architecture:** Supabase をバックエンドとし、実行エンジン(タイマー・フェーズ管理・セグメント記録)は全てクライアントサイド TypeScript で実装する。tastile-core の Command/Event/State パターンを TypeScript に移植し、Supabase の tiles テーブル + 新規 segments テーブルでデータ永続化する。UIは pomodoroom の DayTimelinePanel・FocusHub・TaskCard を参考に Tailwind CSS v4 で再構築する

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS v4, Supabase (Auth + PostgreSQL + Realtime), Web Notifications API

---

## 前提条件

- tastile-web が `bun dev` で起動できる状態
- Supabase プロジェクトが接続済み (`.env.local` 設定済み)
- 既存の tiles テーブル・profiles テーブルが存在する

## 全体構成

```
tastile-web/src/
├── app/app/
│   ├── layout.tsx          # 改修: ボトムナビ + タイマーバー追加
│   ├── now/page.tsx        # 全面改修: メインビュー (タイマー + アクティブタイル + リスト)
│   ├── timeline/page.tsx   # 新規: 24時間タイムラインビュー
│   ├── tiles/page.tsx      # 新規: タイル管理 (追加・編集・削除)
│   ├── prompt/page.tsx     # 改修: プロンプトエンジン連携
│   └── memo/page.tsx       # 既存 (変更なし)
├── components/app/
│   ├── Timer.tsx           # 新規: カウントダウンタイマー
│   ├── TimerBar.tsx        # 新規: フローティングタイマーバー
│   ├── TileCard.tsx        # 新規: タイルカード
│   ├── TileForm.tsx        # 新規: タイル作成/編集フォーム
│   ├── DayTimeline.tsx     # 新規: 24時間タイムライン
│   ├── PhaseIndicator.tsx  # 新規: Work/Break/Idle 表示
│   └── BottomNav.tsx       # 新規: ボトムナビゲーション
├── lib/
│   ├── engine/
│   │   ├── types.ts        # 新規: 実行エンジン型定義
│   │   ├── store.ts        # 新規: 実行状態ストア (React Context)
│   │   ├── commands.ts     # 新規: コマンド処理
│   │   ├── timer.ts        # 新規: タイマーエンジン (wall-clock)
│   │   └── scheduler.ts   # 新規: 次タイル選択ロジック
│   └── supabase/
│       ├── client.ts       # 既存
│       └── server.ts       # 既存
└── hooks/
    ├── useExecutionEngine.ts  # 新規: エンジンフック
    ├── useTimer.ts            # 新規: タイマーフック
    └── useTiles.ts            # 新規: タイルCRUDフック
```

---

## Task 1: DB スキーマ拡張 (segments テーブル + tiles カラム追加)

**Files:**
- Create: `tastile-web/supabase/migrations/20260315000001_add_execution_tables.sql`

**Step 1: マイグレーションSQL作成**

```sql
-- Segments table: work/break time tracking
CREATE TABLE IF NOT EXISTS public.segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tile_id UUID NOT NULL REFERENCES public.tiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('work', 'break')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own segments"
    ON public.segments
    FOR ALL
    USING (auth.uid() = user_id);

CREATE INDEX idx_segments_user_tile ON public.segments(user_id, tile_id);
CREATE INDEX idx_segments_user_date ON public.segments(user_id, started_at);

-- Add execution-related columns to tiles
ALTER TABLE public.tiles
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER DEFAULT 25,
    ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
    ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Index for active tile queries
CREATE INDEX IF NOT EXISTS idx_tiles_user_lifecycle ON public.tiles(user_id, lifecycle)
    WHERE deleted_at IS NULL;
```

**Step 2: Supabase にマイグレーション適用**

Run: `cd tastile-web && npx supabase db push` (ローカル) or Supabase Dashboard > SQL Editor で直接実行

Expected: テーブル作成成功、エラーなし

**Step 3: コミット**

```bash
git add supabase/migrations/20260315000001_add_execution_tables.sql
git commit -m "feat(db): add segments table and execution columns to tiles"
```

---

## Task 2: 実行エンジン型定義

**Files:**
- Create: `tastile-web/src/lib/engine/types.ts`

**Step 1: 型定義ファイル作成**

```typescript
// Execution engine types - mirrors tastile-core domain model

export type Lifecycle = 'Ready' | 'Started' | 'Done'
export type PhaseKind = 'work' | 'break' | 'idle'
export type SegmentMode = 'work' | 'break'

export interface Tile {
  id: string
  user_id: string
  local_tile_id: string
  title: string
  next_action: string | null
  done_definition: string | null
  lifecycle: Lifecycle
  started_at: string | null
  completed_at: string | null
  estimated_minutes: number
  priority: number
  sort_order: number
  updated_at: string
  created_at: string
  deleted_at: string | null
}

export interface Segment {
  id: string
  user_id: string
  tile_id: string
  mode: SegmentMode
  started_at: string
  ended_at: string | null
}

export interface ExecutionState {
  activeTileId: string | null
  phase: PhaseKind
  phaseStartedAt: string | null
  phaseEndsAt: string | null
}

export interface TimerState {
  remainingMs: number
  totalMs: number
  isRunning: boolean
  stepType: 'focus' | 'short_break' | 'long_break'
  stepIndex: number  // 0-based, every 4th break is long
}

export interface CreateTileInput {
  title: string
  next_action?: string
  done_definition?: string
  estimated_minutes?: number
  priority?: number
}

export interface TileWithSegments extends Tile {
  segments: Segment[]
  workedMinutes: number
}
```

**Step 2: コミット**

```bash
git add src/lib/engine/types.ts
git commit -m "feat(engine): add execution engine type definitions"
```

---

## Task 3: タイマーエンジン (wall-clock ベース)

**Files:**
- Create: `tastile-web/src/lib/engine/timer.ts`

**Step 1: タイマーエンジン実装**

pomodoroom の `timer/engine.rs` を TypeScript に移植する。wall-clock ベースで `requestAnimationFrame` + `setInterval` を使い、タブ非アクティブ時も正確に動作する。

```typescript
// Wall-clock based timer engine
// No internal threads - caller drives ticks via requestAnimationFrame

export interface TimerConfig {
  focusMinutes: number    // default 25
  shortBreakMinutes: number  // default 5
  longBreakMinutes: number   // default 15
  longBreakInterval: number  // default 4 (every 4th break is long)
}

export const DEFAULT_CONFIG: TimerConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
}

export type StepType = 'focus' | 'short_break' | 'long_break'
export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed'

export interface TimerSnapshot {
  status: TimerStatus
  stepType: StepType
  stepIndex: number
  totalMs: number
  remainingMs: number
  startedAtMs: number | null
  pausedRemainingMs: number | null
}

export function getStepType(stepIndex: number, config: TimerConfig): StepType {
  if (stepIndex % 2 === 0) return 'focus'
  const breakNumber = Math.floor(stepIndex / 2) + 1
  return breakNumber % config.longBreakInterval === 0 ? 'long_break' : 'short_break'
}

export function getStepDurationMs(stepType: StepType, config: TimerConfig): number {
  switch (stepType) {
    case 'focus': return config.focusMinutes * 60_000
    case 'short_break': return config.shortBreakMinutes * 60_000
    case 'long_break': return config.longBreakMinutes * 60_000
  }
}

export function createTimer(config: TimerConfig = DEFAULT_CONFIG): TimerSnapshot {
  const stepType = getStepType(0, config)
  return {
    status: 'idle',
    stepType,
    stepIndex: 0,
    totalMs: getStepDurationMs(stepType, config),
    remainingMs: getStepDurationMs(stepType, config),
    startedAtMs: null,
    pausedRemainingMs: null,
  }
}

export function startTimer(snapshot: TimerSnapshot): TimerSnapshot {
  if (snapshot.status === 'running') return snapshot
  const now = Date.now()
  return {
    ...snapshot,
    status: 'running',
    startedAtMs: now,
    pausedRemainingMs: null,
    // If resuming from pause, use pausedRemainingMs as totalMs for calculation
    totalMs: snapshot.pausedRemainingMs ?? snapshot.totalMs,
  }
}

export function pauseTimer(snapshot: TimerSnapshot): TimerSnapshot {
  if (snapshot.status !== 'running') return snapshot
  const remaining = tickTimer(snapshot).remainingMs
  return {
    ...snapshot,
    status: 'paused',
    startedAtMs: null,
    pausedRemainingMs: remaining,
  }
}

export function tickTimer(snapshot: TimerSnapshot): TimerSnapshot {
  if (snapshot.status !== 'running' || snapshot.startedAtMs === null) return snapshot
  const elapsed = Date.now() - snapshot.startedAtMs
  const remaining = Math.max(0, snapshot.totalMs - elapsed)

  if (remaining <= 0) {
    return { ...snapshot, remainingMs: 0, status: 'completed' }
  }
  return { ...snapshot, remainingMs: remaining }
}

export function advanceStep(snapshot: TimerSnapshot, config: TimerConfig): TimerSnapshot {
  const nextIndex = snapshot.stepIndex + 1
  const stepType = getStepType(nextIndex, config)
  const durationMs = getStepDurationMs(stepType, config)
  return {
    status: 'idle',
    stepType,
    stepIndex: nextIndex,
    totalMs: durationMs,
    remainingMs: durationMs,
    startedAtMs: null,
    pausedRemainingMs: null,
  }
}

export function resetTimer(config: TimerConfig): TimerSnapshot {
  return createTimer(config)
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function getCompletedPomodoros(stepIndex: number): number {
  return Math.floor((stepIndex + 1) / 2)
}
```

**Step 2: コミット**

```bash
git add src/lib/engine/timer.ts
git commit -m "feat(engine): implement wall-clock timer engine"
```

---

## Task 4: タイルCRUD hooks + Supabase連携

**Files:**
- Create: `tastile-web/src/hooks/useTiles.ts`

**Step 1: タイルフック実装**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tile, CreateTileInput, Segment, TileWithSegments } from '@/lib/engine/types'

export function useTiles() {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadTiles = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('tiles')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false })

    setTiles((data as Tile[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadTiles() }, [loadTiles])

  const createTile = useCallback(async (input: CreateTileInput) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('tiles')
      .insert({
        user_id: user.id,
        local_tile_id: crypto.randomUUID(),
        title: input.title,
        next_action: input.next_action || null,
        done_definition: input.done_definition || null,
        estimated_minutes: input.estimated_minutes || 25,
        priority: input.priority ?? 50,
        lifecycle: 'Ready',
      })
      .select()
      .single()

    if (!error && data) {
      await loadTiles()
      return data as Tile
    }
    return null
  }, [supabase, loadTiles])

  const updateTile = useCallback(async (id: string, updates: Partial<Tile>) => {
    const { error } = await supabase
      .from('tiles')
      .update(updates)
      .eq('id', id)

    if (!error) await loadTiles()
    return !error
  }, [supabase, loadTiles])

  const deleteTile = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('tiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (!error) await loadTiles()
    return !error
  }, [supabase, loadTiles])

  const startTile = useCallback(async (id: string) => {
    // Stop any currently started tile first
    const activeTile = tiles.find(t => t.lifecycle === 'Started')
    if (activeTile) {
      await supabase
        .from('tiles')
        .update({ lifecycle: 'Ready' })
        .eq('id', activeTile.id)
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('tiles')
      .update({ lifecycle: 'Started', started_at: now })
      .eq('id', id)

    if (!error) {
      // Create a work segment
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('segments').insert({
          user_id: user.id,
          tile_id: id,
          mode: 'work',
          started_at: now,
        })
      }
      await loadTiles()
    }
    return !error
  }, [supabase, tiles, loadTiles])

  const completeTile = useCallback(async (id: string) => {
    const now = new Date().toISOString()

    // Close open segment
    const { data: openSegment } = await supabase
      .from('segments')
      .select('id')
      .eq('tile_id', id)
      .is('ended_at', null)
      .limit(1)
      .single()

    if (openSegment) {
      await supabase
        .from('segments')
        .update({ ended_at: now })
        .eq('id', openSegment.id)
    }

    const { error } = await supabase
      .from('tiles')
      .update({ lifecycle: 'Done', completed_at: now })
      .eq('id', id)

    if (!error) await loadTiles()
    return !error
  }, [supabase, loadTiles])

  const reorderTiles = useCallback(async (orderedIds: string[]) => {
    const updates = orderedIds.map((id, i) =>
      supabase.from('tiles').update({ sort_order: i }).eq('id', id)
    )
    await Promise.all(updates)
    await loadTiles()
  }, [supabase, loadTiles])

  const activeTile = tiles.find(t => t.lifecycle === 'Started') || null
  const readyTiles = tiles.filter(t => t.lifecycle === 'Ready')
  const doneTiles = tiles.filter(t => t.lifecycle === 'Done')

  return {
    tiles, loading, activeTile, readyTiles, doneTiles,
    createTile, updateTile, deleteTile, startTile, completeTile,
    reorderTiles, reload: loadTiles,
  }
}

export function useTileSegments(tileId: string | null) {
  const [segments, setSegments] = useState<Segment[]>([])
  const supabase = createClient()

  useEffect(() => {
    if (!tileId) { setSegments([]); return }

    async function load() {
      const { data } = await supabase
        .from('segments')
        .select('*')
        .eq('tile_id', tileId)
        .order('started_at', { ascending: true })

      setSegments((data as Segment[]) || [])
    }
    load()
  }, [tileId, supabase])

  const workedMinutes = segments
    .filter(s => s.mode === 'work' && s.ended_at)
    .reduce((sum, s) => {
      const start = new Date(s.started_at).getTime()
      const end = new Date(s.ended_at!).getTime()
      return sum + (end - start) / 60_000
    }, 0)

  return { segments, workedMinutes }
}

export function useTodaySegments() {
  const [segments, setSegments] = useState<(Segment & { tile_title?: string })[]>([])
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data } = await supabase
        .from('segments')
        .select('*, tiles!inner(title)')
        .eq('user_id', user.id)
        .gte('started_at', todayStart.toISOString())
        .order('started_at', { ascending: true })

      if (data) {
        setSegments(data.map((s: Record<string, unknown>) => ({
          ...s,
          tile_title: (s.tiles as { title: string })?.title,
        })) as (Segment & { tile_title?: string })[])
      }
    }
    load()
  }, [supabase])

  return { segments }
}
```

**Step 2: コミット**

```bash
git add src/hooks/useTiles.ts
git commit -m "feat(hooks): implement tile CRUD and segment hooks"
```

---

## Task 5: 実行エンジン Context + タイマーフック

**Files:**
- Create: `tastile-web/src/lib/engine/store.ts`
- Create: `tastile-web/src/hooks/useTimer.ts`
- Create: `tastile-web/src/hooks/useExecutionEngine.ts`

**Step 1: 実行状態ストア (React Context)**

```typescript
// tastile-web/src/lib/engine/store.ts
'use client'

import { createContext, useContext } from 'react'
import type { ExecutionState, TimerSnapshot, Tile } from './types'
import type { TimerConfig } from './timer'

export interface EngineContextValue {
  execution: ExecutionState
  timer: TimerSnapshot
  config: TimerConfig
  activeTile: Tile | null

  // Commands
  startWork: (tileId: string) => void
  pauseWork: () => void
  resumeWork: () => void
  completeWork: () => void
  skipStep: () => void
  resetTimer: () => void
  startBreak: () => void
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used within EngineProvider')
  return ctx
}
```

**Step 2: タイマーフック**

```typescript
// tastile-web/src/hooks/useTimer.ts
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  type TimerSnapshot, type TimerConfig,
  DEFAULT_CONFIG, createTimer, startTimer, pauseTimer,
  tickTimer, advanceStep, resetTimer as resetTimerFn,
} from '@/lib/engine/timer'

interface UseTimerOptions {
  config?: TimerConfig
  onStepComplete?: (snapshot: TimerSnapshot) => void
}

export function useTimer(options: UseTimerOptions = {}) {
  const config = options.config || DEFAULT_CONFIG
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() => createTimer(config))
  const onStepCompleteRef = useRef(options.onStepComplete)
  onStepCompleteRef.current = options.onStepComplete
  const completedRef = useRef(false)

  // Tick loop using requestAnimationFrame + setInterval fallback
  useEffect(() => {
    if (snapshot.status !== 'running') return

    let rafId: number
    let intervalId: ReturnType<typeof setInterval>

    function tick() {
      setSnapshot(prev => {
        const next = tickTimer(prev)
        if (next.status === 'completed' && !completedRef.current) {
          completedRef.current = true
          // Defer callback to avoid setState during render
          queueMicrotask(() => onStepCompleteRef.current?.(next))
        }
        return next
      })
    }

    // RAF for smooth display (active tab)
    function rafLoop() {
      tick()
      rafId = requestAnimationFrame(rafLoop)
    }
    rafId = requestAnimationFrame(rafLoop)

    // Interval fallback for background tabs (runs every 1s)
    intervalId = setInterval(tick, 1000)

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(intervalId)
    }
  }, [snapshot.status])

  const start = useCallback(() => {
    completedRef.current = false
    setSnapshot(prev => startTimer(prev))
  }, [])

  const pause = useCallback(() => {
    setSnapshot(prev => pauseTimer(prev))
  }, [])

  const skip = useCallback(() => {
    completedRef.current = false
    setSnapshot(prev => advanceStep(prev, config))
  }, [config])

  const reset = useCallback(() => {
    completedRef.current = false
    setSnapshot(resetTimerFn(config))
  }, [config])

  const advance = useCallback(() => {
    completedRef.current = false
    setSnapshot(prev => advanceStep(prev, config))
  }, [config])

  return { snapshot, start, pause, skip, reset, advance }
}
```

**Step 3: 実行エンジンフック**

```typescript
// tastile-web/src/hooks/useExecutionEngine.ts
'use client'

import { useCallback, useMemo } from 'react'
import { useTimer } from './useTimer'
import { useTiles } from './useTiles'
import type { ExecutionState } from '@/lib/engine/types'
import type { TimerSnapshot } from '@/lib/engine/timer'
import { DEFAULT_CONFIG } from '@/lib/engine/timer'

export function useExecutionEngine() {
  const {
    tiles, loading, activeTile, readyTiles, doneTiles,
    createTile, updateTile, deleteTile, startTile, completeTile,
    reorderTiles, reload,
  } = useTiles()

  const handleStepComplete = useCallback((snap: TimerSnapshot) => {
    // Play notification sound + show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = snap.stepType === 'focus' ? 'Focus complete!' : 'Break over!'
      const body = snap.stepType === 'focus'
        ? 'Time for a break.'
        : 'Ready to focus again?'
      new Notification(title, { body, icon: '/icon-192.png' })
    }
    // Play sound
    try {
      const audio = new Audio('/notification.mp3')
      audio.volume = 0.5
      audio.play().catch(() => {})
    } catch {}
  }, [])

  const timer = useTimer({
    config: DEFAULT_CONFIG,
    onStepComplete: handleStepComplete,
  })

  const startWork = useCallback(async (tileId: string) => {
    const success = await startTile(tileId)
    if (success) {
      timer.reset()
      timer.start()
    }
  }, [startTile, timer])

  const pauseWork = useCallback(() => {
    timer.pause()
  }, [timer])

  const resumeWork = useCallback(() => {
    timer.start()
  }, [timer])

  const completeWork = useCallback(async () => {
    if (activeTile) {
      await completeTile(activeTile.id)
      timer.reset()
    }
  }, [activeTile, completeTile, timer])

  const skipStep = useCallback(() => {
    timer.advance()
  }, [timer])

  const resetTimer = useCallback(() => {
    timer.reset()
  }, [timer])

  const startBreak = useCallback(() => {
    timer.advance() // Move to break step
    timer.start()
  }, [timer])

  const execution: ExecutionState = useMemo(() => ({
    activeTileId: activeTile?.id || null,
    phase: activeTile ? (timer.snapshot.stepType === 'focus' ? 'work' : 'break') : 'idle',
    phaseStartedAt: timer.snapshot.startedAtMs
      ? new Date(timer.snapshot.startedAtMs).toISOString()
      : null,
    phaseEndsAt: timer.snapshot.startedAtMs
      ? new Date(timer.snapshot.startedAtMs + timer.snapshot.totalMs).toISOString()
      : null,
  }), [activeTile, timer.snapshot])

  return {
    // State
    execution,
    timer: timer.snapshot,
    config: DEFAULT_CONFIG,
    activeTile,
    tiles,
    readyTiles,
    doneTiles,
    loading,

    // Tile operations
    createTile,
    updateTile,
    deleteTile,
    reorderTiles,
    reload,

    // Execution commands
    startWork,
    pauseWork,
    resumeWork,
    completeWork,
    skipStep,
    resetTimer,
    startBreak,
  }
}
```

**Step 4: コミット**

```bash
git add src/lib/engine/store.ts src/hooks/useTimer.ts src/hooks/useExecutionEngine.ts
git commit -m "feat(engine): implement execution engine context and timer hook"
```

---

## Task 6: UIコンポーネント — Timer, PhaseIndicator, TimerBar

**Files:**
- Create: `tastile-web/src/components/app/Timer.tsx`
- Create: `tastile-web/src/components/app/PhaseIndicator.tsx`
- Create: `tastile-web/src/components/app/TimerBar.tsx`

**Step 1: Timer コンポーネント**

```tsx
// tastile-web/src/components/app/Timer.tsx
'use client'

import { formatTime, getCompletedPomodoros } from '@/lib/engine/timer'
import type { TimerSnapshot } from '@/lib/engine/timer'

interface TimerProps {
  snapshot: TimerSnapshot
  onStart: () => void
  onPause: () => void
  onSkip: () => void
  onReset: () => void
}

const STEP_COLORS = {
  focus: { bg: 'bg-red-50 dark:bg-red-950/30', ring: 'ring-red-200 dark:ring-red-800', text: 'text-red-600 dark:text-red-400', progress: 'bg-red-500' },
  short_break: { bg: 'bg-green-50 dark:bg-green-950/30', ring: 'ring-green-200 dark:ring-green-800', text: 'text-green-600 dark:text-green-400', progress: 'bg-green-500' },
  long_break: { bg: 'bg-blue-50 dark:bg-blue-950/30', ring: 'ring-blue-200 dark:ring-blue-800', text: 'text-blue-600 dark:text-blue-400', progress: 'bg-blue-500' },
}

const STEP_LABELS = {
  focus: 'Focus',
  short_break: 'Short Break',
  long_break: 'Long Break',
}

export function Timer({ snapshot, onStart, onPause, onSkip, onReset }: TimerProps) {
  const colors = STEP_COLORS[snapshot.stepType]
  const progress = snapshot.totalMs > 0
    ? ((snapshot.totalMs - snapshot.remainingMs) / snapshot.totalMs) * 100
    : 0
  const pomodoros = getCompletedPomodoros(snapshot.stepIndex)

  return (
    <div className={`rounded-2xl ${colors.bg} ring-1 ${colors.ring} p-6 text-center`}>
      {/* Step label */}
      <div className={`text-xs font-semibold uppercase tracking-wider ${colors.text} mb-2`}>
        {STEP_LABELS[snapshot.stepType]}
      </div>

      {/* Time display */}
      <div className="text-5xl font-mono font-bold text-zinc-900 dark:text-zinc-100 tabular-nums mb-4">
        {formatTime(snapshot.remainingMs)}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 mb-4 overflow-hidden">
        <div
          className={`h-full rounded-full ${colors.progress} transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Pomodoro dots */}
      {pomodoros > 0 && (
        <div className="flex justify-center gap-1.5 mb-4">
          {Array.from({ length: Math.min(pomodoros, 8) }).map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${colors.progress}`} />
          ))}
          {pomodoros > 8 && (
            <span className={`text-xs ${colors.text}`}>+{pomodoros - 8}</span>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        {snapshot.status === 'idle' || snapshot.status === 'completed' ? (
          <button
            onClick={onStart}
            className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-6 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            Start
          </button>
        ) : snapshot.status === 'running' ? (
          <button
            onClick={onPause}
            className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-6 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={onStart}
            className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-6 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            Resume
          </button>
        )}
        <button
          onClick={onSkip}
          className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={onReset}
          className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
```

**Step 2: PhaseIndicator コンポーネント**

```tsx
// tastile-web/src/components/app/PhaseIndicator.tsx
'use client'

import type { PhaseKind } from '@/lib/engine/types'

const PHASE_CONFIG = {
  work: { label: 'Working', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  break: { label: 'Break', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' },
  idle: { label: 'Idle', dot: 'bg-zinc-400', text: 'text-zinc-500 dark:text-zinc-400' },
}

export function PhaseIndicator({ phase }: { phase: PhaseKind }) {
  const cfg = PHASE_CONFIG[phase]
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${cfg.dot} ${phase === 'work' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
    </div>
  )
}
```

**Step 3: TimerBar コンポーネント (フローティング)**

```tsx
// tastile-web/src/components/app/TimerBar.tsx
'use client'

import { formatTime } from '@/lib/engine/timer'
import type { TimerSnapshot } from '@/lib/engine/timer'
import type { PhaseKind } from '@/lib/engine/types'

interface TimerBarProps {
  snapshot: TimerSnapshot
  phase: PhaseKind
  tileTitle: string | null
  onPause: () => void
  onResume: () => void
}

export function TimerBar({ snapshot, phase, tileTitle, onPause, onResume }: TimerBarProps) {
  if (phase === 'idle') return null

  const isRunning = snapshot.status === 'running'
  const progress = snapshot.totalMs > 0
    ? ((snapshot.totalMs - snapshot.remainingMs) / snapshot.totalMs) * 100
    : 0

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2">
      <div className="max-w-lg mx-auto rounded-2xl bg-zinc-900 dark:bg-zinc-800 shadow-lg border border-zinc-700 px-4 py-3">
        {/* Progress bar */}
        <div className="h-0.5 rounded-full bg-zinc-700 mb-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              snapshot.stepType === 'focus' ? 'bg-red-500' : 'bg-green-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              snapshot.stepType === 'focus' ? 'bg-red-500 animate-pulse' : 'bg-green-500'
            }`} />
            <div className="min-w-0">
              {tileTitle && (
                <p className="text-xs text-zinc-400 truncate">{tileTitle}</p>
              )}
              <p className="text-sm font-mono font-bold text-white tabular-nums">
                {formatTime(snapshot.remainingMs)}
              </p>
            </div>
          </div>
          <button
            onClick={isRunning ? onPause : onResume}
            className="text-white bg-zinc-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors"
          >
            {isRunning ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 4: コミット**

```bash
git add src/components/app/Timer.tsx src/components/app/PhaseIndicator.tsx src/components/app/TimerBar.tsx
git commit -m "feat(ui): add Timer, PhaseIndicator, and TimerBar components"
```

---

## Task 7: UIコンポーネント — TileCard, TileForm, BottomNav

**Files:**
- Create: `tastile-web/src/components/app/TileCard.tsx`
- Create: `tastile-web/src/components/app/TileForm.tsx`
- Create: `tastile-web/src/components/app/BottomNav.tsx`

**Step 1: TileCard コンポーネント**

```tsx
// tastile-web/src/components/app/TileCard.tsx
'use client'

import type { Tile } from '@/lib/engine/types'

interface TileCardProps {
  tile: Tile
  isActive?: boolean
  onStart?: () => void
  onComplete?: () => void
  onDelete?: () => void
  onEdit?: () => void
}

const LIFECYCLE_BADGE = {
  Ready: { label: 'Ready', className: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400' },
  Started: { label: 'Active', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  Done: { label: 'Done', className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
}

export function TileCard({ tile, isActive, onStart, onComplete, onDelete, onEdit }: TileCardProps) {
  const badge = LIFECYCLE_BADGE[tile.lifecycle as keyof typeof LIFECYCLE_BADGE] || LIFECYCLE_BADGE.Ready

  return (
    <div className={`rounded-xl border p-3 transition-colors ${
      isActive
        ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-950/20'
        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>
            {tile.estimated_minutes && (
              <span className="text-[10px] text-zinc-400">{tile.estimated_minutes}min</span>
            )}
            {tile.priority > 70 && (
              <span className="text-[10px] text-orange-500 font-medium">High</span>
            )}
          </div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{tile.title}</h3>
          {tile.next_action && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
              Next: {tile.next_action}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {tile.lifecycle === 'Ready' && onStart && (
            <button
              onClick={onStart}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-medium text-white dark:text-zinc-900 hover:opacity-90"
            >
              Start
            </button>
          )}
          {tile.lifecycle === 'Started' && onComplete && (
            <button
              onClick={onComplete}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              Done
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded-md p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Edit"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {onDelete && tile.lifecycle !== 'Started' && (
            <button
              onClick={onDelete}
              className="rounded-md p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: TileForm コンポーネント**

```tsx
// tastile-web/src/components/app/TileForm.tsx
'use client'

import { useState } from 'react'
import type { CreateTileInput } from '@/lib/engine/types'

interface TileFormProps {
  onSubmit: (input: CreateTileInput) => void
  onCancel?: () => void
  initialValues?: Partial<CreateTileInput>
  submitLabel?: string
  expanded?: boolean
}

export function TileForm({ onSubmit, onCancel, initialValues, submitLabel = 'Add', expanded = false }: TileFormProps) {
  const [title, setTitle] = useState(initialValues?.title || '')
  const [nextAction, setNextAction] = useState(initialValues?.next_action || '')
  const [doneDefinition, setDoneDefinition] = useState(initialValues?.done_definition || '')
  const [estimatedMinutes, setEstimatedMinutes] = useState(initialValues?.estimated_minutes || 25)
  const [priority, setPriority] = useState(initialValues?.priority ?? 50)
  const [showExpanded, setShowExpanded] = useState(expanded)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    onSubmit({
      title: title.trim(),
      next_action: nextAction.trim() || undefined,
      done_definition: doneDefinition.trim() || undefined,
      estimated_minutes: estimatedMinutes,
      priority,
    })
    setTitle('')
    setNextAction('')
    setDoneDefinition('')
    setEstimatedMinutes(25)
    setPriority(50)
    setShowExpanded(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Title row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2.5 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400"
          autoFocus
        />
        {!showExpanded && (
          <>
            <button
              type="button"
              onClick={() => setShowExpanded(true)}
              className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="More options"
            >
              ...
            </button>
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90"
            >
              {submitLabel}
            </button>
          </>
        )}
      </div>

      {/* Expanded fields */}
      {showExpanded && (
        <>
          <input
            type="text"
            value={nextAction}
            onChange={e => setNextAction(e.target.value)}
            placeholder="Next action (optional)"
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400"
          />
          <input
            type="text"
            value={doneDefinition}
            onChange={e => setDoneDefinition(e.target.value)}
            placeholder="Done when... (optional)"
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400"
          />
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 mb-1 block">Duration (min)</label>
              <input
                type="number"
                value={estimatedMinutes}
                onChange={e => setEstimatedMinutes(Number(e.target.value))}
                min={5} max={120} step={5}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 mb-1 block">Priority ({priority})</label>
              <input
                type="range"
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
                min={0} max={100}
                className="w-full mt-2"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            {onCancel && (
              <button
                type="button"
                onClick={() => { onCancel(); setShowExpanded(false) }}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90"
            >
              {submitLabel}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
```

**Step 3: BottomNav コンポーネント**

```tsx
// tastile-web/src/components/app/BottomNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  {
    href: '/app/now',
    label: 'Now',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
  {
    href: '/app/timeline',
    label: 'Timeline',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
    ),
  },
  {
    href: '/app/tiles',
    label: 'Tiles',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    href: '/app/memo',
    label: 'Memo',
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
      </svg>
    ),
  },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm">
      <div className="max-w-lg mx-auto flex">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
                isActive
                  ? 'text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              {item.icon(isActive)}
              <span className="font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

**Step 4: コミット**

```bash
git add src/components/app/TileCard.tsx src/components/app/TileForm.tsx src/components/app/BottomNav.tsx
git commit -m "feat(ui): add TileCard, TileForm, and BottomNav components"
```

---

## Task 8: DayTimeline コンポーネント

**Files:**
- Create: `tastile-web/src/components/app/DayTimeline.tsx`

**Step 1: 24時間タイムラインコンポーネント実装**

pomodoroom の `DayTimelinePanel.tsx` を参考に、セグメントベースのタイムライン表示を実装する。

```tsx
// tastile-web/src/components/app/DayTimeline.tsx
'use client'

import { useMemo } from 'react'
import type { Segment } from '@/lib/engine/types'

interface TimelineSegment extends Segment {
  tile_title?: string
}

interface DayTimelineProps {
  segments: TimelineSegment[]
  hourHeight?: number
  startHour?: number
  endHour?: number
}

function getHourFromDate(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getHours() + d.getMinutes() / 60
}

export function DayTimeline({ segments, hourHeight = 48, startHour = 6, endHour = 24 }: DayTimelineProps) {
  const hours = useMemo(() => {
    const arr: number[] = []
    for (let h = startHour; h <= endHour; h++) arr.push(h)
    return arr
  }, [startHour, endHour])

  const totalHeight = (endHour - startHour) * hourHeight

  // Current time indicator
  const now = new Date()
  const currentHour = now.getHours() + now.getMinutes() / 60
  const currentOffset = (currentHour - startHour) * hourHeight

  const segmentBlocks = useMemo(() => {
    return segments.map(seg => {
      const segStart = getHourFromDate(seg.started_at)
      const segEnd = seg.ended_at
        ? getHourFromDate(seg.ended_at)
        : currentHour

      const top = (Math.max(segStart, startHour) - startHour) * hourHeight
      const bottom = (Math.min(segEnd, endHour) - startHour) * hourHeight
      const height = Math.max(bottom - top, 4)

      return { ...seg, top, height }
    })
  }, [segments, hourHeight, startHour, endHour, currentHour])

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {/* Hour lines */}
      {hours.map(h => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-zinc-100 dark:border-zinc-800"
          style={{ top: (h - startHour) * hourHeight }}
        >
          <span className="absolute -top-2.5 left-0 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono w-8">
            {String(h % 24).padStart(2, '0')}:00
          </span>
        </div>
      ))}

      {/* Segments */}
      <div className="absolute left-10 right-0">
        {segmentBlocks.map(seg => (
          <div
            key={seg.id}
            className={`absolute left-0 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium truncate ${
              seg.mode === 'work'
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-l-2 border-red-500'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-l-2 border-green-500'
            }`}
            style={{ top: seg.top, height: seg.height, minHeight: 16 }}
            title={`${seg.tile_title || 'Untitled'} (${seg.mode})`}
          >
            {seg.height > 16 && (seg.tile_title || seg.mode)}
          </div>
        ))}
      </div>

      {/* Current time indicator */}
      {currentHour >= startHour && currentHour <= endHour && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ top: currentOffset }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <div className="flex-1 h-px bg-red-500" />
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/components/app/DayTimeline.tsx
git commit -m "feat(ui): add 24-hour DayTimeline component"
```

---

## Task 9: メインビュー改修 — /app/now

**Files:**
- Modify: `tastile-web/src/app/app/now/page.tsx` (全面書き換え)

**Step 1: Now ページ全面改修**

タイマー + アクティブタイル + Ready タイルリスト を統合したメインビューにする。

```tsx
// tastile-web/src/app/app/now/page.tsx
'use client'

import { useEffect } from 'react'
import { useExecutionEngine } from '@/hooks/useExecutionEngine'
import { Timer } from '@/components/app/Timer'
import { TimerBar } from '@/components/app/TimerBar'
import { TileCard } from '@/components/app/TileCard'
import { TileForm } from '@/components/app/TileForm'
import { PhaseIndicator } from '@/components/app/PhaseIndicator'

export default function NowPage() {
  const engine = useExecutionEngine()

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  if (engine.loading) {
    return <div className="text-center py-12 text-zinc-400">Loading...</div>
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Phase + Stats header */}
      <div className="flex items-center justify-between">
        <PhaseIndicator phase={engine.execution.phase} />
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span>{engine.doneTiles.length} done today</span>
          <span>{engine.readyTiles.length} ready</span>
        </div>
      </div>

      {/* Timer */}
      <Timer
        snapshot={engine.timer}
        onStart={engine.activeTile
          ? engine.resumeWork
          : engine.readyTiles[0]
            ? () => engine.startWork(engine.readyTiles[0].id)
            : () => {}
        }
        onPause={engine.pauseWork}
        onSkip={engine.skipStep}
        onReset={engine.resetTimer}
      />

      {/* Active Tile */}
      {engine.activeTile && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Currently Working</h2>
          <TileCard
            tile={engine.activeTile}
            isActive
            onComplete={engine.completeWork}
          />
        </div>
      )}

      {/* Quick Add */}
      <TileForm onSubmit={engine.createTile} />

      {/* Ready Tiles */}
      {engine.readyTiles.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Up Next ({engine.readyTiles.length})
          </h2>
          <div className="space-y-2">
            {engine.readyTiles.map(tile => (
              <TileCard
                key={tile.id}
                tile={tile}
                onStart={() => engine.startWork(tile.id)}
                onDelete={() => engine.deleteTile(tile.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Done Tiles (last 5) */}
      {engine.doneTiles.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Completed ({engine.doneTiles.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {engine.doneTiles.slice(0, 5).map(tile => (
              <TileCard key={tile.id} tile={tile} />
            ))}
          </div>
        </div>
      )}

      {/* Floating Timer Bar (when scrolled away from main timer) */}
      <TimerBar
        snapshot={engine.timer}
        phase={engine.execution.phase}
        tileTitle={engine.activeTile?.title || null}
        onPause={engine.pauseWork}
        onResume={engine.resumeWork}
      />
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/app/app/now/page.tsx
git commit -m "feat(now): rebuild Now page with timer, active tile, and ready list"
```

---

## Task 10: タイムラインページ — /app/timeline

**Files:**
- Create: `tastile-web/src/app/app/timeline/page.tsx`

**Step 1: タイムラインページ実装**

```tsx
// tastile-web/src/app/app/timeline/page.tsx
'use client'

import { useMemo } from 'react'
import { useTodaySegments } from '@/hooks/useTiles'
import { DayTimeline } from '@/components/app/DayTimeline'

export default function TimelinePage() {
  const { segments } = useTodaySegments()

  const stats = useMemo(() => {
    let focusMinutes = 0
    let breakMinutes = 0

    for (const seg of segments) {
      if (!seg.ended_at) continue
      const durationMs = new Date(seg.ended_at).getTime() - new Date(seg.started_at).getTime()
      const minutes = durationMs / 60_000
      if (seg.mode === 'work') focusMinutes += minutes
      else breakMinutes += minutes
    }

    return { focusMinutes: Math.round(focusMinutes), breakMinutes: Math.round(breakMinutes) }
  }, [segments])

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Today</h1>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {stats.focusMinutes}m focus
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {stats.breakMinutes}m break
          </span>
        </div>
      </div>

      {/* Timeline */}
      {segments.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-400 dark:text-zinc-500 text-sm">No activity yet today</p>
          <p className="text-zinc-300 dark:text-zinc-600 text-xs mt-1">Start a tile to see your timeline</p>
        </div>
      ) : (
        <div className="overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
          <DayTimeline segments={segments} />
        </div>
      )}
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/app/app/timeline/page.tsx
git commit -m "feat(timeline): add 24-hour timeline page"
```

---

## Task 11: タイル管理ページ — /app/tiles

**Files:**
- Create: `tastile-web/src/app/app/tiles/page.tsx`

**Step 1: タイル管理ページ実装**

タイルの作成・編集・削除・並び替えを行う管理ページ。

```tsx
// tastile-web/src/app/app/tiles/page.tsx
'use client'

import { useState } from 'react'
import { useTiles } from '@/hooks/useTiles'
import { TileCard } from '@/components/app/TileCard'
import { TileForm } from '@/components/app/TileForm'
import type { Tile, CreateTileInput } from '@/lib/engine/types'

type FilterTab = 'all' | 'Ready' | 'Started' | 'Done'

export default function TilesPage() {
  const { tiles, loading, createTile, updateTile, deleteTile, startTile, completeTile } = useTiles()
  const [filter, setFilter] = useState<FilterTab>('all')
  const [editingTile, setEditingTile] = useState<Tile | null>(null)

  const filteredTiles = filter === 'all'
    ? tiles
    : tiles.filter(t => t.lifecycle === filter)

  const counts = {
    all: tiles.length,
    Ready: tiles.filter(t => t.lifecycle === 'Ready').length,
    Started: tiles.filter(t => t.lifecycle === 'Started').length,
    Done: tiles.filter(t => t.lifecycle === 'Done').length,
  }

  async function handleEdit(input: CreateTileInput) {
    if (!editingTile) return
    await updateTile(editingTile.id, {
      title: input.title,
      next_action: input.next_action || null,
      done_definition: input.done_definition || null,
      estimated_minutes: input.estimated_minutes || 25,
      priority: input.priority ?? 50,
    })
    setEditingTile(null)
  }

  if (loading) {
    return <div className="text-center py-12 text-zinc-400">Loading...</div>
  }

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Tiles</h1>

      {/* Add tile */}
      <TileForm onSubmit={createTile} />

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
        {(['all', 'Ready', 'Started', 'Done'] as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tab === 'all' ? 'All' : tab} ({counts[tab]})
          </button>
        ))}
      </div>

      {/* Edit form */}
      {editingTile && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-2">Editing: {editingTile.title}</p>
          <TileForm
            onSubmit={handleEdit}
            onCancel={() => setEditingTile(null)}
            initialValues={{
              title: editingTile.title,
              next_action: editingTile.next_action || undefined,
              done_definition: editingTile.done_definition || undefined,
              estimated_minutes: editingTile.estimated_minutes,
              priority: editingTile.priority,
            }}
            submitLabel="Save"
            expanded
          />
        </div>
      )}

      {/* Tile list */}
      {filteredTiles.length === 0 ? (
        <p className="text-center py-8 text-zinc-400 text-sm">
          {filter === 'all' ? 'No tiles yet' : `No ${filter} tiles`}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredTiles.map(tile => (
            <TileCard
              key={tile.id}
              tile={tile}
              isActive={tile.lifecycle === 'Started'}
              onStart={tile.lifecycle === 'Ready' ? () => startTile(tile.id) : undefined}
              onComplete={tile.lifecycle === 'Started' ? () => completeTile(tile.id) : undefined}
              onEdit={() => setEditingTile(tile)}
              onDelete={() => deleteTile(tile.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/app/app/tiles/page.tsx
git commit -m "feat(tiles): add tile management page with CRUD and filtering"
```

---

## Task 12: レイアウト改修 — BottomNav統合 + ヘッダー簡略化

**Files:**
- Modify: `tastile-web/src/app/app/layout.tsx`

**Step 1: レイアウト改修**

BottomNav を追加し、ヘッダーの `Now/Prompt/Memo` リンクを BottomNav に移行する。max-width を 448px→512px に拡大。

```tsx
// tastile-web/src/app/app/layout.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AccountMenu } from './account-menu'
import { BottomNav } from '@/components/app/BottomNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, plan')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Compact top bar */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">Tastile</span>
          <AccountMenu
            displayName={profile?.display_name || user.email || 'User'}
            avatarUrl={profile?.avatar_url}
            plan={profile?.plan || 'free'}
            email={user.email || ''}
          />
        </div>
      </header>
      {/* Content */}
      <main className="max-w-lg mx-auto px-4 py-4">
        {children}
      </main>
      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/app/app/layout.tsx
git commit -m "feat(layout): add BottomNav and simplify header"
```

---

## Task 13: Prompt ページ改修

**Files:**
- Modify: `tastile-web/src/app/app/prompt/page.tsx`

**Step 1: プロンプトページ改修**

既存のシミュレーションベースから、実行エンジンの状態に基づくプロンプト表示に変更する。

```tsx
// tastile-web/src/app/app/prompt/page.tsx
'use client'

import { useMemo } from 'react'
import { useExecutionEngine } from '@/hooks/useExecutionEngine'
import { formatTime } from '@/lib/engine/timer'

interface Prompt {
  id: string
  type: 'start' | 'end' | 'break' | 'extend'
  title: string
  message: string
  actions: { label: string; action: () => void; primary?: boolean }[]
}

export default function PromptPage() {
  const engine = useExecutionEngine()

  const prompts = useMemo<Prompt[]>(() => {
    const result: Prompt[] = []

    // Timer completed prompt
    if (engine.timer.status === 'completed') {
      if (engine.timer.stepType === 'focus') {
        result.push({
          id: 'focus-complete',
          type: 'end',
          title: 'Focus session complete',
          message: engine.activeTile
            ? `You've been working on "${engine.activeTile.title}". Time for a break?`
            : 'Focus session ended.',
          actions: [
            { label: 'Take Break', action: engine.startBreak, primary: true },
            { label: 'Complete Tile', action: engine.completeWork },
            { label: 'Continue (+5 min)', action: () => { engine.skipStep() } },
          ],
        })
      } else {
        result.push({
          id: 'break-complete',
          type: 'start',
          title: 'Break over!',
          message: engine.readyTiles.length > 0
            ? `Next up: "${engine.readyTiles[0].title}"`
            : 'Ready to start another tile?',
          actions: [
            ...(engine.readyTiles[0]
              ? [{ label: 'Start Next', action: () => engine.startWork(engine.readyTiles[0].id), primary: true }]
              : []),
            { label: 'Skip', action: engine.skipStep },
          ],
        })
      }
    }

    // Idle with ready tiles
    if (engine.execution.phase === 'idle' && engine.readyTiles.length > 0 && engine.timer.status !== 'completed') {
      result.push({
        id: 'idle-start',
        type: 'start',
        title: 'Ready to start?',
        message: `"${engine.readyTiles[0].title}" is waiting. (${engine.readyTiles[0].estimated_minutes || 25} min)`,
        actions: [
          { label: 'Start', action: () => engine.startWork(engine.readyTiles[0].id), primary: true },
        ],
      })
    }

    return result
  }, [engine])

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Prompts</h1>

      {prompts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-400 text-sm">No prompts right now</p>
          <p className="text-zinc-300 dark:text-zinc-600 text-xs mt-1">
            {engine.execution.phase === 'work'
              ? `Working... ${formatTime(engine.timer.remainingMs)} remaining`
              : engine.execution.phase === 'break'
                ? `On break... ${formatTime(engine.timer.remainingMs)} remaining`
                : 'Start a tile to get prompts'
            }
          </p>
        </div>
      ) : (
        prompts.map(prompt => (
          <div
            key={prompt.id}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              {prompt.type === 'start' ? 'Start' : prompt.type === 'end' ? 'Complete' : prompt.type === 'break' ? 'Break' : 'Extend'}
            </div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              {prompt.title}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{prompt.message}</p>
            <div className="flex flex-wrap gap-2">
              {prompt.actions.map(action => (
                <button
                  key={action.label}
                  onClick={action.action}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                    action.primary
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90'
                      : 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

**Step 2: コミット**

```bash
git add src/app/app/prompt/page.tsx
git commit -m "feat(prompt): rebuild prompt page with execution engine integration"
```

---

## Task 14: 通知音ファイル + PWA マニフェスト更新

**Files:**
- Create: `tastile-web/public/notification.mp3` (無音または軽量な通知音 — 実装者が用意)
- Modify: `tastile-web/public/manifest.json` (もし存在すれば)

**Step 1: 通知音**

`public/notification.mp3` に軽量な通知音を配置する。フリー素材サイト (例: mixkit.co) からダウンロードするか、Web Audio API で生成する方法でもOK。

代替案: Web Audio API で動的にビープ音を生成する。通知音ファイルが不要になる。

`src/lib/engine/notification.ts` を作成:

```typescript
export function playNotificationBeep() {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gain.gain.value = 0.3
    oscillator.start()
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    oscillator.stop(ctx.currentTime + 0.5)
  } catch {}
}
```

**Step 2: useExecutionEngine.ts のサウンド部分を更新**

`new Audio('/notification.mp3')` を `playNotificationBeep()` に置き換える。

**Step 3: コミット**

```bash
git add src/lib/engine/notification.ts
git commit -m "feat(notification): add Web Audio API beep notification"
```

---

## Task 15: /app/page.tsx リダイレクト修正

**Files:**
- Modify: `tastile-web/src/app/app/page.tsx`

**Step 1: 確認・修正**

既存の `/app/page.tsx` が `/app/now` にリダイレクトしていることを確認。変更不要ならスキップ。

---

## Task 16: ビルド確認 + 全体テスト

**Step 1: ビルド**

Run: `cd tastile-web && bun run build`
Expected: ビルド成功、エラーなし

**Step 2: Lint**

Run: `cd tastile-web && bun run lint`
Expected: エラーなし (warning は許容)

**Step 3: 手動動作確認**

Run: `cd tastile-web && bun dev`

確認事項:
- [ ] `/app/now` — タイマー表示、タイル追加、Start/Complete 動作
- [ ] `/app/timeline` — セグメントがタイムラインに表示
- [ ] `/app/tiles` — CRUD + フィルタリング動作
- [ ] `/app/prompt` — フェーズに応じたプロンプト表示
- [ ] `/app/memo` — 既存機能が壊れていない
- [ ] BottomNav — 全ナビゲーションリンク動作
- [ ] TimerBar — タイマー作動中にフローティング表示
- [ ] ブラウザ通知 — タイマー完了時に通知

**Step 4: 最終コミット**

```bash
git add -A
git commit -m "feat: complete web pomodoroom with timer, timeline, tasks, and scheduling"
```

---

## ファイルサマリー

| 操作 | ファイル | 内容 |
|------|---------|------|
| Create | `supabase/migrations/20260315000001_add_execution_tables.sql` | segments テーブル + tiles カラム追加 |
| Create | `src/lib/engine/types.ts` | 実行エンジン型定義 |
| Create | `src/lib/engine/timer.ts` | Wall-clock タイマーエンジン |
| Create | `src/lib/engine/store.ts` | React Context ストア |
| Create | `src/lib/engine/notification.ts` | Web Audio 通知音 |
| Create | `src/hooks/useTiles.ts` | タイルCRUD + セグメントフック |
| Create | `src/hooks/useTimer.ts` | タイマーフック |
| Create | `src/hooks/useExecutionEngine.ts` | 統合エンジンフック |
| Create | `src/components/app/Timer.tsx` | タイマーUI |
| Create | `src/components/app/TimerBar.tsx` | フローティングタイマー |
| Create | `src/components/app/PhaseIndicator.tsx` | フェーズ表示 |
| Create | `src/components/app/TileCard.tsx` | タイルカード |
| Create | `src/components/app/TileForm.tsx` | タイル作成/編集フォーム |
| Create | `src/components/app/DayTimeline.tsx` | 24時間タイムライン |
| Create | `src/components/app/BottomNav.tsx` | ボトムナビゲーション |
| Modify | `src/app/app/layout.tsx` | BottomNav統合 + ヘッダー簡略化 |
| Modify | `src/app/app/now/page.tsx` | 全面改修: タイマー + タイルリスト |
| Create | `src/app/app/timeline/page.tsx` | タイムラインページ |
| Create | `src/app/app/tiles/page.tsx` | タイル管理ページ |
| Modify | `src/app/app/prompt/page.tsx` | エンジン連携プロンプト |

## リスク (Top 3)

1. **Supabase スキーマ変更**: `segments` テーブル追加と `tiles` へのカラム追加は既存データに影響しない (`IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`) が、RLS ポリシーの動作確認が必要
2. **タイマー精度**: `requestAnimationFrame` はタブ非アクティブ時にスロットルされる。`setInterval` フォールバックで対応しているが、長時間バックグラウンド放置での精度は wall-clock 参照で保証
3. **状態の不整合**: 複数タブで同時操作した場合、Supabase Realtime を使っていないため状態が不整合になる可能性。将来的に Realtime subscription を追加で解決可能

## 次の3改善

1. Supabase Realtime subscription で複数タブ/デバイス間のリアルタイム同期
2. ドラッグ&ドロップでタイルの並び替え (`@dnd-kit` 導入)
3. 統計ダッシュボード (日別/週別の集中時間チャート)
