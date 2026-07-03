# Fix Architectural Violations - Condition-Based Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the core design principle - "tiles are the absolute source of truth, all behavior is determined by tile conditions, not by special-casing types"

**Architecture:** 
- Remove PhaseKind enum and derive phase from active tile's semantic_role
- Unify SegmentMode or remove enum distinction
- Fix automation condition handling in PromptEngine
- Implement ExecutionDecision type to distinguish prompts from auto-execution
- Implement tick loop logic for prompt storage and auto-approval

**Tech Stack:** Rust (tastile-core, tastile-domain, tastile-daemon), C# (tastile-desktop client)

**Critical Context:**
- Current state: ALL execution control broken (no auto-end, no auto-start, no 30s approval)
- Root cause: Systematic violation of "tiles are truth" principle across entire stack
- Must fix from domain model → business logic → execution → UX (in order)

---

## Phase 0: Analysis and Test Infrastructure

### Task 0.1: Document Current Broken Behavior

**Files:**
- Create: `tastile-core/tests/execution_control_broken.rs`

**Step 1: Write failing integration test documenting expected vs actual**

```rust
//! Integration tests documenting broken execution control behavior.
//! These tests capture EXPECTED behavior per design docs.
//! Currently ALL FAIL - that's the point.

use chrono::{Duration, Utc};
use tastile_core::store::AppState;
use tastile_core::recalc::{recalculate, RecalcTrigger};
use tastile_core::prompt::PromptEngine;
use tastile_domain::tile::{AutomationConditions, SemanticRole, TemporalConditions, TileCore};

#[test]
#[ignore] // Currently fails - documents expected behavior
fn break_with_auto_end_allowed_should_auto_complete() {
    let mut state = AppState::default();
    let now = Utc::now();
    
    // Create break tile with auto_end_allowed=true, target_rest_min=1
    let break_tile = create_break_tile(
        now - Duration::minutes(2), // started 2 minutes ago
        AutomationConditions {
            auto_end_allowed: true,  // Should auto-end!
            prompt_on_end: false,
            ..Default::default()
        },
        1, // target_rest_min
    );
    
    state.tiles.insert(break_tile.core.id.clone(), break_tile);
    
    // Evaluate prompts
    let engine = PromptEngine::new();
    let decisions = engine.evaluate(&state, now);
    
    // EXPECTED: Should return AutoExecute(CompleteTile)
    // ACTUAL: Returns nothing because prompt_on_end=false
    assert_eq!(decisions.len(), 1);
    assert!(matches!(decisions[0], ExecutionDecision::AutoExecute(_)));
}

#[test]
#[ignore]
fn fixed_start_tile_with_auto_start_allowed_should_auto_start() {
    let mut state = AppState::default();
    let now = Utc::now();
    
    // Create tile with fixed_start in the past and auto_start_allowed=true
    let tile = create_task_tile(
        TemporalConditions {
            fixed_start: Some(now - Duration::minutes(5)),
            ..Default::default()
        },
        AutomationConditions {
            auto_start_allowed: true,  // Should auto-start!
            prompt_on_start: false,
            ..Default::default()
        },
    );
    
    state.tiles.insert(tile.core.id.clone(), tile);
    
    let engine = PromptEngine::new();
    let decisions = engine.evaluate(&state, now);
    
    // EXPECTED: Should return AutoExecute(StartTile)
    // ACTUAL: Returns nothing or only prompts
    assert_eq!(decisions.len(), 1);
    assert!(matches!(decisions[0], ExecutionDecision::AutoExecute(_)));
}

// Helper functions
fn create_break_tile(
    started_at: chrono::DateTime<chrono::Utc>,
    automation: AutomationConditions,
    target_rest_min: u32,
) -> tastile_domain::tile::Tile {
    use tastile_domain::tile::*;
    
    Tile {
        core: TileCore {
            id: TileId::new(),
            name: "Break".to_string(),
            ..Default::default()
        },
        annotation: AnnotationConditions {
            semantic_role: SemanticRole::Break,
            ..Default::default()
        },
        automation,
        objective: ObjectiveConditions {
            target_rest_min: Some(target_rest_min),
            ..Default::default()
        },
        work: WorkConditions {
            segments: vec![WorkSegment {
                start_at: started_at,
                mode: SegmentMode::Break,
                ..Default::default()
            }],
            ..Default::default()
        },
        ..Default::default()
    }
}

fn create_task_tile(
    temporal: TemporalConditions,
    automation: AutomationConditions,
) -> tastile_domain::tile::Tile {
    use tastile_domain::tile::*;
    
    Tile {
        core: TileCore {
            id: TileId::new(),
            name: "Task".to_string(),
            ..Default::default()
        },
        temporal,
        automation,
        ..Default::default()
    }
}
```

**Step 2: Run test to verify it fails as expected**

