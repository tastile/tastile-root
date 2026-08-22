# Task 8 (E2E curl verification) — PARTIAL pass

## What passed
`flow_tick::evaluate_window` is correctly invoked from
`GET /v1/timeline`.  When the handler runs with our seed data, the
Dispatcher commits a `source=Flow` Placement into `v1_placement`
with `plan_id = 77777777-…-777777777777` (the seeded study Plan),
`span_start = 2026-07-07T10:00:00Z`, `span_end = 2026-07-07T10:30:00Z`.

## What failed
The HTTP response is `500 Internal Server Error` with an empty body.
The failure happens AFTER `flow_tick` writes the Placement, in the
row-aggregation step of `crates/v1/api/src/handlers/timeline.rs:248`
which issues:

    SELECT id, display_name, avatar_url
    FROM v1_owner
    WHERE id = ANY($1) AND archived_at IS NULL

`v1_owner` does not exist in the migrations folder
(`cratse/v1/storage/migrations/` only has V1_001__base.sql +
V1_002__flow_candidate_output_proposal.sql).  The v1/15
owner-polymorphic migration that creates `v1_owner`,
`v1_owner_user`, `v1_owner_membership` is documented in
`docs/superpowers/plans/2026-07-04 owner-polymorphic-and-avatar-plan.md`
but its SQL files are not committed.  The handler maps any
`sqlx::Error` to `INTERNAL_SERVER_ERROR`.

## Why we cannot fix it inside this goal
The goal-mode prompt CONSTRAINT 1 is **No schema change**:

> No migrations.  No new columns.  No new tables.

Adding the missing v1_owner tables (or downgrading the row-48 query
to a tolerant fallback) violates that constraint.

## E2E proof that flow_tick itself works
The storage-layer `at_gap_break_emission_all.txt` run shows:

    running 7 tests
    test at023_gap_30_min_triggers_flow_propose_placement ... ok
    test at024_gap_under_30_min_emits_nothing ... ok
    test at025_existing_break_placement_survives_gap_collapse ... ok
    test at026_non_break_target_rejected ... ok
    test at027_re_evaluation_is_idempotent ... ok
    test at028_any_flexible_plan_fills_gap ... ok
    test at029_same_plan_splits_across_multiple_gaps ... ok
    test result: ok. 7 passed; 0 failed

These tests drive the SAME `flow_tick::evaluate_window` code, the SAME
`Dispatcher`, the SAME `v1_placement` write path, and the SAME
idempotency check that the production API handler uses.  When the
handler reaches the `flow_tick` call, the same Storage-layer behavior
is exercised; the 500 occurs after that, in row-aggregation code
unrelated to this plan.
