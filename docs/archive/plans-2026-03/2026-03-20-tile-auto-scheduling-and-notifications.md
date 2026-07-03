# Tile Auto Scheduling And Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a deterministic pomodoroom-level tile auto-scheduling loop in `tastile-core`, expose it through the daemon API, and drive desktop prompt notifications from core-owned scheduling state instead of desktop-local heuristics.

**Architecture:** Keep scheduling and prompt generation pure and time-injected inside `tastile-core`, using `tastile_domain::tile::Tile` plus `AppState` as the source of truth. `tastile-api` becomes a projection layer that asks the core scheduler/prompt engine for the current recommendation, while `tastile-desktop` only renders and escalates notifications from the prompt payload it receives.

**Tech Stack:** Rust (`tastile-core`, `tastile-api`, `tastile-domain`), Axum, xUnit (`dotnet test`), WinUI 3 desktop shell, existing prompt toast / intervention services.

---

## Scope And Assumptions

- This plan targets the current local daemon + desktop architecture, not calendar-backed day planning.
- “Pomodoroom-level” here means: ranked next-tile recommendation, progressive focus/break durations, deterministic prompt generation, and escalating desktop notifications.
- The first implementation uses fields already present in `tastile-domain`:
  - `temporal.release_at`, `temporal.due_at`, `temporal.fixed_start`, `temporal.fixed_end`
  - `objective.target_work_min`, `objective.done_rule`
  - `automation.prompt_on_start`, `automation.prompt_on_end`, `automation.auto_start_allowed`, `automation.auto_end_allowed`
  - `work.segments`, `work.resume_note`, `core.started_at`, `core.completed_at`
- The legacy internal `tastile-core/src/domain/mod.rs` scheduler types are not the authority for this feature. New scheduling logic must operate on `tastile_domain::tile::Tile` and `tastile_core::store::AppState`.
- Desktop-local elapsed-time heuristics in `InterventionEngine` are transitional and should be replaced by core prompt severity / prompt kind decisions.

## Target Behavior

1. When the app is idle, the daemon returns one deterministic “best next tile” plus 1-2 fallback candidates.
2. Candidate ranking prefers “resume current context” when valid, but overdue / fixed-start tiles can preempt it.
3. Deferred or unreleased tiles are excluded until their window opens.
4. Focus duration follows a progressive schedule inspired by pomodoroom:
   - focus: `15, 30, 45, 60, 75` minutes (cap at `75`)
   - breaks: `5, 5, 5, 5, 30` minutes repeating with the same cadence
5. When a work phase expires, the daemon emits a prompt that clearly asks to complete, extend, or defer.
6. When a break expires, the daemon emits a break-end prompt.
7. Desktop notifications are triggered from prompt payload changes, not from independent desktop timers.
8. Tests cover selection, focus/break duration, prompt transitions, API projections, and desktop notification policy.

## Scheduling Rules For V1

Use this scoring model for the first implementation. It is intentionally simple and testable:

```rust
score = 0
  + due_urgency_bonus
  + fixed_start_urgency_bonus
  + resume_bonus
  + next_action_bonus
  - defer_penalty
  - release_not_ready_penalty
```

- `ineligible` if:
  - tile is done/closed
  - `release_at > now`
  - `fixed_start > now` and there is no pre-window preview mode
  - `fixed_end < now`
  - tile is explicitly deferred until a future `next_start_at`
- `resume_bonus`: tile has `started_at` and is not done
- `due_urgency_bonus`: higher as `due_at` approaches or passes
- `fixed_start_urgency_bonus`: higher as `fixed_start` approaches or passes
- `next_action_bonus`: tile has `next_action`
- `defer_penalty`: tile was deferred in the past but is now eligible again; it can return, but not dominate without another urgency signal

The engine should also emit machine-readable reasons:

