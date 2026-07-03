# Phase C: Persistence + Sync Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SQLite persistence, event sourcing, recovery logic, and Supabase sync foundation. The system must survive crashes and restart to the exact same state.

**Architecture:** Event Sourcing + Snapshot pattern. Events are the source of truth. Snapshots for fast recovery.

**Tech Stack:** Rust, rusqlite, serde_json, chrono, reqwest (for sync foundation)

---

## Task 1: SQLite Schema and Migration System

**Files:**
- Create: `crates/tastile-storage/src/schema.sql`
- Create: `crates/tastile-storage/src/migration.rs`
- Create: `crates/tastile-storage/src/connection.rs`
- Modify: `crates/tastile-storage/src/lib.rs`
- Test: `crates/tastile-storage/tests/migration_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-storage/tests/migration_test.rs
use tastile_storage::{ConnectionPool, migrate};
use tempfile::TempDir;

#[test]
fn migration_creates_tables() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    
    migrate(&pool).unwrap();
    
    // Verify tables exist
    let conn = pool.get().unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    
    assert!(tables.contains(&"events".to_string()));
    assert!(tables.contains(&"snapshots".to_string()));
    assert!(tables.contains(&"sync_metadata".to_string()));
}

#[test]
fn migration_is_idempotent() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    
    // Run twice
    migrate(&pool).unwrap();
    migrate(&pool).unwrap();
    
    // Should not fail
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p tastile-storage`
Expected: FAIL — types not defined

**Step 3: Write implementation**

```rust
// crates/tastile-storage/src/schema.sql
-- Event Store (Source of Truth)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    caused_by_command_id TEXT,
    sequence_number INTEGER UNIQUE NOT NULL,
    synced_at TEXT,
    
    INDEX idx_aggregate (aggregate_id),
    INDEX idx_sequence (sequence_number),
    INDEX idx_synced (synced_at)
);

-- State Snapshots (for fast recovery)
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT UNIQUE NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    state_json TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    
    INDEX idx_aggregate (aggregate_id),
    INDEX idx_sequence (sequence_number)
);

-- Sync Metadata (last sync, conflict tracking)
CREATE TABLE IF NOT EXISTS sync_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync_at TEXT,
    last_sequence_number INTEGER,
    device_id TEXT NOT NULL,
    sync_version INTEGER NOT NULL DEFAULT 1
);

-- Initial metadata record
INSERT OR IGNORE INTO sync_metadata (id, device_id) VALUES (1, 'local');
```

```rust
// crates/tastile-storage/src/connection.rs
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct ConnectionPool {
    conn: Arc<Mutex<Connection>>,
}

impl ConnectionPool {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
    
    pub fn get(&self) -> Result<std::sync::MutexGuard<Connection>, rusqlite::Error> {
        self.conn.lock().map_err(|_| {
            rusqlite::Error::InvalidPath(std::path::PathBuf::from("mutex poisoned"))
        })
    }
}
```

```rust
// crates/tastile-storage/src/migration.rs
use crate::ConnectionPool;

const SCHEMA_SQL: &str = include_str!("schema.sql");

pub fn migrate(pool: &ConnectionPool) -> Result<(), rusqlite::Error> {
    let conn = pool.get()?;
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}
```

```rust
// crates/tastile-storage/src/lib.rs
pub mod connection;
pub mod migration;

pub use connection::ConnectionPool;
pub use migration::migrate;
```

**Step 4: Run tests**

Run: `cargo test -p tastile-storage`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/tastile-storage/
git commit -m "feat(storage): add SQLite schema and migration system"
```

---

## Task 2: Event Store Repository

**Files:**
- Create: `crates/tastile-storage/src/event_store.rs`
- Modify: `crates/tastile-storage/src/lib.rs`
- Test: `crates/tastile-storage/tests/event_store_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-storage/tests/event_store_test.rs
use tastile_core::event::{EventEnvelope, Event, TileCreatedPayload};
use tastile_domain::*;
use tastile_domain::tile::Tile;
use tastile_storage::{ConnectionPool, migrate, EventStore};
use tempfile::TempDir;

