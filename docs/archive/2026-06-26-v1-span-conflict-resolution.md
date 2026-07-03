# v1 Span Conflict Resolution Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use systematic-debugging before fixes; subagent-driven-development quality gates are applied manually in this session because subagent spawning was not explicitly requested.

**Goal:** Make v1 span endpoint resolution follow v1/04, v1/07, v1/10, and AT-012/AT-061: same layer/rank/key with different values becomes BLOCKED with CHANGE_CONFLICT, never last-wins or silent fallback.

**Architecture:** Keep the fix inside v1 domain resolution. Both full `resolve_effective_placement` and the Timeline lightweight `resolve_span_from_records` must use the same priority rule: higher layer wins, then higher rank; ties with different values emit `ViolationKind::ChangeConflict`.

**Tech Stack:** Rust domain crate, existing v1 API timeline projection, Docker Compose v1 stack.

---

### Task 1: Fix full domain placement span resolution

**Files:**
- Modify: `crates/v1/domain/src/resolver.rs`
- Test: `crates/v1/domain/src/at_acceptance_tests.rs`

**Steps:**
1. Change `resolve_effective_placement` so span endpoints are resolved once through the endpoint resolver, not overwritten sequentially.
2. Make endpoint priority sort by higher layer, then higher rank.
3. Emit `CHANGE_CONFLICT` for different values at the winning priority.
4. Update AT-012 to expect BLOCKED + CHANGE_CONFLICT instead of last-wins.

### Task 2: Fix Timeline lightweight span resolution

**Files:**
- Modify: `crates/v1/domain/src/resolver.rs`
- Test: `crates/v1/domain/src/at_acceptance_tests.rs`

**Steps:**
1. Make `resolve_span_from_records` return `CHANGE_CONFLICT` violations on same layer/rank/part with different endpoint values.
2. Update the AT-060 conflict test to assert the violation, not just baseline fallback.

### Verification

Run:
- `cargo test -p domain at012_same_layer_same_rank_override_conflicts_for_endpoint_keys`
- `cargo test -p domain at060_conflict_same_layer_same_rank_yields_no_winner`
- `cargo test -p domain -p storage -p api -p worker`
- Docker Compose v1 session with HTTP smoke for create placement, conflicting changes, and timeline `include_blocked=true`.
