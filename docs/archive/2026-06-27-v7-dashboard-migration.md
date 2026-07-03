# v7 → v1 Dashboard Migration Plan (CORRECTED)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: Migrate `tastile-web` dashboard（22 ディレクトリ / 24 page.tsx）from v7 condition vectors / event-sourcing reducer to v1 by **consuming existing v1 infrastructure** in `src/lib/domain/v1/`, `src/lib/api/v1-endpoints.ts`, `src/lib/api/error-mapper.ts`, `src/lib/stores/quick-create-store.ts`, and `src/components/tiles/`. Delete v7 files entirely, no flag switching, no `_old/` archive, no parallel set rebuild.

**Architecture**: Server Components prefetch via TanStack Query → dehydrate → Client Components. v1 envelope (`expectedRevision` / `idempotencyKey` / `occurredAt` / `payload`) for mutations (via existing `V1Client` in `v1-endpoints.ts`). SSE for realtime, BroadcastChannel for multi-tab, 10s poll fallback. zustand `QuickCreateStore` retains form state; TanStack Query owns server cache.

**Tech Stack**: Next.js 15 App Router, TanStack Query v5, zustand, EventSource, BroadcastChannel, MSW (tests), vitest, `bun x biome lint`, chrome-devtools MCP (E2E).

**Hard Constraints** (from CLAUDE.md / project memory):
- v1 only. NO v7 fallback, NO `_old/`, NO flag switching.
- **DO NOT rebuild existing v1 infra**. `domain/v1/*`, `api/v1-endpoints.ts`, `api/error-mapper.ts`, `stores/quick-create-store.ts`, `components/tiles/*` are ALREADY v1. Consume them.
- Conventional Commits: `feat(v1):` / `fix(v1):` / `chore(v1):` / `test(v1):` / `docs(v1):`.
- `TileKind` numeric constant is for icon/label only, never for behavior branching.
- No `status` / `running` / `active` stored fields — derived from events.
- No UI-specific commands — domain-level only.
- lucide-react icons only (no emoji, no custom SVG).
- Use targeted `bun x vitest run <files>` — `bun test` has pre-existing merge conflict failures.

**Reference**: `docs/superpowers/specs/2026-06-27-v7-dashboard-migration-design.md`

**Existing v1 foundation (DO NOT RECREATE)**:
- `src/lib/domain/v1/constants.ts` — 82+ numeric constants incl. `ApiErrorKind`, `TileKind`, `PlanRole`, etc.
- `src/lib/domain/v1/envelope.ts` — `CommandRequest<T>`, `CommandResponse`, `ApiError` (numeric kind)
- `src/lib/domain/v1/{actor,change-set,completion,condition,execution,metric,placement,reference,tile,window}.ts`
- `src/lib/api/v1-endpoints.ts` — `V1Client` interface + `Result<T>` type (existing!)
- `src/lib/api/error-mapper.ts` — `mapApiErrorToMessage(err: ApiError): UiMessage` (existing!)
- `src/lib/stores/quick-create-store.ts` — QuickCreateStore with identity/plan/time/windows/recurring/advanced/meta/submit slices (existing!)
- `src/components/tiles/QuickTileCreate.tsx` + sub-panels + build-command + submit-quick-create (v1)

---

## Phase A: Missing Infra Layer

> **A1 already complete** (commit `7347f70`). Tasks A2-A8 are the only NEW infra files needed.

### Task A1: Next.js rewrite `/api/v1/*` → `/api/proxy/v1/*` ✅ DONE

Commit: `7347f70887361e81d4c847ea563b517259851187`. Verify on resume with `git show 7347f70 -- next.config.ts`.

---

### Task A2: v1-keys.ts (TanStack Query key factory)