#[test]
fn can_append_and_read_events() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let store = EventStore::new(pool);
    
    // Append event
    let envelope = EventEnvelope {
        event_id: EventId::new(),
        aggregate_id: "tile:test".to_string(),
        occurred_at: chrono::Utc::now(),
        actor: Actor::system(),
        caused_by_command_id: None,
        request_id: None,
        event: Event::TileCreated(TileCreatedPayload {
            tile: Tile::new(TileId::new(), "Test".to_string()),
        }),
    };
    
    store.append(&envelope).unwrap();
    
    // Read back
    let events = store.get_by_aggregate("tile:test").unwrap();
    assert_eq!(events.len(), 1);
}

#[test]
fn events_have_sequence_numbers() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let store = EventStore::new(pool);
    
    // Append two events
    for i in 0..2 {
        let envelope = EventEnvelope {
            event_id: EventId::new(),
            aggregate_id: "tile:test".to_string(),
            occurred_at: chrono::Utc::now(),
            actor: Actor::system(),
            caused_by_command_id: None,
            request_id: None,
            event: Event::TileCreated(TileCreatedPayload {
                tile: Tile::new(TileId::new(), format!("Test {}", i)),
            }),
        };
        store.append(&envelope).unwrap();
    }
    
    let events = store.get_by_aggregate("tile:test").unwrap();
    assert_eq!(events[0].sequence_number, 1);
    assert_eq!(events[1].sequence_number, 2);
}

#[test]
fn get_all_events_returns_in_order() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let store = EventStore::new(pool);
    
    // Append events to different aggregates
    for i in 0..3 {
        let envelope = EventEnvelope {
            event_id: EventId::new(),
            aggregate_id: format!("tile:{}", i),
            occurred_at: chrono::Utc::now(),
            actor: Actor::system(),
            caused_by_command_id: None,
            request_id: None,
            event: Event::TileCreated(TileCreatedPayload {
                tile: Tile::new(TileId::new(), format!("Test {}", i)),
            }),
        };
        store.append(&envelope).unwrap();
    }
    
    let events = store.get_all_since(0).unwrap();
    assert_eq!(events.len(), 3);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-storage/src/event_store.rs
use crate::ConnectionPool;
use tastile_core::event::EventEnvelope;
use rusqlite::{params, OptionalExtension};
use serde_json;

pub struct EventStore {
    pool: ConnectionPool,
}

#[derive(Debug, Clone)]
pub struct StoredEvent {
    pub event_id: String,
    pub aggregate_id: String,
    pub event_type: String,
    pub payload_json: String,
    pub occurred_at: String,
    pub actor_type: String,
    pub actor_id: String,
    pub caused_by_command_id: Option<String>,
    pub sequence_number: i64,
}

impl EventStore {
    pub fn new(pool: ConnectionPool) -> Self {
        Self { pool }
    }
    
    pub fn append(&self, envelope: &EventEnvelope) -> Result<i64, rusqlite::Error> {
        let conn = self.pool.get()?;
        
        // Get next sequence number
        let next_seq: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM events",
                [],
                |row| row.get(0),
            )?;
        
        let event_type = match &envelope.event {
            tastile_core::event::Event::TileCreated(_) => "tile_created",
            tastile_core::event::Event::TileStarted(_) => "tile_started",
            tastile_core::event::Event::TileCompleted(_) => "tile_completed",
            // ... add others as needed
            _ => "unknown",
        };
        
        let payload_json = serde_json::to_string(&envelope.event).unwrap();
        
