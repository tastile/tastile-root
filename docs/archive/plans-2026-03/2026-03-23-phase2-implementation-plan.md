# Phase 2 Implementation Plan - Tile-Centric Architecture Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement remaining Phase 2 items from CODE_REVIEW_2026_03_23:
- ARCH-04: Prompt queue (Vec<PromptId>)
- ARCH-05: Dynamic prompt types/actions
- FUNC-05: SwitchActiveTile redesign

**Architecture:** Changes to prompt system to support multiple pending prompts and dynamic actions. SwitchActiveTile becomes a display priority change only.

**Tech Stack:** Rust, tastile-core

---

## ARCH-04: Prompt Queue Implementation

### Task 1: Change pending_prompt_id from Option to Vec

**Files:**
- Modify: `crates/tastile-core/src/store/state.rs:13,99-100`

**Step 1: Write the failing test**

```rust
// In tests/store_test.rs - add test for pending_prompts
#[test]
fn test_pending_prompts_is_vec() {
    let state = AppState::new();
    let prompts = state.pending_prompts();
    assert!(prompts.is_empty()); // Should be Vec, not Option
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-core && cargo test --lib test_pending_prompts_is_vec`
Expected: FAIL - method pending_prompts does not exist

**Step 3: Modify state.rs**

Change line 13 from:
```rust
pending_prompt_id: Option<PromptId>,
```
To:
```rust
pending_prompts: Vec<PromptId>,
```

Add method at line 99:
```rust
pub fn pending_prompts(&self) -> &Vec<PromptId> {
    &self.pending_prompts
}
```

Remove old method pending_prompt_id

**Step 4: Run test to verify it passes**

Run: `cd tastile-core && cargo test --lib test_pending_prompts_is_vec`
Expected: PASS

**Step 5: Commit**

---

### Task 2: Update command_handler.rs to push/pop from Vec

**Files:**
- Modify: `crates/tastile-core/src/handler/command_handler.rs`
- Modify: `crates/tastile-core/src/command/payloads.rs`

**Step 1: Write test**

```rust
// Add test for prompt queue behavior
#[test]
fn test_prompt_queue_push_and_pop() {
    let mut state = AppState::new();
    let prompt_id = PromptId::new();
    state.pending_prompts.push(prompt_id.clone());
    assert_eq!(state.pending_prompts.len(), 1);
    state.pending_prompts.retain(|id| *id != prompt_id);
    assert!(state.pending_prompts.is_empty());
}
```

**Step 2: Run test - expected to pass**

**Step 3: Update command handler**

Search for where pending_prompt_id is set/cloned - change to push to Vec

**Step 4: Run all tests**

Run: `cd tastile-core && cargo test`
Expected: All pass

**Step 5: Commit**

---

## ARCH-05: Dynamic Prompt Types/Actions

### Task 3: Make PromptDecision actions dynamic

**Files:**
- Modify: `crates/tastile-core/src/prompt/types.rs`
- Modify: `crates/tastile-core/src/prompt/engine.rs`

**Step 1: Write test**

```rust
// Test that prompt actions vary by context
#[test]
fn test_prompt_actions_vary_by_context() {
    // For a tile that's been running long - should have ExtendPhase
    // For a fresh tile - should not have ExtendPhase
    
    // Test that PromptDecision::end_tile returns different actions
    // based on tile state, not hardcoded list
}
```

**Step 2: Run test - expected to fail**

**Step 3: Modify PromptDecision struct**

Current: Fixed action lists in methods like `start_tile()`, `end_tile()`

Change: Make actions depend on tile state - pass tile reference to decision methods

**Step 4: Run tests**

Run: `cd tastile-core && cargo test`
Expected: All pass

**Step 5: Commit**

---

## FUNC-05: SwitchActiveTile Redesign

### Task 4: Change SwitchActiveTile to display priority only

**Files:**
- Modify: `crates/tastile-core/src/validate/rules.rs:73-85`
- Modify: `crates/tastile-core/src/handler/command_handler.rs:221`
- Modify: `crates/tastile-core/src/command/payloads.rs:75`
- Modify: `crates/tastile-core/src/command/mod.rs:18`

**Step 1: Write test**

```rust
#[test]
fn test_switch_active_tile_no_interruption() {
    // When switching active tile, the "from" tile should NOT be interrupted
    // It should only change display priority/order
}
```

**Step 2: Run test - expected to fail**

**Step 3: Modify command handler**

Current behavior: SwitchActiveTile does interrupt on "from" tile
Change: Just reorder tiles in some display_priority field

**Step 4: Run tests**

Run: `cd tastile-core && cargo test`
Expected: All pass

**Step 5: Commit**

---

## Final Verification

### Task 5: Run all tests and verify no regressions

Run: `cd tastile-core && cargo test`
Expected: All pass

### Task 6: Push to remote and create PR

```bash
git push -u origin feature/tile-centric-architecture-fix-2026-03-23-phase2
```

Create PR with title: "feat: Phase 2 tile-centric architecture fix (ARCH-04, ARCH-05, FUNC-05)"

---