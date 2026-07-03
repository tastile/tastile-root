# Tastile v1 Project Architecture Design

Date: 2026-03-13

## 1. Overview

Tastile is an execution control system that inherits the philosophy of Pomodoroom while being rebuilt from scratch. It is not a task manager or a simple pomodoro timer. It is a system that controls human execution — deciding what to do now, minimizing friction to start, enabling recovery after interruption, and integrating AI as a butler that uses the same interface as humans.

### Core Identity

- Execution control product, PC-first with mobile as a necessary companion
- Tile-based (not task-based) — tiles are differentiated by condition vectors, not type enums
- Notification as the minimal I/O surface with humans
- AI operates through the same Command surface as humans
- Designed for monetization from the start

---

## 2. Organization & Repository Structure

**GitHub Organization:** [github.com/tastile](https://github.com/tastile)

| Repository | Technology | Role |
|---|---|---|
| `tastile-core` | Rust | Core Daemon + CLI. Execution engine, Command/Event/Reducer, SQLite, Local HTTP API, MCP Server |
| `tastile-desktop` | C# / WinUI 3 | Windows native client. OS-level intervention (focus capture, lock screen, tray) + display UI |
| `tastile-web` | Next.js + Supabase | Landing, policy pages, dashboard, iOS PWA, Stripe billing, Edge Functions, integrations |
| `tastile-android` | Kotlin / Jetpack Compose | Android native app. OS intervention + sync companion |

### Why This Split

- Rust and Node.js/C# toolchains are completely separate — merging them adds CI complexity for no gain
- Desktop client has an independent release cycle tied to Windows updates
- Web (Next.js + Supabase) is tightly coupled and belongs together
- Android has its own build system (Gradle) and release pipeline (Play Store)

---

## 3. System Architecture

```
                    +------------------------+
                    |    Supabase Cloud      |
                    |  - Auth (Google OAuth) |
                    |  - PostgreSQL          |
                    |  - Edge Functions      |
                    |  - Stripe webhook      |
                    |  - Integration hooks   |
                    +-----------+------------+
                                |
               +----------------+----------------+
               |                |                |
    +----------+------+ +------+-------+ +------+------+
    | tastile.app     | | Android App  | | Windows PC  |
    | (Next.js)       | | (Kotlin)     | |             |
    |                 | |              | | +---------+ |
    | - Dashboard     | | - Prompt     | | | Desktop | |
    | - Landing       | | - Tile view  | | | Client  | |
    | - Policy pages  | | - Quick Memo | | | (C#)    | |
    | - PWA (iOS)     | | - OS notify  | | | - OS    | |
    | - Stripe        | |              | | |   intv. | |
    +-----------------+ +--------------+ | | - UI    | |
                                         | +----+----+ |
                                         |      | IPC  |
                                         | +----+----+ |
                                         | | Rust    | |
                                         | | Core    | |
                                         | | Daemon  | |
                                         | | +SQLite | |
                                         | +---------+ |
                                         +-------------+
```

### Key Principles

- **Rust Core** runs locally on Windows. Pure logic. Knows nothing about OS.
- **Desktop Client (C#)** calls Core's Local API and uses Win32-level OS intervention (focus capture, fullscreen interrupts, lock screen, system tray).
- **Android App** syncs via Supabase and uses native notification/intervention features.
- **tastile.app** provides Web dashboard and iOS PWA companion.
- All clients sync tile definitions, settings, and history through Supabase.

---

## 4. Synchronization Model (Hybrid C)

### Local Authority

Execution control state is locally authoritative. These never wait for cloud:

- `active_tile_id`
- `current_phase` / `phase_start` / `phase_end`
- `pending_prompt`
- `segments` (work/break intervals)

This ensures offline operation and zero-latency execution control.

### Cloud Authority (with Local Cache)

Tile definitions and project data use cloud as source of truth, with local caching for offline:

- Tile core data (title, nextAction, doneDefinition)
- Condition vectors (temporal, objective, interruption, automation, annotation)
- Project structure
- User settings and preferences
- Execution history and analytics

### Sync Flow

```
Local SQLite <--sync--> Supabase PostgreSQL
                             |
                  +----------+----------+
                  |          |          |
               Android    Web App    Other devices
```

### Conflict Resolution

- Timestamp-based last-write-wins for most fields
- Manual resolution for structural conflicts (rare)
- Execution state conflicts cannot occur (always local-authoritative)

---

## 5. Backend (Supabase)

### Services Used

| Service | Purpose |
|---|---|
| Auth | Google OAuth login, JWT, session management |
| PostgreSQL | Cloud source of truth for tiles, projects, settings, history |
| Realtime | Live sync between devices |
| Edge Functions | Stripe webhooks, integration webhooks, AI agent relay |
| Storage | Future: file attachments, exports |

### Scalability Design (Target: 10,000+ users)

- **Connection pooling**: PgBouncer (built into Supabase) for PostgreSQL connection management
- **Row Level Security (RLS)**: All tables enforce `user_id`-based RLS
- **Partitioning**: `events` table partitioned by `user_id` + month
- **Indexing**: `(user_id, created_at)` as base composite index
- **Pagination**: Cursor-based (not offset-based)
- **Rate limiting**: Per-user at Edge Function level
- **Soft delete**: `deleted_at` column, no physical deletes

### Security

- At-rest encryption: AES-256 (Supabase standard)
- In-transit encryption: TLS 1.3
- Application-level encryption for sensitive user content (memos, titles)
- API key separation: `anon` key (client) vs `service_role` key (Edge Functions)
- JWT: Short expiry (1h) + refresh token
- Sensitive OAuth tokens stored server-side only

---

## 6. tastile-core (Rust) Structure

### Cargo Workspace

```
tastile-core/
+-- Cargo.toml              # workspace root
+-- crates/
    +-- tastile-domain/     # Type defs, condition vectors, derive functions, validation
    +-- tastile-core/       # Command/Event/Reducer, Execution Engine, Prompt Engine
    +-- tastile-storage/    # SQLite, Repository, Migration, Recovery
    +-- tastile-scheduler/  # JIT selection, scoring, interruption evaluation
    +-- tastile-api/        # Local HTTP Server (axum), API type defs
    +-- tastile-sync/       # Supabase sync, offline queue, conflict resolution
    +-- tastile-mcp/        # MCP Server (Model Context Protocol)
    +-- tastile-cli/        # CLI binary (clap)
    +-- tastile-daemon/     # Daemon binary, boot/recovery/tick loop
```

### Dependency Graph

```
tastile-daemon
  +-- tastile-api
  |     +-- tastile-core
  |     |     +-- tastile-domain
  |     |     +-- tastile-storage
  |     |     +-- tastile-scheduler
  |     +-- tastile-sync
  +-- tastile-mcp
  +-- tastile-cli (same deps as api)
```

### Key Libraries

- **axum** — Local HTTP API server
- **rusqlite** — SQLite access
- **serde / serde_json** — Serialization
- **chrono** — Date/time
- **clap** — CLI parser
- **tokio** — Async runtime
- **reqwest** — Supabase REST API communication
- **tracing** — Structured logging

### Local API Endpoints

```
POST /commands/tile/create
POST /commands/tile/start
POST /commands/tile/complete
POST /commands/tile/defer
POST /commands/tile/extend
POST /commands/tile/interrupt
POST /commands/memo/attach
POST /commands/prompt/respond

GET  /read/active-tile
GET  /read/tiles
GET  /read/next-prompt
GET  /read/daily-summary
GET  /read/resume-candidates

GET  /health
GET  /debug/events
GET  /debug/execution
```

---

## 7. tastile-desktop (C# / WinUI 3)

### Architecture

The desktop client is a single native application that handles both OS-level intervention and display UI. It connects to Rust Core via Local HTTP API.

### Responsibilities

**OS Intervention Layer:**
- Focus capture / fullscreen interrupt
- System tray presence with unread prompt indication
- Lock screen notification
- Windows notification API
- Foreground window management

**Display Layer:**
- Now screen (active tile, phase, next action)
- Prompt surface (response-required prompts)
- Tile list view
- Quick memo
- Settings / diagnostics

### What It Must NOT Do

- No scheduler logic
- No prompt generation logic
- No execution mutation logic
- No local state machine when Core is unavailable
- No direct SQLite access

---

## 8. tastile-web (Next.js) Structure

### Technology

- **Next.js 15** (App Router) + TypeScript
- **Supabase Client SDK**
- **Tailwind CSS v4**
- **Stripe.js** + Edge Functions
- **Vercel** deployment (tastile.app domain)

### Route Structure

```
tastile.app/
+-- /                    # Landing page (public)
+-- /pricing             # Pricing plans (public)
+-- /privacy             # Privacy policy (public, required for Google auth)
+-- /terms               # Terms of service (public)
+-- /login               # Google OAuth login
+-- /dashboard           # Main dashboard (authenticated)
|   +-- /tiles           # Tile management
|   +-- /projects        # Project management
|   +-- /history         # Execution history and analytics
|   +-- /settings        # Account settings
|   +-- /billing         # Stripe billing management
+-- /app                 # iOS PWA (authenticated)
    +-- /now             # Active tile display
    +-- /prompt          # Prompt response
    +-- /memo            # Quick memo
```

### Stripe Billing Flow

```
User -> /billing -> Edge Function creates Checkout Session
                        |
                  Stripe payment page
                        |
              webhook -> Edge Function -> Supabase DB
                        |
              user.plan updated, entitlement reflected
                        |
              All clients check plan on sync
```

### iOS PWA

- `/app` routes configured as PWA with `manifest.json` + Service Worker
- Offline-capable for read operations
- Web Push API for notifications (iOS 16.4+)
- "Add to Home Screen" for native-like experience

---

## 9. tastile-android (Kotlin) Structure

### Technology

- **Kotlin** + **Jetpack Compose**
- **Supabase Kotlin SDK**
- **Android notification API** for OS-level intervention

### Responsibilities

- Prompt display and response
- Active tile view
- Quick memo
- Today summary
- Push notification for prompts
- Future: focus mode integration, screen time detection

### Sync

- All data through Supabase (no direct connection to Rust Core)
- Local Room DB as offline cache
- Background sync via WorkManager

---

## 10. AI Integration

### Design Principle

AI is a butler, not a god. AI uses the same Command surface as humans. No backdoor API.

### Connection Surfaces

**1. MCP Server (Model Context Protocol)**

`tastile-mcp` crate exposes Core's Local API as MCP tools. Claude, Cursor, and other MCP-compatible AI tools can:
- Read: tile list, active tile, history, resume candidates
- Write: create tile, start, complete, attach memo
- All tagged with `actor_type: "agent"`

**2. Supabase REST API (Remote)**

For cloud-based AI services (Google Home, Gemini, etc.):
- Authenticated via OAuth + JWT
- Same Command structure
- Edge Functions can relay and validate

**3. CLI (Local AI Agents)**

For locally running AI agents (OpenAI Operator, etc.):
- Invoke `tastile-cli` commands via shell
- Simplest integration path
- Full auditability through event log

### Policy

- All AI operations are logged with `actor_type: "agent"` and `actor_id`
- Dangerous operations (delete, bulk modify) require human confirmation
- Policy rules configurable per user
- No direct SQLite write access for any AI

---

## 11. External Service Integrations

### Architecture

All integrations run through **Supabase Edge Functions**. Core stays clean.

```
External Services (GitHub, Slack, etc.)
        |
        | webhook / OAuth
        v
Supabase Edge Functions
  - /integrations/github
  - /integrations/slack
  - /integrations/discord
  - /integrations/linear
  - /integrations/notion
        |
        v
Supabase DB (tiles, integration_configs, oauth_tokens)
        |
        | sync
        v
All clients (Core / Android / Web)
```

### Supported Integrations (v1 targets)

| Service | Direction | Use Case |
|---|---|---|
| GitHub | Inbound | Issue -> Tile creation |
| Slack | Inbound + Outbound | Status update, daily summary post |
| Discord | Outbound | Status update |
| Linear | Inbound | Ticket -> Tile sync |
| Notion | Inbound | Task -> Tile import |
| Teams | Outbound | Status update |

### Integration Config

Per-user integration settings stored in Supabase:
- OAuth tokens (encrypted, server-side only)
- Webhook endpoints
- Mapping rules (which repo/channel/project maps to which Tastile project)

---

## 12. Implementation Phases

### Phase A: Foundation Setup

- GitHub Organization + repository setup
- CI/CD basics for each repo
- Supabase project creation
- tastile.app domain configuration
- Design document freeze

### Phase B: Core Kernel (Rust)

- Domain types, Command/Event/Reducer
- Validation, Execution Engine
- In-memory tests
- **Exit**: execution kernel works end-to-end in memory

### Phase C: Persistence + Sync Foundation

- SQLite schema + migration
- Recovery logic
- Supabase table design + RLS
- Sync module foundation
- **Exit**: restart after crash restores state correctly

### Phase D: Prompt + Execution Loop

- Prompt Engine, tick loop
- Auto start/end
- CLI completion
- **Exit**: full prompt cycle works without UI

### Phase E: Scheduler + Interruption

- JIT selection, scoring
- Interruption handling, resume bias
- **Exit**: believable day loop in CLI simulation

### Phase F: Windows Client (C# / WinUI 3)

- Core connection + OS intervention layer
- Prompt display/response, Now screen
- Tray presence
- **Exit**: real work session runs from Windows alone

### Phase G: tastile.app

- Landing + policy pages
- Google OAuth login
- Dashboard
- Stripe billing
- iOS PWA
- **Exit**: users can sign up, pay, and manage tiles from web

### Phase H: Android App

- Supabase sync + Prompt response
- OS notification intervention
- Quick memo
- **Exit**: Android companion is usable for daily prompt response

### Phase I: AI + Integrations

- MCP Server
- External service integrations (GitHub, Slack, etc.)
- Agent policy
- **Exit**: AI can operate Tastile through documented interfaces

### Phase J: Validation + Release Prep

- Integration test matrix
- Performance profiling
- Security audit
- Release checklist
- **Exit**: installable, recoverable, loggable, updatable

---

## 13. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Backend | Supabase | Google OAuth built-in, RLS, Edge Functions, fits solo dev scale |
| Repository split | 4 repos by language/platform boundary | Separate toolchains, independent release cycles |
| Windows client | C# / WinUI 3 | OS-level intervention requires native Win32 access |
| Core | Rust | Pure logic, no OS dependency, deterministic execution |
| Android | Kotlin / Jetpack Compose | Native OS intervention, proper app experience |
| iOS | PWA via tastile.app | No iOS test device; upgrade to native later |
| Sync model | Hybrid C | Execution local-first, definitions cloud-synced, offline capable |
| AI integration | MCP + CLI + REST API | Same Command surface, no special backdoor |
| External integrations | Supabase Edge Functions | Keep Core clean, serverless, per-user config |
| Billing | Stripe via Edge Functions | Standard, well-supported, webhook-driven |
| Hosting (web) | Vercel | Next.js native, tastile.app domain |
| Domain | tastile.app | Product brand, policy pages, dashboard |