```rust
pub enum CandidateReason {
    ResumeInFlight,
    DueSoon,
    DueOverdue,
    FixedStartSoon,
    FixedStartNow,
    NewlyReleased,
    HasConcreteNextAction,
    DeferredWindowExpired,
}
```

## Prompt Rules For V1

```rust
pub enum PromptKind {
    StartTile,
    EndTile,
    EndBreak,
}

pub enum PromptSeverity {
    Soft,
    Elevated,
    Critical,
}
```

- `StartTile`
  - emitted when idle and an eligible candidate exists
  - `Soft` by default
  - `Elevated` if tile is overdue or fixed-start is active
- `EndTile`
  - emitted when `phase_kind == Work` and `phase_ends_at <= now`
  - includes actions: `Complete`, `Extend`, `Defer`
  - `Critical` if tile is in a fixed or overdue window
- `EndBreak`
  - emitted when `phase_kind == Break` and `phase_ends_at <= now`
  - includes action: `End Break`
  - `Elevated` by default

Desktop behavior should map these severities as:

- `Soft`: stacked prompt toast only
- `Elevated`: prompt toast + optional overlay
- `Critical`: prompt toast + overlay + intervention window

### Task 1: Lock The Scheduler Contract In Core Tests

**Files:**
- Create: `tastile-core/crates/tastile-core/tests/auto_scheduler_selection_test.rs`
- Modify: `tastile-core/crates/tastile-core/src/scheduler/mod.rs`
- Create: `tastile-core/crates/tastile-core/src/scheduler/recommendation.rs`
- Create: `tastile-core/crates/tastile-core/src/scheduler/scoring.rs`
- Modify: `tastile-core/crates/tastile-core/src/lib.rs`

**Step 1: Write the failing test**

```rust
// tastile-core/crates/tastile-core/tests/auto_scheduler_selection_test.rs
use chrono::{Duration, Utc};
use tastile_core::scheduler::{recommend_next_tiles, CandidateReason};
use tastile_core::store::AppState;
use tastile_domain::{TileId, tile::Tile};

fn ready_tile(title: &str) -> Tile {
    Tile::new(TileId::new(), title.to_string())
}

#[test]
fn resume_candidate_beats_generic_ready_tile() {
    let mut state = AppState::new();
    let mut resume = ready_tile("Resume docs");
    resume.core.started_at = Some(Utc::now() - Duration::minutes(20));

    let plain = ready_tile("Inbox zero");
    state.tiles.insert(resume.core.id, resume.clone());
    state.tiles.insert(plain.core.id, plain);

    let result = recommend_next_tiles(&state, Utc::now(), 3);

    assert_eq!(result.primary.tile_id, resume.core.id);
    assert!(result.primary.reasons.contains(&CandidateReason::ResumeInFlight));
}

#[test]
fn unreleased_and_future_fixed_start_tiles_are_not_candidates() {
    let mut state = AppState::new();
    let mut unreleased = ready_tile("Later");
    unreleased.temporal.release_at = Some(Utc::now() + Duration::minutes(30));

    let mut fixed_later = ready_tile("Meeting prep");
    fixed_later.temporal.fixed_start = Some(Utc::now() + Duration::minutes(45));

    state.tiles.insert(unreleased.core.id, unreleased);
    state.tiles.insert(fixed_later.core.id, fixed_later);

    let result = recommend_next_tiles(&state, Utc::now(), 3);
    assert!(result.primary.is_none());
}

#[test]
fn overdue_due_tile_beats_resume_when_urgency_is_higher() {
    let mut state = AppState::new();
    let mut resume = ready_tile("Resume docs");
    resume.core.started_at = Some(Utc::now() - Duration::minutes(15));

    let mut urgent = ready_tile("Submit form");
    urgent.temporal.due_at = Some(Utc::now() - Duration::minutes(10));

    state.tiles.insert(resume.core.id, resume);
    state.tiles.insert(urgent.core.id, urgent.clone());

    let result = recommend_next_tiles(&state, Utc::now(), 3);
    assert_eq!(result.primary.tile_id, urgent.core.id);
    assert!(result.primary.reasons.contains(&CandidateReason::DueOverdue));
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-core auto_scheduler_selection_test -- --nocapture`

