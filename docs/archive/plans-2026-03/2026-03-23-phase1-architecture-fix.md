# Phase 1 Implementation Plan: アーキテクチャ根本修正

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CODE_REVIEW_2026_03_23 に記載されたアーキテクチャ上の根本的乖離を修正し、タイル中心設計を正しく実装する

**Architecture:** タイルが唯一の真実。独立したExecution型・PhaseKindを廃止し、すべての状態判断をタイル集合から直接導出する

**Tech Stack:** Rust, tastile-core, tastile-domain

---

## 前提確認

この計画は以下のCODE_REVIEWの問題に対応する:
- ARCH-01: Execution型とPhaseKindの廃止
- ARCH-02: Validationをタイル状態から直接判定へ
- ARCH-03: PromptEngineをタイル集合ベースへ
- ARCH-04: Promptキュー化
- ARCH-05: Prompt種別・選択肢の動的化
- ARCH-07: 再計算メカニズムの設計と実装

---

## Task 1: Execution型の移除とstate.rsからの削除

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/store/state.rs`
- Modify: `tastile-core/crates/tastile-domain/src/execution.rs`
- Delete: `tastile-core/crates/tastile-core/src/reducer/execution_reducer.rs`

**Step 1: state.rsからexecutionフィールドを削除**

```rust
// state.rs - AppStateからexecutionを削除
#[derive(Debug, Clone, Default)]
pub struct AppState {
    pub tiles: HashMap<TileId, Tile>,
    pub events: Vec<EventEnvelope>,
    pub deferred_tiles: HashMap<TileId, DateTime<Utc>>,
    // execution フィールドを削除
}
```

**Step 2: execution.rsを削除または空にする**

execution.rs の PhaseKind と Execution 型を削除するか、Dockerなどで必要なものだけが残るよう準備する

**Step 3: reducer/mod.rsからexecution_reducer呼び出しを削除**

```rust
// reducer/mod.rs - execution_reducerの呼び出しをすべて削除
pub fn reduce(state: &mut AppState, event: &Event) {
    match event {
        Event::TileStarted(p) => {
            // phase_ends_at計算を削除 - 再計算メカニズムで処理
            if let Some(tile) = state.tiles.get_mut(&p.tile_id) {
                tile_reducer::apply_tile_started(tile, p);
            }
            // execution_reducer::apply_tile_started 呼び出しを削除
        }
        // 他のexecution_reducer呼び出しもすべて削除
    }
}
```

---

## Task 2: Validationルールの書き直し (tilesベース)

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/validate/rules.rs`

**Step 1: StartTileのValidation**

```rust
// StartTile: タイルが完了済みでなく、同じタイルにopen segmentがなければOK
Command::StartTile(p) => {
    let tile = state.get_tile(&p.tile_id)
        .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
    
    if tile.core.lifecycle() == Lifecycle::Done {
        return Err(ValidationError::TileAlreadyCompleted);
    }
    
    // 同じタイルにopen segmentがある場合はエラー（既にstartedで未完了）
    let has_open_segment = tile.work.segments.iter().any(|s| s.end_at.is_none());
    if has_open_segment {
        return Err(ValidationError::TileAlreadyStarted);
    }
    
    Ok(())
}
```

**Step 2: CompleteTileのValidation**

```rust
// CompleteTile: タイルがstartedAt != null で completedAt == null ならOK
Command::CompleteTile(p) => {
    let tile = state.get_tile(&p.tile_id)
        .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
    
    if tile.core.lifecycle() == Lifecycle::Done {
        return Err(ValidationError::TileAlreadyCompleted);
    }
    
    // startedされていること（open segmentがあるか、started_atが設定されていること）
    let has_started = tile.core.started_at.is_some() 
        || tile.work.segments.iter().any(|s| s.end_at.is_none());
    if !has_started {
        return Err(ValidationError::TileNotStarted);
    }
    
    Ok(())
}
```

**Step 3: ExtendPhaseのValidation**

```rust
// ExtendPhase: 対象タイルが進行中ならOK
Command::ExtendPhase(p) => {
    let tile = state.get_tile(&p.tile_id)
        .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
    
    if p.delta_min == 0 {
        return Err(ValidationError::InvalidExtendDelta);
    }
    
    // タイルがstartedで未完了ならOK
    let is_in_progress = tile.core.started_at.is_some() 
        && tile.core.completed_at.is_none();
    if !is_in_progress {
        return Err(ValidationError::TileNotInProgress);
    }
    
    Ok(())
}
```

**Step 4: SwitchActiveTileのValidation削除または再定義**

SwitchActiveTileは「表示優先順位の変更」にすぎないので、Validationを緩和する

**Step 5: StartBreak/EndBreakのValidation**

休憩開始/終了はPhaseKindではなく、休憩タイルの状態から判定

```rust
Command::StartBreak(p) => {
    // 休憩タイルが作成済みでstartedならOK（または休憩タイルの開始を許可）
    Ok(())
}

Command::EndBreak(p) => {
    // 対象の休憩タイルが進行中ならOK
    let tile = state.get_tile(&p.tile_id)
        .ok_or_else(|| ValidationError::TileNotFound(p.tile_id.to_string()))?;
    
    let is_break_in_progress = tile.core.started_at.is_some() 
        && tile.core.completed_at.is_none();
    if !is_break_in_progress {
        return Err(ValidationError::BreakNotInProgress);
    }
    
    Ok(())
}
```

---

