# Web study-life completion — design

- Owner: web
- Date: 2026-07-27
- Status: design (pending user review)
- Source intent: `tastile-core-handoff-kimi-k3.md` §8 / §12

## 0. Problem

User opens tastile-app on Monday morning to study. End-to-end loop:

```
Web UI → request payload → API → Dispatcher → normalized rows → worker
       → Placement/Execution/Session → read API → UI result
```

Currently (per handoff §8.1):
- `submit.ts` overwrites `plan.completion.root` with a placeholder `{ kind: ALL, children: [], term: null }` and POSTs that — the ConditionEditor output is silently discarded.
- There is no Session/Decision surfacing beyond the placeholder `/app/prompt` page that reads `useExecutionEngineContext().state.execution.pendingPrompt`.
- No Playwright spec covers scenario A: "create a study task with a deadline, see the placement on a day, start execution, finish, see the change reflected".

main branch has already shipped:
- C1–C8 on core (commits 322f680 … 4742320)
- QuickTileCreate v4 with AutomationPanel + ConditionEditor + SchedulePanel
- ActiveExecutionBar + V1ExecutionControls + `use-v1-execution` / `use-daemon-execution`
- `at-030-execution` and `at-034-finish-void` E2E specs
- `POST /v1/sessions/{id}/feedback` route handler in core

## 1. Non-goals (this session)

Per user answers in brainstorming:
- Android (`W6` start, then user picked "B: Android 後送り"). No Kotlin work this session.
- Production deploy gates (`W9`). Local `bun run check:release` + `cargo test --workspace -- --test-threads=1` in WSLC is the gate. CI workflows are not edited.
- Production probe / `/v1/health` / `/v1/ready` against EC2 RDS.
- SourceWindowPanel, PlacementRulesPanel, RelationPanel, SplitPolicyPanel, FlowSequencePanel, CompletionPanel, DecisionPanel, DeliveryPolicyPanel — `W2` minimum is SourceGenerationPanel + ConditionPanel only.
- Scenario B / C / D E2E — only scenario A is in scope.

## 2. Architecture

Single repository: `tastile-web`. No core migration, no Android, no `.env` migration. WSLC stack stays exactly as it is today.

Path-first order:
1. **W1 submit path** — `submit.ts` no longer drops `plan.completion.root`; the wiring is verified by a unit test on `storeToSnapshot`.
2. **W2 panel split** — extract `SourceGenerationPanel.tsx` (occurrences + weekday + end-date + offset) and `ConditionPanel.tsx` (Condition tree wrapper) as standalone components. QuickTileCreate composes them. AutomationPanel becomes a thin façade re-exporting `SourceGenerationPanel`.
3. **W3 Session UI** — `DecisionPromptSheet` reads from a new `use-pending-sessions` hook (uses `useExecutionEngineContext` shape OR a new list endpoint — see §7) and feeds an `InteractionTreeForm`. Click on a notification in the bell menu deep-links to the sheet.
4. **Playwright E2E** — `e2e/scenario-A-test-study.spec.ts` exercises the whole loop end-to-end against the WSLC stack.
5. **WSLC green** — both core and web gates pass.

Layered design:
- `lib/api/v1/submit.ts` — single point of translation. **No silent placeholder.**
- `lib/api/v1/build-command.ts` — already produces a `CommandEnvelope`. Will be extended to consume real `Condition` AST from the store.
- `lib/stores/quick-create-store.ts` — single source of truth. Already holds `plan.completion.root`; we ensure the editor writes to it.
- `components/tiles/editor/SourceGenerationPanel.tsx` — new. Composes occurrence-kind picker + weekday + end-date + offset.
- `components/tiles/editor/ConditionPanel.tsx` — new. Wraps `ConditionEditor` and exposes `plan.completion.root`.
- `components/execution/DecisionPromptSheet.tsx` — new. Renders pending Decision sessions, offers answer buttons.
- `components/decision/InteractionTreeForm.tsx` — new. Renders interaction nodes (input / option) for the answer flow.
- `lib/hooks/use-pending-sessions.ts` — new. Subscribes to pending sessions; polls `/v1/sessions` or `/v1/pending-decisions` per §7.
- `lib/hooks/use-active-execution.ts` — already exists; we keep it.
- `e2e/scenario-A-test-study.spec.ts` — new Playwright spec.

## 3. Data flow (scenario A — test-study task)

1. User clicks "+ Create" on the timeline; QuickTileCreate opens.
2. User picks tile kind = RECURRING (intermediate, until a SourceTile-only quick-create path exists).
3. `SourceGenerationPanel` panel:
   - Mode: `WEEKLY` (Weekday mask)
   - Weekdays: Mon–Fri bits set
   - Time-of-day: 19:00–21:00 (local)
   - End date: empty
   - Local timezone offset: `JST +09:00`