Expected: FAIL because `recommend_next_tiles` and `CandidateReason` do not exist.

**Step 3: Write minimal implementation**

```rust
// tastile-core/crates/tastile-core/src/scheduler/recommendation.rs
use chrono::{DateTime, Utc};
use tastile_domain::TileId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidateReason {
    ResumeInFlight,
    DueSoon,
    DueOverdue,
    FixedStartSoon,
    FixedStartNow,
    NewlyReleased,
    HasConcreteNextAction,
    DeferredWindowExpired,
}

#[derive(Debug, Clone)]
pub struct CandidateRecommendation {
    pub tile_id: TileId,
    pub score: i32,
    pub reasons: Vec<CandidateReason>,
    pub suggested_focus_minutes: u32,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default)]
pub struct RecommendationSet {
    pub primary: Option<CandidateRecommendation>,
    pub alternates: Vec<CandidateRecommendation>,
}
```

Implement `recommend_next_tiles(state, now, limit)` in `src/scheduler/mod.rs` using `tastile_domain::tile::Tile` and `AppState`, not the legacy `crate::domain::Tile`.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-core auto_scheduler_selection_test -- --nocapture`

Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-core/tests/auto_scheduler_selection_test.rs tastile-core/crates/tastile-core/src/scheduler
git commit -m "feat(core): add deterministic tile recommendation scoring"
```

### Task 2: Add Progressive Focus And Break Duration Policy

**Files:**
- Create: `tastile-core/crates/tastile-core/tests/focus_schedule_policy_test.rs`
- Create: `tastile-core/crates/tastile-core/src/scheduler/focus_policy.rs`
- Modify: `tastile-core/crates/tastile-core/src/scheduler/mod.rs`

**Step 1: Write the failing test**

```rust
// tastile-core/crates/tastile-core/tests/focus_schedule_policy_test.rs
use chrono::{Duration, Utc};
use tastile_core::scheduler::{next_focus_minutes, next_break_minutes};
use tastile_core::store::AppState;
use tastile_domain::{TileId, tile::{Tile, Segment, SegmentId, SegmentMode}};

fn worked_segments(count: usize) -> AppState {
    let mut state = AppState::new();
    let mut tile = Tile::new(TileId::new(), "Focus".into());
    for index in 0..count {
        let start = Utc::now() - Duration::minutes(((index + 1) * 20) as i64);
        tile.work.segments.push(Segment {
            id: SegmentId::new(),
            start_at: start,
            end_at: Some(start + Duration::minutes(15)),
            mode: SegmentMode::Work,
            source_tile_id: tile.core.id,
        });
    }
    state.tiles.insert(tile.core.id, tile);
    state
}

#[test]
fn first_focus_window_is_fifteen_minutes() {
    let state = worked_segments(0);
    assert_eq!(next_focus_minutes(&state, Utc::now()), 15);
}

#[test]
fn second_focus_window_is_thirty_minutes() {
    let state = worked_segments(1);
    assert_eq!(next_focus_minutes(&state, Utc::now()), 30);
}

#[test]
fn fifth_break_is_long_break() {
    let state = worked_segments(4);
    assert_eq!(next_break_minutes(&state, Utc::now()), 30);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-core focus_schedule_policy_test -- --nocapture`

Expected: FAIL because the focus policy helpers do not exist.

**Step 3: Write minimal implementation**

