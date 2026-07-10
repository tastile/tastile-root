# v1 Tile-List View-Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the rich `TileListView` response shape that `tastile-web` expects from `GET /v1/tiles`, so the dashboard stops rendering every task as "未設定/unscheduled". v0-era `/views/tile-list` semantics are re-implemented on the v1 read surface.

**Architecture:** A new `domain::read::TileListView` DTO (with embedded `TemporalView` and `RecurrenceView`) carries temporal / recurrence / lifecycle / worked-minutes / semantic-role info. The `list_tiles` API handler issues ONE `sqlx::query_as` that LEFT-JOINs `v1_placement_baseline`, `v1_placement_life`, `v1_execution`, `v1_execution_segment`, `v1_recurring_model`, `v1_plan`, `v1_annotation` and aggregates worked/break minutes per tile. `ListTilesQuery` is extended with `view_mode`, `lifecycle`, `range`, `granularity`, `search`, `exclude_future`. The web hook drops the `?? []` shape fallback and the `TileCardCompact` switches from "null-check on temporal" to "render based on `lifecycle` field".

**Tech Stack:** Rust (axum + sqlx + tokio + chrono + uuid + serde), Postgres, Next.js 14 (App Router) + React + TypeScript + vitest.

**Spec:**
- `tastile-core/v1/14-read-model-and-endpoint.md §4` — timeline is effective placements.
- `tastile-core/docs/v1/PRODUCTION_READINESS.md §2.2` — `/read/tiles → GET /v1/tiles` is "必要" (incomplete).
- `tastile-core/docs/archive/2026-06-24-architecture-v7-superseded.md:797` — `/views/tile-list` was v7's rich tile-list endpoint.
- Web definition: `tastile-web/src/lib/hooks/use-tile-list.ts` `TileListView`.

**Already-implemented (no work needed):**
- `crates/v1/storage/src/placement_repo.rs::list_in_range`
- `crates/v1/storage/src/annotation_repo.rs::list_for_tile`
- `crates/v1/domain/src/read.rs::{TileView,PlanView,CompletionView,PlanningView}` (existing structs to model from)

**To implement (new files marked NEW, modified files marked MOD):**
- `tastile-core/crates/v1/domain/src/read.rs` (MOD — append `TileListView`, `TemporalView`, `RecurrenceView`)
- `tastile-core/crates/v1/domain/src/constants.rs` (MOD — append `TileLifecycleKind`, `ObjectiveModeKind`, `SemanticRoleKind`, `DoneRuleKind`)
- `tastile-core/crates/v1/api/src/handlers/read.rs` (MOD — extend `ListTilesQuery`, rewrite `list_tiles`)
- `tastile-core/crates/v1/api/src/openapi.rs` (MOD — `/v1/tiles` schema + query)
- `tastile-core/crates/v1/api/tests/list_tiles_view_model.rs` (NEW — integration test)
- `tastile-web/src/lib/hooks/use-tile-list.ts` (MOD — drop `?? []` fallback, tighten types)
- `tastile-web/src/lib/utils/map-list-view-to-tile.ts` (MOD — drive lifecycle from new field)
- `tastile-web/src/components/tiles/TileCardCompact.tsx` (MOD — render from `lifecycle` field)
- `tastile-web/src/components/tiles/TileCardCompact.test.tsx` (NEW — render assertions)
- `tastile-core/HARNESS.md` (MOD — append 実装履歴 entry)

**Critical invariants (carried through every task):**
- v1/10 §10: no `kind`/`source_kind` discriminator beyond the v1 numeric constants.
- v1/10 §8: Flow/Recurring auto-adjust never deletes existing Placements.
- v1/02 Placement.source = MANUAL/RECURRING/FLOW/IMPORT stays the only placement classification.
- No new tables. The view-model is purely a SQL projection over existing tables.
- No new columns. Worked/break minutes are computed from existing `v1_execution_segment`.
- Web keeps `TileCardCompact` as the only consumer that decides "unscheduled" — but the trigger flips from `temporal == null` to `lifecycle == "ready" && temporal == null`.

---

## Task 1: Add `TileListView` DTO and view-model constants in domain (RED → GREEN)

> **Note (post-review, 2026-07-07):** `SemanticRoleKind` was removed from the constant registry AND `TileListView.semantic_role` was dropped from the DTO during review. v1/10 §10 and the project memory `feedback_no_fragmented_reimplementations.md` / `feedback_no_kind_enums.md` ban any "is this a break/work?" discriminator. The v1 role is derived at render time in the web mapper (Task 5) from `tile.kind` + `Plan.role` (`EXECUTABLE` / `LABEL`), not stored on the tile. The code block in Step 1 below reflects the post-fix implementation; the original plan block had four structs, this one has three.

**Files:**
- Modify: `tastile-core/crates/v1/domain/src/constants.rs` (append new enum kinds)
- Modify: `tastile-core/crates/v1/domain/src/read.rs` (append `TileListView`, `TemporalView`, `RecurrenceView`)

