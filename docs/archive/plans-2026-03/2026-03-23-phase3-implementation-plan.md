# Phase 3 Implementation Plan - Tile-Centric Architecture Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Phase 3 items from CODE_REVIEW_2026_03_23 for stability:
- RISK-01: Deterministic SegmentId generation
- RISK-02: Event persistence atomicity
- ARCH-06: Scheduler output 6 items
- RISK-03: DeleteTile redesign

**Architecture:** Fix risk issues and scheduler output limits for production stability.

**Tech Stack:** Rust, tastile-core

---

## RISK-01: Deterministic SegmentId Generation

### Task 1: Use CommandContext for SegmentId instead of UUID v4

**Files:**
- Modify: `crates/tastile-core/src/handler/command_handler.rs`

**Step 1: Examine current implementation**

Search for `SegmentId::new()` in command_handler.rs

**Step 2: Design change**

Instead of generating random SegmentId, pass segment_id through Command payload or generate deterministically from tile_id + timestamp

**Step 3: Update tests**

Run `cargo test` to verify

**Step 4: Commit**

---

## RISK-02: Event Persistence Atomicity

### Task 2: Wrap event persistence in transaction

**Files:**
- Modify: `crates/tastile-core/src/handler/command_handler.rs`
- Modify: `crates/tastile-storage/src/event_store.rs`

**Step 1: Examine current implementation**

Check how events are saved individually

**Step 2: Design change**

Wrap all events from a single command in a single transaction

**Step 3: Update tests**

Run `cargo test` to verify

**Step 4: Commit**

---

## ARCH-06: Scheduler Output 6 Items

### Task 3: Change scheduler limit from 3 to 6

**Files:**
- Modify: `crates/tastile-core/src/scheduler/mod.rs`
- Check callers of `recommend_next_tiles`

**Step 1: Search for limit=3 usage**

**Step 2: Change to limit=6**

**Step 3: Update tests**

Run `cargo test` to verify

**Step 4: Commit**

---

## RISK-03: DeleteTile Redesign

### Task 4: Change DeleteTile behavior

**Files:**
- Modify: `crates/tastile-core/src/handler/command_handler.rs`
- Modify: `crates/tastile-core/src/validate/rules.rs`

**Step 1: Understand current DeleteTile behavior**

**Step 2: Redesign**

Instead of issuing TileClosed (which hides tile), make DeleteTile a soft delete or mark as archived

**Step 3: Update tests**

Run `cargo test` to verify

**Step 4: Commit**

---

## Final Verification

### Task 5: Run all tests

Run: `cd tastile-core && cargo test`

### Task 6: Push and create PR

```bash
git push -u origin feature/tile-centric-architecture-fix-2026-03-23-phase3
```

Create PR with title: "feat: Phase 3 tile-centric architecture fix (RISK-01, RISK-02, ARCH-06, RISK-03)"