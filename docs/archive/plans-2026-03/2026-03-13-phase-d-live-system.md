# Phase D: Live System — Local HTTP API + CLI + Desktop Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make tastile a running system where the daemon serves a local HTTP API on port 3140, CLI commands hit that API, and the Desktop client (C#) can read/write tiles and execution state.

**Architecture:** Daemon owns all state. Axum HTTP server runs inside the daemon process (not a separate binary). CLI is a thin HTTP client. Desktop client also calls the same API. Shared state via `Arc<Mutex<AppState>>` between tick loop and API handlers.

**Tech Stack:** Rust, axum 0.8, tokio, serde_json, reqwest (CLI side)

---

## Task 1: Shared AppState with Arc<Mutex>

**Files:**
- Create: `crates/tastile-api/src/state.rs`
- Modify: `crates/tastile-api/src/lib.rs`
- Modify: `crates/tastile-api/Cargo.toml`
- Test: `crates/tastile-api/tests/state_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-api/tests/state_test.rs
use tastile_api::SharedState;
use tastile_domain::TileId;
use tastile_domain::tile::Tile;

#[test]
fn shared_state_is_thread_safe() {
    let shared = SharedState::new();
    let id = TileId::new();

    {
        let mut state = shared.lock();
        state.tiles.insert(id, Tile::new(id, "Test".to_string()));
    }

    let state = shared.lock();
    assert!(state.tiles.contains_key(&id));
}
```

**Step 2: Run test — FAIL**

Run: `cargo test -p tastile-api`
Expected: FAIL — SharedState not defined

**Step 3: Write implementation**

```rust
// crates/tastile-api/src/state.rs
use std::sync::{Arc, Mutex, MutexGuard};
use tastile_core::store::AppState;
use tastile_core::handler::CommandHandler;
use tastile_storage::EventStore;

#[derive(Clone)]
pub struct SharedState {
    inner: Arc<Mutex<AppState>>,
    handler: Arc<CommandHandler>,
    event_store: Arc<EventStore>,
}

impl SharedState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(AppState::new())),
            handler: Arc::new(CommandHandler::new()),
            event_store: Arc::new(EventStore::new_in_memory()),
        }
    }

    pub fn with_deps(state: AppState, handler: CommandHandler, event_store: EventStore) -> Self {
        Self {
            inner: Arc::new(Mutex::new(state)),
            handler: Arc::new(handler),
            event_store: Arc::new(event_store),
        }
    }

    pub fn lock(&self) -> MutexGuard<'_, AppState> {
        self.inner.lock().expect("state lock poisoned")
    }

    pub fn handler(&self) -> &CommandHandler {
        &self.handler
    }

    pub fn event_store(&self) -> &EventStore {
        &self.event_store
    }
}
```

```rust
// crates/tastile-api/src/lib.rs
pub mod state;
pub use state::SharedState;
```

Update `Cargo.toml` to add:
```toml
tastile-storage = { workspace = true }
```

**Step 4: Run tests — PASS**

Run: `cargo test -p tastile-api`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/tastile-api/
git commit -m "feat(api): add SharedState with Arc<Mutex> for thread-safe access"
```

---

## Task 2: Axum Router — Command Endpoints

**Files:**
- Create: `crates/tastile-api/src/router.rs`
- Create: `crates/tastile-api/src/handlers/mod.rs`
- Create: `crates/tastile-api/src/handlers/command_handlers.rs`
- Modify: `crates/tastile-api/src/lib.rs`
- Test: `crates/tastile-api/tests/command_api_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-api/tests/command_api_test.rs
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use tastile_api::{SharedState, create_router};
use serde_json::json;