- [ ] **Step 1: Add domain constants for view-model enums**

In `tastile-core/crates/v1/domain/src/constants.rs`, append the three new constants after the existing `ViolationKind` block:

```rust
/// Numeric constant for TileListView.lifecycle (web/i18n renders).
/// See v1/02-core-entities.md §Tile.state for the canonical mapping.
///
/// Semantics:
/// - `READY` = no placement is currently active and no finished execution exists.
/// - `STARTED` = an execution segment is currently open (active_start set, active_end null).
/// - `DONE` = the most recent execution segment for the active placement has ended (active_end set).
/// - `CLOSED` = the tile has no upcoming placement AND is not eligible for re-opening;
///   distinct from `DONE`, which means the active task simply finished. A `CLOSED` tile is
///   administratively retired and should not be re-scheduled.
pub struct TileLifecycleKind;
impl TileLifecycleKind {
    pub const READY: i16 = 0;
    pub const STARTED: i16 = 1;
    pub const DONE: i16 = 2;
    pub const CLOSED: i16 = 3;
}

/// Numeric constant for TileListView.objective_mode.
///
/// **VIEW-MODEL ONLY projection** — mirrors the legacy v0 `objective_mode` field so the
/// existing web/i18n render code can keep working unchanged. Do NOT use this as a domain
/// decision input: completion logic, scheduling, and flow evaluation must read `Plan.role`
/// (EXECUTABLE / LABEL) and `Plan.completion` (`v1/13`) instead.
pub struct ObjectiveModeKind;
impl ObjectiveModeKind {
    pub const FINISH_ONCE: i16 = 0;
    pub const RECURRING: i16 = 1;
    pub const MAXIMIZE_WITHIN_INTERVAL: i16 = 2;
    pub const LABEL_ONLY: i16 = 3;
}

/// Numeric constant for TileListView.done_rule.
///
/// **VIEW-MODEL ONLY projection** — mirrors v0 done-rule UI labels for back-compat.
/// Do NOT use this as a domain decision input: the v1 canonical completion logic lives in
/// `Plan.completion` (`v1/13-completion.md`); `done_rule` here only tells the renderer
/// which pre-computed label to display.
pub struct DoneRuleKind;
impl DoneRuleKind {
    pub const MANUAL: i16 = 0;
    pub const TIME_REACHED: i16 = 1;
    pub const INTERVAL_END: i16 = 2;
}
```

- [ ] **Step 2: Append view-model structs to `domain/src/read.rs`**

After `pub struct PlanView { ... }` block ends (look for the closing `}` before `pub struct ReferenceDefView`), append:

```rust
/// Temporal window for a Tile: release/due/fixed/active timestamps from
/// the most recent or upcoming Placement, or null when no Placement
/// exists for the tile.
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
pub struct TemporalView {
    pub release_at: Option<Instant>,
    pub due_at: Option<Instant>,
    pub fixed_start: Option<Instant>,
    pub fixed_end: Option<Instant>,
    pub active_start: Option<Instant>,
    pub active_end: Option<Instant>,
}

/// Recurrence model summary for a Tile.
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
pub struct RecurrenceView {
    pub step_min: i32,
    pub window_start_min: i32,
    pub window_end_min: i32,
    pub expression: Option<String>,
}

/// Rich tile-list view-model returned by `GET /v1/tiles`.
///
/// Mirrors the v0 `/views/tile-list` shape that tastile-web still
/// consumes.  See docs/archive/2026-06-24-architecture-v7-superseded.md
/// for the historical definition.
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
pub struct TileListView {
    pub id: Uuid,
    pub plan_id: Option<Uuid>,
    pub title: String,
    /// One of TileLifecycleKind numeric constants.
    pub lifecycle: i16,
    pub next_action: Option<String>,
    pub done_definition: Option<String>,
    pub worked_minutes: i64,
    pub break_minutes: i64,
    pub labels: Vec<String>,
    /// One of ObjectiveModeKind numeric constants.
    pub objective_mode: i16,
    pub target_work_min: Option<i32>,
    pub target_rest_min: Option<i32>,
    /// One of DoneRuleKind numeric constants.
    pub done_rule: Option<i16>,
    pub resume_note: Option<String>,
    pub projected_next_start_at: Option<Instant>,
    pub temporal: Option<TemporalView>,
    pub recurrence: Option<RecurrenceView>,
}
```

- [ ] **Step 3: Build to verify the additions compile**

Run (from WSL Ubuntu, not Windows — see tastile-core/CLAUDE.md):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && cargo build -p domain 2>&1 | tail -20
```
Expected: clean build. New structs and constants are usable from downstream crates.

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core
git add crates/v1/domain/src/constants.rs crates/v1/domain/src/read.rs
git commit -m "feat(domain): add TileListView + view-model constants"
```

---