```rust
// tastile-core/crates/tastile-core/src/scheduler/focus_policy.rs
const FOCUS_SEQUENCE: [u32; 5] = [15, 30, 45, 60, 75];
const BREAK_SEQUENCE: [u32; 5] = [5, 5, 5, 5, 30];

pub fn nth_focus_duration(completed_focus_blocks: usize) -> u32 {
    let index = completed_focus_blocks.min(FOCUS_SEQUENCE.len() - 1);
    FOCUS_SEQUENCE[index]
}

pub fn nth_break_duration(completed_focus_blocks: usize) -> u32 {
    let index = completed_focus_blocks % BREAK_SEQUENCE.len();
    BREAK_SEQUENCE[index]
}
```

In `src/scheduler/mod.rs`, derive `completed_focus_blocks` from ended `SegmentMode::Work` segments that occurred today.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-core focus_schedule_policy_test -- --nocapture`

Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-core/tests/focus_schedule_policy_test.rs tastile-core/crates/tastile-core/src/scheduler
git commit -m "feat(core): add progressive focus and break schedule"
```

### Task 3: Build A Core Prompt Engine From Scheduler Output

**Files:**
- Create: `tastile-core/crates/tastile-core/tests/prompt_engine_v2_test.rs`
- Create: `tastile-core/crates/tastile-core/src/prompt/engine.rs`
- Modify: `tastile-core/crates/tastile-core/src/prompt/types.rs`
- Modify: `tastile-core/crates/tastile-core/src/prompt/mod.rs`
- Modify: `tastile-core/crates/tastile-core/src/event/payloads.rs`

**Step 1: Write the failing test**

```rust
// tastile-core/crates/tastile-core/tests/prompt_engine_v2_test.rs
use chrono::{Duration, Utc};
use tastile_core::prompt::{PromptEngine, PromptKind, PromptSeverity};
use tastile_core::store::AppState;
use tastile_domain::{TileId, tile::Tile, execution::PhaseKind};

#[test]
fn idle_state_emits_start_prompt_for_best_candidate() {
    let mut state = AppState::new();
    let tile = Tile::new(TileId::new(), "Write spec".into());
    let tile_id = tile.core.id;
    state.tiles.insert(tile_id, tile);

    let prompt = PromptEngine::new().evaluate(&state, Utc::now()).expect("prompt");

    assert_eq!(prompt.kind, PromptKind::StartTile);
    assert_eq!(prompt.tile_id, Some(tile_id));
    assert_eq!(prompt.severity, PromptSeverity::Soft);
    assert_eq!(prompt.suggested_minutes, Some(15));
}

#[test]
fn expired_work_phase_emits_end_prompt() {
    let mut state = AppState::new();
    let tile = Tile::new(TileId::new(), "Finish draft".into());
    let tile_id = tile.core.id;
    state.tiles.insert(tile_id, tile);
    state.execution.active_tile_id = Some(tile_id);
    state.execution.phase_kind = PhaseKind::Work;
    state.execution.phase_started_at = Some(Utc::now() - Duration::minutes(20));
    state.execution.phase_ends_at = Some(Utc::now() - Duration::seconds(1));

    let prompt = PromptEngine::new().evaluate(&state, Utc::now()).expect("prompt");

    assert_eq!(prompt.kind, PromptKind::EndTile);
    assert_eq!(prompt.severity, PromptSeverity::Critical);
}

#[test]
fn expired_break_phase_emits_end_break_prompt() {
    let mut state = AppState::new();
    state.execution.phase_kind = PhaseKind::Break;
    state.execution.phase_started_at = Some(Utc::now() - Duration::minutes(6));
    state.execution.phase_ends_at = Some(Utc::now() - Duration::seconds(1));

    let prompt = PromptEngine::new().evaluate(&state, Utc::now()).expect("prompt");

    assert_eq!(prompt.kind, PromptKind::EndBreak);
    assert_eq!(prompt.severity, PromptSeverity::Elevated);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-core prompt_engine_v2_test -- --nocapture`

Expected: FAIL because `PromptEngine`, `PromptKind`, `PromptSeverity`, and `suggested_minutes` do not exist.

**Step 3: Write minimal implementation**

