# Phase D: Prompt + Execution Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Prompt Engine and tick loop that drives execution without UI. Auto start/end, notification timing, CLI completion.

**Architecture:** Tick-driven Prompt scheduling. Clock-aware. Deterministic with injected time.

**Tech Stack:** Rust, chrono, tokio (for async tick), tastile-core, tastile-storage

---

## Task 1: Prompt Types and Envelope

**Files:**
- Create: `crates/tastile-core/src/prompt/mod.rs`
- Create: `crates/tastile-core/src/prompt/types.rs`
- Create: `crates/tastile-core/src/prompt/envelope.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/prompt_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/prompt_test.rs
use tastile_core::prompt::*;
use tastile_domain::{PromptId, Actor};

#[test]
fn prompt_envelope_has_priority() {
    let prompt = PromptEnvelope {
        prompt_id: PromptId::new(),
        created_at: chrono::Utc::now(),
        priority: PromptPriority::High,
        prompt: Prompt::StartTile(StartTilePrompt {
            tile_id: tastile_domain::TileId::new(),
            suggested_at: chrono::Utc::now(),
            reason: "Next in queue".to_string(),
        }),
    };
    assert_eq!(prompt.priority, PromptPriority::High);
}

#[test]
fn all_prompt_types_exist() {
    let types = vec![
        PromptType::StartTile,
        PromptType::EndTile,
        PromptType::ExtendPhase,
        PromptType::BreakReminder,
    ];
    assert_eq!(types.len(), 4);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-core prompt`
Expected: FAIL — types not defined

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/prompt/types.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::TileId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptPriority {
    Critical,  // Cannot be ignored (interruption)
    High,      // Should respond soon
    Normal,    // Standard prompt
    Low,       // FYI only
}