## Task 2: Extend `ListTilesQuery` with view filters (RED test first)

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/read.rs` (extend `ListTilesQuery`, add helper `parse_view_filters`)

- [ ] **Step 1: Add failing API integration test skeleton**

Create `tastile-core/crates/v1/api/tests/list_tiles_view_model.rs`:

```rust
//! Integration test for GET /v1/tiles view-model.
//!
//! Verifies that the handler returns a `domain::TileListView` JSON
//! array containing `temporal`, `recurrence`, `lifecycle`,
//! `worked_minutes`, `break_minutes`, `semantic_role`, `labels`,
//! `objective_mode`, `target_work_min`, `target_rest_min`, `done_rule`,
//! and `projected_next_start_at` for an owned tile.
//!
//! Run (from WSL Ubuntu):
//!   cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core
//!   cargo test -p api --test list_tiles_view_model -- --nocapture

use chrono::{TimeZone, Utc};
use domain::{ObjectiveModeKind, SemanticRoleKind, TileLifecycleKind};
use serde_json::Value;
use storage::Store;
use uuid::Uuid;

#[tokio::test]
async fn list_tiles_returns_rich_view_model() {
    let Some(store) = Store::from_env_or_skip().await else {
        return;
    };
    let owner = Uuid::now_v7();
    let _tile = storage::test_helpers::seed_minimal_tile(&store.pool, owner).await;

    // Spawn the axum app on an ephemeral port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = api::build_router(store.clone()).into_make_service();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let url = format!(
        "http://{}/v1/tiles?owner_ids={}&view_mode=by_state&range=7d",
        addr, owner
    );
    let res = reqwest::Client::new()
        .get(&url)
        .header("x-owner-id", owner.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "list_tiles should be 200");
    let body: Value = res.json().await.unwrap();
    let arr = body.as_array().expect("response must be a JSON array");
    assert!(!arr.is_empty(), "should return at least the seeded tile");
    let first = &arr[0];
    for key in [
        "id",
        "title",
        "lifecycle",
        "worked_minutes",
        "break_minutes",
        "semantic_role",
        "labels",
        "objective_mode",
    ] {
        assert!(
            first.get(key).is_some(),
            "TileListView missing required field: {}",
            key
        );
    }
    assert_eq!(
        first["lifecycle"].as_i64().unwrap(),
        TileLifecycleKind::READY as i64,
        "freshly seeded tile should be READY"
    );
    assert_eq!(
        first["semantic_role"].as_i64().unwrap(),
        SemanticRoleKind::WORK as i64
    );
    assert_eq!(
        first["objective_mode"].as_i64().unwrap(),
        ObjectiveModeKind::FINISH_ONCE as i64
    );

    server.abort();
}
```

- [ ] **Step 2: Run the test, expect it to FAIL**

Run (WSL Ubuntu):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  cargo test -p api --test list_tiles_view_model -- --nocapture 2>&1 | tail -30
```
Expected: FAIL. The current handler returns `[{id,kind,title,description,color,icon,plan_id,archived,created_at,updated_at}]` and is missing `lifecycle`, `worked_minutes`, `break_minutes`, `semantic_role`, `labels`, `objective_mode`.

- [ ] **Step 3: Extend `ListTilesQuery` struct in `read.rs`**

In `tastile-core/crates/v1/api/src/handlers/read.rs`, replace the existing `pub struct ListTilesQuery` with:

```rust
#[derive(serde::Deserialize, Default, Debug)]
pub struct ListTilesQuery {
    /// Comma-separated list of owner_ids.  Defaults to the authenticated
    /// owner (= Personal scope) when omitted.
    pub owner_ids: Option<String>,
    pub limit: Option<i64>,

    /// View bucketing.  `"by_state"` groups tiles by lifecycle.
    /// Defaults to `"flat"` (no bucketing) for backwards compat with the
    /// existing TileSummary-only consumers.
    pub view_mode: Option<String>,

    /// Optional lifecycle filter.  One of "ready" | "started" | "done" | "closed".
    pub lifecycle: Option<String>,

    /// Range string for `by_state` projection (e.g. "7d", "30d").  Only
    /// used when `view_mode = "by_state"`.
    pub range: Option<String>,

    /// Granularity string for `by_state` projection
    /// (e.g. "no_breaks,min_0m", "important_only").
    pub granularity: Option<String>,

    /// Free-text search across title / description / labels.
    pub search: Option<String>,

    /// When true, exclude tiles whose first upcoming placement is
    /// strictly after the current instant.
    pub exclude_future: Option<bool>,
}
```

Add the corresponding `pub` re-exports to the handler module's `use` block at the top of `read.rs` if not already present:

```rust
use domain::{
    ObjectiveModeKind, SemanticRoleKind, TileLifecycleView, TileListView, TileLifecycleKind,
};
```

(Note: replace the existing `use domain::{...}` block at the top of the file to include the new types. Keep existing imports.)

- [ ] **Step 4: Add `parse_view_filters` helper**

Below the `ListTilesQuery` definition, add:

```rust
/// Parsed projection filters derived from `ListTilesQuery`.  Centralizes
/// the strings-to-numeric-constant conversion so SQL never has to.
pub struct ViewFilters {
    pub lifecycle: Option<i16>,
    pub lifecycle_str: &'static str,
    pub objective_modes: Vec<i16>,
    pub exclude_future: bool,
    pub has_text_search: Option<String>,
    pub min_duration_min: Option<i32>,
    pub no_breaks: bool,
    pub important_only: bool,
    pub view_by_state: bool,
    pub range_start: Option<chrono::DateTime<chrono::Utc>>,
    pub range_end: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn parse_view_filters(q: &ListTilesQuery, now: chrono::DateTime<chrono::Utc>) -> ViewFilters {
    let lifecycle_str = q.lifecycle.as_deref().unwrap_or("");
    let lifecycle = match lifecycle_str {
        "ready" => Some(TileLifecycleKind::READY),
        "started" => Some(TileLifecycleKind::STARTED),
        "done" => Some(TileLifecycleKind::DONE),
        "closed" => Some(TileLifecycleKind::CLOSED),
        _ => None,
    };

    let granularity = q.granularity.as_deref().unwrap_or("");
    let g_parts: Vec<&str> = granularity.split(',').collect();
    let no_breaks = g_parts.contains(&"no_breaks");
    let important_only = g_parts.contains(&"important_only");
    let min_duration_min = g_parts
        .iter()
        .find_map(|p| p.strip_prefix("min_").and_then(|s| s.strip_suffix("m")))
        .and_then(|s| s.parse::<i32>().ok())
        .filter(|m| *m > 0);

    let range = q.range.as_deref().unwrap_or("");
    let (range_start, range_end) = if range.ends_with('d') {
        range
            .strip_suffix('d')
            .and_then(|n| n.parse::<i64>().ok())
            .map(|days| {
                let end = now;
                let start = end - chrono::Duration::days(days);
                (Some(start), Some(end))
            })
            .unwrap_or((None, None))
    } else {
        (None, None)
    };

    ViewFilters {
        lifecycle,
        lifecycle_str,
        objective_modes: vec![], // filled by caller
        exclude_future: q.exclude_future.unwrap_or(false),
        has_text_search: q.search.clone().filter(|s| !s.is_empty()),
        min_duration_min,
        no_breaks,
        important_only,
        view_by_state: q.view_mode.as_deref() == Some("by_state"),
        range_start,
        range_end,
    }
}
```

- [ ] **Step 5: Build to verify the new types compile**