```rust
// tastile-core/crates/tastile-core/src/prompt/engine.rs
use chrono::{DateTime, Utc};
use crate::scheduler::{recommend_next_tiles, next_focus_minutes, next_break_minutes};
use crate::store::AppState;
use tastile_domain::execution::PhaseKind;

pub struct PromptEngine;

impl PromptEngine {
    pub fn new() -> Self { Self }

    pub fn evaluate(&self, state: &AppState, now: DateTime<Utc>) -> Option<PromptDecision> {
        match state.execution.phase_kind {
            PhaseKind::Work if state.execution.phase_ends_at.is_some_and(|ends| now >= ends) => {
                Some(PromptDecision::end_tile(state, now))
            }
            PhaseKind::Break if state.execution.phase_ends_at.is_some_and(|ends| now >= ends) => {
                Some(PromptDecision::end_break(state, now))
            }
            PhaseKind::Idle => {
                let recommended = recommend_next_tiles(state, now, 3).primary?;
                Some(PromptDecision::start_tile(recommended, next_focus_minutes(state, now)))
            }
            _ => None,
        }
    }
}
```

Extend prompt types to carry:

- `kind`
- `severity`
- `suggested_minutes`
- `reasons`
- `actions`

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-core prompt_engine_v2_test -- --nocapture`

Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-core/tests/prompt_engine_v2_test.rs tastile-core/crates/tastile-core/src/prompt tastile-core/crates/tastile-core/src/event/payloads.rs
git commit -m "feat(core): add prompt engine backed by scheduler output"
```

### Task 4: Replace API Heuristics With Core Scheduler And Prompt Projection

**Files:**
- Modify: `tastile-core/crates/tastile-api/src/handlers/read_handlers.rs`
- Modify: `tastile-core/crates/tastile-api/src/handlers/command_handlers.rs`
- Modify: `tastile-core/crates/tastile-api/tests/read_api_test.rs`
- Modify: `tastile-core/crates/tastile-api/tests/e2e_test.rs`

**Step 1: Write the failing test**

```rust
// tastile-core/crates/tastile-api/tests/read_api_test.rs
#[tokio::test]
async fn pending_prompt_uses_core_scheduler_candidate_and_duration() {
    let state = SharedState::new();
    let app = create_router(state.clone());

    let _ = post_json(&app, "/commands/tile/create", json!({
        "title": "Due task",
        "next_action": "Ship the patch"
    })).await;

    // mutate fixture in test helper or create a dedicated factory so due_at is set
    let prompt = get_json(&app, "/views/pending-prompt").await;

    assert_eq!(prompt["prompt"]["kind"], "start");
    assert_eq!(prompt["prompt"]["suggested_minutes"], 15);
    assert!(prompt["prompt"]["reasons"].as_array().unwrap().len() >= 1);
}

#[tokio::test]
async fn expired_break_returns_end_break_prompt() {
    let state = SharedState::new();
    let app = create_router(state.clone());

    let _ = post_json(&app, "/commands/break/start", json!({ "break_min": 1 })).await;
    // adjust execution phase end in fixture helper or seeded state
    let prompt = get_json(&app, "/views/pending-prompt").await;

    assert_eq!(prompt["prompt"]["kind"], "break_end");
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-api read_api_test pending_prompt -- --nocapture`

Expected: FAIL because the current API builds prompts with hand-written `best_candidate()` and has no duration / severity / reasons.

**Step 3: Write minimal implementation**

Replace this local logic in `read_handlers.rs`:

- `best_candidate(...)`
- manual `build_pending_prompt(...)`

with a projection built from `tastile_core::prompt::PromptEngine` and `tastile_core::scheduler::recommend_next_tiles`.

Target response shape:

```rust
#[derive(Serialize, Clone)]
pub struct PromptView {
    pub prompt_id: String,
    pub kind: String,
    pub severity: String,
    pub tile_id: Option<String>,
    pub title: String,
    pub body: String,
    pub why: String,
    pub suggested_minutes: Option<u32>,
    pub reasons: Vec<String>,
    pub actions: Vec<PromptActionView>,
    pub expires_at: Option<String>,
    pub stale: bool,
}
```

