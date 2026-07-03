# Phase B: Core Kernel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the deterministic mutation core (domain types, commands, events, validation, reducer) that works entirely in-memory with full test coverage.

**Architecture:** Command -> Validation -> Event(s) -> Reducer -> State. All writes go through this pipeline. No direct state mutation. Reducer is pure and deterministic. Clock is injected via trait for testability.

**Tech Stack:** Rust, serde, chrono, uuid, thiserror

---

## Task 1: Newtypes and Shared Primitives

**Files:**
- Create: `crates/tastile-domain/src/ids.rs`
- Create: `crates/tastile-domain/src/clock.rs`
- Modify: `crates/tastile-domain/src/lib.rs`
- Test: `crates/tastile-domain/tests/ids_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/ids_test.rs
use tastile_domain::{TileId, SegmentId, PromptId, ActorId, EventId, CommandId};

#[test]
fn newtype_ids_are_unique() {
    let a = TileId::new();
    let b = TileId::new();
    assert_ne!(a, b);
}

#[test]
fn newtype_ids_serialize_as_string() {
    let id = TileId::new();
    let json = serde_json::to_string(&id).unwrap();
    assert!(json.starts_with('"'));
    let back: TileId = serde_json::from_str(&json).unwrap();
    assert_eq!(id, back);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-domain`
Expected: FAIL — types not defined

**Step 3: Write implementation**

```rust
// crates/tastile-domain/src/ids.rs
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

macro_rules! define_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

define_id!(TileId);
define_id!(SegmentId);
define_id!(PromptId);
define_id!(ActorId);
define_id!(EventId);
define_id!(CommandId);
define_id!(RequestId);
```

```rust
// crates/tastile-domain/src/clock.rs
use chrono::{DateTime, Utc};

pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

#[derive(Debug, Clone)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

#[derive(Debug, Clone)]
pub struct FixedClock {
    pub time: DateTime<Utc>,
}

impl FixedClock {
    pub fn new(time: DateTime<Utc>) -> Self {
        Self { time }
    }

    pub fn advance(&mut self, duration: chrono::Duration) {
        self.time = self.time + duration;
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.time
    }
}
```

```rust
// crates/tastile-domain/src/lib.rs
pub mod ids;
pub mod clock;

pub use ids::*;
pub use clock::*;
```

**Step 4: Run tests**

Run: `cargo test -p tastile-domain`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add newtype IDs and Clock trait"
```

---

## Task 2: Actor Model

**Files:**
- Create: `crates/tastile-domain/src/actor.rs`
- Modify: `crates/tastile-domain/src/lib.rs`
- Test: `crates/tastile-domain/tests/actor_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/actor_test.rs
use tastile_domain::{Actor, ActorType, ActorId};

#[test]
fn actor_serializes_correctly() {
    let actor = Actor {
        actor_type: ActorType::Human,
        actor_id: ActorId::new(),
    };
    let json = serde_json::to_string(&actor).unwrap();
    let back: Actor = serde_json::from_str(&json).unwrap();
    assert_eq!(actor.actor_type, back.actor_type);
}

#[test]
fn all_actor_types_exist() {
    let types = vec![
        ActorType::Human,
        ActorType::Agent,
        ActorType::Cron,
        ActorType::Loop,
        ActorType::System,
    ];
    assert_eq!(types.len(), 5);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-domain/src/actor.rs
use serde::{Deserialize, Serialize};
use crate::ActorId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    Human,
    Agent,
    Cron,
    Loop,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub actor_type: ActorType,
    pub actor_id: ActorId,
}

impl Actor {
    pub fn system() -> Self {
        Self {
            actor_type: ActorType::System,
            actor_id: ActorId::new(),
        }
    }