Run: `cd tastile-core && cargo test execution_control_broken --ignored -- --nocapture`
Expected: FAIL - ExecutionDecision type doesn't exist yet, that's correct

**Step 3: Commit test documentation**

```bash
git add tastile-core/tests/execution_control_broken.rs
git commit -m "test: document broken execution control behavior

These tests capture EXPECTED behavior per design docs.
Currently all fail - tracking architectural violations.

Refs: ca6, ca10, ca11 from analysis"
```

---

## Phase 1: Domain Model - Remove Type-Based Enums

### Task 1.1: Add ExecutionDecision Type

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/prompt/types.rs`

**Step 1: Add ExecutionDecision enum to distinguish prompts from auto-execution**

```rust
// Add after PromptDecision struct (around line 165)

/// Represents a decision about what should happen during execution.
/// This separates "show user a prompt" from "automatically execute a command".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionDecision {
    /// Show a prompt to the user for confirmation
    Prompt(PromptDecision),
    
    /// Automatically execute a command without user confirmation
    AutoExecute(AutoExecuteDecision),
}

/// Represents an automatic execution decision based on tile conditions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoExecuteDecision {
    pub tile_id: TileId,
    pub action: AutoExecuteAction,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoExecuteAction {
    StartTile,
    CompleteTile,
    DeferTile,
}
```

**Step 2: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: SUCCESS - new types compile

**Step 3: Commit type additions**

```bash
git add tastile-core/crates/tastile-core/src/prompt/types.rs
git commit -m "feat: add ExecutionDecision to distinguish prompts from auto-execution

Separates 'show prompt' from 'auto-execute' decisions.
Foundation for condition-based automation.

Part of: Phase 1 domain model fixes"
```

### Task 1.2: Mark PhaseKind as Deprecated

**Files:**
- Modify: `tastile-core/crates/tastile-domain/src/execution.rs:7-12`

**Context:** We can't immediately delete PhaseKind because it's used in 20+ places. Mark deprecated first, remove later.

**Step 1: Add deprecation warning to PhaseKind**

```rust
// Line 7-12
#[deprecated(
    since = "0.1.0",
    note = "PhaseKind violates 'tiles are truth' principle. \
            Derive phase from active tile's semantic_role instead. \
            Will be removed in future version."
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseKind {
    Idle,
    Working,
    Break,
}
```

**Step 2: Add deprecation to Execution struct's phase_kind field**

```rust
// Line 14-21
#[derive(Debug, Clone)]
pub struct Execution {
    pub active_tile_id: Option<TileId>,
    
    #[deprecated(
        since = "0.1.0",
        note = "Derive phase from active tile instead. Use AppState::derive_current_phase()"
    )]
    pub phase_kind: PhaseKind,
    
    pub phase_started_at: Option<DateTime<Utc>>,
}
```

**Step 3: Run cargo check (will show warnings)**

Run: `cd tastile-core && cargo check 2>&1 | grep -i "warning.*deprecated"`
Expected: Many deprecation warnings - that's intentional

**Step 4: Commit deprecation markers**

```bash
git add tastile-core/crates/tastile-domain/src/execution.rs
git commit -m "deprecate: mark PhaseKind as violating design principles

PhaseKind contradicts 'tiles are truth' - phase should be derived
from active tile's conditions, not stored separately.

Marked deprecated to guide refactoring. Will remove after callers updated.

Part of: Phase 1 domain model fixes"
```

### Task 1.3: Add Phase Derivation Method to AppState

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/store/state.rs`

**Step 1: Add derive_current_phase method**

Find the `impl AppState` block and add this method:

```rust
impl AppState {
    // ... existing methods ...
    
    /// Derives the current phase from the active tile's semantic_role.
    /// This is the CORRECT way to determine phase - from tile conditions, not from PhaseKind enum.
    pub fn derive_current_phase(&self) -> DerivedPhase {
        if let Some(active_id) = &self.execution.active_tile_id {
            if let Some(tile) = self.tiles.get(active_id) {
                return match tile.annotation.semantic_role {
                    SemanticRole::Break => DerivedPhase::Break,
                    SemanticRole::Work | SemanticRole::None => {
                        if tile.work.open_segment().is_some() {
                            DerivedPhase::Working
                        } else {
                            DerivedPhase::Idle
                        }
                    }
                };
            }
        }
        DerivedPhase::Idle
    }
}

/// Phase derived from tile conditions (the CORRECT approach).
/// This is what should be used instead of PhaseKind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DerivedPhase {
    Idle,
    Working,
    Break,
}
```

**Step 2: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: SUCCESS

**Step 3: Write unit test for phase derivation**