**Files:**
- Create: `tastile-web/src/lib/state/v1-keys.ts`
- Create: `tastile-web/src/lib/state/v1-keys.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tastile-web/src/lib/state/v1-keys.test.ts
import { describe, expect, it } from "vitest";
import { v1Keys } from "./v1-keys";

describe("v1Keys", () => {
  it("all() returns base key", () => {
    expect(v1Keys.all).toEqual(["v1"]);
  });
  it("tiles.* hierarchy", () => {
    expect(v1Keys.tiles.all).toEqual(["v1", "tiles"]);
    expect(v1Keys.tiles.list()).toEqual(["v1", "tiles", "list"]);
    expect(v1Keys.tiles.detail("t1")).toEqual(["v1", "tiles", "detail", "t1"]);
  });
  it("plans.* hierarchy", () => {
    expect(v1Keys.plans.list()).toEqual(["v1", "plans", "list"]);
    expect(v1Keys.plans.detail("p1")).toEqual(["v1", "plans", "detail", "p1"]);
  });
  it("placements.* hierarchy", () => {
    expect(v1Keys.placements.list()).toEqual(["v1", "placements", "list"]);
    expect(v1Keys.placements.detail("pl1")).toEqual(["v1", "placements", "detail", "pl1"]);
  });
  it("executions.* hierarchy", () => {
    expect(v1Keys.executions.list()).toEqual(["v1", "executions", "list"]);
    expect(v1Keys.executions.detail("ex1")).toEqual(["v1", "executions", "detail", "ex1"]);
  });
  it("sync() returns sync cursor key", () => {
    expect(v1Keys.sync()).toEqual(["v1", "sync"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tastile-web && bun x vitest run src/lib/state/v1-keys.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement v1Keys**

```ts
// tastile-web/src/lib/state/v1-keys.ts
export const v1Keys = {
  all: ["v1"] as const,
  tiles: {
    all: ["v1", "tiles"] as const,
    list: () => ["v1", "tiles", "list"] as const,
    detail: (id: string) => ["v1", "tiles", "detail", id] as const,
  },
  plans: {
    all: ["v1", "plans"] as const,
    list: () => ["v1", "plans", "list"] as const,
    detail: (id: string) => ["v1", "plans", "detail", id] as const,
  },
  placements: {
    all: ["v1", "placements"] as const,
    list: () => ["v1", "placements", "list"] as const,
    detail: (id: string) => ["v1", "placements", "detail", id] as const,
  },
  executions: {
    all: ["v1", "executions"] as const,
    list: () => ["v1", "executions", "list"] as const,
    detail: (id: string) => ["v1", "executions", "detail", id] as const,
  },
  sync: () => ["v1", "sync"] as const,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tastile-web && bun x vitest run src/lib/state/v1-keys.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/lib/state/v1-keys.ts src/lib/state/v1-keys.test.ts && git commit -m "feat(v1): add v1Keys query key factory for TanStack Query"
```

---

### Task A3: query-client.ts singleton

**Files:**
- Create: `tastile-web/src/lib/state/query-client.ts`

- [ ] **Step 1: Implement QueryClient singleton**

```ts
// tastile-web/src/lib/state/query-client.ts
import { QueryClient } from "@tanstack/react-query";
import { ApiErrorKind } from "@/lib/domain/v1/constants";

let client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server: always create fresh client to avoid cross-request leaks
    return makeClient();
  }
  if (!client) client = makeClient();
  return client;
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error: unknown) => {
          const kind = (error as { kind?: number })?.kind;
          // Don't retry validation, forbidden, or stale-revision
          if (
            kind === ApiErrorKind.VALIDATION ||
            kind === ApiErrorKind.FORBIDDEN ||
            kind === ApiErrorKind.STALE_REVISION
          ) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
```

- [ ] **Step 2: Verify type-checks**

```bash
cd tastile-web && bun x tsc --noEmit src/lib/state/query-client.ts 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd tastile-web && git add src/lib/state/query-client.ts && git commit -m "feat(v1): add QueryClient singleton with smart retry policy (skips VALIDATION/FORBIDDEN/STALE_REVISION)"
```

---

### Task A4: app/providers.tsx (QueryClientProvider)

**Files:**
- Create: `tastile-web/src/app/providers.tsx`
- Modify: `tastile-web/src/app/layout.tsx`

- [ ] **Step 1: Implement Providers**

```tsx
// tastile-web/src/app/providers.tsx
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { getQueryClient } from "@/lib/state/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => getQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Wire Providers into root layout**

Modify `src/app/layout.tsx`: wrap `{children}` inside `<Providers>...</Providers>`.

- [ ] **Step 3: Verify dev server starts (best-effort)**

```bash
cd tastile-web && bun dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

Expected: `200` OR `500` due to pre-existing `src/proxy.ts` merge conflict (acceptable — not introduced by this task).

- [ ] **Step 4: Commit**

```bash
cd tastile-web && git add src/app/providers.tsx src/app/layout.tsx && git commit -m "feat(v1): add Providers wrapping QueryClientProvider in root layout"
```

---

### Task A5: SSE client (sse.ts)

**Files:**
- Create: `tastile-web/src/lib/realtime/sse.ts`
- Create: `tastile-web/src/lib/realtime/sse.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tastile-web/src/lib/realtime/sse.test.ts
import { describe, expect, it, vi } from "vitest";
import { SseClient } from "./sse";

describe("SseClient", () => {
  it("connects to given URL and emits parsed events", () => {
    const onEvent = vi.fn();
    const close = vi.fn();
    class MockEventSource {
      url: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) { this.url = url; }
      close = close;
    }
    (globalThis as any).EventSource = MockEventSource;
    const sse = new SseClient({ url: "/api/v1/sync/stream", onEvent });
    sse.connect();
    expect((sse as any).es.url).toBe("/api/v1/sync/stream");
    const evt = new MessageEvent("message", { data: JSON.stringify({ kind: "tile", id: "t1", revision: 2 }) });
    (sse as any).es.onmessage?.(evt);
    expect(onEvent).toHaveBeenCalledWith({ kind: "tile", id: "t1", revision: 2 });
    sse.disconnect();
    expect(close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/sse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement SseClient**

```ts
// tastile-web/src/lib/realtime/sse.ts
export type SseEvent = { kind: "tile" | "placement" | "execution"; id: string; revision: number };

export type SseClientOpts = {
  url: string;
  onEvent: (e: SseEvent) => void;
  onError?: (e: Event) => void;
  onOpen?: () => void;
};

export class SseClient {
  private es: EventSource | null = null;
  constructor(private opts: SseClientOpts) {}

  connect(): void {
    if (this.es) return;
    const es = new EventSource(this.opts.url);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as SseEvent;
        this.opts.onEvent(data);
      } catch { /* ignore malformed */ }
    };
    es.onerror = (e) => this.opts.onError?.(e);
    es.onopen = () => this.opts.onOpen?.();
    this.es = es;
  }

  disconnect(): void {
    this.es?.close();
    this.es = null;
  }

  isConnected(): boolean {
    return this.es !== null && this.es.readyState === EventSource.OPEN;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/sse.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/lib/realtime/sse.ts src/lib/realtime/sse.test.ts && git commit -m "feat(v1): add SseClient wrapper around EventSource"
```

---

### Task A6: Poll fallback (poll.ts)

**Files:**
- Create: `tastile-web/src/lib/realtime/poll.ts`
- Create: `tastile-web/src/lib/realtime/poll.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tastile-web/src/lib/realtime/poll.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PollClient } from "./poll";

describe("PollClient", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("polls at given interval and emits sync events", async () => {
    const onEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ changes: [{ kind: "tile", id: "t1", revision: 2 }], next_cursor: "c1" }),
    });
    const pc = new PollClient({ url: "/api/v1/sync", intervalMs: 10_000, onEvent });
    pc.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onEvent).toHaveBeenCalledWith({ kind: "tile", id: "t1", revision: 2 });
    pc.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/poll.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement PollClient**

```ts
// tastile-web/src/lib/realtime/poll.ts
import type { SseEvent } from "./sse";

export type PollClientOpts = {
  url: string;
  intervalMs: number;
  onEvent: (e: SseEvent) => void;
};

export class PollClient {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor: string | null = null;

  constructor(private opts: PollClientOpts) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const url = this.cursor ? `${this.opts.url}?cursor=${this.cursor}` : this.opts.url;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const body = await res.json() as { changes: SseEvent[]; next_cursor?: string };
      for (const c of body.changes) this.opts.onEvent(c);
      if (body.next_cursor) this.cursor = body.next_cursor;
    } catch { /* network error — next tick */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/poll.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/lib/realtime/poll.ts src/lib/realtime/poll.test.ts && git commit -m "feat(v1): add PollClient 10s fallback for SSE"
```

---

### Task A7: BroadcastChannel wrapper (broadcast.ts)

**Files:**
- Create: `tastile-web/src/lib/realtime/broadcast.ts`
- Create: `tastile-web/src/lib/realtime/broadcast.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tastile-web/src/lib/realtime/broadcast.test.ts
import { describe, expect, it } from "vitest";
import { Broadcaster } from "./broadcast";

describe("Broadcaster", () => {
  it("post sends message, onMessage receives from other channel", () => {
    const channelName = "tastile-test";
    const received: any[] = [];
    const ch1 = new BroadcastChannel(channelName);
    const ch2 = new BroadcastChannel(channelName);
    ch2.onmessage = (e) => received.push(e.data);
    ch1.postMessage({ type: "invalidate", keys: [["v1", "tiles"]] });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(received).toEqual([{ type: "invalidate", keys: [["v1", "tiles"]] }]);
        ch1.close(); ch2.close();
        resolve();
      }, 50);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/broadcast.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Broadcaster**

```ts
// tastile-web/src/lib/realtime/broadcast.ts
export type BroadcastMessage = { type: "invalidate"; keys: readonly (readonly string[])[] };

export class Broadcaster {
  private ch: BroadcastChannel | null = null;

  constructor(private channelName: string) {}

  open(handler: (msg: BroadcastMessage) => void): void {
    if (typeof BroadcastChannel === "undefined") return;
    if (this.ch) return;
    this.ch = new BroadcastChannel(this.channelName);
    this.ch.onmessage = (e) => handler(e.data as BroadcastMessage);
  }

  post(msg: BroadcastMessage): void {
    this.ch?.postMessage(msg);
  }

  close(): void {
    this.ch?.close();
    this.ch = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tastile-web && bun x vitest run src/lib/realtime/broadcast.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/lib/realtime/broadcast.ts src/lib/realtime/broadcast.test.ts && git commit -m "feat(v1): add Broadcaster wrapper around BroadcastChannel for multi-tab sync"
```

---

### Task A8: useRealtime hook (composes SSE + Poll + BroadcastChannel)

**Files:**
- Create: `tastile-web/src/lib/state/use-realtime.ts`

- [ ] **Step 1: Implement hook**

```ts
// tastile-web/src/lib/state/use-realtime.ts
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SseClient, type SseEvent } from "@/lib/realtime/sse";
import { PollClient } from "@/lib/realtime/poll";
import { Broadcaster } from "@/lib/realtime/broadcast";
import { v1Keys } from "@/lib/state/v1-keys";

export function useRealtime(userSub: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userSub) return;

    const invalidate = (e: SseEvent) => {
      if (e.kind === "tile") qc.invalidateQueries({ queryKey: v1Keys.tiles.detail(e.id) });
      if (e.kind === "placement") qc.invalidateQueries({ queryKey: v1Keys.placements.detail(e.id) });
      if (e.kind === "execution") qc.invalidateQueries({ queryKey: v1Keys.executions.detail(e.id) });
      qc.invalidateQueries({ queryKey: v1Keys.tiles.list() });
      qc.invalidateQueries({ queryKey: v1Keys.placements.list() });
      qc.invalidateQueries({ queryKey: v1Keys.executions.list() });
    };

    const bc = new Broadcaster(`tastile-${userSub}`);
    bc.open((msg) => {
      if (msg.type === "invalidate") {
        for (const key of msg.keys) qc.invalidateQueries({ queryKey: key as string[] });
      }
    });

    const sse = new SseClient({
      url: "/api/v1/sync/stream",
      onEvent: (e) => {
        invalidate(e);
        bc.post({ type: "invalidate", keys: [v1Keys.tiles.detail(e.id), v1Keys.tiles.list()] });
      },
      onError: () => { sse.disconnect(); poll.start(); },
    });
    const poll = new PollClient({ url: "/api/v1/sync", intervalMs: 10_000, onEvent: invalidate });
    sse.connect();

    return () => { sse.disconnect(); poll.stop(); bc.close(); };
  }, [userSub, qc]);
}
```

- [ ] **Step 2: Verify type-checks**

```bash
cd tastile-web && bun x tsc --noEmit src/lib/state/use-realtime.ts 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd tastile-web && git add src/lib/state/use-realtime.ts && git commit -m "feat(v1): add useRealtime hook composing SSE/Poll/BroadcastChannel"
```

---

## Phase B: TanStack Query Hooks (consume existing V1Client)

### Task B1: v1-hooks.ts (read + mutation hooks for all 4 aggregates)

**Files:**
- Create: `tastile-web/src/lib/state/v1-hooks.ts`
- Create: `tastile-web/src/lib/state/v1-hooks.test.ts`

- [ ] **Step 1: Read existing V1Client interface**

```bash
cd tastile-web && grep -n "export interface V1Client\|export type Result" src/lib/api/v1-endpoints.ts | head -5
```

Confirm shape:
```ts
export interface V1Client { baseUrl: string; getIdToken: () => Promise<string | null>; }
export type Result<T> = { ok: true; data: T; status: number } | { ok: false; error: ApiError };
```

- [ ] **Step 2: Write failing test**

```ts
// tastile-web/src/lib/state/v1-hooks.test.ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTiles } from "./v1-hooks";

const wrapper = (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe("useTiles", () => {
  it("fetches tile list and parses Result<T>", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [{ id: "t1", revision: 0, title: "x" }],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTiles({ baseUrl: "https://x", getIdToken: async () => "t" }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].id).toBe("t1");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd tastile-web && bun x vitest run src/lib/state/v1-hooks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement v1-hooks.ts**

```ts
// tastile-web/src/lib/state/v1-hooks.ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { V1Client, Result } from "@/lib/api/v1-endpoints";
import type { ApiError, CommandRequest, CommandResponse } from "@/lib/domain/v1/envelope";
import type { Tile, Plan, Placement, Execution } from "@/lib/domain/v1/tile";
import { v1Keys } from "./v1-keys";

type ClientOpts = { baseUrl: string; getIdToken: () => Promise<string | null> };

function clientOf(opts: ClientOpts): V1Client { return opts; }

// READ
export function useTiles(opts: ClientOpts) {
  return useQuery({
    queryKey: v1Keys.tiles.list(),
    queryFn: async () => {
      const r = await fetch(`${opts.baseUrl}/v1/sync/tiles`, {
        headers: { Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Tile[];
    },
  });
}

export function useTile(opts: ClientOpts, id: string) {
  return useQuery({
    queryKey: v1Keys.tiles.detail(id),
    queryFn: async () => {
      const r = await fetch(`${opts.baseUrl}/v1/tiles/${id}`, {
        headers: { Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Tile;
    },
    enabled: !!id,
  });
}

export function usePlans(opts: ClientOpts) {
  return useQuery({
    queryKey: v1Keys.plans.list(),
    queryFn: async () => {
      const r = await fetch(`${opts.baseUrl}/v1/sync/plans`, {
        headers: { Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Plan[];
    },
  });
}

export function usePlacements(opts: ClientOpts) {
  return useQuery({
    queryKey: v1Keys.placements.list(),
    queryFn: async () => {
      const r = await fetch(`${opts.baseUrl}/v1/sync/placements`, {
        headers: { Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Placement[];
    },
  });
}

export function useExecutions(opts: ClientOpts) {
  return useQuery({
    queryKey: v1Keys.executions.list(),
    queryFn: async () => {
      const r = await fetch(`${opts.baseUrl}/v1/sync/executions`, {
        headers: { Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Execution[];
    },
  });
}

// MUTATIONS (envelope: expectedRevision + idempotencyKey + occurredAt + payload)
export function useCreateTile(opts: ClientOpts) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { payload: unknown; expectedRevision: number }) => {
      const body: CommandRequest<unknown> = {
        expectedRevision: vars.expectedRevision,
        idempotencyKey: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: vars.payload,
      };
      const r = await fetch(`${opts.baseUrl}/v1/tiles`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Tile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: v1Keys.tiles.list() });
    },
  });
}

export function useStartExecution(opts: ClientOpts) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { placementId: string; payload: unknown; expectedRevision: number }) => {
      const body: CommandRequest<unknown> = {
        expectedRevision: vars.expectedRevision,
        idempotencyKey: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: vars.payload,
      };
      const r = await fetch(`${opts.baseUrl}/v1/placements/${vars.placementId}/executions`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Execution;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: v1Keys.executions.list() });
    },
  });
}

export function useCompleteExecution(opts: ClientOpts) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { executionId: string; payload: unknown; expectedRevision: number }) => {
      const body: CommandRequest<unknown> = {
        expectedRevision: vars.expectedRevision,
        idempotencyKey: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: vars.payload,
      };
      const r = await fetch(`${opts.baseUrl}/v1/executions/${vars.executionId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await opts.getIdToken() ?? ""}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await mapFetchToApiError(r);
      return (await r.json()) as Execution;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: v1Keys.executions.list() });
    },
  });
}

// helper
async function mapFetchToApiError(r: Response): Promise<ApiError> {
  try {
    const body = await r.json() as Partial<ApiError>;
    return {
      kind: body.kind ?? 7, // RETRYABLE default
      message: body.message ?? r.statusText,
      currentRevision: body.currentRevision ?? null,
      violations: body.violations ?? [],
    };
  } catch {
    return { kind: 7, message: r.statusText, currentRevision: null, violations: [] };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd tastile-web && bun x vitest run src/lib/state/v1-hooks.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 6: Commit**

```bash
cd tastile-web && git add src/lib/state/v1-hooks.ts src/lib/state/v1-hooks.test.ts && git commit -m "feat(v1): add TanStack Query hooks (read+mutate) for tiles/plans/placements/executions"
```

---

## Phase C: v7 File Deletion

### Task C1: Delete v7 lib directories

- [ ] **Step 1: Verify no current importer exists**

```bash
cd tastile-web && grep -rE "from ['\"]@/lib/(core|scheduler|projection|notifications|account|security|storage)" src --include="*.ts" --include="*.tsx" 2>&1 | wc -l
```

Expected: 0 (after Phase D v1-ization; if not, fix importers first).

- [ ] **Step 2: Delete directories**

```bash
cd tastile-web && git rm -r src/lib/core src/lib/scheduler src/lib/projection src/lib/notifications src/lib/account src/lib/security src/lib/storage
```

- [ ] **Step 3: Verify type-check**

```bash
cd tastile-web && bun x tsc --noEmit 2>&1 | head -30
```

Expected: no new errors introduced (pre-existing merge conflicts OK).

- [ ] **Step 4: Commit**

```bash
cd tastile-web && git commit -m "chore(v1): delete v7 lib/{core,scheduler,projection,notifications,account,security,storage}"
```

---

### Task C2: Delete v7 domain + endpoints files

- [ ] **Step 1: Verify no current importer**

```bash
cd tastile-web && grep -rE "from ['\"]@/lib/domain/(tile|actor|execution|ids)|from ['\"]@/lib/api/endpoints['\"]" src --include="*.ts" --include="*.tsx" 2>&1 | wc -l
```

Expected: 0.

- [ ] **Step 2: Delete files**

```bash
cd tastile-web && git rm src/lib/domain/tile.ts src/lib/domain/actor.ts src/lib/domain/execution.ts src/lib/domain/ids.ts src/lib/api/endpoints.ts
```

- [ ] **Step 3: Verify type-check**

```bash
cd tastile-web && bun x tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd tastile-web && git commit -m "chore(v1): delete v7 domain/{tile,actor,execution,ids} and api/endpoints"
```

---

### Task C3: Delete v7 hooks

- [ ] **Step 1: Verify no current importer**

```bash
cd tastile-web && grep -rE "use-(active-tile|calendar-projection|daemon-execution|execution-engine|placements|recurring-templates|sse-sync|tile-list)" src --include="*.ts" --include="*.tsx" 2>&1 | wc -l
```

Expected: 0.

- [ ] **Step 2: Delete files**

```bash
cd tastile-web && git rm src/lib/hooks/use-active-tile.ts src/lib/hooks/use-calendar-projection.ts src/lib/hooks/use-daemon-execution.ts src/lib/hooks/use-execution-engine.ts src/lib/hooks/use-placements.ts src/lib/hooks/use-recurring-templates.ts src/lib/hooks/use-sse-sync.ts src/lib/hooks/use-tile-list.ts src/lib/hooks/use-execution-engine.test.tsx src/lib/hooks/use-daemon-execution.test.tsx src/lib/hooks/use-placements.test.ts
```

- [ ] **Step 3: Verify type-check + commit**

```bash
cd tastile-web && bun x tsc --noEmit 2>&1 | head -20
cd tastile-web && git commit -m "chore(v1): delete v7 hooks"
```

---

### Task C4: Delete v7 dashboard pages (breaks, prompts)

- [ ] **Step 1: Verify no inbound link**

```bash
cd tastile-web && grep -rE "(/dashboard/breaks|/dashboard/prompts)" src --include="*.ts" --include="*.tsx" 2>&1 | wc -l
```

Expected: 0.

- [ ] **Step 2: Delete directories**

```bash
cd tastile-web && git rm -r src/app/dashboard/breaks src/app/dashboard/prompts
```

- [ ] **Step 3: Verify build + commit**

```bash
cd tastile-web && bun run build 2>&1 | tail -10
cd tastile-web && git commit -m "chore(v1): delete v7 dashboard/breaks (break-as-category forbidden) and dashboard/prompts"
```

---

### Task C5: § 7.1 wire verification

- [ ] **Step 1: Run grep — ZERO v7 imports remain**

```bash
cd tastile-web
grep -rE "from ['\"]@/lib/(domain/(tile|actor|execution|ids)|core|scheduler|projection|notifications|account|security|storage|hooks/use-(active-tile|calendar-projection|daemon-execution|execution-engine|placements|recurring-templates|sse-sync|tile-list))" src/app/dashboard src/components 2>&1
grep -rE "from ['\"]@/lib/api/endpoints['\"]" src/app src/components 2>&1
find src -type d -name "_old" 2>&1
```

Expected: all empty.

---

## Phase D: Component v1-ization (use existing domain/v1/* types)

> Components import v7 types from `@/lib/domain/{tile,actor,execution,ids}`. Replace with `@/lib/domain/v1/*`.

### Task D1-D8: Per-component migration

For each component below, the migration pattern is:

- Replace `from "@/lib/domain/tile"` → `from "@/lib/domain/v1/tile"`
- Replace `from "@/lib/domain/actor"` → `from "@/lib/domain/v1/actor"`
- Replace `from "@/lib/domain/execution"` → `from "@/lib/domain/v1/execution"`
- Replace `from "@/lib/domain/ids"` → `from "@/lib/domain/v1/envelope"` (Uuidv7 helper if needed)
- Replace `from "@/lib/core/command"` → DELETE (v7 reducer; no v1 equivalent — command flow lives in TanStack Query hooks)
- Replace `from "@/lib/core/..."` → DELETE
- Update Tile fields: `condition` → derive from `windows` + `recurring`; `status` → derive from `startedAt`/`completedAt`
- Use `TileKind` (numeric) ONLY for icon/label selection, never for behavior branching

| Task | File |
|---|---|
| D1 | `src/components/dashboard/TileCard.tsx` (may not exist — create from scratch using v1 Tile) |
| D2 | `src/components/layout/AppShell.tsx` (useRealtime hook) |
| D3 | `src/components/layout/Header.tsx` (resolve merge conflict, use v1) |
| D4 | `src/components/layout/RightSidebar.tsx` |
| D5 | `src/components/execution/ActiveExecutionBadge.tsx` |
| D6 | `src/components/execution/GlobalPromptBanner.tsx` + test |
| D7 | `src/components/execution/TimelineAxis.tsx` + test |
| D8 | `src/components/execution/TileEditPanel.tsx` (v1 mutation, defer to separate spec OK) |

For each:

- [ ] **Step 1**: Read component, identify v7 imports
- [ ] **Step 2**: Replace imports with `@/lib/domain/v1/*` (existing types)
- [ ] **Step 3**: Update field accesses to match v1 schema (Tile.kind numeric, no .condition, no .status)
- [ ] **Step 4**: For test files: update fixtures to use numeric kinds, v1 fields
- [ ] **Step 5**: Run `bun x vitest run <file>` — green
- [ ] **Step 6**: Commit with `feat(v1): <file> consumes v1 domain types`

---

## Phase E: Dialog v1-ization

### Task E1-E3: Replace v7 mutations with TanStack Query hooks

Pattern: replace direct fetch / v7 mutation in `src/components/dialogs/*.tsx` with:
- `useCreateTile`, `useStartExecution`, `useCompleteExecution` from `@/lib/state/v1-hooks`
- On error: call `mapApiErrorToMessage(err)` from existing `@/lib/api/error-mapper`

| Task | File |
|---|---|
| E1 | `src/components/dialogs/ConfirmDialog.tsx` |
| E2 | `src/components/dialogs/DeleteTileDialog.tsx` |
| E3 | `src/components/execution/TileEditPanel.tsx` (full impl) |

For each:

- [ ] **Step 1**: Replace direct fetch with hook
- [ ] **Step 2**: Wire `mapApiErrorToMessage` on `mutation.isError`
- [ ] **Step 3**: Verify `bun x tsc --noEmit <file>` clean
- [ ] **Step 4**: Commit with `feat(v1): <file> uses v1 hooks + error-mapper`

---

## Phase F: Dashboard Pages (consume v1 hooks)

### Task F1: dashboard root page (Server Component with prefetch)

- [ ] **Step 1**: Rewrite `src/app/dashboard/page.tsx`:

```tsx
import { Hydrate, dehydrate } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/state/query-client";
import { getIdToken } from "@/lib/daemon/id-token-client";
import { v1Keys } from "@/lib/state/v1-keys";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const token = await getIdToken();
  const baseUrl = process.env.NEXT_PUBLIC_DAEMON_BASE_URL ?? "https://api.tastile.app";
  const qc = getQueryClient();
  const headers = { Authorization: `Bearer ${token ?? ""}` };
  await Promise.all([
    qc.prefetchQuery({ queryKey: v1Keys.tiles.list(), queryFn: async () => (await fetch(`${baseUrl}/v1/sync/tiles`, { headers })).json() }),
    qc.prefetchQuery({ queryKey: v1Keys.placements.list(), queryFn: async () => (await fetch(`${baseUrl}/v1/sync/placements`, { headers })).json() }),
    qc.prefetchQuery({ queryKey: v1Keys.executions.list(), queryFn: async () => (await fetch(`${baseUrl}/v1/sync/executions`, { headers })).json() }),
  ]);
  const state = dehydrate(qc);
  return <Hydrate state={state}><DashboardClient /></Hydrate>;
}
```

- [ ] **Step 2**: Verify + commit

```bash
cd tastile-web && git add src/app/dashboard/page.tsx && git commit -m "feat(v1): dashboard root is Server Component with TanStack Query prefetch + hydrate"
```

---

### Task F2-F22: Per-page migration

For each dashboard page, replace v7 hooks with v1 TanStack Query hooks. Pages to migrate:

| Task | File | Hook to use |
|---|---|---|
| F2 | `src/app/dashboard/tiles/page.tsx` | useTiles |
| F3 | `src/app/dashboard/tiles/[id]/page.tsx` (NEW) | useTile |
| F4 | `src/app/dashboard/tasks/page.tsx` | usePlans |
| F5 | `src/app/dashboard/schedule/page.tsx` | usePlacements |
| F6 | `src/app/dashboard/schedule/[id]/page.tsx` (NEW) | usePlacements + detail |
| F7 | `src/app/dashboard/events/page.tsx` | useExecutions |
| F8 | `src/app/dashboard/events/[id]/page.tsx` (NEW) | useExecutions + detail |
| F9 | `src/app/dashboard/execute/page.tsx` | useTiles + useStartExecution |
| F10 | `src/app/dashboard/timeline/page.tsx` | useExecutions + usePlacements |
| F11 | `src/app/dashboard/calendar/page.tsx` | usePlacements |
| F12 | `src/app/dashboard/calendar/[view]/page.tsx` | usePlacements |
| F13 | `src/app/dashboard/history/page.tsx` | useExecutions (filter completed) |
| F14 | `src/app/dashboard/runtime/page.tsx` | useTiles + useExecutions |
| F15 | `src/app/dashboard/projects/page.tsx` | useTiles (filter recurring) |
| F16 | `src/app/dashboard/preferences/page.tsx` | no v1 hook (settings) |
| F17 | `src/app/dashboard/preferences/account/page.tsx` | no v1 hook |
| F18 | `src/app/dashboard/preferences/general/page.tsx` | no v1 hook |
| F19 | `src/app/dashboard/quota/page.tsx` | no v1 hook |
| F20 | `src/app/dashboard/references/page.tsx` | usePlacements |
| F21 | `src/app/dashboard/integrations/page.tsx` | no v1 hook |
| F22 | `src/app/dashboard/billing/page.tsx` | no v1 hook (Stripe unchanged) |

For each:

- [ ] **Step 1**: Read page, identify v7 imports/hooks
- [ ] **Step 2**: Replace with TanStack Query hooks from `@/lib/state/v1-hooks`
- [ ] **Step 3**: Run `bun x tsc --noEmit <file>` clean
- [ ] **Step 4**: Commit with `feat(v1): dashboard/<path> uses v1 hooks`

---

## Phase G: Auth + E2E

### Task G1: Resolve `src/proxy.ts` merge conflict

- [ ] **Step 1**: Identify conflict markers

```bash
cd tastile-web && grep -n "^<<<<<<<\|^=======\|^>>>>>>>" src/proxy.ts
```

- [ ] **Step 2**: Resolve — keep the `Updated upstream` version (canonical Cognito refresh with refreshTokens + isNativeAuthReturnRequest)
- [ ] **Step 3**: Verify

```bash
cd tastile-web && bun x tsc --noEmit src/proxy.ts 2>&1 | head -10
```

- [ ] **Step 4**: Commit

```bash
cd tastile-web && git add src/proxy.ts && git commit -m "fix: resolve merge conflict in proxy.ts (keep upstream Cognito refresh)"
```

---

### Task G2: Resolve `src/app/login/page.tsx` merge conflict

- [ ] **Step 1-4**: Same pattern as G1

```bash
cd tastile-web && git add src/app/login/page.tsx && git commit -m "fix: resolve merge conflict in login/page.tsx"
```

---

### Task G3: E2E test plan (chrome-devtools MCP)

- [ ] **Step 1**: Create `tastile-web/e2e/dashboard.spec.md` with 22-directory happy-path checklist + 3 negative paths (401 redirect, stale revision, server down)
- [ ] **Step 2**: Commit

```bash
cd tastile-web && git add e2e/dashboard.spec.md && git commit -m "docs(v1): add E2E test plan for 22 dashboard pages + 3 negative paths"
```

---

### Task G4-G5: Manual E2E via chrome-devtools MCP

- [ ] **Step 1**: `docker compose up -d tastile-core`, `bun dev`, login via chrome-devtools MCP
- [ ] **Step 2**: Walk each dashboard page, record HTTP code + render time + console errors in `e2e/dashboard-results.md`
- [ ] **Step 3**: Run 3 negative paths
- [ ] **Step 4**: Commit results

---

## Phase H: Acceptance

### Task H1: § 7.1 static verification

- [ ] **Step 1**: Run grep suite (from Task C5 Step 1) — confirm all empty
- [ ] **Step 2**: `bun x biome lint src/app/dashboard src/components src/lib/api src/lib/state` — clean
- [ ] **Step 3**: `bun x vitest run src/lib/api src/lib/state src/lib/realtime src/components/tiles` — green
- [ ] **Step 4**: `bun run build` — succeeds

---

### Task H2: § 7.2 behavioral verification (docker + chrome-devtools)

- [ ] **Step 1**: `docker compose up -d tastile-core`, `curl localhost:31400/health` → 200
- [ ] **Step 2**: Walk § 7.2 scenarios in chrome-devtools MCP
- [ ] **Step 3**: Document + commit

---

### Task H3: § 7.5 performance budgets

- [ ] **Step 1**: Lighthouse on `/dashboard` — Performance > 80, TTI < 1.5s
- [ ] **Step 2**: Bundle size analysis (dashboard bundle < +5% vs. v7 baseline)
- [ ] **Step 3**: Document + commit

---

## Summary

| Phase | Tasks | Status |
|---|---|---|
| A: Missing infra | 8 (A1 ✅, A2-A8 new) | In progress |
| B: TanStack Query hooks | 1 (comprehensive) | Pending |
| C: v7 deletion | 5 | Pending |
| D: Components | 8 | Pending |
| E: Dialogs | 3 | Pending |
| F: Pages | 22 | Pending |
| G: Auth + E2E | 5 | Pending |
| H: Acceptance | 3 | Pending |
| **Total** | **55** | |

**Estimated sessions**: 5-7 (smaller than original 7+ because we consume existing v1 infra).

**Critical insight from re-review**: Tasks A2-A7 in the ORIGINAL plan were duplicating existing `lib/domain/v1/*`, `lib/api/v1-endpoints.ts`, `lib/api/error-mapper.ts`. The corrected plan reduces Phase A from 13 tasks to 8 and aligns with existing v1 architecture.

**Pre-existing merge conflicts** (OUT OF SCOPE, resolved in Phase G): `src/proxy.ts`, `src/app/login/page.tsx`, `src/components/layout/Header.tsx`, `src/lib/hooks/use-daemon-execution.ts`.