    pub fn human(id: ActorId) -> Self {
        Self {
            actor_type: ActorType::Human,
            actor_id: id,
        }
    }
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add Actor model"
```

---

## Task 3: Tile Core Facts

**Files:**
- Create: `crates/tastile-domain/src/tile/mod.rs`
- Create: `crates/tastile-domain/src/tile/core.rs`
- Modify: `crates/tastile-domain/src/lib.rs`
- Test: `crates/tastile-domain/tests/tile_core_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/tile_core_test.rs
use tastile_domain::tile::{TileCore, Lifecycle};
use tastile_domain::TileId;
use chrono::Utc;

#[test]
fn new_tile_is_ready() {
    let core = TileCore {
        id: TileId::new(),
        title: "Write tests".to_string(),
        next_action: Some("Open editor".to_string()),
        done_definition: Some("All tests pass".to_string()),
        started_at: None,
        completed_at: None,
    };
    assert_eq!(core.lifecycle(), Lifecycle::Ready);
}

#[test]
fn started_tile_is_started() {
    let core = TileCore {
        id: TileId::new(),
        title: "Write tests".to_string(),
        next_action: None,
        done_definition: None,
        started_at: Some(Utc::now()),
        completed_at: None,
    };
    assert_eq!(core.lifecycle(), Lifecycle::Started);
}

#[test]
fn completed_tile_is_done() {
    let now = Utc::now();
    let core = TileCore {
        id: TileId::new(),
        title: "Write tests".to_string(),
        next_action: None,
        done_definition: None,
        started_at: Some(now),
        completed_at: Some(now),
    };
    assert_eq!(core.lifecycle(), Lifecycle::Done);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-domain/src/tile/mod.rs
pub mod core;
pub use self::core::*;

// crates/tastile-domain/src/tile/core.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::TileId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lifecycle {
    Ready,
    Started,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileCore {
    pub id: TileId,
    pub title: String,
    pub next_action: Option<String>,
    pub done_definition: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl TileCore {
    pub fn lifecycle(&self) -> Lifecycle {
        if self.completed_at.is_some() {
            Lifecycle::Done
        } else if self.started_at.is_some() {
            Lifecycle::Started
        } else {
            Lifecycle::Ready
        }
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add TileCore with lifecycle derivation"
```

---

## Task 4: Condition Vectors (Temporal, Objective, Interruption, Automation, Annotation)

**Files:**
- Create: `crates/tastile-domain/src/tile/temporal.rs`
- Create: `crates/tastile-domain/src/tile/objective.rs`
- Create: `crates/tastile-domain/src/tile/interruption.rs`
- Create: `crates/tastile-domain/src/tile/automation.rs`
- Create: `crates/tastile-domain/src/tile/annotation.rs`
- Modify: `crates/tastile-domain/src/tile/mod.rs`
- Test: `crates/tastile-domain/tests/conditions_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/conditions_test.rs
use tastile_domain::tile::*;

#[test]
fn default_temporal_is_unconstrained() {
    let t = TemporalConditions::default();
    assert!(t.release_at.is_none());
    assert!(t.due_at.is_none());
    assert!(t.fixed_start.is_none());
    assert!(t.fixed_end.is_none());
    assert!(t.active_start.is_none());
    assert!(t.active_end.is_none());
}

#[test]
fn default_objective_is_finish_once() {
    let o = ObjectiveConditions::default();
    assert_eq!(o.objective_mode, ObjectiveMode::FinishOnce);
}

#[test]
fn default_interruption_allows_break_split() {
    let i = InterruptionConditions::default();
    assert!(i.break_splits_work);
    assert!(!i.external_interrupt_only);
}

#[test]
fn default_automation_prompts_both() {
    let a = AutomationConditions::default();
    assert!(a.prompt_on_start);
    assert!(a.prompt_on_end);
    assert!(!a.auto_start_allowed);
    assert!(!a.auto_end_allowed);
}

#[test]
fn break_annotation() {
    let a = AnnotationConditions {
        semantic_role: SemanticRole::Break,
        labels: vec![],
        timed_labels: vec![],
    };
    assert_eq!(a.semantic_role, SemanticRole::Break);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementations**

```rust
// crates/tastile-domain/src/tile/temporal.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TemporalConditions {
    pub release_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub fixed_start: Option<DateTime<Utc>>,
    pub fixed_end: Option<DateTime<Utc>>,
    pub active_start: Option<DateTime<Utc>>,
    pub active_end: Option<DateTime<Utc>>,
}
```

```rust
// crates/tastile-domain/src/tile/objective.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveMode {
    FinishOnce,
    MaximizeWithinInterval,
    LabelOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoneRule {
    Manual,
    TimeReached,
    IntervalEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectiveConditions {
    pub objective_mode: ObjectiveMode,
    pub target_work_min: Option<u32>,
    pub target_rest_min: Option<u32>,
    pub done_rule: Option<DoneRule>,
}

impl Default for ObjectiveConditions {
    fn default() -> Self {
        Self {
            objective_mode: ObjectiveMode::FinishOnce,
            target_work_min: None,
            target_rest_min: None,
            done_rule: None,
        }
    }
}
```

```rust
// crates/tastile-domain/src/tile/interruption.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterruptionConditions {
    pub interrupt_penalty: u32,
    pub resume_penalty: u32,
    pub break_splits_work: bool,
    pub external_interrupt_only: bool,
}

impl Default for InterruptionConditions {
    fn default() -> Self {
        Self {
            interrupt_penalty: 3,
            resume_penalty: 3,
            break_splits_work: true,
            external_interrupt_only: false,
        }
    }
}
```

```rust
// crates/tastile-domain/src/tile/automation.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationConditions {
    pub prompt_on_start: bool,
    pub prompt_on_end: bool,
    pub auto_start_allowed: bool,
    pub auto_end_allowed: bool,
}

impl Default for AutomationConditions {
    fn default() -> Self {
        Self {
            prompt_on_start: true,
            prompt_on_end: true,
            auto_start_allowed: false,
            auto_end_allowed: false,
        }
    }
}
```

```rust
// crates/tastile-domain/src/tile/annotation.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticRole {
    Work,
    Break,
    Label,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimedLabel {
    pub label: String,
    pub start_at: Option<DateTime<Utc>>,
    pub end_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationConditions {
    pub semantic_role: SemanticRole,
    pub labels: Vec<String>,
    pub timed_labels: Vec<TimedLabel>,
}

impl Default for AnnotationConditions {
    fn default() -> Self {
        Self {
            semantic_role: SemanticRole::Work,
            labels: vec![],
            timed_labels: vec![],
        }
    }
}
```

Update `tile/mod.rs` to re-export all.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add all condition vectors"
```

---

## Task 5: WorkFacts and Segment

**Files:**
- Create: `crates/tastile-domain/src/tile/work_facts.rs`
- Modify: `crates/tastile-domain/src/tile/mod.rs`
- Test: `crates/tastile-domain/tests/work_facts_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/work_facts_test.rs
use tastile_domain::tile::{WorkFacts, Segment, SegmentMode};
use tastile_domain::{SegmentId, TileId};
use chrono::{Utc, Duration};

#[test]
fn worked_minutes_from_closed_segments() {
    let start = Utc::now();
    let end = start + Duration::minutes(25);
    let facts = WorkFacts {
        segments: vec![Segment {
            id: SegmentId::new(),
            start_at: start,
            end_at: Some(end),
            mode: SegmentMode::Work,
            source_tile_id: TileId::new(),
        }],
        closed_at: None,
        resume_note: None,
        scratch_notes: vec![],
    };
    assert_eq!(facts.worked_minutes(), 25);
}

#[test]
fn open_segment_not_counted_in_minutes() {
    let facts = WorkFacts {
        segments: vec![Segment {
            id: SegmentId::new(),
            start_at: Utc::now(),
            end_at: None,
            mode: SegmentMode::Work,
            source_tile_id: TileId::new(),
        }],
        closed_at: None,
        resume_note: None,
        scratch_notes: vec![],
    };
    assert_eq!(facts.worked_minutes(), 0);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-domain/src/tile/work_facts.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::{SegmentId, TileId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentMode {
    Work,
    Break,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub id: SegmentId,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub mode: SegmentMode,
    pub source_tile_id: TileId,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkFacts {
    pub segments: Vec<Segment>,
    pub closed_at: Option<DateTime<Utc>>,
    pub resume_note: Option<String>,
    pub scratch_notes: Vec<String>,
}

impl WorkFacts {
    pub fn worked_minutes(&self) -> i64 {
        self.minutes_by_mode(SegmentMode::Work)
    }

    pub fn rested_minutes(&self) -> i64 {
        self.minutes_by_mode(SegmentMode::Break)
    }

    fn minutes_by_mode(&self, mode: SegmentMode) -> i64 {
        self.segments
            .iter()
            .filter(|s| s.mode == mode)
            .filter_map(|s| s.end_at.map(|end| (end - s.start_at).num_minutes()))
            .sum()
    }

    pub fn open_segment(&self) -> Option<&Segment> {
        self.segments.iter().find(|s| s.end_at.is_none())
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add WorkFacts and Segment"
```

---

## Task 6: Tile Aggregate and Execution State

**Files:**
- Create: `crates/tastile-domain/src/tile/aggregate.rs`
- Create: `crates/tastile-domain/src/execution.rs`
- Modify: `crates/tastile-domain/src/tile/mod.rs`
- Modify: `crates/tastile-domain/src/lib.rs`
- Test: `crates/tastile-domain/tests/tile_aggregate_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-domain/tests/tile_aggregate_test.rs
use tastile_domain::tile::*;
use tastile_domain::execution::*;
use tastile_domain::TileId;

#[test]
fn tile_has_all_condition_layers() {
    let tile = Tile::new(TileId::new(), "Test tile".to_string());
    assert_eq!(tile.core.lifecycle(), Lifecycle::Ready);
    assert_eq!(tile.objective.objective_mode, ObjectiveMode::FinishOnce);
    assert_eq!(tile.annotation.semantic_role, SemanticRole::Work);
}

#[test]
fn execution_starts_idle() {
    let exec = Execution::default();
    assert!(exec.active_tile_id.is_none());
    assert_eq!(exec.phase_kind, PhaseKind::Idle);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-domain/src/tile/aggregate.rs
use serde::{Deserialize, Serialize};
use crate::TileId;
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tile {
    pub core: TileCore,
    pub work: WorkFacts,
    pub temporal: TemporalConditions,
    pub objective: ObjectiveConditions,
    pub interruption: InterruptionConditions,
    pub automation: AutomationConditions,
    pub annotation: AnnotationConditions,
}

impl Tile {
    pub fn new(id: TileId, title: String) -> Self {
        Self {
            core: TileCore {
                id,
                title,
                next_action: None,
                done_definition: None,
                started_at: None,
                completed_at: None,
            },
            work: WorkFacts::default(),
            temporal: TemporalConditions::default(),
            objective: ObjectiveConditions::default(),
            interruption: InterruptionConditions::default(),
            automation: AutomationConditions::default(),
            annotation: AnnotationConditions::default(),
        }
    }
}
```

```rust
// crates/tastile-domain/src/execution.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::{TileId, PromptId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseKind {
    Work,
    Break,
    Idle,
}

impl Default for PhaseKind {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Execution {
    pub active_tile_id: Option<TileId>,
    pub phase_kind: PhaseKind,
    pub phase_started_at: Option<DateTime<Utc>>,
    pub phase_ends_at: Option<DateTime<Utc>>,
    pub pending_prompt_id: Option<PromptId>,
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-domain/
git commit -m "feat(domain): add Tile aggregate and Execution state"
```

---

## Task 7: Command Types

**Files:**
- Create: `crates/tastile-core/src/command/mod.rs`
- Create: `crates/tastile-core/src/command/envelope.rs`
- Create: `crates/tastile-core/src/command/payloads.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/command_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/command_test.rs
use tastile_core::command::*;
use tastile_domain::*;

#[test]
fn command_envelope_serializes() {
    let cmd = CommandEnvelope {
        command_id: CommandId::new(),
        actor: Actor::system(),
        issued_at: chrono::Utc::now(),
        request_id: None,
        command: Command::CreateTile(CreateTilePayload {
            tile_id: TileId::new(),
            title: "Test".to_string(),
            next_action: None,
            done_definition: None,
        }),
    };
    let json = serde_json::to_string(&cmd).unwrap();
    assert!(json.contains("create_tile"));
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/command/envelope.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::{Actor, CommandId, RequestId};
use super::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEnvelope {
    pub command_id: CommandId,
    pub actor: Actor,
    pub issued_at: DateTime<Utc>,
    pub request_id: Option<RequestId>,
    pub command: Command,
}
```

```rust
// crates/tastile-core/src/command/payloads.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::TileId;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTilePayload {
    pub tile_id: TileId,
    pub title: String,
    pub next_action: Option<String>,
    pub done_definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTilePayload {
    pub tile_id: TileId,
    pub started_at: Option<DateTime<Utc>>,
    pub source: StartSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartSource {
    Prompt,
    Cli,
    Agent,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeferTilePayload {
    pub tile_id: TileId,
    pub reason: Option<String>,
    pub defer_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteAndStartNextPayload {
    pub tile_id: TileId,
    pub completed_at: Option<DateTime<Utc>>,
    pub next_tile_id: Option<TileId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendPhasePayload {
    pub tile_id: TileId,
    pub delta_min: u32,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchActiveTilePayload {
    pub from_tile_id: TileId,
    pub to_tile_id: TileId,
    pub reason: String,
    pub interrupt_source: InterruptSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterruptSource {
    FixedSchedule,
    UserSwitch,
    HighPriority,
    SystemForce,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachMemoPayload {
    pub tile_id: Option<TileId>,
    pub text: String,
    pub memo_kind: Option<MemoKind>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoKind {
    ResumeNote,
    Scratch,
    Log,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartBreakPayload {
    pub linked_tile_id: Option<TileId>,
    pub break_min: u32,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndBreakPayload {
    pub ended_at: Option<DateTime<Utc>>,
}
```

```rust
// crates/tastile-core/src/command/mod.rs
pub mod envelope;
pub mod payloads;

pub use envelope::*;
pub use payloads::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    CreateTile(CreateTilePayload),
    StartTile(StartTilePayload),
    DeferTile(DeferTilePayload),
    CompleteAndStartNext(CompleteAndStartNextPayload),
    ExtendPhase(ExtendPhasePayload),
    SwitchActiveTile(SwitchActiveTilePayload),
    AttachMemo(AttachMemoPayload),
    StartBreak(StartBreakPayload),
    EndBreak(EndBreakPayload),
}
```

```rust
// crates/tastile-core/src/lib.rs
pub mod command;
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add Command types and envelope"
```

---

## Task 8: Event Types

**Files:**
- Create: `crates/tastile-core/src/event/mod.rs`
- Create: `crates/tastile-core/src/event/envelope.rs`
- Create: `crates/tastile-core/src/event/payloads.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/event_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/event_test.rs
use tastile_core::event::*;
use tastile_domain::*;

#[test]
fn event_envelope_has_caused_by() {
    let evt = EventEnvelope {
        event_id: EventId::new(),
        aggregate_id: "tile:123".to_string(),
        occurred_at: chrono::Utc::now(),
        actor: Actor::system(),
        caused_by_command_id: Some(CommandId::new()),
        request_id: None,
        event: Event::TileCreated(TileCreatedPayload {
            tile: tastile_domain::tile::Tile::new(TileId::new(), "Test".to_string()),
        }),
    };
    assert!(evt.caused_by_command_id.is_some());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/event/envelope.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::{Actor, EventId, CommandId, RequestId};
use super::Event;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub event_id: EventId,
    pub aggregate_id: String,
    pub occurred_at: DateTime<Utc>,
    pub actor: Actor,
    pub caused_by_command_id: Option<CommandId>,
    pub request_id: Option<RequestId>,
    pub event: Event,
}
```

```rust
// crates/tastile-core/src/event/payloads.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tastile_domain::TileId;
use tastile_domain::tile::Tile;
use crate::command::{StartSource, InterruptSource, MemoKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileCreatedPayload { pub tile: Tile }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileStartedPayload {
    pub tile_id: TileId,
    pub started_at: DateTime<Utc>,
    pub source: StartSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileDeferredPayload {
    pub tile_id: TileId,
    pub deferred_at: DateTime<Utc>,
    pub reason: Option<String>,
    pub defer_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileCompletedPayload {
    pub tile_id: TileId,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileClosedPayload {
    pub tile_id: TileId,
    pub reason: Option<String>,
    pub closed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTileSwitchedPayload {
    pub from_tile_id: TileId,
    pub to_tile_id: TileId,
    pub switched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseExtendedPayload {
    pub tile_id: TileId,
    pub delta_min: u32,
    pub extended_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentStartedPayload {
    pub tile_id: TileId,
    pub mode: tastile_domain::tile::SegmentMode,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentEndedPayload {
    pub tile_id: TileId,
    pub mode: tastile_domain::tile::SegmentMode,
    pub ended_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakStartedPayload {
    pub linked_tile_id: Option<TileId>,
    pub started_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakEndedPayload {
    pub ended_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileInterruptedPayload {
    pub tile_id: TileId,
    pub interrupted_at: DateTime<Utc>,
    pub source: InterruptSource,
    pub reason: Option<String>,
    pub switched_to_tile_id: Option<TileId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoAttachedPayload {
    pub tile_id: Option<TileId>,
    pub text: String,
    pub memo_kind: Option<MemoKind>,
    pub attached_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptScheduledPayload {
    pub prompt_id: tastile_domain::PromptId,
    pub prompt_type: PromptType,
    pub tile_id: Option<TileId>,
    pub scheduled_at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptType {
    Start,
    End,
    AutoStart,
    AutoEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptClearedPayload {
    pub prompt_id: tastile_domain::PromptId,
    pub cleared_at: DateTime<Utc>,
    pub reason: String,
}
```

```rust
// crates/tastile-core/src/event/mod.rs
pub mod envelope;
pub mod payloads;

pub use envelope::*;
pub use payloads::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    TileCreated(TileCreatedPayload),
    TileStarted(TileStartedPayload),
    TileDeferred(TileDeferredPayload),
    TileCompleted(TileCompletedPayload),
    TileClosed(TileClosedPayload),
    ActiveTileSwitched(ActiveTileSwitchedPayload),
    PhaseExtended(PhaseExtendedPayload),
    SegmentStarted(SegmentStartedPayload),
    SegmentEnded(SegmentEndedPayload),
    BreakStarted(BreakStartedPayload),
    BreakEnded(BreakEndedPayload),
    TileInterrupted(TileInterruptedPayload),
    MemoAttached(MemoAttachedPayload),
    PromptScheduled(PromptScheduledPayload),
    PromptCleared(PromptClearedPayload),
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add Event types and envelope"
```

---

## Task 9: In-Memory State Store

**Files:**
- Create: `crates/tastile-core/src/store/mod.rs`
- Create: `crates/tastile-core/src/store/state.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/store_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/store_test.rs
use tastile_core::store::AppState;
use tastile_domain::TileId;
use tastile_domain::tile::Tile;

#[test]
fn state_starts_empty() {
    let state = AppState::new();
    assert!(state.tiles.is_empty());
    assert!(state.execution.active_tile_id.is_none());
    assert!(state.events.is_empty());
}

#[test]
fn can_insert_and_find_tile() {
    let mut state = AppState::new();
    let id = TileId::new();
    let tile = Tile::new(id, "Test".to_string());
    state.tiles.insert(id, tile);
    assert!(state.tiles.contains_key(&id));
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/store/state.rs
use std::collections::HashMap;
use tastile_domain::TileId;
use tastile_domain::tile::Tile;
use tastile_domain::execution::Execution;
use crate::event::EventEnvelope;

#[derive(Debug, Clone, Default)]
pub struct AppState {
    pub tiles: HashMap<TileId, Tile>,
    pub execution: Execution,
    pub events: Vec<EventEnvelope>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_tile(&self, id: &TileId) -> Option<&Tile> {
        self.tiles.get(id)
    }

    pub fn get_tile_mut(&mut self, id: &TileId) -> Option<&mut Tile> {
        self.tiles.get_mut(id)
    }
}
```

```rust
// crates/tastile-core/src/store/mod.rs
pub mod state;
pub use state::*;
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add in-memory AppState"
```

---

## Task 10: Validation Layer

**Files:**
- Create: `crates/tastile-core/src/validate/mod.rs`
- Create: `crates/tastile-core/src/validate/error.rs`
- Create: `crates/tastile-core/src/validate/rules.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/validate_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/validate_test.rs
use tastile_core::command::*;
use tastile_core::validate::*;
use tastile_core::store::AppState;
use tastile_domain::*;
use tastile_domain::tile::Tile;
use tastile_domain::execution::PhaseKind;

#[test]
fn cannot_start_nonexistent_tile() {
    let state = AppState::new();
    let cmd = Command::StartTile(StartTilePayload {
        tile_id: TileId::new(),
        started_at: None,
        source: StartSource::Cli,
    });
    let result = validate(&cmd, &state);
    assert!(result.is_err());
}

#[test]
fn cannot_start_completed_tile() {
    let mut state = AppState::new();
    let id = TileId::new();
    let mut tile = Tile::new(id, "Done".to_string());
    tile.core.started_at = Some(chrono::Utc::now());
    tile.core.completed_at = Some(chrono::Utc::now());
    state.tiles.insert(id, tile);
    let cmd = Command::StartTile(StartTilePayload {
        tile_id: id,
        started_at: None,
        source: StartSource::Cli,
    });
    let result = validate(&cmd, &state);
    assert!(result.is_err());
}

#[test]
fn cannot_start_while_another_active() {
    let mut state = AppState::new();
    let id1 = TileId::new();
    let id2 = TileId::new();
    state.tiles.insert(id1, Tile::new(id1, "A".to_string()));
    state.tiles.insert(id2, Tile::new(id2, "B".to_string()));
    state.execution.active_tile_id = Some(id1);
    state.execution.phase_kind = PhaseKind::Work;
    let cmd = Command::StartTile(StartTilePayload {
        tile_id: id2,
        started_at: None,
        source: StartSource::Cli,
    });
    let result = validate(&cmd, &state);
    assert!(result.is_err());
}

#[test]
fn can_start_valid_tile() {
    let mut state = AppState::new();
    let id = TileId::new();
    state.tiles.insert(id, Tile::new(id, "OK".to_string()));
    let cmd = Command::StartTile(StartTilePayload {
        tile_id: id,
        started_at: None,
        source: StartSource::Cli,
    });
    let result = validate(&cmd, &state);
    assert!(result.is_ok());
}

#[test]
fn create_tile_always_valid() {
    let state = AppState::new();
    let cmd = Command::CreateTile(CreateTilePayload {
        tile_id: TileId::new(),
        title: "New".to_string(),
        next_action: None,
        done_definition: None,
    });
    let result = validate(&cmd, &state);
    assert!(result.is_ok());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/validate/error.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("tile not found: {0}")]
    TileNotFound(String),
    #[error("tile already completed")]
    TileAlreadyCompleted,
    #[error("another tile is already active")]
    AnotherTileActive,
    #[error("no active tile")]
    NoActiveTile,
    #[error("tile is not active")]
    TileNotActive,
    #[error("not in break phase")]
    NotInBreak,
    #[error("invalid extend: delta must be > 0")]
    InvalidExtendDelta,
}
```

```rust
// crates/tastile-core/src/validate/rules.rs
use crate::command::*;
use crate::store::AppState;
use super::error::ValidationError;
use tastile_domain::tile::Lifecycle;
use tastile_domain::execution::PhaseKind;

pub fn validate(command: &Command, state: &AppState) -> Result<(), ValidationError> {
    match command {
        Command::CreateTile(_) => Ok(()),

        Command::StartTile(p) => {
            let tile = state.get_tile(&p.tile_id)
                .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
            if tile.core.lifecycle() == Lifecycle::Done {
                return Err(ValidationError::TileAlreadyCompleted);
            }
            if state.execution.active_tile_id.is_some() {
                return Err(ValidationError::AnotherTileActive);
            }
            Ok(())
        }

        Command::DeferTile(p) => {
            state.get_tile(&p.tile_id)
                .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
            Ok(())
        }

        Command::CompleteAndStartNext(p) => {
            let tile = state.get_tile(&p.tile_id)
                .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
            if tile.core.lifecycle() == Lifecycle::Done {
                return Err(ValidationError::TileAlreadyCompleted);
            }
            if state.execution.active_tile_id != Some(p.tile_id) {
                return Err(ValidationError::TileNotActive);
            }
            if let Some(next_id) = p.next_tile_id {
                let next = state.get_tile(&next_id)
                    .ok_or_else(|| ValidationError::TileNotFound(next_id.to_string()))?;
                if next.core.lifecycle() == Lifecycle::Done {
                    return Err(ValidationError::TileAlreadyCompleted);
                }
            }
            Ok(())
        }

        Command::ExtendPhase(p) => {
            if p.delta_min == 0 {
                return Err(ValidationError::InvalidExtendDelta);
            }
            if state.execution.active_tile_id.is_none() {
                return Err(ValidationError::NoActiveTile);
            }
            Ok(())
        }

        Command::SwitchActiveTile(p) => {
            if state.execution.active_tile_id != Some(p.from_tile_id) {
                return Err(ValidationError::TileNotActive);
            }
            let to = state.get_tile(&p.to_tile_id)
                .ok_or_else(|| ValidationError::TileNotFound(p.to_tile_id.to_string()))?;
            if to.core.lifecycle() == Lifecycle::Done {
                return Err(ValidationError::TileAlreadyCompleted);
            }
            Ok(())
        }

        Command::AttachMemo(_) => Ok(()),

        Command::StartBreak(_) => {
            if state.execution.phase_kind == PhaseKind::Break {
                return Err(ValidationError::NotInBreak);
            }
            Ok(())
        }

        Command::EndBreak(_) => {
            if state.execution.phase_kind != PhaseKind::Break {
                return Err(ValidationError::NotInBreak);
            }
            Ok(())
        }
    }
}
```

```rust
// crates/tastile-core/src/validate/mod.rs
pub mod error;
pub mod rules;
pub use error::*;
pub use rules::*;
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add validation layer"
```

---

## Task 11: Reducer

**Files:**
- Create: `crates/tastile-core/src/reducer/mod.rs`
- Create: `crates/tastile-core/src/reducer/tile_reducer.rs`
- Create: `crates/tastile-core/src/reducer/execution_reducer.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/reducer_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/reducer_test.rs
use tastile_core::event::*;
use tastile_core::reducer::*;
use tastile_core::store::AppState;
use tastile_domain::*;
use tastile_domain::tile::*;
use tastile_domain::execution::PhaseKind;
use tastile_core::command::StartSource;

#[test]
fn tile_created_adds_to_state() {
    let mut state = AppState::new();
    let id = TileId::new();
    let tile = Tile::new(id, "Test".to_string());
    let event = Event::TileCreated(TileCreatedPayload { tile: tile.clone() });
    reduce(&mut state, &event);
    assert!(state.tiles.contains_key(&id));
    assert_eq!(state.tiles[&id].core.title, "Test");
}

#[test]
fn tile_started_sets_active_and_phase() {
    let mut state = AppState::new();
    let id = TileId::new();
    state.tiles.insert(id, Tile::new(id, "T".to_string()));
    let now = chrono::Utc::now();
    let event = Event::TileStarted(TileStartedPayload {
        tile_id: id,
        started_at: now,
        source: StartSource::Cli,
    });
    reduce(&mut state, &event);
    assert_eq!(state.execution.active_tile_id, Some(id));
    assert_eq!(state.execution.phase_kind, PhaseKind::Work);
    assert_eq!(state.tiles[&id].core.started_at, Some(now));
}

#[test]
fn tile_completed_clears_active() {
    let mut state = AppState::new();
    let id = TileId::new();
    let now = chrono::Utc::now();
    let mut tile = Tile::new(id, "T".to_string());
    tile.core.started_at = Some(now);
    state.tiles.insert(id, tile);
    state.execution.active_tile_id = Some(id);
    state.execution.phase_kind = PhaseKind::Work;

    let event = Event::TileCompleted(TileCompletedPayload {
        tile_id: id,
        completed_at: now,
    });
    reduce(&mut state, &event);
    assert!(state.execution.active_tile_id.is_none());
    assert_eq!(state.execution.phase_kind, PhaseKind::Idle);
    assert!(state.tiles[&id].core.completed_at.is_some());
}

#[test]
fn break_started_sets_break_phase() {
    let mut state = AppState::new();
    let now = chrono::Utc::now();
    let ends = now + chrono::Duration::minutes(5);
    let event = Event::BreakStarted(BreakStartedPayload {
        linked_tile_id: None,
        started_at: now,
        ends_at: ends,
        reason: None,
    });
    reduce(&mut state, &event);
    assert_eq!(state.execution.phase_kind, PhaseKind::Break);
    assert_eq!(state.execution.phase_ends_at, Some(ends));
}

#[test]
fn break_ended_returns_to_idle() {
    let mut state = AppState::new();
    state.execution.phase_kind = PhaseKind::Break;
    let event = Event::BreakEnded(BreakEndedPayload {
        ended_at: chrono::Utc::now(),
    });
    reduce(&mut state, &event);
    assert_eq!(state.execution.phase_kind, PhaseKind::Idle);
    assert!(state.execution.phase_ends_at.is_none());
}

#[test]
fn replay_produces_same_state() {
    let id = TileId::new();
    let now = chrono::Utc::now();
    let events = vec![
        Event::TileCreated(TileCreatedPayload {
            tile: Tile::new(id, "Replay".to_string()),
        }),
        Event::TileStarted(TileStartedPayload {
            tile_id: id,
            started_at: now,
            source: StartSource::Cli,
        }),
        Event::TileCompleted(TileCompletedPayload {
            tile_id: id,
            completed_at: now + chrono::Duration::minutes(25),
        }),
    ];

    let mut state1 = AppState::new();
    for e in &events {
        reduce(&mut state1, e);
    }

    let mut state2 = AppState::new();
    for e in &events {
        reduce(&mut state2, e);
    }

    assert_eq!(state1.tiles[&id].core.completed_at, state2.tiles[&id].core.completed_at);
    assert_eq!(state1.execution.active_tile_id, state2.execution.active_tile_id);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/reducer/tile_reducer.rs
use crate::event::*;
use tastile_domain::tile::Tile;

pub fn reduce_tile_created(tile: &Tile) -> Tile {
    tile.clone()
}

pub fn apply_tile_started(tile: &mut Tile, payload: &TileStartedPayload) {
    if tile.core.started_at.is_none() {
        tile.core.started_at = Some(payload.started_at);
    }
}

pub fn apply_tile_completed(tile: &mut Tile, payload: &TileCompletedPayload) {
    tile.core.completed_at = Some(payload.completed_at);
}

pub fn apply_tile_deferred(_tile: &mut Tile, _payload: &TileDeferredPayload) {
    // Defer does not change tile core state.
    // Defer tracking handled in projection layer.
}

pub fn apply_tile_closed(tile: &mut Tile, payload: &TileClosedPayload) {
    tile.work.closed_at = Some(payload.closed_at);
}

pub fn apply_memo_attached(tile: &mut Tile, payload: &MemoAttachedPayload) {
    match payload.memo_kind {
        Some(crate::command::MemoKind::ResumeNote) => {
            tile.work.resume_note = Some(payload.text.clone());
        }
        _ => {
            tile.work.scratch_notes.push(payload.text.clone());
        }
    }
}
```

```rust
// crates/tastile-core/src/reducer/execution_reducer.rs
use crate::event::*;
use tastile_domain::execution::{Execution, PhaseKind};

pub fn apply_tile_started(exec: &mut Execution, payload: &TileStartedPayload) {
    exec.active_tile_id = Some(payload.tile_id);
    exec.phase_kind = PhaseKind::Work;
    exec.phase_started_at = Some(payload.started_at);
}

pub fn apply_tile_completed(exec: &mut Execution, payload: &TileCompletedPayload) {
    if exec.active_tile_id == Some(payload.tile_id) {
        exec.active_tile_id = None;
        exec.phase_kind = PhaseKind::Idle;
        exec.phase_started_at = None;
        exec.phase_ends_at = None;
    }
}

pub fn apply_active_tile_switched(exec: &mut Execution, payload: &ActiveTileSwitchedPayload) {
    exec.active_tile_id = Some(payload.to_tile_id);
    exec.phase_kind = PhaseKind::Work;
    exec.phase_started_at = Some(payload.switched_at);
}

pub fn apply_break_started(exec: &mut Execution, payload: &BreakStartedPayload) {
    exec.active_tile_id = None;
    exec.phase_kind = PhaseKind::Break;
    exec.phase_started_at = Some(payload.started_at);
    exec.phase_ends_at = Some(payload.ends_at);
}

pub fn apply_break_ended(exec: &mut Execution, _payload: &BreakEndedPayload) {
    exec.phase_kind = PhaseKind::Idle;
    exec.phase_started_at = None;
    exec.phase_ends_at = None;
}

pub fn apply_phase_extended(exec: &mut Execution, payload: &PhaseExtendedPayload) {
    if let Some(ref mut ends_at) = exec.phase_ends_at {
        *ends_at = *ends_at + chrono::Duration::minutes(payload.delta_min as i64);
    }
}

pub fn apply_prompt_scheduled(exec: &mut Execution, payload: &PromptScheduledPayload) {
    exec.pending_prompt_id = Some(payload.prompt_id);
}

pub fn apply_prompt_cleared(exec: &mut Execution, _payload: &PromptClearedPayload) {
    exec.pending_prompt_id = None;
}
```

```rust
// crates/tastile-core/src/reducer/mod.rs
pub mod tile_reducer;
pub mod execution_reducer;

use crate::event::Event;
use crate::store::AppState;

pub fn reduce(state: &mut AppState, event: &Event) {
    match event {
        Event::TileCreated(p) => {
            let tile = tile_reducer::reduce_tile_created(&p.tile);
            state.tiles.insert(tile.core.id, tile);
        }
        Event::TileStarted(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile_reducer::apply_tile_started(tile, p);
            }
            execution_reducer::apply_tile_started(&mut state.execution, p);
        }
        Event::TileDeferred(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile_reducer::apply_tile_deferred(tile, p);
            }
        }
        Event::TileCompleted(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile_reducer::apply_tile_completed(tile, p);
            }
            execution_reducer::apply_tile_completed(&mut state.execution, p);
        }
        Event::TileClosed(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile_reducer::apply_tile_closed(tile, p);
            }
        }
        Event::ActiveTileSwitched(p) => {
            execution_reducer::apply_active_tile_switched(&mut state.execution, p);
        }
        Event::PhaseExtended(p) => {
            execution_reducer::apply_phase_extended(&mut state.execution, p);
        }
        Event::SegmentStarted(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile.work.segments.push(tastile_domain::tile::Segment {
                    id: tastile_domain::SegmentId::new(),
                    start_at: p.started_at,
                    end_at: None,
                    mode: p.mode,
                    source_tile_id: p.tile_id,
                });
            }
        }
        Event::SegmentEnded(p) => {
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                if let Some(seg) = tile.work.segments.iter_mut().rev().find(|s| s.end_at.is_none() && s.mode == p.mode) {
                    seg.end_at = Some(p.ended_at);
                }
            }
        }
        Event::BreakStarted(p) => {
            execution_reducer::apply_break_started(&mut state.execution, p);
        }
        Event::BreakEnded(p) => {
            execution_reducer::apply_break_ended(&mut state.execution, p);
        }
        Event::TileInterrupted(_) => {
            // Interrupt tracking — execution state changes handled by ActiveTileSwitched
        }
        Event::MemoAttached(p) => {
            if let Some(tile_id) = p.tile_id {
                if let Some(tile) = state.tiles.get_mut(&tile_id) {
                    tile_reducer::apply_memo_attached(tile, p);
                }
            }
        }
        Event::PromptScheduled(p) => {
            execution_reducer::apply_prompt_scheduled(&mut state.execution, p);
        }
        Event::PromptCleared(p) => {
            execution_reducer::apply_prompt_cleared(&mut state.execution, p);
        }
    }
}
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add Reducer (tile + execution)"
```

---

## Task 12: Command Handler (orchestrates validate -> events -> reduce)

**Files:**
- Create: `crates/tastile-core/src/handler/mod.rs`
- Create: `crates/tastile-core/src/handler/command_handler.rs`
- Modify: `crates/tastile-core/src/lib.rs`
- Test: `crates/tastile-core/tests/handler_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-core/tests/handler_test.rs
use tastile_core::command::*;
use tastile_core::handler::CommandHandler;
use tastile_core::store::AppState;
use tastile_domain::*;
use tastile_domain::execution::PhaseKind;

fn make_handler() -> CommandHandler {
    CommandHandler::new()
}

fn system_actor() -> Actor {
    Actor::system()
}

#[test]
fn create_then_start_then_complete() {
    let mut state = AppState::new();
    let handler = make_handler();
    let id = TileId::new();
    let now = chrono::Utc::now();

    // Create
    let result = handler.handle(
        CommandEnvelope {
            command_id: CommandId::new(),
            actor: system_actor(),
            issued_at: now,
            request_id: None,
            command: Command::CreateTile(CreateTilePayload {
                tile_id: id,
                title: "Full flow".to_string(),
                next_action: Some("Start coding".to_string()),
                done_definition: Some("Tests pass".to_string()),
            }),
        },
        &mut state,
    );
    assert!(result.is_ok());
    assert!(state.tiles.contains_key(&id));

    // Start
    let result = handler.handle(
        CommandEnvelope {
            command_id: CommandId::new(),
            actor: system_actor(),
            issued_at: now,
            request_id: None,
            command: Command::StartTile(StartTilePayload {
                tile_id: id,
                started_at: Some(now),
                source: StartSource::Cli,
            }),
        },
        &mut state,
    );
    assert!(result.is_ok());
    assert_eq!(state.execution.active_tile_id, Some(id));
    assert_eq!(state.execution.phase_kind, PhaseKind::Work);

    // Complete
    let complete_time = now + chrono::Duration::minutes(25);
    let result = handler.handle(
        CommandEnvelope {
            command_id: CommandId::new(),
            actor: system_actor(),
            issued_at: complete_time,
            request_id: None,
            command: Command::CompleteAndStartNext(CompleteAndStartNextPayload {
                tile_id: id,
                completed_at: Some(complete_time),
                next_tile_id: None,
            }),
        },
        &mut state,
    );
    assert!(result.is_ok());
    assert!(state.execution.active_tile_id.is_none());
    assert!(state.tiles[&id].core.completed_at.is_some());
}

#[test]
fn double_active_is_prevented() {
    let mut state = AppState::new();
    let handler = make_handler();
    let id1 = TileId::new();
    let id2 = TileId::new();
    let now = chrono::Utc::now();

    // Create two tiles
    for (id, name) in [(id1, "A"), (id2, "B")] {
        handler.handle(
            CommandEnvelope {
                command_id: CommandId::new(),
                actor: system_actor(),
                issued_at: now,
                request_id: None,
                command: Command::CreateTile(CreateTilePayload {
                    tile_id: id,
                    title: name.to_string(),
                    next_action: None,
                    done_definition: None,
                }),
            },
            &mut state,
        ).unwrap();
    }

    // Start first
    handler.handle(
        CommandEnvelope {
            command_id: CommandId::new(),
            actor: system_actor(),
            issued_at: now,
            request_id: None,
            command: Command::StartTile(StartTilePayload {
                tile_id: id1,
                started_at: None,
                source: StartSource::Cli,
            }),
        },
        &mut state,
    ).unwrap();

    // Try start second — should fail
    let result = handler.handle(
        CommandEnvelope {
            command_id: CommandId::new(),
            actor: system_actor(),
            issued_at: now,
            request_id: None,
            command: Command::StartTile(StartTilePayload {
                tile_id: id2,
                started_at: None,
                source: StartSource::Cli,
            }),
        },
        &mut state,
    );
    assert!(result.is_err());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-core/src/handler/command_handler.rs
use crate::command::*;
use crate::event::*;
use crate::validate::{validate, ValidationError};
use crate::reducer::reduce;
use crate::store::AppState;
use tastile_domain::*;
use tastile_domain::tile::Tile;

pub struct CommandHandler;

impl CommandHandler {
    pub fn new() -> Self {
        Self
    }

    pub fn handle(
        &self,
        envelope: CommandEnvelope,
        state: &mut AppState,
    ) -> Result<Vec<EventEnvelope>, ValidationError> {
        // 1. Validate
        validate(&envelope.command, state)?;

        // 2. Generate events
        let events = self.generate_events(&envelope, state);

        // 3. Apply events
        for evt in &events {
            reduce(state, &evt.event);
            state.events.push(evt.clone());
        }

        Ok(events)
    }

    fn generate_events(
        &self,
        envelope: &CommandEnvelope,
        state: &AppState,
    ) -> Vec<EventEnvelope> {
        let mut events = Vec::new();
        let now = envelope.issued_at;

        match &envelope.command {
            Command::CreateTile(p) => {
                let mut tile = Tile::new(p.tile_id, p.title.clone());
                tile.core.next_action = p.next_action.clone();
                tile.core.done_definition = p.done_definition.clone();
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::TileCreated(TileCreatedPayload { tile }),
                ));
            }

            Command::StartTile(p) => {
                let started_at = p.started_at.unwrap_or(now);
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::TileStarted(TileStartedPayload {
                        tile_id: p.tile_id,
                        started_at,
                        source: p.source,
                    }),
                ));
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::SegmentStarted(SegmentStartedPayload {
                        tile_id: p.tile_id,
                        mode: tastile_domain::tile::SegmentMode::Work,
                        started_at,
                    }),
                ));
            }

            Command::DeferTile(p) => {
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::TileDeferred(TileDeferredPayload {
                        tile_id: p.tile_id,
                        deferred_at: now,
                        reason: p.reason.clone(),
                        defer_until: p.defer_until,
                    }),
                ));
            }

            Command::CompleteAndStartNext(p) => {
                let completed_at = p.completed_at.unwrap_or(now);
                // Close work segment
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::SegmentEnded(SegmentEndedPayload {
                        tile_id: p.tile_id,
                        mode: tastile_domain::tile::SegmentMode::Work,
                        ended_at: completed_at,
                    }),
                ));
                // Complete tile
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.tile_id),
                    Event::TileCompleted(TileCompletedPayload {
                        tile_id: p.tile_id,
                        completed_at,
                    }),
                ));
                // Start next if specified
                if let Some(next_id) = p.next_tile_id {
                    events.push(self.wrap(
                        &envelope,
                        format!("tile:{}", next_id),
                        Event::TileStarted(TileStartedPayload {
                            tile_id: next_id,
                            started_at: completed_at,
                            source: StartSource::Auto,
                        }),
                    ));
                    events.push(self.wrap(
                        &envelope,
                        format!("tile:{}", next_id),
                        Event::SegmentStarted(SegmentStartedPayload {
                            tile_id: next_id,
                            mode: tastile_domain::tile::SegmentMode::Work,
                            started_at: completed_at,
                        }),
                    ));
                }
            }

            Command::ExtendPhase(p) => {
                events.push(self.wrap(
                    &envelope,
                    "execution:singleton".to_string(),
                    Event::PhaseExtended(PhaseExtendedPayload {
                        tile_id: p.tile_id,
                        delta_min: p.delta_min,
                        extended_at: now,
                    }),
                ));
            }

            Command::SwitchActiveTile(p) => {
                // End current segment
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.from_tile_id),
                    Event::SegmentEnded(SegmentEndedPayload {
                        tile_id: p.from_tile_id,
                        mode: tastile_domain::tile::SegmentMode::Work,
                        ended_at: now,
                    }),
                ));
                // Record interrupt
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.from_tile_id),
                    Event::TileInterrupted(TileInterruptedPayload {
                        tile_id: p.from_tile_id,
                        interrupted_at: now,
                        source: p.interrupt_source,
                        reason: Some(p.reason.clone()),
                        switched_to_tile_id: Some(p.to_tile_id),
                    }),
                ));
                // Switch active
                events.push(self.wrap(
                    &envelope,
                    "execution:singleton".to_string(),
                    Event::ActiveTileSwitched(ActiveTileSwitchedPayload {
                        from_tile_id: p.from_tile_id,
                        to_tile_id: p.to_tile_id,
                        switched_at: now,
                    }),
                ));
                // Start segment on new tile
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.to_tile_id),
                    Event::TileStarted(TileStartedPayload {
                        tile_id: p.to_tile_id,
                        started_at: now,
                        source: StartSource::Auto,
                    }),
                ));
                events.push(self.wrap(
                    &envelope,
                    format!("tile:{}", p.to_tile_id),
                    Event::SegmentStarted(SegmentStartedPayload {
                        tile_id: p.to_tile_id,
                        mode: tastile_domain::tile::SegmentMode::Work,
                        started_at: now,
                    }),
                ));
            }

            Command::AttachMemo(p) => {
                events.push(self.wrap(
                    &envelope,
                    p.tile_id.map_or("memo:global".to_string(), |id| format!("tile:{}", id)),
                    Event::MemoAttached(MemoAttachedPayload {
                        tile_id: p.tile_id,
                        text: p.text.clone(),
                        memo_kind: p.memo_kind,
                        attached_at: now,
                    }),
                ));
            }

            Command::StartBreak(p) => {
                let ends_at = now + chrono::Duration::minutes(p.break_min as i64);
                events.push(self.wrap(
                    &envelope,
                    "execution:singleton".to_string(),
                    Event::BreakStarted(BreakStartedPayload {
                        linked_tile_id: p.linked_tile_id,
                        started_at: now,
                        ends_at,
                        reason: p.reason.clone(),
                    }),
                ));
            }

            Command::EndBreak(p) => {
                let ended_at = p.ended_at.unwrap_or(now);
                events.push(self.wrap(
                    &envelope,
                    "execution:singleton".to_string(),
                    Event::BreakEnded(BreakEndedPayload { ended_at }),
                ));
            }
        }

        events
    }

    fn wrap(&self, envelope: &CommandEnvelope, aggregate_id: String, event: Event) -> EventEnvelope {
        EventEnvelope {
            event_id: EventId::new(),
            aggregate_id,
            occurred_at: envelope.issued_at,
            actor: envelope.actor.clone(),
            caused_by_command_id: Some(envelope.command_id),
            request_id: envelope.request_id,
            event,
        }
    }
}
```

```rust
// crates/tastile-core/src/handler/mod.rs
pub mod command_handler;
pub use command_handler::*;
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-core/
git commit -m "feat(core): add CommandHandler (validate -> events -> reduce)"
```

---

## Summary

| Task | What | Crate |
|------|------|-------|
| 1 | Newtype IDs + Clock trait | tastile-domain |
| 2 | Actor model | tastile-domain |
| 3 | TileCore + Lifecycle | tastile-domain |
| 4 | Condition vectors (5 layers) | tastile-domain |
| 5 | WorkFacts + Segment | tastile-domain |
| 6 | Tile aggregate + Execution state | tastile-domain |
| 7 | Command types + envelope | tastile-core |
| 8 | Event types + envelope | tastile-core |
| 9 | In-memory AppState | tastile-core |
| 10 | Validation layer | tastile-core |
| 11 | Reducer (tile + execution) | tastile-core |
| 12 | CommandHandler (full pipeline) | tastile-core |

**Phase B exit criteria met when:**
- All 12 tasks pass tests
- create -> start -> extend -> complete -> replay works
- No double-active invariant holds
- Segments track correctly
- Break flow works
- Event replay yields identical state