Also update command handlers so `StartTile`, `CompleteTile`, `StartBreak`, and `EndBreak` stamp `phase_ends_at` with durations derived from the core focus/break policy, not only from ad-hoc request values.

**Step 4: Run test to verify it passes**

Run: `cargo test -p tastile-api read_api_test -- --nocapture`

Expected: PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-api/src/handlers/read_handlers.rs tastile-core/crates/tastile-api/src/handlers/command_handlers.rs tastile-core/crates/tastile-api/tests/read_api_test.rs tastile-core/crates/tastile-api/tests/e2e_test.rs
git commit -m "feat(api): project prompts from core scheduler"
```

### Task 5: Move Desktop Notification Decisions To Prompt Payloads

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Models/ApiModels.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Services/InterventionEngine.cs`
- Create: `tastile-desktop/src/TastileDesktop/Services/PromptNotificationPolicy.cs`
- Modify: `tastile-desktop/src/TastileDesktop/ViewModels/MainViewModel.cs`
- Modify: `tastile-desktop/tests/TastileDesktop.Tests/TastileDesktop.Tests.csproj`
- Create: `tastile-desktop/tests/TastileDesktop.Tests/PromptNotificationPolicyTests.cs`

**Step 1: Write the failing test**

```csharp
// tastile-desktop/tests/TastileDesktop.Tests/PromptNotificationPolicyTests.cs
using TastileDesktop.Models;
using TastileDesktop.Services;

public class PromptNotificationPolicyTests
{
    [Fact]
    public void Soft_prompt_requests_stack_toast_only()
    {
        var prompt = new PromptView(
            "p1", "start", "soft", "t1",
            "Start Write spec",
            "Ship the patch",
            "Best next tile",
            15,
            new List<string> { "resume_in_flight" },
            new List<PromptActionView>(),
            null,
            false);

        var decision = PromptNotificationPolicy.Decide(prompt, isFullscreen: false);
        Assert.True(decision.ShowToast);
        Assert.False(decision.ShowIntervention);
    }

    [Fact]
    public void Critical_prompt_requests_intervention()
    {
        var prompt = new PromptView(
            "p2", "end", "critical", "t2",
            "Close Finish draft",
            "Choose complete, extend, or defer",
            "Phase expired",
            null,
            new List<string>(),
            new List<PromptActionView>(),
            null,
            false);

        var decision = PromptNotificationPolicy.Decide(prompt, isFullscreen: false);
        Assert.True(decision.ShowToast);
        Assert.True(decision.ShowIntervention);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test C:\Users\rebui\Desktop\tastile\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj --filter PromptNotificationPolicyTests`

Expected: FAIL because `PromptView` lacks `severity` and `suggested_minutes`, and `PromptNotificationPolicy` does not exist.

**Step 3: Write minimal implementation**

```csharp
// tastile-desktop/src/TastileDesktop/Services/PromptNotificationPolicy.cs
namespace TastileDesktop.Services;

using TastileDesktop.Models;

public sealed record PromptNotificationDecision(bool ShowToast, bool ShowOverlay, bool ShowIntervention);

public static class PromptNotificationPolicy
{
    public static PromptNotificationDecision Decide(PromptView prompt, bool isFullscreen)
    {
        if (prompt.Stale)
            return new(false, false, false);

        return prompt.Severity switch
        {
            "critical" => new(true, !isFullscreen, true),
            "elevated" => new(true, !isFullscreen, false),
            _ => new(true, false, false),
        };
    }
}
```

Update `InterventionEngine` so it subscribes to `PendingPromptChanged` and responds to prompt kind / severity instead of recomputing elapsed thresholds from `ActiveTileChanged`.

**Step 4: Run test to verify it passes**