4. `ConditionPanel` panel:
   - Composition root: ALL with no children (this is a legal Condition AST that matches everything; weekday mask lives on SourceGeneration, so the Completion root is intentionally permissive).
   - One-term authoring (calendar/moment/relation/…) is out of `W2` minimum scope; the panel exposes only the top-level kind switch for now (ALL/ANY/NOT/TERM).
5. QuickTileCreate collects:
   - title "Test study"
   - durationMinMax `min=60 min, max=150 min`
   - split `maxSegments=3`
6. User clicks submit. `submit.ts::storeToSnapshot` returns:
   ```ts
   { identity: { title: "Test study", kind: RECURRING, … },
     plan: { role: PRIMARY, completion: { root: <real condition root from store>, … }, … },
     time: { span: { start: "…", end: null, offsetMin: 540 }, durationMinMax: { min: 60min, max: 150min }, … },
     windows: [...],
     recurring: { kind: weekly, frameRules: [<mask>], rules: [], … },
     relations: [] }
   ```
7. `buildCreateTileCommand` (already wired) emits the ladder:
   - `CREATE_TILE`
   - `SET_PLAN` (with real completion.root)
   - `APPEND_FRAMES` (weekly mask)
   - `APPEND_RULES`
8. Each Command is POSTed to `POST /api/proxy/v1/commands` (or directly to `NEXT_PUBLIC_TASTILE_CORE_V1_URL`). Core `Dispatcher` processes, outbox emits.
9. Worker fills horizon → `SourceOccurrence` → `Placement` rows.
10. Timeline polls `/v1/timeline?from=…&to=…` (already exists); placement shows up.
11. User clicks placement → `V1ExecutionControls` fires `POST /v1/executions`.
12. Worker starts execution, emits Delivery.
13. `ActiveExecutionBar` reads `/v1/active-tile`; shows the active task.
14. User clicks finish; `POST /v1/executions/{id}/finish`. Worker re-evaluates metrics.
15. Timeline refresh shows the placement as completed (deduped or hidden).

## 4. Error handling

- Form validation: title non-empty; durationMinMax.min > 0; durationMinMax.min ≤ durationMinMax.max; weekday mask non-zero when mode=WEEKLY; offsetMin ∈ [−12h, +14h]. Inline errors in `QuickTileCreate` validator (already exists at line ~401 `taskOrderValid`).
- Submit failures:
  - 401 → toast "session expired" + reset auth.
  - 409 → inline message showing conflicting tile.
  - 422 → highlight invalid fields per response body's per-field error list.
- Execution start failures:
  - placement has an active execution already → toast "X is already running; finish it first".
  - placement not yet clocked-in (start time in the future beyond grace) → show "schedule-aware" inline message.
- Decision answer failures:
  - stale `baseRevision` → refetch session and re-prompt; never auto-overwrite.
  - 410 → clear from pending list and show "this decision is no longer needed".
- Browser notification failures: log to console; in-app sheet remains the source of truth.

## 5. Note on doc-cleanup PR

The current working tree has a `git mv` rename in progress for `docs/superpowers/specs/2026-07-23-tastile-web-login-minimal-design.md` → `docs/archive/2026-07-27-doc-cleanup/...`. This spec is committed to `docs/superpowers/specs/2026-07-27-web-study-life-completion-design.md` which is the path the brainstorming skill defaults to. If the user prefers the spec under the cleanup-archive path, they should land the cleanup first or move this file. We don't run a `git mv` automatically (per `feedback_no_git_stash.md` and CLAUDE.md "現在未コミット変更をreset, checkout, stash, revert しない" rule).

## 5. Testing

WSLC gates (must all be green before claiming DONE):

| Layer | Command | Pass criteria |
| --- | --- | --- |
| core | `cargo fmt --manifest-path crates-v1/Cargo.toml --all -- --check` | exit 0 |
| core | `cargo clippy --manifest-path crates-v1/Cargo.toml --workspace --all-targets -- -D warnings` | exit 0 |
| core | `cargo test --manifest-path crates-v1/Cargo.toml --workspace -- --test-threads=1` | `test result: ok` for every crate |
| web | `bun install --frozen-lockfile` | exit 0 |
| web | `bun run check` (= biome + eslint + tsc + knip + vitest) | exit 0 |
| web | `bun run check:release` (= check + bun audit + build:prod) | exit 0; build artifact produced |

Playwright E2E:
- `e2e/scenario-A-test-study.spec.ts` — new. Steps:
  1. `NEXT_PUBLIC_E2E_BYPASS_AUTH=1`; navigate to `/dashboard`.
  2. Open QuickTileCreate ("+ Create").
  3. Fill identity: title "Test study".
  4. Open SourceGenerationPanel; pick weekly; Mon-Fri; 19:00–21:00; offset +09:00.
  5. Set duration: min 60, max 150.
  6. Click submit. Wait for success toast.
  7. Wait for the placement tile to render in DayView. Assert text contains "Test study".
  8. Click the placement tile. Assert V1ExecutionControls visible.
  9. Click Start. Wait for ActiveExecutionBar to render with title "Test study".
  10. Click Finish. Wait for ActiveExecutionBar to disappear.
  11. Refresh timeline. Assert the placement is no longer in DayView (or marked completed via class hook).