Run (WSL):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  cargo build -p api 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core
git add crates/v1/api/src/handlers/read.rs crates/v1/api/tests/list_tiles_view_model.rs
git commit -m "feat(api): extend ListTilesQuery + add view filter parser"
```

---

## Task 3: Rewrite `list_tiles` handler to project `TileListView` (GREEN)

**Files:**
- Modify: `tastile-core/crates/v1/api/src/handlers/read.rs` (rewrite the SQL projection + post-processing in `list_tiles`)

- [ ] **Step 1: Replace the existing `list_tiles` SQL + projection**

In `tastile-core/crates/v1/api/src/handlers/read.rs`, replace the entire body of `list_tiles` between `let limit = ...` and `Ok(Json(out))` (approx. lines 244–303) with:

```rust
    let limit = q.limit.unwrap_or(500).clamp(1, 500);
    let now = chrono::Utc::now();
    let filters = parse_view_filters(&q, now);

    let owner_ids: Vec<Uuid> = match q.owner_ids {
        Some(s) => s
            .split(',')
            .filter_map(|x| Uuid::parse_str(x.trim()).ok())
            .collect(),
        None => vec![actor],
    };
    if owner_ids.is_empty() {
        return Ok(Json(vec![]));
    }
    // Authorization: each owner_id must be either the actor (Personal) or a
    // WORKSPACE where the actor is OWNER via v1_subject_member.
    for &oid in &owner_ids {
        if oid == actor { continue; }
        let subj = storage::access_repo::get_subject_by_id(&state.store.pool, oid)
            .await.map_err(|e| { tracing::error!(?e, "list_tiles get_subject_by_id failed"); internal() })?;
        if subj.kind != storage::access_repo::subject_kind::WORKSPACE || subj.disabled_at.is_some() {
            return Err(StatusCode::FORBIDDEN);
        }
        let owner_row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT member_id FROM v1_subject_member
             WHERE subject_id = $1 AND member_id = $2
               AND role = 0 AND state = 0",
        )
        .bind(oid)
        .bind(actor)
        .fetch_optional(&state.store.pool)
        .await
        .map_err(|e| { tracing::error!(?e, "list_tiles owner check failed"); internal() })?;
        if owner_row.is_none() { return Err(StatusCode::FORBIDDEN); }
    }

    // Aggregate worked + break minutes from v1_execution_segment.
    // semantic_role defaults to WORK (0) when no annotation row exists.
    // objective_mode defaults to FINISH_ONCE (0).
    // done_rule defaults to MANUAL (0).
    let rows: Result<
        Vec<(
            Uuid,
            Uuid,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<Uuid>,
            Option<Uuid>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<i64>,
            Option<i64>,
            i64,
            i64,
            Option<i16>,
            Option<i16>,
            Option<i32>,
            Option<i32>,
            Option<i16>,
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<i32>,
            Option<i32>,
            Option<i32>,
            Option<String>,
        )>,
        sqlx::Error,
    > = sqlx::query_as(
        r#"
        WITH agg AS (
            SELECT
                eb.placement_id,
                COALESCE(SUM(
                    EXTRACT(EPOCH FROM (seg.ended_at - seg.started_at)) / 60
                )::bigint, 0) AS worked_min,
                COUNT(*) FILTER (WHERE seg.kind = 1) AS break_segments
            FROM v1_execution_segment seg
            JOIN v1_execution_basis eb ON eb.execution_id = seg.execution_id
            GROUP BY eb.placement_id
        ),
        next_placement AS (
            SELECT DISTINCT ON (p.tile_id)
                p.tile_id,
                b.span_start  AS fixed_start,
                b.span_end    AS fixed_end,
                es.started_at AS active_start,
                es.ended_at   AS active_end
            FROM v1_placement p
            JOIN v1_placement_baseline b ON b.placement_id = p.id
            JOIN v1_placement_life     l ON l.placement_id = p.id
            LEFT JOIN agg ON agg.placement_id = p.id
            LEFT JOIN LATERAL (
                SELECT seg.started_at, seg.ended_at
                FROM v1_execution_segment seg
                JOIN v1_execution_basis eb ON eb.execution_id = seg.execution_id
                WHERE eb.placement_id = p.id
                ORDER BY seg.started_at DESC LIMIT 1
            ) es ON true
            WHERE p.owner_id = ANY($1)
              AND l.close = false
              AND b.span_start >= COALESCE($4::timestamptz, '-infinity'::timestamptz)
            ORDER BY p.tile_id, b.span_start ASC
        ),
        last_placement AS (
            SELECT DISTINCT ON (p.tile_id)
                p.tile_id,
                b.span_start AS last_fixed_start
            FROM v1_placement p
            JOIN v1_placement_baseline b ON b.placement_id = p.id
            WHERE p.owner_id = ANY($1)
            ORDER BY p.tile_id, b.span_start DESC
        )
        SELECT
            t.id, t.owner_id, t.title, t.description, t.color, t.icon,
            t.plan_id, pr.id AS recurring_id,
            pr.release_at, pr.due_at,
            np.fixed_start, np.fixed_end,
            np.active_start, np.active_end,
            agg.worked_min, agg.break_segments,
            COALESCE(agg.worked_min, 0) AS worked_minutes_out,
            COALESCE(agg.break_segments, 0) AS break_minutes_out,
            ann.semantic_role,
            ann.completion_objective_mode,
            ann.target_work_min,
            ann.target_rest_min,
            ann.completion_done_rule,
            ann.next_action,
            ann.projected_next_start_at,
            rec.step_min, rec.window_start_min, rec.window_end_min, rec.expression
        FROM v1_tile t
        LEFT JOIN next_placement np ON np.tile_id = t.id
        LEFT JOIN last_placement lp ON lp.tile_id = t.id
        LEFT JOIN agg ON agg.placement_id = np.fixed_start  -- placeholder join, see note
        LEFT JOIN v1_recurring_instance pr ON pr.tile_id = t.id AND pr.lifecycle_kind IN (0, 1)
        LEFT JOIN v1_recurring_model rec ON rec.tile_id = t.id
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(MIN(CASE WHEN ann.kind = 0 THEN 0 END), 0) AS semantic_role,
                MAX(CASE WHEN ann.kind = 1 THEN ann.completion_objective_mode END) AS completion_objective_mode,
                MAX(CASE WHEN ann.kind = 1 THEN ann.completion_target_work_min END) AS target_work_min,
                MAX(CASE WHEN ann.kind = 1 THEN ann.completion_target_rest_min END) AS target_rest_min,
                MAX(CASE WHEN ann.kind = 1 THEN ann.completion_done_rule END) AS completion_done_rule,
                MAX(CASE WHEN ann.kind = 2 THEN ann.label END) AS next_action,
                MAX(pr2.projected_next_start_at) AS projected_next_start_at
            FROM v1_annotation ann
            LEFT JOIN v1_recurring_projection pr2 ON pr2.tile_id = t.id
            WHERE ann.tile_id = t.id
        ) ann ON true
        WHERE t.owner_id = ANY($1) AND t.archived_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(&owner_ids)
    .bind(limit)
    .bind(filters.lifecycle.map(|l| l as i16))
    .bind(filters.range_start)
    .fetch_all(&state.store.pool)
    .await;
    let rows = rows.map_err(|e| { tracing::error!(?e, "list_tiles query failed"); internal() })?;

    let out: Vec<TileListView> = rows
        .into_iter()
        .map(|r| {
            let temporal = if r.8.is_some() || r.9.is_some() || r.10.is_some() || r.11.is_some() || r.12.is_some() || r.13.is_some() {
                Some(domain::TemporalView {
                    release_at: r.8,
                    due_at: r.9,
                    fixed_start: r.10,
                    fixed_end: r.11,
                    active_start: r.12,
                    active_end: r.13,
                })
            } else { None };

            let worked = r.14.unwrap_or(0);
            let break_min = r.15.unwrap_or(0);
            let lifecycle = if r.12.is_some() && r.13.is_none() {
                TileLifecycleKind::STARTED
            } else if r.13.is_some() {
                TileLifecycleKind::DONE
            } else if r.7.is_some() && r.10.is_none() {
                TileLifecycleKind::CLOSED
            } else {
                TileLifecycleKind::READY
            };

            let recurrence = if r.23.is_some() || r.24.is_some() || r.25.is_some() {
                Some(domain::RecurrenceView {
                    step_min: r.23.unwrap_or(0),
                    window_start_min: r.24.unwrap_or(0),
                    window_end_min: r.25.unwrap_or(0),
                    expression: r.26.clone(),
                })
            } else { None };

            TileListView {
                id: r.0,
                plan_id: r.6,
                title: r.2,
                lifecycle,
                next_action: r.21,
                done_definition: r.3.clone(),
                worked_minutes: worked,
                break_minutes: break_min,
                semantic_role: r.16.unwrap_or(SemanticRoleKind::WORK),
                labels: vec![], // populated via annotation_repo::list_for_tile below
                objective_mode: r.17.unwrap_or(ObjectiveModeKind::FINISH_ONCE),
                target_work_min: r.18,
                target_rest_min: r.19,
                done_rule: r.20,
                resume_note: None,
                projected_next_start_at: r.22,
                temporal,
                recurrence,
            }
        })
        .collect();

    // Second pass: enrich labels via annotation_repo.  Cheap because
    // tile count is capped by `limit`.
    let mut out = out;
    for v in out.iter_mut() {
        if let Ok(rows) = storage::annotation_repo::list_for_tile(&state.store.pool, v.id).await {
            v.labels = rows.into_iter().map(|a| a.label).collect();
        }
    }

    Ok(Json(out))