Run: `dotnet test C:\Users\rebui\Desktop\tastile\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj --filter PromptNotificationPolicyTests`

Expected: PASS

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Models/ApiModels.cs tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs tastile-desktop/src/TastileDesktop/Services/InterventionEngine.cs tastile-desktop/src/TastileDesktop/Services/PromptNotificationPolicy.cs tastile-desktop/src/TastileDesktop/ViewModels/MainViewModel.cs tastile-desktop/tests/TastileDesktop.Tests
git commit -m "feat(desktop): drive prompt notifications from core prompt severity"
```

### Task 6: End-To-End Regression Coverage For The Full Loop

**Files:**
- Modify: `tastile-core/crates/tastile-api/tests/e2e_test.rs`
- Create: `tastile-core/crates/tastile-core/tests/pomodoroom_loop_regression_test.rs`
- Modify: `tastile-desktop/tests/TastileDesktop.Tests/PromptToastStackStateTests.cs`

**Step 1: Write the failing test**

```rust
// tastile-core/crates/tastile-core/tests/pomodoroom_loop_regression_test.rs
#[test]
fn idle_to_work_to_break_to_idle_loop_stays_deterministic() {
    // 1. create two tiles
    // 2. scheduler picks the resume/urgent one
    // 3. start tile -> work phase gets the expected focus duration
    // 4. expire phase -> end prompt appears
    // 5. start break -> break duration follows progressive policy
    // 6. expire break -> end-break prompt appears
    // assert prompt kinds and suggested durations at each step
}
```

```csharp
// tastile-desktop/tests/TastileDesktop.Tests/PromptToastStackStateTests.cs
[Fact]
public void New_prompt_id_replaces_front_card_and_pushes_previous_cards_back()
{
    var state = new PromptToastStackState(3);
    state.Push("prompt-1");
    state.Push("prompt-2");
    Assert.Equal("prompt-2", state.FrontPromptId);
    Assert.Contains("prompt-1", state.BackPromptIds);
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test -p tastile-core pomodoroom_loop_regression_test -- --nocapture`

Run: `dotnet test C:\Users\rebui\Desktop\tastile\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj --filter PromptToastStackStateTests`

Expected: FAIL until the full loop uses prompt-driven transitions consistently.

**Step 3: Write minimal implementation**

Make the minimum fixes needed so the following path is stable:

1. idle state returns one ranked start prompt
2. starting the tile sets `phase_ends_at` from progressive focus policy
3. expired work phase returns `end` prompt
4. starting a break sets `phase_ends_at` from progressive break policy
5. expired break phase returns `break_end` prompt
6. desktop prompt toast treats each new prompt id as a new front item without losing backlog

**Step 4: Run the full suite**

Run:

```bash
cargo test -p tastile-core
cargo test -p tastile-api
dotnet test C:\Users\rebui\Desktop\tastile\tastile-desktop\tests\TastileDesktop.Tests\TastileDesktop.Tests.csproj
dotnet build C:\Users\rebui\Desktop\tastile\tastile-desktop\src\TastileDesktop\TastileDesktop.csproj
```

Expected: all PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-core/tests tastile-core/crates/tastile-api/tests tastile-desktop/tests/TastileDesktop.Tests
git commit -m "test: add end-to-end coverage for auto scheduling and prompt loop"
```

## Notes For Implementation

- Do not extend this phase into Google Calendar or full-day slot auto-fill yet.
- Do not keep two independent prompt engines. Core owns prompt generation; desktop only renders.
- Keep the first scheduler deterministic and explainable. A smaller rule set with hard tests is better than an opaque scoring model.
- Prefer adding small pure helper modules over pushing more logic into `read_handlers.rs` or `InterventionEngine.cs`.
- When changing API response shapes, update `ApiModels.cs` first and add tests before touching UI.
- If a desktop service is hard to test because it depends on WinUI, extract a pure policy/helper class and test that instead.