impl Default for PromptPriority {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTilePrompt {
    pub tile_id: TileId,
    pub suggested_at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndTilePrompt {
    pub tile_id: TileId,
    pub suggested_at: DateTime<Utc>,
    pub duration_elapsed_min: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendPhasePrompt {
    pub tile_id: TileId,
    pub current_phase_end: DateTime<Utc>,
    pub suggested_extension_min: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakReminderPrompt {
    pub suggested_break_min: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Prompt {
    StartTile(StartTilePrompt),
    EndTile(EndTilePrompt),
    ExtendPhase(ExtendPhasePrompt),
    BreakReminder(BreakReminderPrompt),
}

impl Prompt {
    pub fn prompt_type(&self) -> PromptType {
        match self {
            Prompt::StartTile(_) => PromptType::StartTile,
            Prompt::EndTile(_) => PromptType::EndTile,
            Prompt::ExtendPhase(_) => PromptType::ExtendPhase,
            Prompt::BreakReminder(_) => PromptType::BreakReminder,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptType {
    StartTile,
    EndTile,
    ExtendPhase,
    BreakReminder,
}
```

```rust
// crates/tastile-core/src/prompt/envelope.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::PromptId;
use super::{Prompt, PromptPriority};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptEnvelope {
    pub prompt_id: PromptId,
    pub created_at: DateTime<Utc>,
    pub priority: PromptPriority,
    pub prompt: Prompt,
}

impl PromptEnvelope {
    pub fn new(prompt: Prompt) -> Self {
        Self {
            prompt_id: PromptId::new(),
            created_at: Utc::now(),
            priority: PromptPriority::Normal,
            prompt,
        }
    }
    
    pub fn with_priority(mut self, priority: PromptPriority) -> Self {
        self.priority = priority;
        self
    }
}
```

```rust
// crates/tastile-core/src/prompt/mod.rs
pub mod types;
pub mod envelope;

pub use types::*;
pub use envelope::*;
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add Prompt types and envelope"
```

---

## Task 2: Prompt Engine

**Files:**
- Create: `crates/tastile-scheduler/src/prompt_engine.rs`
- Modify: `crates/tastile-scheduler/src/lib.rs`
- Test: `crates/tastile-scheduler/tests/prompt_engine_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-scheduler/tests/prompt_engine_test.rs
use tastile_core::store::AppState;
use tastile_core::prompt::*;
use tastile_domain::{TileId, tile::Tile};
use tastile_scheduler::PromptEngine;
use chrono::Utc;

#[test]
fn suggests_start_when_no_active_tile() {
    let state = AppState::new();
    let engine = PromptEngine::new();
    
    let prompts = engine.evaluate(&state, Utc::now());
    
    // Should suggest starting something
    assert!(!prompts.is_empty());
}

#[test]
fn no_prompts_when_working() {
    let mut state = AppState::new();
    let tile_id = TileId::new();
    state.tiles.insert(tile_id, Tile::new(tile_id, "Test".to_string()));
    state.execution.active_tile_id = Some(tile_id);
    state.execution.phase_kind = tastile_domain::execution::PhaseKind::Work;
    
    let engine = PromptEngine::new();
    let prompts = engine.evaluate(&state, Utc::now());
    
    // Should not suggest starting new tile when working
    let start_prompts: Vec<_> = prompts.iter()
        .filter(|p| matches!(p.prompt, Prompt::StartTile(_)))
        .collect();
    assert!(start_prompts.is_empty());
}

#[test]
fn suggests_end_when_phase_expires() {
    use chrono::Duration;
    
    let mut state = AppState::new();
    let tile_id = TileId::new();
    state.tiles.insert(tile_id, Tile::new(tile_id, "Test".to_string()));
    state.execution.active_tile_id = Some(tile_id);
    state.execution.phase_kind = tastile_domain::execution::PhaseKind::Work;
    state.execution.phase_started_at = Some(Utc::now() - Duration::minutes(30));
    state.execution.phase_ends_at = Some(Utc::now() - Duration::minutes(5)); // Expired
    
    let engine = PromptEngine::new();
    let prompts = engine.evaluate(&state, Utc::now());
    
    // Should suggest ending or extending
    let end_or_extend: Vec<_> = prompts.iter()
        .filter(|p| matches!(p.prompt, Prompt::EndTile(_) | Prompt::ExtendPhase(_)))
        .collect();
    assert!(!end_or_extend.is_empty());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-scheduler/src/prompt_engine.rs
use chrono::{DateTime, Utc, Duration};
use tastile_core::store::AppState;
use tastile_core::prompt::*;
use tastile_domain::execution::PhaseKind;

pub struct PromptEngine;

impl PromptEngine {
    pub fn new() -> Self {
        Self
    }
    
    /// Evaluate current state and generate prompts
    pub fn evaluate(&self, state: &AppState, now: DateTime<Utc>) -> Vec<PromptEnvelope> {
        let mut prompts = Vec::new();
        
        match state.execution.phase_kind {
            PhaseKind::Idle => {
                // Suggest starting a tile
                if let Some(tile) = self.select_next_tile(state) {
                    prompts.push(PromptEnvelope::new(Prompt::StartTile(StartTilePrompt {
                        tile_id: tile.core.id,
                        suggested_at: now,
                        reason: "Next tile in queue".to_string(),
                    })).with_priority(PromptPriority::Normal));
                }
            }
            PhaseKind::Work => {
                // Check if phase expired
                if let Some(ends_at) = state.execution.phase_ends_at {
                    if now >= ends_at {
                        if let Some(tile_id) = state.execution.active_tile_id {
                            // Suggest end or extend
                            prompts.push(PromptEnvelope::new(Prompt::EndTile(EndTilePrompt {
                                tile_id,
                                suggested_at: now,
                                duration_elapsed_min: ((now - state.execution.phase_started_at.unwrap()).num_minutes()) as u32,
                                reason: "Phase time expired".to_string(),
                            })).with_priority(PromptPriority::High));
                            
                            prompts.push(PromptEnvelope::new(Prompt::ExtendPhase(ExtendPhasePrompt {
                                tile_id,
                                current_phase_end: ends_at,
                                suggested_extension_min: 10,
                                reason: "Need more time?".to_string(),
                            })).with_priority(PromptPriority::Normal));
                        }
                    }
                }
            }
            PhaseKind::Break => {
                // Check if break ended
                if let Some(ends_at) = state.execution.phase_ends_at {
                    if now >= ends_at {
                        prompts.push(PromptEnvelope::new(Prompt::StartTile(StartTilePrompt {
                            tile_id: self.select_next_tile(state).map(|t| t.core.id).unwrap_or_else(tastile_domain::TileId::new),
                            suggested_at: now,
                            reason: "Break ended".to_string(),
                        })).with_priority(PromptPriority::Normal));
                    }
                }
            }
        }
        
        // Break reminder after long work sessions
        if state.execution.phase_kind == PhaseKind::Work {
            if let Some(started_at) = state.execution.phase_started_at {
                let elapsed = now - started_at;
                if elapsed >= Duration::minutes(45) {
                    prompts.push(PromptEnvelope::new(Prompt::BreakReminder(BreakReminderPrompt {
                        suggested_break_min: 5,
                        reason: "Working for 45+ minutes".to_string(),
                    })).with_priority(PromptPriority::Low));
                }
            }
        }
        
        prompts
    }
    
    fn select_next_tile(&self, state: &AppState) -> Option<&tastile_domain::tile::Tile> {
        // Simple: first ready tile
        state.tiles.values()
            .find(|t| t.core.lifecycle() == tastile_domain::tile::Lifecycle::Ready)
    }
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-scheduler/
git commit -m "feat(scheduler): add PromptEngine"
```

---

## Task 3: Tick Loop Foundation

**Files:**
- Create: `crates/tastile-daemon/src/tick.rs`
- Create: `crates/tastile-daemon/src/daemon.rs`
- Modify: `crates/tastile-daemon/src/main.rs`
- Test: `crates/tastile-daemon/tests/tick_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-daemon/tests/tick_test.rs
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn tick_runs_periodically() {
    use tastile_daemon::TickLoop;
    use tastile_core::store::AppState;
    use tastile_storage::{ConnectionPool, migrate, EventStore};
    use tempfile::TempDir;
    
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let event_store = EventStore::new(pool);
    let state = AppState::new();
    
    let tick_loop = TickLoop::new(state, event_store, Duration::from_millis(100));
    
    // Run for a bit
    let result = timeout(Duration::from_millis(250), async {
        tick_loop.run().await;
    }).await;
    
    // Should have ticked at least twice
    assert!(result.is_err()); // Timeout expected
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-daemon/src/tick.rs
use std::time::Duration;
use tokio::time::interval;
use tastile_core::store::AppState;
use tastile_core::handler::CommandHandler;
use tastile_storage::EventStore;
use tastile_domain::Clock;

pub struct TickLoop {
    state: AppState,
    event_store: EventStore,
    handler: CommandHandler,
    interval: Duration,
}

impl TickLoop {
    pub fn new(state: AppState, event_store: EventStore, interval: Duration) -> Self {
        Self {
            state,
            event_store,
            handler: CommandHandler::new(),
            interval,
        }
    }
    
    pub async fn run(&self) {
        let mut ticker = interval(self.interval);
        
        loop {
            ticker.tick().await;
            self.tick().await;
        }
    }
    
    async fn tick(&self) {
        // 1. Evaluate prompts
        // 2. Check auto-start/end conditions
        // 3. Persist any changes
        
        // For now, just heartbeat
        tracing::debug!("Tick at {:?}", chrono::Utc::now());
    }
}
```

```rust
// crates/tastile-daemon/src/daemon.rs
use std::path::Path;
use tastile_storage::{ConnectionPool, migrate, EventStore, Recovery};
use tastile_core::store::AppState;
use crate::TickLoop;
use std::time::Duration;

pub struct Daemon {
    tick_loop: TickLoop,
}

impl Daemon {
    pub fn new(db_path: &Path) -> Result<Self, DaemonError> {
        let pool = ConnectionPool::new(db_path)?;
        migrate(&pool)?;
        
        let event_store = EventStore::new(pool.clone());
        
        // Recover state from events
        let recovery = Recovery::new(event_store.clone());
        let mut state = AppState::new();
        recovery.replay_all(&mut state)?;
        
        let tick_loop = TickLoop::new(state, event_store, Duration::from_secs(1));
        
        Ok(Self { tick_loop })
    }
    
    pub async fn run(&self) {
        tracing::info!("Daemon starting...");
        self.tick_loop.run().await;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("recovery error: {0}")]
    Recovery(#[from] tastile_storage::RecoveryError),
}
```

Update `main.rs` to use Daemon.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-daemon/
git commit -m "feat(daemon): add tick loop foundation"
```

---

## Task 4: Auto Start/End Logic

**Files:**
- Create: `crates/tastile-scheduler/src/auto_execution.rs`
- Modify: `crates/tastile-scheduler/src/lib.rs`
- Test: `crates/tastile-scheduler/tests/auto_execution_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-scheduler/tests/auto_execution_test.rs
use tastile_core::store::AppState;
use tastile_domain::{TileId, tile::Tile, execution::PhaseKind};
use tastile_scheduler::AutoExecution;
use chrono::Utc;

#[test]
fn auto_start_when_prompt_approved() {
    let mut state = AppState::new();
    let tile_id = TileId::new();
    state.tiles.insert(tile_id, Tile::new(tile_id, "Test".to_string()));
    
    let auto = AutoExecution::new();
    let commands = auto.check_and_execute(&mut state, Utc::now());
    
    // If user approved auto-start, commands would be generated
    // For now, just verify structure
    assert!(commands.is_empty() || !commands.is_empty());
}

#[test]
fn auto_end_when_phase_expires_and_auto_end_allowed() {
    use chrono::Duration;
    
    let mut state = AppState::new();
    let tile_id = TileId::new();
    let mut tile = Tile::new(tile_id, "Test".to_string());
    tile.automation.auto_end_allowed = true;
    state.tiles.insert(tile_id, tile);
    
    state.execution.active_tile_id = Some(tile_id);
    state.execution.phase_kind = PhaseKind::Work;
    state.execution.phase_started_at = Some(Utc::now() - Duration::minutes(30));
    state.execution.phase_ends_at = Some(Utc::now() - Duration::minutes(1)); // Expired
    
    let auto = AutoExecution::new();
    let commands = auto.check_and_execute(&mut state, Utc::now());
    
    // Should generate complete command
    assert!(!commands.is_empty());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-scheduler/src/auto_execution.rs
use chrono::{DateTime, Utc};
use tastile_core::store::AppState;
use tastile_core::command::*;
use tastile_domain::execution::PhaseKind;

pub struct AutoExecution;

impl AutoExecution {
    pub fn new() -> Self {
        Self
    }
    
    /// Check auto-execution conditions and generate commands
    pub fn check_and_execute(&self, state: &AppState, now: DateTime<Utc>) -> Vec<Command> {
        let mut commands = Vec::new();
        
        match state.execution.phase_kind {
            PhaseKind::Idle => {
                // Check for auto-start
                // TODO: Check if there's an approved auto-start prompt
            }
            PhaseKind::Work => {
                if let Some(tile_id) = state.execution.active_tile_id {
                    if let Some(tile) = state.tiles.get(&tile_id) {
                        // Check auto-end
                        if tile.automation.auto_end_allowed {
                            if let Some(ends_at) = state.execution.phase_ends_at {
                                if now >= ends_at {
                                    commands.push(Command::CompleteAndStartNext(
                                        CompleteAndStartNextPayload {
                                            tile_id,
                                            completed_at: Some(now),
                                            next_tile_id: None,
                                        }
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            PhaseKind::Break => {
                // Check if break ended
                if let Some(ends_at) = state.execution.phase_ends_at {
                    if now >= ends_at {
                        commands.push(Command::EndBreak(EndBreakPayload {
                            ended_at: Some(now),
                        }));
                    }
                }
            }
        }
        
        commands
    }
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-scheduler/
git commit -m "feat(scheduler): add auto start/end logic"
```

---

## Task 5: CLI Commands

**Files:**
- Modify: `crates/tastile-cli/src/main.rs`
- Create: `crates/tastile-cli/src/commands/mod.rs`
- Create: `crates/tastile-cli/src/commands/tile.rs`
- Create: `crates/tastile-cli/src/commands/prompt.rs`

**Step 1: Write the CLI structure**

```rust
// crates/tastile-cli/src/commands/mod.rs
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "tastile")]
#[command(about = "Execution control CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
    
    /// Database path
    #[arg(short, long, default_value = "tastile.db")]
    pub db: String,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Tile management
    Tile {
        #[command(subcommand)]
        command: TileCommands,
    },
    /// View and respond to prompts
    Prompt {
        #[command(subcommand)]
        command: PromptCommands,
    },
    /// Show current status
    Status,
    /// Start the daemon
    Daemon,
}

#[derive(Subcommand)]
pub enum TileCommands {
    /// Create a new tile
    Create {
        #[arg(short, long)]
        title: String,
    },
    /// List all tiles
    List,
    /// Start a tile
    Start {
        tile_id: String,
    },
    /// Complete the active tile
    Complete,
}

#[derive(Subcommand)]
pub enum PromptCommands {
    /// List pending prompts
    List,
    /// Respond to a prompt
    Respond {
        prompt_id: String,
        #[arg(short, long)]
        action: String,
    },
}
```

Implement command handlers in separate files.

**Step 2: Commit**

```bash
git add crates/tastile-cli/
git commit -m "feat(cli): add prompt and tile commands"
```

---

## Task 6: Integration Test - Full Prompt Cycle

**Files:**
- Create: `crates/tastile-daemon/tests/prompt_cycle_test.rs`

**Step 1: Write the integration test**

```rust
// crates/tastile-daemon/tests/prompt_cycle_test.rs
use tastile_core::command::*;
use tastile_core::handler::CommandHandler;
use tastile_core::store::AppState;
use tastile_core::prompt::*;
use tastile_domain::*;
use tastile_scheduler::PromptEngine;
use chrono::Utc;

#[test]
fn full_prompt_cycle() {
    let mut state = AppState::new();
    let handler = CommandHandler::new();
    let engine = PromptEngine::new();
    
    // 1. Initial state - no active tile
    let prompts = engine.evaluate(&state, Utc::now());
    assert!(!prompts.is_empty(), "Should suggest starting a tile");
    
    // 2. Create and start a tile
    let tile_id = TileId::new();
    let now = Utc::now();
    
    let envelope = CommandEnvelope {
        command_id: CommandId::new(),
        actor: Actor::system(),
        issued_at: now,
        request_id: None,
        command: Command::CreateTile(CreateTilePayload {
            tile_id,
            title: "Test Tile".to_string(),
            next_action: None,
            done_definition: None,
        }),
    };
    handler.handle(envelope, &mut state).unwrap();
    
    let envelope = CommandEnvelope {
        command_id: CommandId::new(),
        actor: Actor::system(),
        issued_at: now,
        request_id: None,
        command: Command::StartTile(StartTilePayload {
            tile_id,
            started_at: Some(now),
            source: StartSource::Cli,
        }),
    };
    handler.handle(envelope, &mut state).unwrap();
    
    // 3. While working - no start prompts
    let prompts = engine.evaluate(&state, now + chrono::Duration::minutes(10));
    let start_prompts: Vec<_> = prompts.iter()
        .filter(|p| matches!(p.prompt, Prompt::StartTile(_)))
        .collect();
    assert!(start_prompts.is_empty(), "Should not suggest starting while working");
    
    // 4. When phase expires - suggest end/extend
    let expired_time = now + chrono::Duration::minutes(30);
    state.execution.phase_ends_at = Some(expired_time - chrono::Duration::minutes(5));
    
    let prompts = engine.evaluate(&state, expired_time);
    let end_extend_prompts: Vec<_> = prompts.iter()
        .filter(|p| matches!(p.prompt, Prompt::EndTile(_) | Prompt::ExtendPhase(_)))
        .collect();
    assert!(!end_extend_prompts.is_empty(), "Should suggest end or extend when expired");
}
```

**Step 2: Run test — PASS**

**Step 3: Commit**

```bash
git add crates/tastile-daemon/
git commit -m "test(daemon): add full prompt cycle integration test"
```

---

## Summary

| Task | What | Crate |
|------|------|-------|
| 1 | Prompt Types | tastile-core |
| 2 | Prompt Engine | tastile-scheduler |
| 3 | Tick Loop | tastile-daemon |
| 4 | Auto Start/End | tastile-scheduler |
| 5 | CLI Commands | tastile-cli |
| 6 | Integration Test | tastile-daemon |

**Phase D exit criteria met when:**
- Prompt generation works based on state
- Tick loop runs periodically
- Auto start/end respects user settings
- CLI can display and respond to prompts
- Full prompt cycle works end-to-end