```

**NOTE**: The SQL above references `v1_recurring_instance`, `v1_recurring_projection`, and `v1_annotation.completion_*` columns that **may not exist** in the current migration set. Before committing, the implementer MUST run:
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  grep -rh "CREATE TABLE.*v1_recurring\|CREATE TABLE v1_annotation\|v1_recurring_instance\|v1_recurring_projection" migrations/ crates/v1/storage/migrations/ 2>/dev/null | head -20
```
and adjust the SQL to match the actual schema. The shape and intent are correct; column names need reconciliation against the live DDL. Document any column renames in the commit message.

- [ ] **Step 2: Run the integration test from Task 2**

Run (WSL):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  cargo test -p api --test list_tiles_view_model -- --nocapture 2>&1 | tail -30
```
Expected: PASS.

- [ ] **Step 3: Run the existing api test suite**

Run (WSL):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  cargo test -p api 2>&1 | tail -30
```
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core
git add crates/v1/api/src/handlers/read.rs
git commit -m "feat(api): rewrite list_tiles to project TileListView"
```

---

## Task 4: Update OpenAPI schema for `/v1/tiles`

**Files:**
- Modify: `tastile-core/crates/v1/api/src/openapi.rs` (replace the `/v1/tiles` GET schema with `TileListView` reference + new query params)

- [ ] **Step 1: Locate the existing `/v1/tiles` GET entry**

Search for the entry in `openapi.rs` with `(paths.)?/v1/tiles` GET block. The current schema references `TileSummary`.

- [ ] **Step 2: Replace the response schema with `TileListView` and add query params**

Replace the existing entry with:

```rust
(
    "/v1/tiles".to_string(),
    PathItem {
        get: Some(Operation {
            operation_id: Some("listTiles".into()),
            tags: vec!["Read".into()],
            summary: Some("List tiles (rich view-model)".into()),
            parameters: vec![
                Parameter {
                    name: "owner_ids".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    ..Default::default()
                },
                Parameter {
                    name: "view_mode".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    description: Some("One of: flat, by_state".into()),
                    ..Default::default()
                },
                Parameter {
                    name: "lifecycle".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    description: Some("One of: ready, started, done, closed".into()),
                    ..Default::default()
                },
                Parameter {
                    name: "range".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    description: Some("E.g. 7d, 30d. Used when view_mode=by_state.".into()),
                    ..Default::default()
                },
                Parameter {
                    name: "granularity".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    ..Default::default()
                },
                Parameter {
                    name: "search".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("string".into()), ..Default::default() }),
                    required: false,
                    ..Default::default()
                },
                Parameter {
                    name: "exclude_future".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("boolean".into()), ..Default::default() }),
                    required: false,
                    ..Default::default()
                },
                Parameter {
                    name: "limit".into(),
                    kind: "query".into(),
                    schema: Some(Schema { kind: Some("integer".into()), ..Default::default() }),
                    required: false,
                    ..Default::default()
                },
            ],
            responses: Some(BTreeMap::from([(
                "200".into(),
                Response {
                    description: Some("OK".into()),
                    content: Some(BTreeMap::from([(
                        "application/json".into(),
                        MediaType {
                            schema: Some(Schema {
                                kind: Some("array".into()),
                                items: Some(Box::new(Schema {
                                    reference: Some("#/components/schemas/TileListView".into()),
                                    ..Default::default()
                                })),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }
                    )])),
                    ..Default::default()
                }
            )])),
            ..Default::default()
        }),
        ..Default::default()
    },
)
```

Also add a `TileListView` entry under `components.schemas`:

```rust
components: Some(Components {
    schemas: Some(BTreeMap::from([
        ("TileListView".into(), Schema {
            kind: Some("object".into()),
            properties: Some(BTreeMap::from([
                ("id".into(), Schema { kind: Some("string".into()), format: Some("uuid".into()), ..Default::default() }),
                ("title".into(), Schema { kind: Some("string".into()), ..Default::default() }),
                ("lifecycle".into(), Schema { kind: Some("integer".into()), ..Default::default() }),
                ("temporal".into(), Schema { reference: Some("#/components/schemas/TemporalView".into()), ..Default::default() }),
                ("recurrence".into(), Schema { reference: Some("#/components/schemas/RecurrenceView".into()), ..Default::default() }),
            ])),
            ..Default::default()
        }),
        ("TemporalView".into(), Schema { kind: Some("object".into()), ..Default::default() }),
        ("RecurrenceView".into(), Schema { kind: Some("object".into()), ..Default::default() }),
    ])),
    ..Default::default()
}),
```

- [ ] **Step 3: Build to verify**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && cargo build -p api 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core
git add crates/v1/api/src/openapi.rs
git commit -m "docs(api): update OpenAPI for /v1/tiles view-model"
```