        conn.execute(
            "INSERT INTO events (
                event_id, aggregate_id, event_type, payload_json, 
                occurred_at, actor_type, actor_id, caused_by_command_id, sequence_number
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                envelope.event_id.to_string(),
                envelope.aggregate_id,
                event_type,
                payload_json,
                envelope.occurred_at.to_rfc3339(),
                format!("{:?}", envelope.actor.actor_type),
                envelope.actor.actor_id.to_string(),
                envelope.caused_by_command_id.map(|id| id.to_string()),
                next_seq,
            ],
        )?;
        
        Ok(next_seq)
    }
    
    pub fn get_by_aggregate(&self, aggregate_id: &str) -> Result<Vec<StoredEvent>, rusqlite::Error> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT event_id, aggregate_id, event_type, payload_json, 
                    occurred_at, actor_type, actor_id, caused_by_command_id, sequence_number
             FROM events 
             WHERE aggregate_id = ?1 
             ORDER BY sequence_number ASC"
        )?;
        
        let events = stmt.query_map([aggregate_id], |row| {
            Ok(StoredEvent {
                event_id: row.get(0)?,
                aggregate_id: row.get(1)?,
                event_type: row.get(2)?,
                payload_json: row.get(3)?,
                occurred_at: row.get(4)?,
                actor_type: row.get(5)?,
                actor_id: row.get(6)?,
                caused_by_command_id: row.get(7)?,
                sequence_number: row.get(8)?,
            })
        })?;
        
        events.collect::<Result<Vec<_>, _>>()
    }
    
    pub fn get_all_since(&self, sequence_number: i64) -> Result<Vec<StoredEvent>, rusqlite::Error> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT event_id, aggregate_id, event_type, payload_json, 
                    occurred_at, actor_type, actor_id, caused_by_command_id, sequence_number
             FROM events 
             WHERE sequence_number > ?1
             ORDER BY sequence_number ASC"
        )?;
        
        let events = stmt.query_map([sequence_number], |row| {
            Ok(StoredEvent {
                event_id: row.get(0)?,
                aggregate_id: row.get(1)?,
                event_type: row.get(2)?,
                payload_json: row.get(3)?,
                occurred_at: row.get(4)?,
                actor_type: row.get(5)?,
                actor_id: row.get(6)?,
                caused_by_command_id: row.get(7)?,
                sequence_number: row.get(8)?,
            })
        })?;
        
        events.collect::<Result<Vec<_>, _>>()
    }
    
    pub fn get_max_sequence(&self) -> Result<i64, rusqlite::Error> {
        let conn = self.pool.get()?;
        conn.query_row(
            "SELECT COALESCE(MAX(sequence_number), 0) FROM events",
            [],
            |row| row.get(0),
        )
    }
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-storage/
git commit -m "feat(storage): add EventStore repository"
```

---

## Task 3: State Snapshot Repository

**Files:**
- Create: `crates/tastile-storage/src/snapshot_store.rs`
- Modify: `crates/tastile-storage/src/lib.rs`
- Test: `crates/tastile-storage/tests/snapshot_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-storage/tests/snapshot_test.rs
use tastile_storage::{ConnectionPool, migrate, SnapshotStore};
use tempfile::TempDir;

#[test]
fn can_save_and_load_snapshot() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let store = SnapshotStore::new(pool);
    
    // Save snapshot
    store.save(
        "tile:test",
        "TileAggregate",
        r#"{"id": "test", "title": "Test Tile"}"#,
        42,
    ).unwrap();
    
    // Load snapshot
    let snapshot = store.load("tile:test").unwrap().unwrap();
    assert_eq!(snapshot.aggregate_type, "TileAggregate");
    assert_eq!(snapshot.sequence_number, 42);
    assert_eq!(snapshot.state_json, r#"{"id": "test", "title": "Test Tile"}"#);
}

#[test]
fn load_returns_none_for_missing_snapshot() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let store = SnapshotStore::new(pool);
    
    let snapshot = store.load("tile:nonexistent").unwrap();
    assert!(snapshot.is_none());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-storage/src/snapshot_store.rs
use crate::ConnectionPool;
use rusqlite::params;
use uuid::Uuid;

pub struct SnapshotStore {
    pool: ConnectionPool,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub snapshot_id: String,
    pub aggregate_id: String,
    pub aggregate_type: String,
    pub state_json: String,
    pub sequence_number: i64,
    pub created_at: String,
}

impl SnapshotStore {
    pub fn new(pool: ConnectionPool) -> Self {
        Self { pool }
    }
    
