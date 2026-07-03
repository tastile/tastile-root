# Remove WASM, API-Only Execution Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove WASM execution engine from tastile-web, making it purely API-based (daemon client).

**Architecture:** The web app should communicate with the tastile-core API daemon only. WASM local execution is removed entirely.

**Tech Stack:** Next.js, TypeScript, React

---

### Task 1: Remove WASM directories and scripts

**Files:**
- Delete: `src/wasm/` (entire directory)
- Delete: `src/lib/wasm/` (entire directory)
- Delete: `scripts/build-core-wasm.mjs`
- Delete: `scripts/check-core-wasm-freshness.mjs`

**Step 1: Delete WASM directories**

```bash
rm -rf src/wasm src/lib/wasm scripts/build-core-wasm.mjs scripts/check-core-wasm-freshness.mjs
```

**Step 2: Verify deletion**

```bash
ls src/wasm 2>&1  # Should fail
ls src/lib/wasm 2>&1  # Should fail
```

---

### Task 2: Clean up use-daemon-execution.ts

**Files:**
- Modify: `src/lib/hooks/use-daemon-execution.ts`

**Step 1: Remove WASM imports and constants**

Remove these lines:
- Line 18: `import { createWasmExecutionEngine, WasmExecutionEngine } from '../wasm/core-engine'`
- Line 31: `const DEFAULT_EXECUTION_BACKEND = 'wasm'`
- Line 33: `const WASM_TILES_STORAGE_KEY = 'tastile:wasm-tiles:v1'`
- Line 48: `const wasmRef = useRef<WasmExecutionEngine | null>(null)`

**Step 2: Remove WASM backend logic from init()**

Remove the `if (backend === 'wasm')` block (lines 146-152).

**Step 3: Remove WASM from refreshSnapshot()**

Remove `readWasmSnapshot` function and the `client ? ... : await readWasmSnapshot()` logic. Always use daemon client.

**Step 4: Remove WASM from execute()**

Remove `const wasm = wasmRef.current` and the `else { await wasm!.execute(...) }` block.

**Step 5: Remove WASM helper functions**

Delete these functions entirely:
- `replayPersistedWasmTiles()`
- `persistWasmTiles()`
- `getLocalStorage()`

**Step 6: Remove backend useMemo**

Remove the `backend` useMemo and all references to `NEXT_PUBLIC_EXECUTION_BACKEND`.

---

### Task 3: Update tests

**Files:**
- Modify: `src/lib/hooks/use-daemon-execution.test.tsx`

**Step 1: Remove WASM mocks**

Remove all `wasm*Mock` variables and the `vi.mock('../wasm/core-engine', ...)` block.

**Step 2: Update test cases**

Remove or update tests that reference WASM backend.

---

### Task 4: Update .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Remove WASM entries**

Remove any lines referencing `wasm` or `tastile-core-wasm`.

---

### Task 5: Build verification

**Step 1: Run build**

```bash
bun run build
```

Expected: Build succeeds with no WASM references.

**Step 2: Run tests**

```bash
bun test
```

Expected: All tests pass.
