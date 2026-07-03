# Web Dashboard Core-Daemon Full Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `tastile-web` の `dashboard` 全体を Core Daemon 正本モデルへ完全移行し、desktop と同一の execution/prompt/timeline 体験を実現する。

**Architecture:** Web 側の `useExecutionEngine`（ローカル event-sourcing 実装）を廃止し、Core Daemon の read model + command API を唯一の状態源に置き換える。UI は投影を表示し、操作はすべて command 送信に統一する。Prompt は永続キューを先頭から表示し、timeline は絶対時間軸（core 生成）を描画する。

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest, Supabase Auth, Core Daemon HTTP/SSE(or WS) API

---

### Task 1: Daemon API 契約を固定し、Web 側でテスト可能な型を導入する

**Files:**
- Create: `tastile-web/src/lib/daemon/contracts.ts`
- Create: `tastile-web/src/lib/daemon/contracts.test.ts`
- Modify: `tastile-web/src/lib/domain/execution.ts`
- Modify: `tastile-web/src/lib/core/command.ts`（Web内部コマンド定義を daemon request 互換に整理）

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseExecutionSnapshot } from './contracts'

describe('daemon contracts', () => {
  it('parses timeline/prompt queue/in-progress tiles from daemon snapshot', () => {
    const snapshot = parseExecutionSnapshot(mockPayload)
    expect(snapshot.inProgressTiles.length).toBeGreaterThan(1)
    expect(snapshot.promptQueue[0].status).toBe('pending')
    expect(snapshot.timeline[0].startAt instanceof Date).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix tastile-web test -- --run src/lib/daemon/contracts.test.ts`
Expected: FAIL with module/function not found

**Step 3: Write minimal implementation**

```ts
export function parseExecutionSnapshot(raw: unknown): ExecutionSnapshot {
  // strict parse + date normalization
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix tastile-web test -- --run src/lib/daemon/contracts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/lib/daemon/contracts.ts tastile-web/src/lib/daemon/contracts.test.ts tastile-web/src/lib/domain/execution.ts tastile-web/src/lib/core/command.ts
git commit -m "feat(web): add core daemon execution contracts"
```

---

### Task 2: Daemon client（read + command + stream）を実装し、再接続戦略を固定する

**Files:**
- Create: `tastile-web/src/lib/daemon/client.ts`
- Create: `tastile-web/src/lib/daemon/stream.ts`
- Create: `tastile-web/src/lib/daemon/client.test.ts`
- Create: `tastile-web/src/lib/daemon/stream.test.ts`
- Modify: `tastile-web/src/lib/supabase/client.ts`（auth token 受け渡し補助）

**Step 1: Write the failing tests**

```ts
it('sends command with auth header and receives accepted envelope', async () => {
  const res = await client.sendCommand({ type: 'start_tile', tileId: 't1' })
  expect(res.accepted).toBe(true)
})

it('reconnects stream and deduplicates events by eventId', async () => {
  // emit duplicate event after reconnect
  expect(seenIds.size).toBe(1)
})
```

**Step 2: Run tests to verify failure**

Run: `npm --prefix tastile-web test -- --run src/lib/daemon/client.test.ts src/lib/daemon/stream.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export class DaemonClient { /* readSnapshot/sendCommand */ }
export function openExecutionStream(...) { /* reconnect + dedupe */ }
```

**Step 4: Run tests to verify pass**

Run: `npm --prefix tastile-web test -- --run src/lib/daemon/client.test.ts src/lib/daemon/stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/lib/daemon/client.ts tastile-web/src/lib/daemon/stream.ts tastile-web/src/lib/daemon/client.test.ts tastile-web/src/lib/daemon/stream.test.ts tastile-web/src/lib/supabase/client.ts
git commit -m "feat(web): add daemon read-command-stream client"
```

---

### Task 3: 新しい Execution Store を実装し、`useExecutionEngine` を置換する

**Files:**
- Create: `tastile-web/src/lib/hooks/use-daemon-execution.ts`
- Create: `tastile-web/src/lib/hooks/use-daemon-execution.test.tsx`
- Modify: `tastile-web/src/lib/hooks/execution-engine-context.tsx`
- Modify: `tastile-web/src/lib/hooks/use-execution-engine.ts`（deprecated wrapper化 or 削除準備）

**Step 1: Write the failing test**

```tsx
it('hydrates from daemon snapshot and updates via stream events', async () => {
  const { result } = renderHook(() => useDaemonExecution(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.state.tiles.size).toBeGreaterThan(0)
})
```

**Step 2: Run test to verify failure**

Run: `npm --prefix tastile-web test -- --run src/lib/hooks/use-daemon-execution.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export function useDaemonExecution() {
  // snapshot fetch -> stream subscription -> command dispatch
}
```

**Step 4: Run test to verify pass**

Run: `npm --prefix tastile-web test -- --run src/lib/hooks/use-daemon-execution.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/lib/hooks/use-daemon-execution.ts tastile-web/src/lib/hooks/use-daemon-execution.test.tsx tastile-web/src/lib/hooks/execution-engine-context.tsx tastile-web/src/lib/hooks/use-execution-engine.ts
git commit -m "refactor(web): switch dashboard state source to daemon execution hook"
```

---

### Task 4: Header/AppShell/Execute を daemon projection 前提に再配線する

**Files:**
- Modify: `tastile-web/src/components/layout/AppShell.tsx`
- Modify: `tastile-web/src/components/layout/Header.tsx`
- Modify: `tastile-web/src/components/execution/ActiveExecutionBar.tsx`
- Modify: `tastile-web/src/components/execution/ActiveExecutionBadge.tsx`
- Modify: `tastile-web/src/app/dashboard/execute/page.tsx`
- Test: `tastile-web/src/components/execution/GlobalPromptBanner.test.tsx`

**Step 1: Write the failing UI test**

```tsx
it('shows top prompt from queue and dispatches selected action command', async () => {
  render(<AppShell ... />)
  await user.click(screen.getByRole('button', { name: /start/i }))
  expect(sendCommandMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'start_tile' }))
})
```

**Step 2: Run test to verify failure**

Run: `npm --prefix tastile-web test -- --run src/components/execution/GlobalPromptBanner.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
const pending = state.promptQueue[0] ?? null
// action -> daemon command mapping only
```

**Step 4: Run test to verify pass**

Run: `npm --prefix tastile-web test -- --run src/components/execution/GlobalPromptBanner.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/components/layout/AppShell.tsx tastile-web/src/components/layout/Header.tsx tastile-web/src/components/execution/ActiveExecutionBar.tsx tastile-web/src/components/execution/ActiveExecutionBadge.tsx tastile-web/src/app/dashboard/execute/page.tsx tastile-web/src/components/execution/GlobalPromptBanner.test.tsx
git commit -m "feat(web): wire execute/header prompt flow to daemon projection"
```

---

### Task 5: Timeline を absolute-axis + core projection 表示へ置換する

**Files:**
- Modify: `tastile-web/src/components/execution/TimelineAxis.tsx`
- Modify: `tastile-web/src/components/timeline/TimelineView.tsx`
- Modify: `tastile-web/src/lib/core/reducer/index.ts`（`buildTimelineView` の UI fallback を削除し、projection adapter 化）
- Create: `tastile-web/src/components/execution/TimelineAxis.test.tsx`

**Step 1: Write the failing test**

```tsx
it('renders absolute time axis and preserves order from daemon timeline', () => {
  render(<TimelineAxis items={items} />)
  expect(screen.getAllByTestId('timeline-time')[0]).toHaveTextContent('09:30')
  expect(screen.getAllByTestId('timeline-time')[1]).toHaveTextContent('10:45')
})
```

**Step 2: Run test to verify failure**

Run: `npm --prefix tastile-web test -- --run src/components/execution/TimelineAxis.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// consume daemon timeline rows directly; no synthetic phase reconstruction in UI
```

**Step 4: Run test to verify pass**

Run: `npm --prefix tastile-web test -- --run src/components/execution/TimelineAxis.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/components/execution/TimelineAxis.tsx tastile-web/src/components/timeline/TimelineView.tsx tastile-web/src/lib/core/reducer/index.ts tastile-web/src/components/execution/TimelineAxis.test.tsx
git commit -m "feat(web): render core projected absolute timeline axis"
```

---

### Task 6: `tiles` / `history` / `right sidebar` を同一 projection に統一する

**Files:**
- Modify: `tastile-web/src/app/dashboard/tiles/page.tsx`
- Modify: `tastile-web/src/app/dashboard/history/page.tsx`
- Modify: `tastile-web/src/components/layout/RightSidebar.tsx`
- Modify: `tastile-web/src/components/account/TileStatistics.tsx`
- Create: `tastile-web/src/app/dashboard/history/page.test.tsx`

**Step 1: Write the failing test**

```tsx
it('history page uses daemon events projection and does not read local reducer events', () => {
  render(<HistoryPage />)
  expect(screen.getByText(/tile_started/i)).toBeInTheDocument()
})
```

**Step 2: Run test to verify failure**

Run: `npm --prefix tastile-web test -- --run src/app/dashboard/history/page.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// switch state source to daemon projection slices for all dashboard pages
```

**Step 4: Run test to verify pass**

Run: `npm --prefix tastile-web test -- --run src/app/dashboard/history/page.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/app/dashboard/tiles/page.tsx tastile-web/src/app/dashboard/history/page.tsx tastile-web/src/components/layout/RightSidebar.tsx tastile-web/src/components/account/TileStatistics.tsx tastile-web/src/app/dashboard/history/page.test.tsx
git commit -m "refactor(web): unify dashboard pages on daemon projection"
```

---

### Task 7: 旧ローカル Execution 実装を段階削除し、回帰テストを更新する

**Files:**
- Modify: `tastile-web/src/lib/core/state.ts`
- Modify: `tastile-web/src/lib/domain/execution.ts`
- Modify: `tastile-web/src/lib/core/reducer/index.ts`
- Modify: `tastile-web/src/lib/hooks/use-execution-engine.test.tsx`
- Modify: `tastile-web/src/lib/core/prompt-parity.test.ts`
- Modify: `tastile-web/src/lib/core/handler.test.ts`（daemon境界に寄せる）

**Step 1: Write failing migration guard tests**

```ts
it('does not expose legacy phaseKind/execution aggregate in dashboard state', () => {
  expect('execution' in currentState).toBe(false)
})
```

**Step 2: Run tests to verify failure**

Run: `npm --prefix tastile-web test -- --run src/lib/hooks/use-execution-engine.test.tsx src/lib/core/prompt-parity.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// remove legacy aggregate usage from dashboard path, keep compatibility where strictly needed
```

**Step 4: Run tests to verify pass**

Run: `npm --prefix tastile-web test -- --run src/lib/hooks/use-execution-engine.test.tsx src/lib/core/prompt-parity.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tastile-web/src/lib/core/state.ts tastile-web/src/lib/domain/execution.ts tastile-web/src/lib/core/reducer/index.ts tastile-web/src/lib/hooks/use-execution-engine.test.tsx tastile-web/src/lib/core/prompt-parity.test.ts tastile-web/src/lib/core/handler.test.ts
git commit -m "refactor(web): remove legacy local execution ownership from dashboard"
```

---

### Task 8: E2E 相当の統合検証（ローカル起動→手動確認→build/test）とリリース準備

**Files:**
- Modify: `tastile-web/src/app/dashboard/layout-client.tsx`
- Modify: `tastile-web/src/app/dashboard/dashboard-shell.ui.test.tsx`
- Modify: `tastile-web/src/components/layout/AppShell.tsx`（最終調整）
- Modify: `C:\Users\rebui\.copilot\session-state\c0b7091f-9982-4ea0-b990-7e3ccf829d6b\plan.md`（完了更新）

**Step 1: Write failing integration test**

```tsx
it('dashboard shell keeps same daemon-backed execution state across execute/tiles/history routes', async () => {
  // navigate tabs and assert active tile + prompt queue continuity
})
```

**Step 2: Run test to verify failure**

Run: `npm --prefix tastile-web test -- --run src/app/dashboard/dashboard-shell.ui.test.tsx`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// ensure single provider lifecycle + route-safe state subscription
```

**Step 4: Run full verification**

Run:
- `npm --prefix tastile-web test -- --run --silent`
- `npm --prefix tastile-web build`

Expected: PASS

Manual check:
- `npm --prefix tastile-web dev`
- `/dashboard/execute`, `/dashboard/tiles`, `/dashboard/history` で
  - prompt が queue 順に出る
  - status icon で prompt を起動できる
  - header 残り時間が 0:00 固定にならない
  - timeline が絶対時間軸で表示される

**Step 5: Commit**

```bash
git add tastile-web/src/app/dashboard/layout-client.tsx tastile-web/src/app/dashboard/dashboard-shell.ui.test.tsx tastile-web/src/components/layout/AppShell.tsx C:\Users\rebui\.copilot\session-state\c0b7091f-9982-4ea0-b990-7e3ccf829d6b\plan.md
git commit -m "feat(web): complete dashboard-wide core daemon migration and parity checks"
```

---

## Notes / Guardrails

- 実装中は `@test-driven-development` を適用（RED→GREEN→REFACTOR）。
- リアルタイム不具合時は `@systematic-debugging` を適用し、再現条件を先に固定する。
- 実装完了後は `@requesting-code-review` で parity 観点レビューを必須化する。
- 既存の local reducer/handler は dashboard ルートから責務を外し、別用途がない場合は削除する（YAGNI）。
- すべての dashboard 操作は「UI state mutation」ではなく「daemon command dispatch」に統一する。