#[tokio::test]
async fn create_tile_returns_201() {
    let state = SharedState::new();
    let app = create_router(state.clone());

    let body = json!({
        "title": "Write tests",
        "next_action": "Open editor"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands/tile/create")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    // Verify tile exists in state
    let s = state.lock();
    assert_eq!(s.tiles.len(), 1);
}

#[tokio::test]
async fn start_tile_returns_200() {
    let state = SharedState::new();
    let app = create_router(state.clone());

    // First create a tile
    let create_body = json!({ "title": "Test tile" });
    let resp = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands/tile/create")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&create_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Get tile_id from state
    let tile_id = {
        let s = state.lock();
        s.tiles.keys().next().unwrap().to_string()
    };

    // Start it
    let start_body = json!({ "tile_id": tile_id });
    let app2 = create_router(state.clone());
    let resp = app2
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands/tile/start")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&start_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn start_nonexistent_tile_returns_422() {
    let state = SharedState::new();
    let app = create_router(state);

    let body = json!({ "tile_id": "00000000-0000-0000-0000-000000000001" });
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands/tile/start")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-api/src/handlers/command_handlers.rs
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use tastile_core::command::*;
use tastile_core::event::EventEnvelope;
use tastile_domain::*;
use crate::SharedState;

#[derive(Deserialize)]
pub struct CreateTileRequest {
    pub title: String,
    pub next_action: Option<String>,
    pub done_definition: Option<String>,
}

#[derive(Deserialize)]
pub struct TileIdRequest {
    pub tile_id: String,
}

#[derive(Deserialize)]
pub struct CompleteTileRequest {
    pub next_tile_id: Option<String>,
}

#[derive(Deserialize)]
pub struct DeferTileRequest {
    pub tile_id: String,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct ExtendPhaseRequest {
    pub delta_min: u32,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub struct MemoRequest {
    pub tile_id: Option<String>,
    pub text: String,
    pub memo_kind: Option<String>,
}

#[derive(Deserialize)]
pub struct StartBreakRequest {
    pub break_min: u32,
    pub reason: Option<String>,
}

#[derive(Serialize)]
pub struct CommandResponse {
    pub ok: bool,
    pub events: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn parse_tile_id(s: &str) -> Result<TileId, StatusCode> {
    let uuid = uuid::Uuid::parse_str(s).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(TileId::from_uuid(uuid))
}

fn make_envelope(command: Command) -> CommandEnvelope {
    CommandEnvelope {
        command_id: CommandId::new(),
        actor: Actor::system(),
        issued_at: chrono::Utc::now(),
        request_id: None,
        command,
    }
}

fn handle_result(
    result: Result<Vec<EventEnvelope>, tastile_core::validate::ValidationError>,
    success_status: StatusCode,
) -> (StatusCode, Json<CommandResponse>) {
    match result {
        Ok(events) => (
            success_status,
            Json(CommandResponse {
                ok: true,
                events: events.iter().map(|e| e.event_id.to_string()).collect(),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(CommandResponse {
                ok: false,
                events: vec![],
                error: Some(e.to_string()),
            }),
        ),
    }
}

pub async fn create_tile(
    State(shared): State<SharedState>,
    Json(req): Json<CreateTileRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let tile_id = TileId::new();
    let envelope = make_envelope(Command::CreateTile(CreateTilePayload {
        tile_id,
        title: req.title,
        next_action: req.next_action,
        done_definition: req.done_definition,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::CREATED)
}

pub async fn start_tile(
    State(shared): State<SharedState>,
    Json(req): Json<TileIdRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let tile_id = match parse_tile_id(&req.tile_id) {
        Ok(id) => id,
        Err(status) => return (status, Json(CommandResponse { ok: false, events: vec![], error: Some("invalid tile_id".into()) })),
    };

    let envelope = make_envelope(Command::StartTile(StartTilePayload {
        tile_id,
        started_at: None,
        source: StartSource::Cli,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn complete_tile(
    State(shared): State<SharedState>,
    Json(req): Json<CompleteTileRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let state_read = shared.lock();
    let active_id = match state_read.execution.active_tile_id {
        Some(id) => id,
        None => return (StatusCode::UNPROCESSABLE_ENTITY, Json(CommandResponse { ok: false, events: vec![], error: Some("no active tile".into()) })),
    };
    drop(state_read);

    let next_tile_id = req.next_tile_id.and_then(|s| parse_tile_id(&s).ok());

    let envelope = make_envelope(Command::CompleteAndStartNext(CompleteAndStartNextPayload {
        tile_id: active_id,
        completed_at: None,
        next_tile_id,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn defer_tile(
    State(shared): State<SharedState>,
    Json(req): Json<DeferTileRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let tile_id = match parse_tile_id(&req.tile_id) {
        Ok(id) => id,
        Err(status) => return (status, Json(CommandResponse { ok: false, events: vec![], error: Some("invalid tile_id".into()) })),
    };

    let envelope = make_envelope(Command::DeferTile(DeferTilePayload {
        tile_id,
        reason: req.reason,
        defer_until: None,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn extend_phase(
    State(shared): State<SharedState>,
    Json(req): Json<ExtendPhaseRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let state_read = shared.lock();
    let active_id = match state_read.execution.active_tile_id {
        Some(id) => id,
        None => return (StatusCode::UNPROCESSABLE_ENTITY, Json(CommandResponse { ok: false, events: vec![], error: Some("no active tile".into()) })),
    };
    drop(state_read);

    let envelope = make_envelope(Command::ExtendPhase(ExtendPhasePayload {
        tile_id: active_id,
        delta_min: req.delta_min,
        reason: req.reason,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn attach_memo(
    State(shared): State<SharedState>,
    Json(req): Json<MemoRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let tile_id = req.tile_id.and_then(|s| parse_tile_id(&s).ok());

    let envelope = make_envelope(Command::AttachMemo(AttachMemoPayload {
        tile_id,
        text: req.text,
        memo_kind: None,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn start_break(
    State(shared): State<SharedState>,
    Json(req): Json<StartBreakRequest>,
) -> (StatusCode, Json<CommandResponse>) {
    let envelope = make_envelope(Command::StartBreak(StartBreakPayload {
        linked_tile_id: None,
        break_min: req.break_min,
        reason: req.reason,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}

pub async fn end_break(
    State(shared): State<SharedState>,
) -> (StatusCode, Json<CommandResponse>) {
    let envelope = make_envelope(Command::EndBreak(EndBreakPayload {
        ended_at: None,
    }));

    let mut state = shared.lock();
    let result = shared.handler().handle(envelope, &mut state);
    handle_result(result, StatusCode::OK)
}
```

```rust
// crates/tastile-api/src/handlers/mod.rs
pub mod command_handlers;
pub use command_handlers::*;
```

```rust
// crates/tastile-api/src/router.rs
use axum::{Router, routing::{get, post}};
use crate::SharedState;
use crate::handlers;

pub fn create_router(state: SharedState) -> Router {
    Router::new()
        // Command endpoints
        .route("/commands/tile/create", post(handlers::create_tile))
        .route("/commands/tile/start", post(handlers::start_tile))
        .route("/commands/tile/complete", post(handlers::complete_tile))
        .route("/commands/tile/defer", post(handlers::defer_tile))
        .route("/commands/tile/extend", post(handlers::extend_phase))
        .route("/commands/memo/attach", post(handlers::attach_memo))
        .route("/commands/break/start", post(handlers::start_break))
        .route("/commands/break/end", post(handlers::end_break))
        // Health
        .route("/health", get(health))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
```

```rust
// crates/tastile-api/src/lib.rs
pub mod state;
pub mod router;
pub mod handlers;

pub use state::SharedState;
pub use router::create_router;
```

Add to `Cargo.toml` under `[dev-dependencies]`:
```toml
tower = { version = "0.5", features = ["util"] }
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-api/
git commit -m "feat(api): add axum command endpoints (create/start/complete/defer/extend/memo/break)"
```

---

## Task 3: Axum Router — Read Endpoints

**Files:**
- Create: `crates/tastile-api/src/handlers/read_handlers.rs`
- Modify: `crates/tastile-api/src/handlers/mod.rs`
- Modify: `crates/tastile-api/src/router.rs`
- Test: `crates/tastile-api/tests/read_api_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-api/tests/read_api_test.rs
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use tastile_api::{SharedState, create_router};
use serde_json::{json, Value};

async fn body_json(resp: axum::http::Response<Body>) -> Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn get_tiles_returns_empty_list() {
    let state = SharedState::new();
    let app = create_router(state);

    let resp = app
        .oneshot(Request::builder().uri("/read/tiles").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tiles"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn get_active_tile_when_idle() {
    let state = SharedState::new();
    let app = create_router(state);

    let resp = app
        .oneshot(Request::builder().uri("/read/active-tile").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json["tile"].is_null());
    assert_eq!(json["phase"], "idle");
}

#[tokio::test]
async fn get_execution_returns_state() {
    let state = SharedState::new();
    let app = create_router(state);

    let resp = app
        .oneshot(Request::builder().uri("/read/execution").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["phase_kind"], "idle");
    assert!(json["active_tile_id"].is_null());
}

#[tokio::test]
async fn health_returns_ok() {
    let state = SharedState::new();
    let app = create_router(state);

    let resp = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-api/src/handlers/read_handlers.rs
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use serde_json::Value;
use crate::SharedState;

#[derive(Serialize)]
pub struct TilesResponse {
    pub tiles: Vec<TileView>,
}

#[derive(Serialize)]
pub struct TileView {
    pub id: String,
    pub title: String,
    pub lifecycle: String,
    pub next_action: Option<String>,
    pub done_definition: Option<String>,
    pub worked_minutes: i64,
    pub semantic_role: String,
}

#[derive(Serialize)]
pub struct ActiveTileResponse {
    pub tile: Option<TileView>,
    pub phase: String,
    pub phase_started_at: Option<String>,
    pub phase_ends_at: Option<String>,
}

#[derive(Serialize)]
pub struct ExecutionResponse {
    pub active_tile_id: Option<String>,
    pub phase_kind: String,
    pub phase_started_at: Option<String>,
    pub phase_ends_at: Option<String>,
    pub pending_prompt_id: Option<String>,
    pub tile_count: usize,
    pub event_count: usize,
}

pub async fn get_tiles(
    State(shared): State<SharedState>,
) -> Json<TilesResponse> {
    let state = shared.lock();
    let tiles: Vec<TileView> = state.tiles.values().map(|t| TileView {
        id: t.core.id.to_string(),
        title: t.core.title.clone(),
        lifecycle: format!("{:?}", t.core.lifecycle()).to_lowercase(),
        next_action: t.core.next_action.clone(),
        done_definition: t.core.done_definition.clone(),
        worked_minutes: t.work.worked_minutes(),
        semantic_role: format!("{:?}", t.annotation.semantic_role).to_lowercase(),
    }).collect();

    Json(TilesResponse { tiles })
}

pub async fn get_active_tile(
    State(shared): State<SharedState>,
) -> Json<ActiveTileResponse> {
    let state = shared.lock();
    let tile = state.execution.active_tile_id
        .and_then(|id| state.tiles.get(&id))
        .map(|t| TileView {
            id: t.core.id.to_string(),
            title: t.core.title.clone(),
            lifecycle: format!("{:?}", t.core.lifecycle()).to_lowercase(),
            next_action: t.core.next_action.clone(),
            done_definition: t.core.done_definition.clone(),
            worked_minutes: t.work.worked_minutes(),
            semantic_role: format!("{:?}", t.annotation.semantic_role).to_lowercase(),
        });

    Json(ActiveTileResponse {
        tile,
        phase: format!("{:?}", state.execution.phase_kind).to_lowercase(),
        phase_started_at: state.execution.phase_started_at.map(|t| t.to_rfc3339()),
        phase_ends_at: state.execution.phase_ends_at.map(|t| t.to_rfc3339()),
    })
}

pub async fn get_execution(
    State(shared): State<SharedState>,
) -> Json<ExecutionResponse> {
    let state = shared.lock();

    Json(ExecutionResponse {
        active_tile_id: state.execution.active_tile_id.map(|id| id.to_string()),
        phase_kind: format!("{:?}", state.execution.phase_kind).to_lowercase(),
        phase_started_at: state.execution.phase_started_at.map(|t| t.to_rfc3339()),
        phase_ends_at: state.execution.phase_ends_at.map(|t| t.to_rfc3339()),
        pending_prompt_id: state.execution.pending_prompt_id.map(|id| id.to_string()),
        tile_count: state.tiles.len(),
        event_count: state.events.len(),
    })
}

pub async fn get_events(
    State(shared): State<SharedState>,
) -> Json<Value> {
    let state = shared.lock();
    let events: Vec<Value> = state.events.iter().map(|e| {
        serde_json::to_value(e).unwrap_or(Value::Null)
    }).collect();
    Json(serde_json::json!({ "events": events, "count": events.len() }))
}
```

Update `handlers/mod.rs`:
```rust
pub mod command_handlers;
pub mod read_handlers;
pub use command_handlers::*;
pub use read_handlers::*;
```

Update `router.rs` to add read routes:
```rust
.route("/read/tiles", get(handlers::get_tiles))
.route("/read/active-tile", get(handlers::get_active_tile))
.route("/read/execution", get(handlers::get_execution))
.route("/debug/events", get(handlers::get_events))
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-api/
git commit -m "feat(api): add read endpoints (tiles/active-tile/execution/events)"
```

---

## Task 4: Embed Axum Server in Daemon

**Files:**
- Modify: `crates/tastile-daemon/src/daemon.rs`
- Modify: `crates/tastile-daemon/src/tick.rs`
- Modify: `crates/tastile-daemon/src/main.rs`
- Modify: `crates/tastile-daemon/Cargo.toml`
- Test: `crates/tastile-daemon/tests/daemon_api_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-daemon/tests/daemon_api_test.rs
use reqwest;
use std::time::Duration;

#[tokio::test]
async fn daemon_serves_health_endpoint() {
    // Start daemon in background
    let handle = tokio::spawn(async {
        let config = tastile_daemon::DaemonConfig::default();
        let mut daemon = tastile_daemon::Daemon::new(config).unwrap();
        daemon.run().await;
    });

    // Give it time to start
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Hit the API
    let resp = reqwest::get("http://127.0.0.1:3140/health").await;
    assert!(resp.is_ok());
    assert_eq!(resp.unwrap().status(), 200);

    handle.abort();
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

The key change: Daemon creates SharedState, passes it to both tick loop and axum server. They run concurrently via `tokio::select!`.

In `daemon.rs`, refactor to:
1. Create `SharedState` from recovered `AppState`
2. Spawn axum server on `127.0.0.1:3140`
3. Tick loop reads/writes through `SharedState`
4. Both run concurrently

In `tick.rs`, change `TickLoop` to accept `SharedState` instead of owning `AppState` directly.

In `main.rs`, make sure `lib.rs` re-exports `DaemonConfig` and `Daemon` for test access.

**Implementation details are complex — implementer should follow the architecture but adapt as needed for borrow checker satisfaction. Key constraint: tick_once() must lock, do work, unlock before next tick.**

**Step 4: Run tests — PASS**

Run: `cargo test -p tastile-daemon -- daemon_api_test`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/tastile-daemon/
git commit -m "feat(daemon): embed axum HTTP server on port 3140"
```

---

## Task 5: Wire CLI to HTTP API

**Files:**
- Modify: `crates/tastile-cli/src/main.rs`
- Create: `crates/tastile-cli/src/api_client.rs`
- Modify: `crates/tastile-cli/src/commands/mod.rs`
- Modify: `crates/tastile-cli/Cargo.toml`

**Step 1: Write the failing test**

No integration test (would need running daemon). Instead, write a unit test for the API client:

```rust
// crates/tastile-cli/tests/api_client_test.rs
// NOTE: This test requires a running daemon on port 3140.
// Mark as #[ignore] for CI, run manually with: cargo test -p tastile-cli -- --ignored

#[tokio::test]
#[ignore]
async fn can_create_and_list_tiles() {
    use tastile_cli::ApiClient;

    let client = ApiClient::new("http://127.0.0.1:3140");
    let result = client.create_tile("Test from CLI", None, None).await;
    assert!(result.is_ok());

    let tiles = client.list_tiles().await;
    assert!(tiles.is_ok());
    assert!(!tiles.unwrap().tiles.is_empty());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-cli/src/api_client.rs
use serde::{Deserialize, Serialize};

pub struct ApiClient {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
pub struct CommandResponse {
    pub ok: bool,
    pub events: Vec<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct TilesResponse {
    pub tiles: Vec<TileView>,
}

#[derive(Deserialize, Debug)]
pub struct TileView {
    pub id: String,
    pub title: String,
    pub lifecycle: String,
    pub next_action: Option<String>,
    pub worked_minutes: i64,
}

#[derive(Deserialize)]
pub struct ActiveTileResponse {
    pub tile: Option<TileView>,
    pub phase: String,
}

#[derive(Deserialize)]
pub struct ExecutionResponse {
    pub active_tile_id: Option<String>,
    pub phase_kind: String,
    pub tile_count: usize,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn health(&self) -> Result<bool, reqwest::Error> {
        let resp = self.client.get(format!("{}/health", self.base_url)).send().await?;
        Ok(resp.status().is_success())
    }

    pub async fn create_tile(&self, title: &str, next_action: Option<&str>, done_definition: Option<&str>) -> Result<CommandResponse, reqwest::Error> {
        let body = serde_json::json!({
            "title": title,
            "next_action": next_action,
            "done_definition": done_definition,
        });
        self.client.post(format!("{}/commands/tile/create", self.base_url))
            .json(&body).send().await?.json().await
    }

    pub async fn start_tile(&self, tile_id: &str) -> Result<CommandResponse, reqwest::Error> {
        let body = serde_json::json!({ "tile_id": tile_id });
        self.client.post(format!("{}/commands/tile/start", self.base_url))
            .json(&body).send().await?.json().await
    }

    pub async fn complete_tile(&self, next_tile_id: Option<&str>) -> Result<CommandResponse, reqwest::Error> {
        let body = serde_json::json!({ "next_tile_id": next_tile_id });
        self.client.post(format!("{}/commands/tile/complete", self.base_url))
            .json(&body).send().await?.json().await
    }

    pub async fn list_tiles(&self) -> Result<TilesResponse, reqwest::Error> {
        self.client.get(format!("{}/read/tiles", self.base_url)).send().await?.json().await
    }

    pub async fn get_active(&self) -> Result<ActiveTileResponse, reqwest::Error> {
        self.client.get(format!("{}/read/active-tile", self.base_url)).send().await?.json().await
    }

    pub async fn get_execution(&self) -> Result<ExecutionResponse, reqwest::Error> {
        self.client.get(format!("{}/read/execution", self.base_url)).send().await?.json().await
    }

    pub async fn start_break(&self, break_min: u32) -> Result<CommandResponse, reqwest::Error> {
        let body = serde_json::json!({ "break_min": break_min });
        self.client.post(format!("{}/commands/break/start", self.base_url))
            .json(&body).send().await?.json().await
    }

    pub async fn end_break(&self) -> Result<CommandResponse, reqwest::Error> {
        self.client.post(format!("{}/commands/break/end", self.base_url))
            .send().await?.json().await
    }
}
```

Then update `main.rs` to use `ApiClient` instead of println:

```rust
// In main.rs match arms, replace println with API calls:
TileCommands::Create { title } => {
    let client = ApiClient::new("http://127.0.0.1:3140");
    match client.create_tile(&title, None, None).await {
        Ok(resp) if resp.ok => println!("✅ Tile created"),
        Ok(resp) => eprintln!("❌ {}", resp.error.unwrap_or_default()),
        Err(e) => eprintln!("❌ Failed to connect to daemon: {}", e),
    }
}
// ... similar for all other commands
```

**Step 4: Verify** (manual — start daemon, then run CLI commands)

**Step 5: Commit**

```bash
git add crates/tastile-cli/
git commit -m "feat(cli): wire all commands to daemon HTTP API"
```

---

## Task 6: Event Persistence in Command Pipeline

**Files:**
- Modify: `crates/tastile-api/src/handlers/command_handlers.rs`
- Test: `crates/tastile-api/tests/persistence_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-api/tests/persistence_test.rs
use tastile_api::SharedState;
use tastile_storage::{ConnectionPool, migrate, EventStore};
use tastile_core::store::AppState;
use tastile_core::handler::CommandHandler;

#[test]
fn events_are_persisted_to_sqlite() {
    let pool = ConnectionPool::new_in_memory().unwrap();
    migrate(&pool).unwrap();
    let event_store = EventStore::new(pool);

    let shared = SharedState::with_deps(
        AppState::new(),
        CommandHandler::new(),
        event_store.clone(),
    );

    // Create tile via handler
    use tastile_core::command::*;
    use tastile_domain::*;
    let envelope = CommandEnvelope {
        command_id: CommandId::new(),
        actor: Actor::system(),
        issued_at: chrono::Utc::now(),
        request_id: None,
        command: Command::CreateTile(CreateTilePayload {
            tile_id: TileId::new(),
            title: "Persistent".to_string(),
            next_action: None,
            done_definition: None,
        }),
    };

    {
        let mut state = shared.lock();
        let events = shared.handler().handle(envelope, &mut state).unwrap();
        // Persist events
        for evt in &events {
            shared.event_store().append(evt).unwrap();
        }
    }

    // Verify events in DB
    let stored = event_store.get_all().unwrap();
    assert_eq!(stored.len(), 1);
}
```

**Step 2: Run test — FAIL** (EventStore::new_in_memory and append may need to be added)

**Step 3: Write implementation**

Add `EventStore::new_in_memory()` to tastile-storage if not present.

Update `command_handlers.rs` — after successful `handler.handle()`, persist each event via `shared.event_store().append(evt)`. Log errors but don't fail the request (local state already updated).

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-api/ crates/tastile-storage/
git commit -m "feat(api): persist events to SQLite after command execution"
```

---

## Task 7: End-to-End Smoke Test

**Files:**
- Create: `crates/tastile-api/tests/e2e_test.rs`

**Step 1: Write the test**

```rust
// crates/tastile-api/tests/e2e_test.rs
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use tastile_api::{SharedState, create_router};
use serde_json::{json, Value};

async fn post_json(app: &axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let resp = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    (status, json)
}

async fn get_json(app: &axum::Router, uri: &str) -> Value {
    let resp = app.clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn full_execution_flow() {
    let state = SharedState::new();
    let app = create_router(state.clone());

    // 1. Create tile
    let (status, resp) = post_json(&app, "/commands/tile/create", json!({
        "title": "Write Phase D plan",
        "next_action": "Open docs",
        "done_definition": "Plan reviewed and saved"
    })).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(resp["ok"].as_bool().unwrap());

    // 2. Get tiles — should have 1
    let tiles = get_json(&app, "/read/tiles").await;
    assert_eq!(tiles["tiles"].as_array().unwrap().len(), 1);
    let tile_id = tiles["tiles"][0]["id"].as_str().unwrap().to_string();

    // 3. Start tile
    let (status, _) = post_json(&app, "/commands/tile/start", json!({
        "tile_id": tile_id
    })).await;
    assert_eq!(status, StatusCode::OK);

    // 4. Check active tile
    let active = get_json(&app, "/read/active-tile").await;
    assert_eq!(active["phase"], "work");
    assert_eq!(active["tile"]["title"], "Write Phase D plan");

    // 5. Complete tile
    let (status, _) = post_json(&app, "/commands/tile/complete", json!({})).await;
    assert_eq!(status, StatusCode::OK);

    // 6. Verify idle
    let exec = get_json(&app, "/read/execution").await;
    assert_eq!(exec["phase_kind"], "idle");
    assert!(exec["active_tile_id"].is_null());

    // 7. Verify tile is done
    let tiles = get_json(&app, "/read/tiles").await;
    assert_eq!(tiles["tiles"][0]["lifecycle"], "done");
}

#[tokio::test]
async fn break_flow() {
    let state = SharedState::new();
    let app = create_router(state);

    // Start break
    let (status, _) = post_json(&app, "/commands/break/start", json!({
        "break_min": 5
    })).await;
    assert_eq!(status, StatusCode::OK);

    // Verify break phase
    let exec = get_json(&app, "/read/execution").await;
    assert_eq!(exec["phase_kind"], "break");

    // End break
    let (status, _) = post_json(&app, "/commands/break/end", json!({})).await;
    assert_eq!(status, StatusCode::OK);

    // Verify idle
    let exec = get_json(&app, "/read/execution").await;
    assert_eq!(exec["phase_kind"], "idle");
}
```

**Step 2: Run tests — should PASS if Tasks 1-3 are correct**

**Step 3: Fix any issues found**

**Step 4: Commit**

```bash
git add crates/tastile-api/
git commit -m "test(api): add e2e smoke tests for full tile + break flows"
```

---

## Summary

| Task | What | Crate |
|------|------|-------|
| 1 | SharedState (Arc<Mutex>) | tastile-api |
| 2 | Command endpoints (axum POST handlers) | tastile-api |
| 3 | Read endpoints (axum GET handlers) | tastile-api |
| 4 | Embed HTTP server in daemon (port 3140) | tastile-daemon |
| 5 | Wire CLI to HTTP API (reqwest client) | tastile-cli |
| 6 | Event persistence in command pipeline | tastile-api + tastile-storage |
| 7 | E2E smoke test (create → start → complete) | tastile-api |

**Phase D exit criteria met when:**
- `cargo run --bin tastile-daemon` starts and serves HTTP on 3140
- `cargo run --bin tastile-cli -- tile create "Test"` creates a real tile
- `cargo run --bin tastile-cli -- tile list` shows the tile
- `cargo run --bin tastile-cli -- tile start <id>` starts it
- `cargo run --bin tastile-cli -- tile complete` completes it
- Desktop C# client at `http://localhost:3140/read/active-tile` gets JSON
- All events persisted to SQLite and survive daemon restart
- E2E test passes