- `vitest` unit:
  - `lib/api/v1/submit.test.ts` — new: `storeToSnapshot` includes `plan.completion.root` from a real Condition AST (not the placeholder).
  - `components/tiles/editor/SourceGenerationPanel.test.tsx` — new: changing weekday mask updates store; mode switch clears incompatible fields.
  - `components/tiles/editor/ConditionPanel.test.tsx` — new: switches ALL/ANY/NOT/TERM and emits matching root.
  - `components/execution/DecisionPromptSheet.test.tsx` — new: renders pending sessions and submits a feedback txn.

Coverage of existing E2E specs stays green:
- `at-030-execution.spec.ts`
- `at-034-finish-void.spec.ts`
- `at-053-idempotency.spec.ts`
- `active-tile-query.spec.ts`
- `quick-tile-create-e2e.spec.ts`
- all `at-0xx-*.spec.ts`

## 7. Pending endpoint decision (Decision loop)

The Core API has:
- `POST /v1/sessions` — create
- `GET /v1/sessions/{id}` — read one
- `POST /v1/sessions/{id}/feedback` — answer

There is no `GET /v1/sessions` list endpoint in core today.

This session's path:
- Probe the existing `useExecutionEngineContext` to determine where `pendingPrompt` actually comes from. If it already polls a real endpoint (e.g., a Delivery-driven list inside Rust), wire `DecisionPromptSheet` to that data.
- If no list endpoint exists and the existing `pendingPrompt` is filled by an in-memory mock, we will **add one route** in core (`GET /v1/sessions?status=open`) following the handoff §6.7 pattern. The change is intentionally minimal: one new handler function in `crates/v1/api/src/handlers/read.rs`, one new query method in `crates/v1/storage/src/session_repo.rs`, one row in `crates/v1/api/openapi.yaml`. **No schema migration** — `v1_session` (auth) and the workflow session table already carry enough columns. We re-confirm by reading both tables before writing.
- This is the only core-side change in this session.

If the probe reveals the list path already exists and works, we skip the endpoint add entirely.

## 8. File list (concrete, with intent)

### Add (new files)
- `tastile-web/src/components/tiles/editor/SourceGenerationPanel.tsx` — Weekly/Daily/Interval/Once/Condition picker + weekday mask + end-date + offset. Composes existing input controls.
- `tastile-web/src/components/tiles/editor/ConditionPanel.tsx` — Wraps `ConditionEditor`; exposes `plan.completion.root` to QuickTileCreate.
- `tastile-web/src/components/execution/DecisionPromptSheet.tsx` — Renders pending sessions, one card each; offers answer buttons; calls `POST /v1/sessions/{id}/feedback`.
- `tastile-web/src/components/decision/InteractionTreeForm.tsx` — Renders InteractionNode tree for one session.
- `tastile-web/src/lib/hooks/use-pending-sessions.ts` — Subscribes to pending sessions list (data source §7).
- `tastile-web/src/lib/api/v1/sessions.ts` — `listPendingSessions`, `getSession`, `submitFeedback`.
- `tastile-web/e2e/scenario-A-test-study.spec.ts` — Playwright spec.
- `tastile-core/crates-v1/api/src/handlers/read_sessions.rs` (only if §6 demands it) — minimal list endpoint.

### Modify
- `tastile-web/src/lib/api/v1/submit.ts` — replace placeholder `completionRoot` with `state.plan.completion.root`. Drop the `// Phase B replaces this …` comment.
- `tastile-web/src/components/tiles/QuickTileCreate.tsx` — import the two new panels; remove inline duplicates.
- `tastile-web/src/components/tiles/editor/AutomationPanel.tsx` — re-export `SourceGenerationPanel` for back-compat; the existing panel body becomes a thin host.
- `tastile-web/src/app/app/prompt/page.tsx` — replace placeholder with `<DecisionPromptSheet>`.
- `tastile-web/src/components/notifications/NotificationsMenu.tsx` — clicking a pending-decision notification opens `DecisionPromptSheet`.

### Tests
- `tastile-web/src/lib/api/v1/submit.test.ts` (new)
- `tastile-web/src/components/tiles/editor/SourceGenerationPanel.test.tsx` (new)
- `tastile-web/src/components/tiles/editor/ConditionPanel.test.tsx` (new)
- `tastile-web/src/components/execution/DecisionPromptSheet.test.tsx` (new)
- `tastile-web/e2e/scenario-A-test-study.spec.ts` (new)

## 9. Out-of-scope evidence requirement

Per user "全自動" choice — no checkpoint from user. The session:
- Iterates W1 → W2 → W3 → E2E in order.
- For each layer, runs the relevant tests. If green, layer is complete.
- Reports progress at end-of-session with: completed path, evidence (test names + exit codes), open blockers if any.

No "概ね完成" / "基盤は揃った" / "今後接続可能" final report.