Add to the test module in state.rs:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tastile_domain::tile::*;
    
    #[test]
    fn derive_phase_from_break_tile() {
        let mut state = AppState::default();
        
        let break_tile = Tile {
            core: TileCore {
                id: TileId::new(),
                name: "Break".to_string(),
                ..Default::default()
            },
            annotation: AnnotationConditions {
                semantic_role: SemanticRole::Break,
                ..Default::default()
            },
            work: WorkConditions {
                segments: vec![WorkSegment {
                    start_at: Utc::now(),
                    mode: SegmentMode::Break,
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        };
        
        let tile_id = break_tile.core.id.clone();
        state.tiles.insert(tile_id.clone(), break_tile);
        state.execution.active_tile_id = Some(tile_id);
        
        assert_eq!(state.derive_current_phase(), DerivedPhase::Break);
    }
    
    #[test]
    fn derive_phase_idle_when_no_active_tile() {
        let state = AppState::default();
        assert_eq!(state.derive_current_phase(), DerivedPhase::Idle);
    }
}
```

**Step 4: Run tests**

Run: `cd tastile-core && cargo test derive_phase`
Expected: PASS

**Step 5: Commit phase derivation**

```bash
git add tastile-core/crates/tastile-core/src/store/state.rs
git commit -m "feat: add derive_current_phase from tile conditions

Correct approach: phase is derived from active tile's semantic_role,
not stored in PhaseKind enum.

This is the foundation for removing PhaseKind entirely.

Part of: Phase 1 domain model fixes"
```

---

## Phase 2: Automation Logic - Respect Tile Conditions

### Task 2.1: Fix PromptEngine to Respect auto_end_allowed

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/prompt/engine.rs:52-54`
- Modify: `tastile-core/crates/tastile-core/src/prompt/engine.rs:68-105`

**Critical Fix:** Currently ignores auto_end_allowed, only checks prompt_on_end

**Step 1: Fix check_for_end_prompt to return ExecutionDecision**

Replace the existing method (lines 52-105):

```rust
fn check_for_end_prompt(
    &self,
    state: &AppState,
    now: DateTime<Utc>,
) -> Vec<ExecutionDecision> {
    let mut decisions = Vec::new();

    for (tile_id, tile) in &state.tiles {
        // Skip completed tiles
        if tile.core.completed_at.is_some() {
            continue;
        }

        let Some(open_segment) = tile.work.open_segment() else {
            continue;
        };

        // Calculate expiration time based on segment mode
        let expiration_time = match open_segment.mode {
            SegmentMode::Work => {
                if let Some(target) = tile.objective.target_work_min {
                    if target > 0 {
                        open_segment.start_at + Duration::minutes(target as i64)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }
            SegmentMode::Break => {
                if let Some(target) = tile.objective.target_rest_min {
                    if target > 0 {
                        open_segment.start_at + Duration::minutes(target as i64)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }
        };

        // Check if time has expired
        if now < expiration_time {
            continue;
        }

        // CRITICAL FIX: Check automation conditions FIRST
        if tile.automation.auto_end_allowed {
            // Auto-execute completion without prompting
            decisions.push(ExecutionDecision::AutoExecute(AutoExecuteDecision {
                tile_id: tile_id.clone(),
                action: AutoExecuteAction::CompleteTile,
                reason: format!(
                    "Time expired ({} min) and auto_end_allowed=true",
                    match open_segment.mode {
                        SegmentMode::Work => tile.objective.target_work_min.unwrap_or(0),
                        SegmentMode::Break => tile.objective.target_rest_min.unwrap_or(0),
                    }
                ),
            }));
        } else if tile.automation.prompt_on_end {
            // Show prompt for user confirmation
            decisions.push(ExecutionDecision::Prompt(PromptDecision {
                tile_id: tile_id.clone(),
                prompt_kind: PromptKind::End,
                message: format!("Complete '{}'?", tile.core.name),
                default_action: DefaultAction::Accept,
            }));
        }
        // If neither auto_end nor prompt_on_end, do nothing (manual only)
    }

    decisions
}
```

**Step 2: Update check_for_start_prompt similarly**

Replace check_for_start_prompt method (lines 117-150):

```rust
fn check_for_start_prompt(
    &self,
    state: &AppState,
    now: DateTime<Utc>,
) -> Vec<ExecutionDecision> {
    let mut decisions = Vec::new();

    for (tile_id, tile) in &state.tiles {
        // Skip completed or started tiles
        if tile.core.completed_at.is_some() || tile.work.open_segment().is_some() {
            continue;
        }

        // Check if fixed_start time has passed
        let should_start = if let Some(fixed_start) = tile.temporal.fixed_start {
            now >= fixed_start
        } else {
            false
        };

        if !should_start {
            continue;
        }

        // CRITICAL FIX: Check automation conditions FIRST
        if tile.automation.auto_start_allowed {
            // Auto-execute start without prompting
            decisions.push(ExecutionDecision::AutoExecute(AutoExecuteDecision {
                tile_id: tile_id.clone(),
                action: AutoExecuteAction::StartTile,
                reason: format!(
                    "Fixed start time reached and auto_start_allowed=true"
                ),
            }));
        } else if tile.automation.prompt_on_start {
            // Show prompt for user confirmation
            decisions.push(ExecutionDecision::Prompt(PromptDecision {
                tile_id: tile_id.clone(),
                prompt_kind: PromptKind::Start,
                message: format!("Start '{}'?", tile.core.name),
                default_action: DefaultAction::Accept,
            }));
        }
        // If neither auto_start nor prompt_on_start, do nothing (manual only)
    }

    decisions
}
```

**Step 3: Update evaluate() return type**

Change the public method signature (around line 36):

```rust
pub fn evaluate(&self, state: &AppState, now: DateTime<Utc>) -> Vec<ExecutionDecision> {
    let mut decisions = Vec::new();
    
    decisions.extend(self.check_for_end_prompt(state, now));
    decisions.extend(self.check_for_start_prompt(state, now));
    
    // Startup recovery prompts - keep as prompts for now
    if state.startup_recovery_mode {
        decisions.extend(self.check_startup_recovery_prompt(state, now));
    }
    
    decisions
}
```

**Step 4: Fix imports at top of file**

```rust
use super::types::{
    AutoExecuteAction, AutoExecuteDecision, DefaultAction, ExecutionDecision, PromptDecision,
    PromptKind,
};
```

**Step 5: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: Compilation errors in other files that still use old PromptDecision return type - that's next

**Step 6: Commit prompt engine fix**

```bash
git add tastile-core/crates/tastile-core/src/prompt/engine.rs
git commit -m "fix: respect auto_end_allowed and auto_start_allowed conditions

CRITICAL FIX: Engine was ignoring automation conditions entirely.

Before:
- Only checked prompt_on_end/prompt_on_start
- If false, did nothing (tiles never auto-ended)

After:
- Check auto_*_allowed FIRST → return AutoExecute
- Then check prompt_on_* → return Prompt
- If neither, do nothing (manual only)

This fixes ca6 - 'タイルの条件が絶対真実'

Part of: Phase 2 automation logic"
```

---

## Phase 3: Tick Loop - Implement Execution Control

### Task 3.1: Add PendingPrompt Storage to AppState

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/store/state.rs`

**Step 1: Add PendingPrompt struct and storage**

At the top of the file, add:

```rust
use std::collections::HashMap;

/// A prompt that's been generated and is waiting for user action.
/// After 30 seconds, the default_action is automatically executed.
#[derive(Debug, Clone)]
pub struct PendingPrompt {
    pub decision: PromptDecision,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl PendingPrompt {
    pub fn new(decision: PromptDecision, now: DateTime<Utc>) -> Self {
        Self {
            decision,
            created_at: now,
            expires_at: now + Duration::seconds(30),
        }
    }
    
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        now >= self.expires_at
    }
}
```

**Step 2: Add pending_prompts field to AppState**

```rust
pub struct AppState {
    pub tiles: HashMap<TileId, Tile>,
    pub execution: Execution,
    pub focus_policy: FocusPolicy,
    pub startup_recovery_mode: bool,
    
    /// Prompts waiting for user confirmation.
    /// Auto-execute default action after 30 seconds.
    pub pending_prompts: HashMap<TileId, PendingPrompt>,
}
```

**Step 3: Update Default implementation**

```rust
impl Default for AppState {
    fn default() -> Self {
        Self {
            tiles: HashMap::new(),
            execution: Execution::default(),
            focus_policy: FocusPolicy::default(),
            startup_recovery_mode: false,
            pending_prompts: HashMap::new(),
        }
    }
}
```

**Step 4: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: SUCCESS

**Step 5: Commit storage addition**

```bash
git add tastile-core/crates/tastile-core/src/store/state.rs
git commit -m "feat: add pending_prompts storage with 30s expiration

Prompts are now persisted with created_at and expires_at.
Foundation for 30-second auto-approval.

Part of: Phase 3 tick loop implementation"
```

### Task 3.2: Implement Tick Loop Execution Logic

**Files:**
- Modify: `tastile-core/crates/tastile-daemon/src/tick.rs:36-63`

**Critical:** This is where execution control actually happens

**Step 1: Replace hollow tick_once with full implementation**

```rust
async fn tick_once(app_state: Arc<Mutex<AppState>>) -> Result<()> {
    let now = Utc::now();
    
    // Phase 1: Evaluate what should happen
    let (decisions_to_process, expired_prompts) = {
        let state = app_state.lock().unwrap();
        let engine = PromptEngine::new();
        let decisions = engine.evaluate(&state, now);
        
        // Find expired prompts
        let expired: Vec<(TileId, PromptDecision)> = state
            .pending_prompts
            .iter()
            .filter(|(_, pending)| pending.is_expired(now))
            .map(|(id, pending)| (id.clone(), pending.decision.clone()))
            .collect();
        
        (decisions, expired)
    };
    
    // Phase 2: Process auto-execute decisions immediately
    for decision in decisions_to_process {
        match decision {
            ExecutionDecision::AutoExecute(auto_exec) => {
                execute_auto_decision(app_state.clone(), auto_exec).await?;
            }
            ExecutionDecision::Prompt(prompt_decision) => {
                // Store prompt with 30-second expiration
                let mut state = app_state.lock().unwrap();
                state.pending_prompts.insert(
                    prompt_decision.tile_id.clone(),
                    PendingPrompt::new(prompt_decision, now),
                );
            }
        }
    }
    
    // Phase 3: Execute default actions for expired prompts
    for (_tile_id, prompt_decision) in expired_prompts {
        execute_default_action(app_state.clone(), prompt_decision).await?;
    }
    
    Ok(())
}

/// Execute an auto-decision immediately without user confirmation.
async fn execute_auto_decision(
    app_state: Arc<Mutex<AppState>>,
    decision: AutoExecuteDecision,
) -> Result<()> {
    use tastile_core::handler::command_handler;
    
    match decision.action {
        AutoExecuteAction::StartTile => {
            command_handler::handle_start_tile(
                app_state,
                command_handler::StartTileCommand {
                    tile_id: decision.tile_id,
                },
            )?;
        }
        AutoExecuteAction::CompleteTile => {
            command_handler::handle_complete_tile(
                app_state,
                command_handler::CompleteTileCommand {
                    tile_id: decision.tile_id,
                },
            )?;
        }
        AutoExecuteAction::DeferTile => {
            // Not implemented yet - manual defer only for now
        }
    }
    
    Ok(())
}

/// Execute the default action for an expired prompt.
async fn execute_default_action(
    app_state: Arc<Mutex<AppState>>,
    prompt: PromptDecision,
) -> Result<()> {
    // Remove from pending first
    {
        let mut state = app_state.lock().unwrap();
        state.pending_prompts.remove(&prompt.tile_id);
    }
    
    // Execute based on default action
    use tastile_core::handler::command_handler;
    
    match prompt.default_action {
        DefaultAction::Accept => {
            match prompt.prompt_kind {
                PromptKind::Start => {
                    command_handler::handle_start_tile(
                        app_state,
                        command_handler::StartTileCommand {
                            tile_id: prompt.tile_id,
                        },
                    )?;
                }
                PromptKind::End => {
                    command_handler::handle_complete_tile(
                        app_state,
                        command_handler::CompleteTileCommand {
                            tile_id: prompt.tile_id,
                        },
                    )?;
                }
                _ => {
                    // Other prompt kinds - skip for now
                }
            }
        }
        DefaultAction::Defer => {
            // Defer action - not implemented yet
        }
        DefaultAction::Dismiss => {
            // Just remove from pending (already done above)
        }
    }
    
    Ok(())
}
```

**Step 2: Add necessary imports**

```rust
use tastile_core::prompt::{
    AutoExecuteDecision, ExecutionDecision, PromptDecision, PromptEngine,
};
use tastile_core::store::PendingPrompt;
```

**Step 3: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: May have some compilation errors in command handlers - fix in next task

**Step 4: Commit tick loop implementation**

```bash
git add tastile-core/crates/tastile-daemon/src/tick.rs
git commit -m "feat: implement tick loop execution control

CRITICAL IMPLEMENTATION:
- Evaluate ExecutionDecisions every tick
- AutoExecute → execute immediately
- Prompt → store with 30s expiration
- Expired prompts → execute default action

This fixes ca10, ca11 - tick loop now actually works.

Part of: Phase 3 tick loop implementation"
```

### Task 3.3: Update API to Expose Pending Prompts

**Files:**
- Modify: `tastile-api/src/handlers/read_handlers.rs:657-665`

**Step 1: Replace current_prompt_view to use stored prompts**

```rust
// Replace existing function around line 657
pub async fn current_prompt_view(
    State(app): State<Arc<Mutex<AppState>>>,
) -> Json<Option<PromptView>> {
    let state = app.lock().unwrap();
    
    // Return the first pending prompt if any
    let prompt_view = state
        .pending_prompts
        .values()
        .next()
        .map(|pending| {
            PromptView {
                tile_id: pending.decision.tile_id.clone(),
                message: pending.decision.message.clone(),
                prompt_kind: pending.decision.prompt_kind,
                created_at: Some(pending.created_at),
                expires_at: Some(pending.expires_at),
            }
        });
    
    Json(prompt_view)
}

// Add view type if it doesn't exist
#[derive(Serialize)]
pub struct PromptView {
    pub tile_id: TileId,
    pub message: String,
    pub prompt_kind: PromptKind,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}
```

**Step 2: Run cargo check**

Run: `cd tastile-core && cargo check`
Expected: SUCCESS

**Step 3: Commit API update**

```bash
git add tastile-api/src/handlers/read_handlers.rs
git commit -m "fix: serve prompts from storage instead of recalculating

Before: Called PromptEngine.evaluate() on every request
After: Return stored pending_prompts

Enables client to show created_at and expires_at for countdown.

Part of: Phase 3 tick loop implementation"
```

---

## Phase 4: Integration Testing

### Task 4.1: Verify Auto-End Works

**Files:**
- Modify: `tastile-core/tests/execution_control_broken.rs`

**Step 1: Remove #[ignore] from break auto-end test**

```rust
#[test]
// Remove #[ignore] - should pass now
fn break_with_auto_end_allowed_should_auto_complete() {
    // ... existing test code ...
}
```

**Step 2: Run test**

Run: `cd tastile-core && cargo test break_with_auto_end_allowed_should_auto_complete`
Expected: PASS

**Step 3: If fails, add debug logging to tick loop**

Add tracing to tick.rs to see what's happening:

```rust
tracing::info!("Tick decisions: {:?}", decisions_to_process);
tracing::info!("Expired prompts: {:?}", expired_prompts);
```

Run with: `RUST_LOG=info cargo test break_with_auto_end_allowed_should_auto_complete -- --nocapture`

**Step 4: Commit passing test**

```bash
git add tastile-core/tests/execution_control_broken.rs
git commit -m "test: verify break auto-end works

Test now passes - auto_end_allowed is respected.

Part of: Phase 4 integration testing"
```

### Task 4.2: Verify Auto-Start Works

**Files:**
- Modify: `tastile-core/tests/execution_control_broken.rs`

**Step 1: Remove #[ignore] from fixed-start auto-start test**

```rust
#[test]
// Remove #[ignore] - should pass now
fn fixed_start_tile_with_auto_start_allowed_should_auto_start() {
    // ... existing test code ...
}
```

**Step 2: Run test**

Run: `cd tastile-core && cargo test fixed_start_tile_with_auto_start_allowed_should_auto_start`
Expected: PASS

**Step 3: Commit passing test**

```bash
git add tastile-core/tests/execution_control_broken.rs
git commit -m "test: verify auto-start works

Test now passes - auto_start_allowed is respected.

Part of: Phase 4 integration testing"
```

### Task 4.3: Manual E2E Test with Desktop Client

**Files:**
- None (manual testing)

**Step 1: Build and run daemon**

```bash
cd tastile-core
cargo build --release
cd ../tastile-daemon
cargo run
```

**Step 2: Run desktop client**

```bash
cd tastile-desktop
dotnet run
```

**Step 3: Create a break manually and verify it auto-ends**

1. In UI, create a break with 1-minute target
2. Start the break
3. Wait 1 minute
4. Verify: Break should automatically complete without clicking anything

**Step 4: Document results**

```bash
# Create manual test log
echo "Manual E2E Test Results - $(date)" > docs/plans/2026-04-05-manual-test-log.md
echo "" >> docs/plans/2026-04-05-manual-test-log.md
echo "## Break Auto-End Test" >> docs/plans/2026-04-05-manual-test-log.md
echo "- Created 1-minute break" >> docs/plans/2026-04-05-manual-test-log.md
echo "- Result: [PASS/FAIL]" >> docs/plans/2026-04-05-manual-test-log.md
echo "- Notes: " >> docs/plans/2026-04-05-manual-test-log.md

git add docs/plans/2026-04-05-manual-test-log.md
git commit -m "test: manual E2E verification of auto-end

Part of: Phase 4 integration testing"
```

---

## Phase 5: Break Creation - Set Correct Defaults

### Task 5.1: Fix Break Creation to Set auto_end_allowed=true by Default

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/handler/command_handler.rs:389`

**Context:** Line 389 already sets auto_end_allowed=true, verify it's correct

**Step 1: Verify break creation sets correct automation defaults**

Check around line 389:

```rust
// Should already have:
automation: AutomationConditions {
    auto_end_allowed: true,  // ✓ Correct
    prompt_on_end: false,    // ✓ Correct - no prompt, just auto-end
    auto_start_allowed: false,
    prompt_on_start: false,
    ..Default::default()
},
```

**Step 2: If not set, fix it**

If the defaults are wrong, update to:

```rust
automation: AutomationConditions {
    auto_end_allowed: true,   // Breaks auto-end when time expires
    prompt_on_end: false,     // No prompt needed
    auto_start_allowed: false,
    prompt_on_start: false,
    ..Default::default()
},
```

**Step 3: Write test for break creation defaults**

Add test in command_handler.rs:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn break_creation_sets_auto_end_allowed() {
        let mut state = AppState::default();
        let cmd = StartBreakCommand {
            duration_minutes: 5,
        };
        
        handle_start_break(Arc::new(Mutex::new(state)), cmd).unwrap();
        
        let state = state.lock().unwrap();
        let break_tile = state
            .tiles
            .values()
            .find(|t| t.annotation.semantic_role == SemanticRole::Break)
            .expect("Break tile should exist");
        
        assert!(
            break_tile.automation.auto_end_allowed,
            "Breaks must have auto_end_allowed=true"
        );
        assert!(
            !break_tile.automation.prompt_on_end,
            "Breaks should not prompt on end"
        );
    }
}
```

**Step 4: Run test**

Run: `cd tastile-core && cargo test break_creation_sets_auto_end_allowed`
Expected: PASS

**Step 5: Commit if changes made**

```bash
git add tastile-core/crates/tastile-core/src/handler/command_handler.rs
git commit -m "test: verify break creation sets auto_end_allowed=true

Breaks should auto-end when time expires, no prompt needed.

Part of: Phase 5 break creation defaults"
```

---

## Phase 6: Documentation and Migration Guide

### Task 6.1: Document the 30-Second Auto-Approval Feature

**Files:**
- Create: `tastile_docs_bundle/tastile_docs/14_Execution_Control.md`

**Step 1: Create execution control documentation**

```markdown
# 14. Execution Control

## Overview

Tastile's execution control is **condition-driven**, not type-driven. All behavior is determined by tile conditions, particularly `AutomationConditions`.

## Core Principles

1. **Tiles are the absolute source of truth** - never special-case by type
2. **Automation conditions control behavior** - not PhaseKind or SegmentMode
3. **Prompts are recommendations** - not required confirmations

## Automation Conditions

Each tile has `AutomationConditions`:

```rust
pub struct AutomationConditions {
    pub auto_start_allowed: bool,   // If true, auto-start when conditions met
    pub prompt_on_start: bool,      // If true, show prompt before starting
    pub auto_end_allowed: bool,     // If true, auto-complete when conditions met
    pub prompt_on_end: bool,        // If true, show prompt before ending
}
```

## Decision Logic

When tile conditions are met (time expired, fixed_start reached, etc.):

```
if auto_*_allowed {
    → AutoExecute (immediate)
} else if prompt_on_* {
    → Prompt (show to user, 30s auto-approval)
} else {
    → Nothing (manual only)
}
```

## 30-Second Auto-Approval

When a prompt is shown:

1. Prompt created with `created_at` and `expires_at = created_at + 30s`
2. Stored in `AppState.pending_prompts`
3. Tick loop checks for expired prompts every second
4. After 30 seconds: Execute the `default_action` automatically
5. Prompt removed from pending

**Why:** Prevents users from missing important transitions (like break ending).

## Examples

### Break (Auto-End)

```rust
AutomationConditions {
    auto_end_allowed: true,    // ✓ Auto-complete when time expires
    prompt_on_end: false,      // No prompt needed
    ...
}
```

Behavior: Break starts → 5 minutes pass → **automatically completes**

### Fixed-Time Task (Auto-Start)

```rust
AutomationConditions {
    auto_start_allowed: true,   // ✓ Auto-start at fixed_start time
    prompt_on_start: false,     // No prompt needed
    ...
}
```

Behavior: 9:00 AM arrives → **automatically starts task**

### Important Task (Prompt with Auto-Approval)

```rust
AutomationConditions {
    auto_end_allowed: false,    // Don't auto-complete
    prompt_on_end: true,        // Show prompt
    ...
}
```

Behavior: Time expires → Show prompt → **30 seconds later, auto-accept**

## Implementation

See:
- `tastile-core/src/prompt/engine.rs` - Decision logic
- `tastile-daemon/src/tick.rs` - Execution loop
- `tastile-core/src/store/state.rs` - PendingPrompt storage
```

**Step 2: Commit documentation**

```bash
git add tastile_docs_bundle/tastile_docs/14_Execution_Control.md
git commit -m "docs: document 30-second auto-approval feature

Explains:
- Condition-driven execution (not type-driven)
- AutomationConditions decision logic
- 30-second auto-approval mechanism

Part of: Phase 6 documentation"
```

### Task 6.2: Create Migration Guide for PhaseKind Removal

**Files:**
- Create: `docs/plans/migration-remove-phasekind.md`

**Step 1: Write migration guide**

```markdown
# Migration Guide: Removing PhaseKind

## Why

PhaseKind violates the "tiles are truth" principle. Phase should be **derived** from active tile's `semantic_role`, not stored separately.

## Current State (Deprecated)

```rust
// ❌ Wrong: Storing phase separately
state.execution.phase_kind = PhaseKind::Break;
```

## Target State

```rust
// ✓ Correct: Deriving phase from tile
let phase = state.derive_current_phase();
```

## Migration Steps

### Step 1: Replace phase_kind() calls

**Before:**
```rust
let phase = state.execution.phase_kind;
match phase {
    PhaseKind::Break => { /* ... */ }
    PhaseKind::Working => { /* ... */ }
    PhaseKind::Idle => { /* ... */ }
}
```

**After:**
```rust
let phase = state.derive_current_phase();
match phase {
    DerivedPhase::Break => { /* ... */ }
    DerivedPhase::Working => { /* ... */ }
    DerivedPhase::Idle => { /* ... */ }
}
```

### Step 2: Remove phase_kind assignments

**Before:**
```rust
state.execution.phase_kind = PhaseKind::Break;
state.execution.phase_started_at = Some(now);
```

**After:**
```rust
// Phase is automatically derived from active tile
// Just set active_tile_id:
state.execution.active_tile_id = Some(tile_id);
```

### Step 3: Update command handlers

Find all `state.execution.phase_kind = ...` assignments and remove them.

### Step 4: Update client code (C#)

**Before:**
```csharp
if (state.PhaseKind == PhaseKind.Break) { /* ... */ }
```

**After:**
```csharp
var phase = DerivePhaseFro_activeTile(state);
if (phase == DerivedPhase.Break) { /* ... */ }
```

Or better: Check tile conditions directly:
```csharp
var activeTile = GetActiveTile(state);
if (activeTile?.SemanticRole == SemanticRole.Break) { /* ... */ }
```

## Files to Update

Run: `rg "phase_kind" --type rust --type cs`

Expected ~30 files. Update systematically:
1. Core domain (tastile-domain) - remove field
2. Business logic (tastile-core) - use derive_current_phase()
3. API (tastile-api) - return derived phase
4. Client (tastile-desktop) - derive from tile

## Testing

After each file updated:
1. `cargo test` in Rust
2. `dotnet test` in C#
3. Manual E2E test

## Completion Criteria

- [ ] All `phase_kind` assignments removed
- [ ] All reads replaced with `derive_current_phase()`
- [ ] PhaseKind enum deleted from execution.rs
- [ ] All tests pass
- [ ] Manual E2E test passes
```

**Step 2: Commit migration guide**

```bash
git add docs/plans/migration-remove-phasekind.md
git commit -m "docs: migration guide for PhaseKind removal

Step-by-step guide for removing PhaseKind enum and using
condition-based phase derivation instead.

Part of: Phase 6 documentation"
```

---

## Success Criteria

### Immediate Fixes (Phase 1-3)
- [x] ExecutionDecision type exists
- [x] PhaseKind marked deprecated
- [x] derive_current_phase() method added
- [x] PromptEngine respects auto_end_allowed and auto_start_allowed
- [x] Tick loop processes ExecutionDecisions
- [x] Pending prompts stored with 30s expiration
- [x] Expired prompts auto-execute default action

### Behavioral Verification
- [ ] Breaks auto-end after target_rest_min (no user action)
- [ ] Fixed-start tasks auto-start at fixed_start time
- [ ] Prompts appear for prompt_on_* tiles
- [ ] Prompts auto-execute after 30 seconds
- [ ] Timer shows correct countdown
- [ ] Next task starts after break ends

### Code Quality
- [ ] No compilation warnings (except deprecation)
- [ ] All new code has tests
- [ ] Integration tests pass
- [ ] Manual E2E test documented

### Future Work (Not in This Plan)
- Remove PhaseKind entirely (requires 30+ file updates)
- Remove SegmentMode distinction
- Remove break-specific commands/events
- Update client UI to be condition-based

---

## Notes for Implementer

### Critical Context

This is **architectural restoration**, not a small bug fix. We're correcting systematic violations of the "tiles are truth" principle that accumulated over time.

### Principle to Remember

**BEFORE any code:**
> "Is this special-casing by type, or driven by tile conditions?"

If you find yourself writing `if tile.is_break()` or `match segment.mode`, **STOP**. Use tile conditions instead.

### Testing Strategy

1. Write failing test documenting expected behavior
2. Implement minimal fix
3. Verify test passes
4. Verify no regressions
5. Commit immediately

**No large changes**. Each commit should be shippable.

### If You Get Stuck

1. Re-read the design doc: `tastile_docs_bundle/tastile_docs/03_Domain_Model_and_Tile_Conditions.md`
2. Check SQL analysis: `SELECT * FROM complete_analysis WHERE severity='CRITICAL'`
3. Ask: "What would the tile's conditions say?"

### Estimated Time

- Phase 0-2: 2-3 hours
- Phase 3: 3-4 hours (tick loop is complex)
- Phase 4-5: 1-2 hours
- Phase 6: 1 hour

Total: ~8-12 hours of focused work

**Break this into multiple sessions.** Commit frequently.
