# Codex Goal-Mode Prompt — v1 Schedule Packing (100% Gap Fill)

> Paste the block under **GOAL** into Codex as the goal-mode instruction.
> Spec/plan paths are absolute so Codex can self-load.

---

## GOAL

Implement v1 schedule packing end-to-end in `tastile-core/`, working from the spec at `docs/superpowers/specs/2026-07-06-v1-schedule-packing-design.md` (commit `f793de0`) and the implementation plan at `docs/superpowers/plans/2026-07-06-v1-schedule-packing-plan.md` (commit `ae664c1`). After all 10 tasks: `GET /v1/timeline?start=…&end=…` fills GAPs ≥ matching thresholds with `source=FLOW` Placements using each owner's active Flows. Acceptance: AT-023..AT-029 green in `cargo test -p storage`, real-API curl evidence in `docs/superpowers/plans/evidence/`, and `cargo build --workspace` clean.

## CONSTRAINTS (DO NOT VIOLATE)

1. **No schema change.** No migrations. No new columns. No new tables.
2. **No new discriminators.** Do NOT introduce `isBreak`, `kind_break`, `source_kind`, or any enum to identify "break" tiles. The break Plan is whatever Plan the Flow's `ProposePlacement` carries; the engine never asks "is this a break?".
3. **No implicit delete.** `flow_tick` ONLY dispatches `CreatePlacement{ source=Flow }`. Never call `close_*`, `detach_*`, or DELETE.
4. **Postgres only.** No SQLite. Use the existing `sqlx::PgPool` and `Store::from_env_or_skip()`.
5. **No `kind`/`type`/`source_kind` enum variants.** Use condition layers (v7_intent_nodes + v7_condition_atoms) per project rule.
6. **Out-of-scope dirs: do NOT touch** `crates/tastile-{scheduler,daemon,mcp,plugin-runtime}/` (legacy v7).
7. **In-scope dir only**: `tastile-core/crates/v1/{storage,domain,api}/`.

## ALREADY IMPLEMENTED (NO WORK NEEDED)

- `crates/v1/storage/src/placement_repo.rs::list_in_range` (line 185)
- `crates/v1/storage/src/flow_repo.rs::load_active_flows_for_owner` (line 193)
- `crates/v1/storage/src/dispatcher.rs::dispatch` + `Dispatcher::new(store)`
- `crates/v1/domain/src/{gap,flow,materialization,resolver}.rs` (helpers green)
- `crates/v1/storage/tests/integration_placement_list.rs`
- `crates/v1/storage/tests/integration_flow_repo.rs`
- AT-023..AT-027 spec text already in `tastile-core/v1/12-acceptance-tests.md` §C'

## TASKS (10 — follow plan verbatim)