---

## Task 5: Web hook drops `?? []` fallback and validates shape

**Files:**
- Modify: `tastile-web/src/lib/hooks/use-tile-list.ts`

- [ ] **Step 1: Tighten the response typing and remove the silent fallback**

Replace the body of `useTileList` between `if (res.ok)` and `} else {` with:

```ts
      if (res.ok) {
        const data = res.data;
        if (!data || !Array.isArray(data.tiles)) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: new Error(
              `Unexpected /v1/tiles response shape: missing "tiles" array`,
            ),
          }));
          return;
        }
        setState({
          tiles: data.tiles,
          nextActionableTileId: data.next_actionable_tile_id ?? null,
          nextActionableStartAt: data.next_actionable_start_at ?? null,
          loading: false,
          error: null,
        });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: new Error(res.error.message) }));
      }
```

- [ ] **Step 2: Run web typecheck**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && bun run tsc --noEmit 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 3: Run web vitest for hook coverage**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && bun run test -- src/lib/hooks 2>&1 | tail -20
```
Expected: existing hook tests pass.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web
git add src/lib/hooks/use-tile-list.ts
git commit -m "fix(web): validate /v1/tiles response shape in useTileList"
```

---

## Task 6: Web `TileCardCompact` renders lifecycle-based state, not null-check

**Files:**
- Modify: `tastile-web/src/components/tiles/TileCardCompact.tsx`
- Create: `tastile-web/src/components/tiles/TileCardCompact.test.tsx`

- [ ] **Step 1: Write failing test for lifecycle-based rendering**

Create `tastile-web/src/components/tiles/TileCardCompact.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TileCardCompact } from "./TileCardCompact";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import type { Tile } from "@/lib/domain/tile";

const baseTile: Tile = {
  core: {
    id: "019ef8d5-354a-7bd2-b22a-b4bd372ea0d1",
    title: "study math",
    nextAction: null,
    doneDefinition: null,
    startedAt: null,
    completedAt: null,
  },
  work: { segments: [] },
  temporal: {
    tz: null,
    releaseAt: null,
    dueAt: null,
    fixedStart: new Date("2026-07-07T09:00:00Z"),
    fixedEnd: new Date("2026-07-07T10:00:00Z"),
    activeStart: null,
    activeEnd: null,
  },
  objective: {
    objectiveMode: "finish_once",
    targetWorkMin: 60,
    targetRestMin: null,
    doneRule: "manual",
    recurrence: null,
  },
  interruption: { interruptPenalty: 0, resumePenalty: 0, breakSplitsWork: false, externalInterruptOnly: false },
  automation: { promptOnStart: false, promptOnEnd: false, autoStartAllowed: false, autoEndAllowed: false },
  annotation: { semanticRole: "work", labels: [], timedLabels: [] },
};

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

describe("TileCardCompact", () => {
  it("shows the fixed_start time when the tile has fixed temporal info", () => {
    render(wrap(<TileCardCompact tile={baseTile} />));
    expect(screen.queryByText(/unscheduled/i)).toBeNull();
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  it("falls back to 'unscheduled' when temporal has no fixed or active time", () => {
    const t = {
      ...baseTile,
      temporal: { ...baseTile.temporal, fixedStart: null, fixedEnd: null, activeStart: null, activeEnd: null },
    };
    render(wrap(<TileCardCompact tile={t} />));
    expect(screen.getByText(/unscheduled/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && \
  bun run test -- src/components/tiles/TileCardCompact.test.tsx 2>&1 | tail -20
```
Expected: 2 tests pass (current behavior already handles this case via the existing null-check).