    pub fn save(
        &self,
        aggregate_id: &str,
        aggregate_type: &str,
        state_json: &str,
        sequence_number: i64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.pool.get()?;
        
        conn.execute(
            "INSERT INTO snapshots (
                snapshot_id, aggregate_id, aggregate_type, state_json, sequence_number, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(aggregate_id) DO UPDATE SET
                state_json = excluded.state_json,
                sequence_number = excluded.sequence_number,
                created_at = excluded.created_at",
            params![
                Uuid::new_v4().to_string(),
                aggregate_id,
                aggregate_type,
                state_json,
                sequence_number,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        
        Ok(())
    }
    
    pub fn load(&self, aggregate_id: &str) -> Result<Option<Snapshot>, rusqlite::Error> {
        let conn = self.pool.get()?;
        
        conn.query_row(
            "SELECT snapshot_id, aggregate_id, aggregate_type, state_json, sequence_number, created_at
             FROM snapshots 
             WHERE aggregate_id = ?1",
            [aggregate_id],
            |row| {
                Ok(Snapshot {
                    snapshot_id: row.get(0)?,
                    aggregate_id: row.get(1)?,
                    aggregate_type: row.get(2)?,
                    state_json: row.get(3)?,
                    sequence_number: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        ).optional()
    }
    
    pub fn delete_older_than(&self, days: i64) -> Result<usize, rusqlite::Error> {
        let conn = self.pool.get()?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
        
        let deleted = conn.execute(
            "DELETE FROM snapshots WHERE created_at < ?1",
            [cutoff.to_rfc3339()],
        )?;
        
        Ok(deleted)
    }
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-storage/
git commit -m "feat(storage): add SnapshotStore for fast recovery"
```

---

## Task 4: Recovery Logic

**Files:**
- Create: `crates/tastile-storage/src/recovery.rs`
- Modify: `crates/tastile-storage/src/lib.rs`
- Test: `crates/tastile-storage/tests/recovery_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-storage/tests/recovery_test.rs
use tastile_core::event::{EventEnvelope, Event, TileCreatedPayload, TileStartedPayload};
use tastile_core::command::StartSource;
use tastile_core::reducer::reduce;
use tastile_core::store::AppState;
use tastile_domain::*;
use tastile_domain::tile::Tile;
use tastile_storage::{ConnectionPool, migrate, EventStore, SnapshotStore, Recovery};
use tempfile::TempDir;

#[test]
fn recover_from_events_reproduces_state() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let event_store = EventStore::new(pool.clone());
    let recovery = Recovery::new(event_store);
    
    let tile_id = TileId::new();
    let now = chrono::Utc::now();
    
    // Create and store events
    let events = vec![
        EventEnvelope {
            event_id: EventId::new(),
            aggregate_id: format!("tile:{}", tile_id),
            occurred_at: now,
            actor: Actor::system(),
            caused_by_command_id: None,
            request_id: None,
            event: Event::TileCreated(TileCreatedPayload {
                tile: Tile::new(tile_id, "Test".to_string()),
            }),
        },
        EventEnvelope {
            event_id: EventId::new(),
            aggregate_id: format!("tile:{}", tile_id),
            occurred_at: now,
            actor: Actor::system(),
            caused_by_command_id: None,
            request_id: None,
            event: Event::TileStarted(TileStartedPayload {
                tile_id,
                started_at: now,
                source: StartSource::Cli,
            }),
        },
    ];
    
    // Store events
    for e in &events {
        recovery.event_store().append(e).unwrap();
    }
    
    // Recover state
    let mut state = AppState::new();
    recovery.replay_all(&mut state).unwrap();
    
    // Verify
    assert!(state.tiles.contains_key(&tile_id));
    assert!(state.tiles[&tile_id].core.started_at.is_some());
}

#[test]
fn recover_from_snapshot_plus_events() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    let pool = ConnectionPool::new(&db_path).unwrap();
    migrate(&pool).unwrap();
    
    let event_store = EventStore::new(pool.clone());
    let snapshot_store = SnapshotStore::new(pool.clone());
    let recovery = Recovery::new_with_snapshot(event_store, snapshot_store);
    
    let tile_id = TileId::new();
    
    // Save snapshot at sequence 5
    recovery.snapshot_store().save(
        &format!("tile:{}", tile_id),
        "Tile",
        &format!(r#"{{"id":"{}","title":"Test","started_at":null,"completed_at":null}}"#, tile_id),
        5,
    ).unwrap();
    
    // Add event after snapshot (sequence 6+)
    let now = chrono::Utc::now();
    let event = EventEnvelope {
        event_id: EventId::new(),
        aggregate_id: format!("tile:{}", tile_id),
        occurred_at: now,
        actor: Actor::system(),
        caused_by_command_id: None,
        request_id: None,
        event: Event::TileStarted(TileStartedPayload {
            tile_id,
            started_at: now,
            source: StartSource::Cli,
        }),
    };
    recovery.event_store().append(&event).unwrap();
    
    // Recover should start from snapshot
    let mut state = AppState::new();
    recovery.replay_all(&mut state).unwrap();
    
    assert!(state.tiles.contains_key(&tile_id));
    assert!(state.tiles[&tile_id].core.started_at.is_some());
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-storage/src/recovery.rs
use crate::{EventStore, SnapshotStore};
use tastile_core::store::AppState;
use tastile_core::reducer::reduce;
use serde_json;

pub struct Recovery {
    event_store: EventStore,
    snapshot_store: Option<SnapshotStore>,
}

impl Recovery {
    pub fn new(event_store: EventStore) -> Self {
        Self {
            event_store,
            snapshot_store: None,
        }
    }
    
    pub fn new_with_snapshot(event_store: EventStore, snapshot_store: SnapshotStore) -> Self {
        Self {
            event_store,
            snapshot_store: Some(snapshot_store),
        }
    }
    
    pub fn event_store(&self) -> &EventStore {
        &self.event_store
    }
    
    pub fn snapshot_store(&self) -> &SnapshotStore {
        self.snapshot_store.as_ref().unwrap()
    }
    
    /// Replay all events to recover state
    pub fn replay_all(&self, state: &mut AppState) -> Result<(), RecoveryError> {
        let events = self.event_store.get_all_since(0)?;
        
        for stored in events {
            let event = self.deserialize_event(&stored)?;
            reduce(state, &event);
        }
        
        Ok(())
    }
    
    /// Recover specific aggregate from snapshot + events
    pub fn replay_aggregate(&self, aggregate_id: &str, state: &mut AppState) -> Result<(), RecoveryError> {
        let start_seq = if let Some(ref snapshot_store) = self.snapshot_store {
            if let Some(snapshot) = snapshot_store.load(aggregate_id)? {
                // Deserialize and apply snapshot
                // For now, replay events instead
                snapshot.sequence_number
            } else {
                0
            }
        } else {
            0
        };
        
        let events = self.event_store.get_all_since(start_seq)?;
        
        for stored in events {
            if stored.aggregate_id == aggregate_id {
                let event = self.deserialize_event(&stored)?;
                reduce(state, &event);
            }
        }
        
        Ok(())
    }
    
    fn deserialize_event(&self, stored: &crate::event_store::StoredEvent) -> Result<tastile_core::event::Event, RecoveryError> {
        // For now, simple JSON deserialization
        // In production, use event_type to determine variant
        serde_json::from_str(&stored.payload_json)
            .map_err(|e| RecoveryError::DeserializeError(e.to_string()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RecoveryError {
    #[error("database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
    #[error("deserialize error: {0}")]
    DeserializeError(String),
}
```

Update `lib.rs` to export.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-storage/
git commit -m "feat(storage): add recovery logic with event replay"
```

---

## Task 5: Supabase Schema (RLS)

**Files:**
- Create: `tastile-web/supabase/migrations/20260313000001_initial_schema.sql`
- Create: `tastile-web/supabase/seed.sql`
- Create: `docs/supabase-schema.md`

**Step 1: Write the schema**

```sql
-- tastile-web/supabase/migrations/20260313000001_initial_schema.sql

-- Enable RLS
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Users table (extends auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

-- Tiles table (cloud authority)
CREATE TABLE public.tiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    local_tile_id TEXT NOT NULL, -- maps to TileId in local system
    
    -- Core data
    title TEXT NOT NULL,
    next_action TEXT,
    done_definition TEXT,
    
    -- Condition vectors (JSON for flexibility)
    temporal_conditions JSONB DEFAULT '{}',
    objective_conditions JSONB DEFAULT '{}',
    interruption_conditions JSONB DEFAULT '{}',
    automation_conditions JSONB DEFAULT '{}',
    annotation_conditions JSONB DEFAULT '{}',
    
    -- Soft delete
    deleted_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Local sync tracking
    local_created_at TIMESTAMPTZ,
    local_updated_at TIMESTAMPTZ,
    
    UNIQUE(user_id, local_tile_id)
);

-- Enable RLS on tiles
ALTER TABLE public.tiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own tiles" 
    ON public.tiles 
    FOR ALL 
    USING (auth.uid() = user_id);

-- Events table (for sync)
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Event data
    event_id TEXT NOT NULL, -- local EventId
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    caused_by_command_id TEXT,
    sequence_number BIGINT NOT NULL,
    
    -- Sync tracking
    synced_at TIMESTAMPTZ,
    device_id TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, event_id)
) PARTITION BY RANGE (occurred_at);

-- Create monthly partitions for events
CREATE TABLE public.events_2026_03 PARTITION OF public.events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Enable RLS on events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own events" 
    ON public.events 
    FOR ALL 
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_tiles_user ON public.tiles(user_id);
CREATE INDEX idx_tiles_user_local_id ON public.tiles(user_id, local_tile_id);
CREATE INDEX idx_tiles_updated ON public.tiles(user_id, updated_at);

CREATE INDEX idx_events_user_sequence ON public.events(user_id, sequence_number);
CREATE INDEX idx_events_user_aggregate ON public.events(user_id, aggregate_id);
CREATE INDEX idx_events_user_occurred ON public.events(user_id, occurred_at);

-- Settings table
CREATE TABLE public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own settings" 
    ON public.user_settings 
    FOR ALL 
    USING (auth.uid() = user_id);

-- Function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
CREATE TRIGGER update_tiles_updated_at 
    BEFORE UPDATE ON public.tiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON public.profiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

**Step 2: Create documentation**

```markdown
<!-- docs/supabase-schema.md -->
# Supabase Schema

## Tables

### profiles
Extends auth.users with app-specific profile data.

### tiles
Cloud authority for tile definitions. Local-first execution state is NOT stored here.

### events
Event sourcing for sync. Partitioned by month for performance.

### user_settings
User preferences and configuration.

## RLS Policies
All tables have RLS enabled. Users can only access their own data.

## Sync Model
- Tiles: Cloud authority, local cache
- Events: Append-only, ordered by sequence_number
- Settings: Last-write-wins
```

**Step 3: Commit**

```bash
git add tastile-web/supabase/
git add docs/supabase-schema.md
git commit -m "feat(supabase): add initial schema with RLS"
```

---

## Task 6: Sync Module Foundation

**Files:**
- Create: `crates/tastile-sync/src/client.rs`
- Create: `crates/tastile-sync/src/sync_engine.rs`
- Create: `crates/tastile-sync/src/offline_queue.rs`
- Modify: `crates/tastile-sync/src/lib.rs`
- Test: `crates/tastile-sync/tests/sync_test.rs`

**Step 1: Write the failing test**

```rust
// crates/tastile-sync/tests/sync_test.rs
use tastile_sync::{SyncConfig, SyncEngine, SyncStatus};

#[test]
fn sync_engine_starts_offline() {
    let config = SyncConfig {
        supabase_url: "http://localhost:54321".to_string(),
        anon_key: "test-key".to_string(),
    };
    
    let engine = SyncEngine::new(config);
    assert_eq!(engine.status(), SyncStatus::Offline);
}

#[test]
fn offline_queue_buffers_operations() {
    let config = SyncConfig {
        supabase_url: "http://localhost:54321".to_string(),
        anon_key: "test-key".to_string(),
    };
    
    let mut engine = SyncEngine::new(config);
    
    // Queue operation while offline
    engine.queue_tile_create("tile-1", r#"{"title": "Test"}"#);
    
    assert_eq!(engine.pending_count(), 1);
}
```

**Step 2: Run test — FAIL**

**Step 3: Write implementation**

```rust
// crates/tastile-sync/src/client.rs
use reqwest::{Client, header::HeaderMap};

pub struct SupabaseClient {
    client: Client,
    base_url: String,
    anon_key: String,
}

impl SupabaseClient {
    pub fn new(base_url: String, anon_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            anon_key,
        }
    }
    
    fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("apikey", self.anon_key.parse().unwrap());
        headers.insert("Content-Type", "application/json".parse().unwrap());
        headers
    }
    
    pub async fn health_check(&self) -> Result<bool, reqwest::Error> {
        let url = format!("{}/health", self.base_url);
        match self.client.get(&url).send().await {
            Ok(response) => Ok(response.status().is_success()),
            Err(_) => Ok(false),
        }
    }
}
```

```rust
// crates/tastile-sync/src/offline_queue.rs
use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub enum SyncOperation {
    TileCreate { local_id: String, payload: String },
    TileUpdate { local_id: String, payload: String },
    TileDelete { local_id: String },
    EventPush { event_id: String, payload: String },
}

pub struct OfflineQueue {
    queue: VecDeque<SyncOperation>,
}

impl OfflineQueue {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
        }
    }
    
    pub fn push(&mut self, op: SyncOperation) {
        self.queue.push_back(op);
    }
    
    pub fn pop(&mut self) -> Option<SyncOperation> {
        self.queue.pop_front()
    }
    
    pub fn len(&self) -> usize {
        self.queue.len()
    }
    
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
    
    pub fn clear(&mut self) {
        self.queue.clear();
    }
}
```

```rust
// crates/tastile-sync/src/sync_engine.rs
use crate::{SupabaseClient, OfflineQueue, SyncOperation};

pub struct SyncConfig {
    pub supabase_url: String,
    pub anon_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SyncStatus {
    Offline,
    Connecting,
    Online,
    Syncing,
    Error,
}

pub struct SyncEngine {
    config: SyncConfig,
    status: SyncStatus,
    queue: OfflineQueue,
    client: Option<SupabaseClient>,
}

impl SyncEngine {
    pub fn new(config: SyncConfig) -> Self {
        Self {
            config,
            status: SyncStatus::Offline,
            queue: OfflineQueue::new(),
            client: None,
        }
    }
    
    pub fn status(&self) -> SyncStatus {
        self.status
    }
    
    pub fn pending_count(&self) -> usize {
        self.queue.len()
    }
    
    pub fn queue_tile_create(&mut self, local_id: &str, payload: &str) {
        self.queue.push(SyncOperation::TileCreate {
            local_id: local_id.to_string(),
            payload: payload.to_string(),
        });
    }
    
    pub async fn connect(&mut self) -> Result<(), SyncError> {
        self.status = SyncStatus::Connecting;
        
        let client = SupabaseClient::new(
            self.config.supabase_url.clone(),
            self.config.anon_key.clone(),
        );
        
        if client.health_check().await? {
            self.status = SyncStatus::Online;
            self.client = Some(client);
            Ok(())
        } else {
            self.status = SyncStatus::Offline;
            Err(SyncError::ConnectionFailed)
        }
    }
    
    pub async fn sync(&mut self) -> Result<SyncResult, SyncError> {
        if self.client.is_none() {
            return Err(SyncError::NotConnected);
        }
        
        self.status = SyncStatus::Syncing;
        
        // Process offline queue
        let mut synced = 0;
        let mut failed = 0;
        
        while let Some(op) = self.queue.pop() {
            match self.process_operation(op).await {
                Ok(_) => synced += 1,
                Err(_) => failed += 1,
            }
        }
        
        self.status = if failed > 0 {
            SyncStatus::Error
        } else {
            SyncStatus::Online
        };
        
        Ok(SyncResult { synced, failed })
    }
    
    async fn process_operation(&self, _op: SyncOperation) -> Result<(), SyncError> {
        // TODO: Implement actual sync logic
        Ok(())
    }
}

#[derive(Debug)]
pub struct SyncResult {
    pub synced: usize,
    pub failed: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("not connected")]
    NotConnected,
    #[error("connection failed")]
    ConnectionFailed,
    #[error("network error: {0}")]
    NetworkError(#[from] reqwest::Error),
}
```

```rust
// crates/tastile-sync/src/lib.rs
pub mod client;
pub mod offline_queue;
pub mod sync_engine;

pub use client::SupabaseClient;
pub use offline_queue::{OfflineQueue, SyncOperation};
pub use sync_engine::{SyncConfig, SyncEngine, SyncStatus, SyncResult, SyncError};
```

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add crates/tastile-sync/
git commit -m "feat(sync): add sync module foundation with offline queue"
```

---

## Task 7: Integration Test - Crash Recovery

**Files:**
- Create: `crates/tastile-storage/tests/crash_recovery_test.rs`

**Step 1: Write the integration test**

```rust
// crates/tastile-storage/tests/crash_recovery_test.rs
use tastile_core::command::*;
use tastile_core::handler::CommandHandler;
use tastile_core::store::AppState;
use tastile_domain::*;
use tastile_storage::{ConnectionPool, migrate, EventStore, Recovery};
use tempfile::TempDir;

#[test]
fn full_crash_recovery_workflow() {
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("test.db");
    
    // Phase 1: Initial run
    {
        let pool = ConnectionPool::new(&db_path).unwrap();
        migrate(&pool).unwrap();
        
        let event_store = EventStore::new(pool.clone());
        let handler = CommandHandler::new();
        let mut state = AppState::new();
        
        let tile_id = TileId::new();
        let now = chrono::Utc::now();
        
        // Execute commands
        let commands = vec![
            Command::CreateTile(CreateTilePayload {
                tile_id,
                title: "Recovery Test".to_string(),
                next_action: None,
                done_definition: None,
            }),
            Command::StartTile(StartTilePayload {
                tile_id,
                started_at: Some(now),
                source: StartSource::Cli,
            }),
        ];
        
        for cmd in commands {
            let envelope = CommandEnvelope {
                command_id: CommandId::new(),
                actor: Actor::system(),
                issued_at: now,
                request_id: None,
                command: cmd,
            };
            let events = handler.handle(envelope, &mut state).unwrap();
            
            // Persist events
            for e in &events {
                event_store.append(e).unwrap();
            }
        }
        
        // Verify state before crash
        assert!(state.tiles.contains_key(&tile_id));
        assert!(state.tiles[&tile_id].core.started_at.is_some());
    }
    
    // Phase 2: Simulate crash - new process
    {
        let pool = ConnectionPool::new(&db_path).unwrap();
        // No migrate needed - DB exists
        
        let event_store = EventStore::new(pool.clone());
        let recovery = Recovery::new(event_store);
        
        // Recover state
        let mut recovered_state = AppState::new();
        recovery.replay_all(&mut recovered_state).unwrap();
        
        // Find the tile (need to get ID from events, but for test we know it's in there)
        let tile_id = recovered_state.tiles.keys().next().copied().unwrap();
        
        // Verify recovered state matches
        assert!(recovered_state.tiles[&tile_id].core.started_at.is_some());
        assert_eq!(recovered_state.tiles[&tile_id].core.title, "Recovery Test");
    }
}
```

**Step 2: Run test — PASS**

**Step 3: Commit**

```bash
git add crates/tastile-storage/
git commit -m "test(storage): add crash recovery integration test"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | SQLite Schema + Migration | `tastile-storage` |
| 2 | Event Store Repository | `event_store.rs` |
| 3 | Snapshot Repository | `snapshot_store.rs` |
| 4 | Recovery Logic | `recovery.rs` |
| 5 | Supabase Schema (RLS) | `supabase/migrations/` |
| 6 | Sync Module Foundation | `tastile-sync` |
| 7 | Crash Recovery Test | Integration test |

**Phase C exit criteria met when:**
- All 7 tasks pass tests
- Crash recovery workflow works end-to-end
- Events are persisted and replayable
- Sync module foundation ready for Phase D