1. Append AT-028, AT-029 spec text to `tastile-core/v1/12-acceptance-tests.md` (after AT-027, before `## D. Execution`). Commit: `docs(v1): add AT-028/AT-029 spec for general packing`.
2. Add `crates/v1/storage/src/flow_tick.rs` skeleton (`evaluate_window` returning `Ok(0)`). Add `pub mod flow_tick;` to `crates/v1/storage/src/lib.rs` after `pub mod flow_repo;`. Commit: `feat(storage): add flow_tick skeleton (returns 0)`.
3. Create `crates/v1/storage/tests/at_gap_break_emission.rs` with `at023_gap_30_min_triggers_flow_propose_placement` skeleton (uses `todo!()` helpers). RED. Commit: `test(storage): add at_gap_break_emission skeleton (RED)`.
4. Implement `flow_tick::evaluate_window`: load anchors via `placement_repo::list_in_range`, compute GAPs via `gap::find_gap_windows`, load active Flows via `flow_repo::load_active_flows_for_owner`, evaluate each candidate via `flow::rank_flow_candidates`, dispatch `CreatePlacement{ source=Flow, source_ref=Flow { flow_id, candidate_id, plan_id, proposal_key } }` via `Dispatcher`. Idempotency: `proposal_key = "{flow_id}:{candidate_id}:{plan_id}:{gap_start_ms}"`. Commit: `feat(storage): implement flow_tick::evaluate_window (GREEN for AT-023)`.
5. Flesh out `at_gap_break_emission.rs`: AT-024..AT-029. Use `integration_placement_list.rs` and `integration_flow_repo.rs` as reference patterns for `insert_tile`/`insert_plan`/`insert_placement_manual`. All via Dispatcher, no direct INSERT for Placement. Commit: `test(storage): flesh out AT-023..AT-029 (storage-layer integration)`.
6. Wire into `crates/v1/api/src/handlers/timeline.rs`: after the existing `lazy_expand_for_window(...)` call, loop `owner_ids` and call `flow_tick::evaluate_window(&store, *owner_id, range_start, range_end, Utc::now()).await.ok()`. Errors log via `tracing::warn!` — do not propagate (a partial pack is better than no timeline). Commit: `feat(api): drive flow_tick from timeline read`.
7. `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`. Commit if changed: `chore: fmt + clippy`.
8. E2E curl verification: bring up `cargo run -p api` (host `0.0.0.0`, port `31400` per `crates/v1/api/src/main.rs:498-499`). Seed via API: 2 fixed Placements, 1 Flow. `curl /v1/timeline?start=…&end=…` and assert a `source=FLOW` Placement in the GAP. Save raw curl + response to `docs/superpowers/plans/evidence/{at_id}.txt`. Commit evidence.
9. (Skip on Codex — visual UI verification is the human's job. Codex stops after Task 8.)
10. Append 実装履歴 entry to `tastile-core/HARNESS.md` under "v1 schedule packing live". Commit: `docs(v1): HARNESS 実装履歴 entry for schedule packing`.

**Codex stops after Task 8 (Step 8 commits evidence). Task 9 (visual e2e) and Task 10 (HARNESS update) are reserved for the human orchestrator.**

## EVIDENCE REQUIREMENT (NEVER CLAIM PASS WITHOUT)

Per project rule `feedback_no_unverified_pass.md`: "PASS" requires an executed `cargo test` and a curl response — not a code read. Save to `docs/superpowers/plans/evidence/`:
- `at023_storage.txt` — `cargo test -p storage --test at_gap_break_emission at023_… -- --nocapture 2>&1 | tail -40`
- `at028_storage.txt` — same for at028
- `at029_storage.txt` — same for at029
- `timeline_curl.txt` — full `curl -v` request + response showing a `source=FLOW` Placement
- `api_build.txt` — `cargo build --workspace 2>&1 | tail -20`

If `DATABASE_URL` is unset, tests skip via `Store::from_env_or_skip()`. State this explicitly in evidence; do NOT mark a skipped test as PASS.

## OUTPUT DISCIPLINE (MiniMax-M3 SPECIFIC)

Per `feedback_codex_minimax_output_cap.md`: `api.minimax.io` truncates output at ~2K tokens.
- **Use `apply_patch` for any file write > 50 lines.** Never embed multi-KB file bodies inside `exec_command`.
- Keep reasoning output ≤ 2K tokens per turn. If a turn exceeds the cap, the proxy returns `2013 invalid_prompt` and the session is unrecoverable.
- Prefer one short status line per turn ("task 2 done; next: task 3") over long prose summaries.
- If a tool call fails, retry at most once with a smaller payload — do not loop.

## WORKFLOW

1. Read the plan file once at the start. Do not re-read full files; use `grep`/`sed`/`awk` to locate specific lines.
2. After each task, run `cargo build -p <crate> --all-targets 2>&1 | tail -30` to confirm clean build before commit.
3. Commit format: `<type>(<scope>): <subject>` with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. One commit per task.
4. If a task is blocked, write a `docs/superpowers/plans/evidence/BLOCKED_<task>.md` with the blocker + reproduction; do NOT mark it complete.
5. Final message: list each task with status (PASS / SKIPPED / BLOCKED) and the evidence file paths. Under 1.5K tokens.

## ENVIRONMENT NOTES

- Working dir: `C:\Users\rebui\Desktop\tastile` (Windows). Use forward slashes in shell commands. `git` works directly without `cd`.
- `tastile-core/` is a sub-crate; `cargo` commands must run from inside it.
- Default API bind: `0.0.0.0:31400`. Env vars: `TASTILE_API_HOST`, `TASTILE_API_PORT`, `DATABASE_URL`.
- Postgres is required for integration tests. If unavailable, all storage tests skip cleanly — do not panic, do not retry.