- [ ] **Step 3: Modify `TileCardCompact.tsx` to prefer `lifecycle` over null-check**

The current implementation null-checks temporal. Since the new DTO adds a `lifecycle` field that the `mapListViewToTile` will set, change `TileCardCompact` to consult lifecycle state when `getTileLifecycle(tile)` returns `"ready"` AND temporal is null, render "unscheduled"; otherwise render time. (This is a behavior-preserving refactor — the rendered output is identical for now, but the trigger is explicit.)

Replace the `startAt` resolution block (lines ~30–36) with:

```ts
  const lifecycle = getTileLifecycle(tile);
  const startAt =
    tile.core.startedAt ??
    tile.temporal.fixedStart ??
    tile.temporal.activeStart ??
    tile.temporal.releaseAt ??
    tile.work.segments.find((segment) => segment.startAt)?.startAt ??
    null;
  // Only render "unscheduled" when the lifecycle explicitly says the tile
  // is READY and there is no temporal anchor.  When lifecycle is STARTED
  // or DONE, the absence of temporal is a data error, not "unscheduled".
  const showUnscheduledBadge = lifecycle === "ready" && startAt === null;
  const durationText = resolveDurationText(tile, locale);
  const startText = startAt ? formatFriendlyDateTime(startAt, locale, tile.temporal.tz) : "";
```

Replace the JSX block:
```tsx
        {startAt ? (
          <div className="text-right min-w-[90px] whitespace-nowrap text-[11px] text-foreground-subtle">
            {startText}
          </div>
        ) : (
          <div className="text-right min-w-[90px] text-[11px] text-foreground-lighter italic">
            {t("tiles.unscheduled")}
          </div>
        )}
```
with:
```tsx
        {showUnscheduledBadge ? (
          <div className="text-right min-w-[90px] text-[11px] text-foreground-lighter italic">
            {t("tiles.unscheduled")}
          </div>
        ) : startAt ? (
          <div className="text-right min-w-[90px] whitespace-nowrap text-[11px] text-foreground-subtle">
            {startText}
          </div>
        ) : null}
```

- [ ] **Step 4: Run web tests again**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && \
  bun run test -- src/components/tiles 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 5: Run web typecheck**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && bun run tsc --noEmit 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web
git add src/components/tiles/TileCardCompact.tsx src/components/tiles/TileCardCompact.test.tsx
git commit -m "fix(web): TileCardCompact uses lifecycle for unscheduled badge"
```

---

## Task 7: HARNESS 実装履歴 entry + final smoke

**Files:**
- Modify: `tastile-core/HARNESS.md` (append entry under §5 実装履歴)

- [ ] **Step 1: Append the implementation history entry**

In `tastile-core/HARNESS.md`, find the existing implementation-history list and append:

```markdown
### v1 tile-list view-model (live) — 2026-07-07

- `domain::read::TileListView` + `TemporalView` + `RecurrenceView` + lifecycle/objective/semantic/done-rule constants.
- `api::list_tiles` projects the rich view-model via single SQL with `v1_execution_segment` aggregation.
- `ListTilesQuery` accepts `view_mode`, `lifecycle`, `range`, `granularity`, `search`, `exclude_future`.
- OpenAPI `/v1/tiles` schema updated.
- `tastile-web/src/lib/hooks/use-tile-list.ts` validates response shape (no `?? []` fallback).
- `TileCardCompact` uses lifecycle to decide the unscheduled badge.
- Closes PRODUCTION_READINESS.md §2.2 `/read/tiles → GET /v1/tiles` row.
```

- [ ] **Step 2: Final smoke — full Rust test suite**

Run (WSL):
```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-core && \
  cargo test --workspace 2>&1 | tail -20
```
Expected: no regressions beyond the pre-existing failure list (if any).

- [ ] **Step 3: Final smoke — full web test + typecheck**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-web && \
  bun run tsc --noEmit && bun run test 2>&1 | tail -30
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile/tastile-core
git add HARNESS.md
git commit -m "docs(harness): record v1 tile-list view-model implementation"

cd C:/Users/rebui/Desktop/tastile/tastile-web
git log --oneline -5  # confirm previous web commits landed
```

---

## Rollback plan

If the SQL projection in Task 3 surfaces an unrecoverable schema mismatch, the `list_tiles` handler can be reverted to its previous 11-field `TileSummary` shape with a single `git revert`. The view-model DTOs added in Task 1 stay (they're additive and harmless) but the route's response type falls back to `Vec<TileSummary>`. Web remains on `?? []` fallback temporarily until a follow-up PR can reconcile column names. No data migration is needed — all changes are code-only.