## Task 3: PromptEngine書き直し (tilesベース)

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/prompt/engine.rs`

**Step 1: PhaseKind依存を削除**

```rust
impl PromptEngine {
    /// タイル集合の状態からPromptを導出（キュー対応）
    pub fn evaluate(&self, state: &AppState, now: DateTime<Utc>) -> Vec<PromptDecision> {
        let mut prompts = Vec::new();
        
        // 1. 時間条件を超えた進行中タイルに対してEnd Prompt
        for (tile_id, tile) in &state.tiles {
            if let Some(phase_ends_at) = tile.temporal.phase_ends_at {
                if now >= phase_ends_at && tile.core.completed_at.is_none() {
                    prompts.push(PromptDecision::end_tile(
                        tile_id.clone(),
                        PromptSeverity::Critical,
                        None,
                        vec![PromptReason::WorkPhaseExpired],
                    ));
                }
            }
        }
        
        // 2. 休憩時間がすぎた休憩タイルに対してEnd Break Prompt
        for (tile_id, tile) in &state.tiles {
            if tile.objective.is_break_tile && tile.core.completed_at.is_none() {
                if let Some(phase_ends_at) = tile.temporal.phase_ends_at {
                    if now >= phase_ends_at {
                        prompts.push(PromptDecision::end_break(
                            Some(tile_id.clone()),
                            vec![PromptReason::BreakPhaseExpired],
                        ));
                    }
                }
            }
        }
        
        // 3. 開始可能な候補があればStart Prompt
        if prompts.is_empty() {
            if let Some(candidate) = recommend_next_tiles(state, now, 1).primary {
                prompts.push(PromptDecision::from(candidate));
            }
        }
        
        prompts
    }
}
```

**Step 2: Promptキュー対応**

Promptを単一値ではなくVecで返す

---

## Task 4: 再計算メカニズムの設計と実装

**Files:**
- Create: `tastile-core/crates/tastile-core/src/recalc/mod.rs`
- Modify: `tastile-core/crates/tastile-core/src/handler/command_handler.rs`

**Step 1: 再計算トリガーの定義**

```rust
// recalc/mod.rs
pub enum RecalcTrigger {
    TileCreated(TileId),
    TileStarted(TileId),
    TileCompleted(TileId),
    TileDeferred(TileId),
    TileInterrupted(TileId),
    PromptAccepted(PromptId),
    TimeElapsed(DateTime<Utc>),
}
```

**Step 2: 再計算関数の実装**

```rust
pub fn recalculate(state: &mut AppState, trigger: RecalcTrigger, now: DateTime<Utc>) {
    // 1. すべての未完了タイルの時間条件を再計算
    for (tile_id, tile) in &mut state.tiles {
        if tile.core.completed_at.is_none() {
            recalc_tile_timing(tile, now);
        }
    }
    
    // 2. 休憩タイルの生成（必要に応じて）
    generate_break_tiles_if_needed(state, now);
    
    // 3. 定期タイルの生成（必要に応じて）
    generate_recurring_tiles_if_needed(state, now);
}
```

**Step 3: command_handlerで再計算を発火**

```rust
fn handle(...) -> Vec<EventEnvelope> {
    // コマンド処理後、再計算を発火
    for event in &events {
        reduce(state, &event);
    }
    
    // 再計算発火
    let trigger = match command {
        Command::StartTile(p) => RecalcTrigger::TileStarted(p.tile_id),
        Command::CompleteTile(p) => RecalcTrigger::TileCompleted(p.tile_id),
        // ...
    };
    recalculate(state, trigger, now);
}
```

---

## Task 5: CommandHandlerの修正 (active_tile_id依存排除)

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/handler/command_handler.rs`

**Step 1: EndBreakをタイルID直接指定へ**

```rust
// EndBreakコマンドのペイロードにtile_idを追加
Command::EndBreak(p) => {
    let tile_id = p.tile_id; // 直接指定
    // タイル的状态を確認して終了
}
```

**Step 2: DeferTileをタイルの状態から直接判定へ**

```rust
Command::DeferTile(p) => {
    let tile = state.get_tile(&p.tile_id)?;
    // タイルのopen segmentを直接確認
    let has_open_segment = tile.work.segments.iter().any(|s| s.end_at.is_none());
    // active_tile_idへの依存を削除
}
```

---

## Task 6: focus_policy.rsのリセット条件実装

**Files:**
- Modify: `tastile-core/crates/tastile-core/src/scheduler/focus_policy.rs`

**Step 1: 集中リセット条件の実装**

```rust
/// 集中リセット後のブロック数を計算
pub fn completed_focus_blocks_since_reset(&self, state: &AppState, day_start: DateTime<Utc>, day_end: DateTime<Utc>, last_reset_at: DateTime<Utc>) -> u32 {
    state.tiles.values()
        .flat_map(|tile| tile.work.segments.iter())
        .filter(|segment| segment.mode == SegmentMode::Work)
        .filter(|segment| segment.end_at.is_some_and(|end_at| end_at >= last_reset_at && end_at < day_end))
        .filter(|segment| {
            // リセット条件を満たさないセグメントのみカウント
            !is_interrupt_segment(segment, state)
        })
        .count()
}

/// リセット条件を判定
fn is_interrupt_segment(segment: &Segment, state: &AppState) -> bool {
    // breakSplitsWork=false のタイルのセグメントはリセットとして扱う
    let tile = state.tiles.get(&segment.source_tile_id);
    tile.map(|t| !t.automation.break_splits_work).unwrap_or(false)
}
```

---

## 実行オプション

**Plan complete and saved.**

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
