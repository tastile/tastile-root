# SourceTile Product Completion Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to execute each batch with an independent implementation review followed by an integration review.

**Goal:** Make SourceTile to Occurrence to PlacementTile to Execution the only new scheduling and execution write path, then prove it across Core, Web, Android, multiple users, and a live WSLC stack.

**Architecture:** `tastile-core/v1/` remains the sole product specification. Legacy Recurring remains readable only for compatibility; no new user, seed, worker, or client path may create or materialize it. SourceTile is the normalized schedule definition, Core owns occurrence expansion and placement selection transactionally, and clients only consume typed Core read/command APIs. Cross-repository release evidence is retained at the workspace root so a later agent can resume without inferring state from commits.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL, WSLC, Next.js/Playwright/Bun, Kotlin/Android/Gradle, Cognito-backed Core authorization.

---

## Authoritative inputs and non-negotiable invariants

- Specification: `tastile-core/v1/00-glossary.md` through `14-read-model-and-endpoint.md`, especially `02-core-entities.md`, `08-recurring-and-frame.md`, `10-invariants.md`, `12-acceptance-tests.md`, and `14-read-model-and-endpoint.md`.
- Product scenarios: `tastile-core/docs/USECASE.md` cases 01 through 30 and the supplied dormitory/school scenarios.
- Never introduce a use-case-specific rest/sleep/exam flag, JSONB/`serde_json::Value` canonical payload, string enum, local-time scheduling decision, physical history deletion, or direct client/database mutation.
- Execution starts only from a Placement. A SourceTile must never be executable directly.
- All source definition, occurrence, placement, revision, domain event, outbox event, and idempotency record mutations are atomic.

## Initial evidence and gaps (2026-07-18 audit)

| Priority | Evidence | Required outcome |
| --- | --- | --- |
| P0 | `tastile-core/crates/v1/api/src/main.rs` still exposes Recurring creation/materialization writes; `storage/src/default_break_recurring.rs` seeds Recurring; `worker/src/main.rs` runs legacy recurring/flow writers. | New writes become SourceTile-only; legacy is read compatibility only. |
| P0 | Web `src/lib/api/v1/tile-commands.ts` and Android `V1ApiClient.kt` create Recurring paths; neither has a SourceTile typed client. | Both clients use SourceTile read/command APIs and Placement execution APIs only. |
| P0 | Existing `scripts/usecase-e2e/` covers 17 cases and accepts Recurring; Web E2E bypasses auth and directly manipulates the database. | Public-API-only evidence covers USECASE 01–30, owner isolation, races, worker, and history. |
| P0 | WSLC `up-v1.sh` and E2E loops use fixed names/ports. | Run-scoped names and locks prevent one agent's live test from stopping another's stack. |
| P1 | Gap API routes are deferred/stubbed and legacy model commands accept `serde_json::Value`. | Typed, validated canonical commands or an explicit v1 specification decision before implementation. |
| P1 | Android local Core connection and authenticated emulator/device E2E are undocumented and untested. | Reproducible emulator and physical-device connection gates with retained evidence. |

## Ownership and main-branch protocol

The controller is the integration reviewer. At most three implementers work concurrently, with these exclusive file groups:

| Slot | Owns | Must not edit |
| --- | --- | --- |
| A — canonical scheduling | `tastile-core/crates/v1/domain/src/source_schedule.rs`, `storage/src/source_tile_repo.rs`, `storage/src/source_lifecycle_repo.rs`, `storage/src/default_break_recurring.rs`, `storage/src/access_repo.rs`, `worker/src/main.rs`, their migrations and storage tests | API route/OpenAPI files, Web, Android, root status documents |
| B — Core HTTP and evidence | `tastile-core/crates/v1/api/src/{main.rs,openapi.rs,handlers/**}`, API tests, `tastile-core/scripts/usecase-e2e/**` | scheduling/storage ownership files, Web, Android, root status documents |
| C — clients and live-contract harness | `tastile-web/**`, `tastile-android/**`, client-specific WSLC harness files | Core source/migrations/API contracts, root status documents |
| Controller — review/integration | this plan, workspace evidence/ownership/status documents, shared API contract approval, release-gate scripts | implementation-owned files except reviewed conflict resolution |

Every batch follows: claim files → add a failing test → minimal implementation → focused gate → independent spec review → independent quality review → short conventional commit → controller records evidence. Shared DTO/OpenAPI changes are serialized: A first for domain/schema, B second for HTTP, C last for clients.

## Task 1: Establish resumable program control before parallel edits

**Files:**

- Create: `docs/implementation/recurring-to-source/STATUS.md`
- Create: `docs/implementation/recurring-to-source/GAP-INVENTORY.md`
- Create: `docs/implementation/recurring-to-source/EVIDENCE.md`
- Create: `docs/implementation/recurring-to-source/OWNERSHIP.md`
- Create: `scripts/orchestration/claim.ps1`
- Create: `scripts/orchestration/release-claim.ps1`
- Create: `scripts/orchestration/review-batch.ps1`
- Create: `scripts/orchestration/verify-release.ps1`

1. Add a machine-readable or strictly tabular claim record with batch ID, agent, file globs, acquired time, expiry, and release state. Refuse overlapping unexpired claims.
2. Record initial P0/P1 gaps above with source location, authoritative v1 section, affected UC/AT, owner slot, and the proof still missing.
3. Make EVIDENCE a matrix of UC01–30 and layers: domain, PostgreSQL, HTTP, worker, Web E2E, Android, multi-user, WSLC. A PASS requires command, UTC time, commit SHA, fixture owner, and artifact path.
4. Make release verification acquire an exclusive live-stack claim, run core quality gates, WSLC contract tests, Web tests, Android tests, and write command output paths into EVIDENCE. Do not change existing `.agent-loop`; layer this program gate on top.

## Task 2: Make SourceTile the sole new Core scheduling writer

**Files:** Slot A ownership.

1. Add failing storage/worker tests proving a new owner receives no `v1_recurring` seed and a worker does not write legacy Recurring/Flow placements.
2. Replace the default-break seed with an equivalent SourceTile definition using normalized generation/window/split/flow structures; preserve interruption/reset behavior through plan/flow semantics, not a special break state.
3. Disable legacy recurring/flow worker materialization for normal operation. Preserve read compatibility and explicit migration behavior without pretending legacy data is a SourceTile.
4. Prove SourceTile bounded horizon fill is idempotent across two workers, preserves protected placements, and emits aligned events/outbox/work items.
5. Run focused storage tests, then `cargo test -p storage --test at_source_tile_scheduling -- --test-threads=1` against PostgreSQL.

## Task 3: Close the Core HTTP contract and deprecated write surface

**Files:** Slot B ownership.

1. Add API contract tests showing every legacy Recurring mutation path rejects with a stable deprecation response and does not write data; retain only documented compatibility reads.
2. Replace untyped `serde_json::Value` mutation payloads that are on the canonical path with named DTOs and validation errors. Do not silently ignore unknown fields or store debug payloads as canonical state.
3. Implement or specify and approve typed Gap behavior needed by USECASE 04/05 before exposing it. Add exact-boundary and cancellation/history tests.
4. Add public HTTP E2E: authenticated owner creates SourceTile, reads occurrence/placements, reflows, starts/pauses/resumes/finishes Execution, reads Basis and Sync, replays idempotency keys, and observes events/outbox through inspection-only assertions.
5. Add two-owner and concurrent-client tests for read/update/reflow/execution isolation, same-placement StartExecution race, stale revision, and idempotency payload mismatch.

## Task 4: Migrate Web to the canonical contract and create live Web E2E

**Files:** Slot C Web ownership.

1. Add typed SourceTile/Occurrence/Placement DTOs and an API client for all five canonical endpoints. Remove new UI creation's use of `createRecurringCommand`; retain legacy display only where necessary.
2. Make UI scheduling use server-owned UTC/offset inputs; remove browser-local recurrence expansion and timezone-derived scheduling decisions.
3. Replace synthetic sync assumptions with the specified Core Sync/Read flow for schedule/execution refresh.
4. Add Playwright scenarios using only the proxy and Core HTTP API: SourceTile create → displayed Placement → reflow → Execution lifecycle → sync refresh; separate authenticated owners; same-owner concurrent start.
5. Remove DB injection/container-name coupling from canonical E2E fixtures. Keep lower-level SQL tests only as Core integration tests, not user-flow evidence.

## Task 5: Migrate Android and prove WSLC connectivity

**Files:** Slot C Android ownership.

1. Add typed SourceTile/Occurrence/Placement clients, repository projections, and execution recovery based on Core reads rather than a process-local execution map.
2. Remove new UI writes through legacy tile lifecycle adapters. Keep compatibility display separately and document it.
3. Add reproducible debug configuration for emulator (`10.0.2.2`) and a documented physical-device path (HTTPS LAN endpoint or `adb reverse`; physical devices must not rely on cleartext).
4. Add connected/instrumentation contract tests for authenticated token bootstrap, SourceTile create/read/reflow, Placement read, Execution lifecycle, and sync recovery against WSLC. Persist request logs and device/emulator metadata as evidence.

## Task 6: Implement the actual dormitory and USECASE coverage

**Files:** B owns HTTP/usecase harness; A owns domain/storage cases; C owns client presentation cases.

1. Express schedules as SourceTile definitions, normalized Windows/Conditions/Labels/Flows/Plans: JST offset +540, semester/test labels, exceptions, timetable overrides, fixed evening activity phases, ordered break workflow, naps/laundry/AtCoder rules.
2. Add a requirement-to-artifact matrix for UC01–30 and supplied scenarios. Mark AUTO, DECISION, BLOCKED, or REJECT only when runtime evidence proves the prescribed outcome.
3. Verify every case at its required layer: exact time boundary, owner/race, history/revocation, decision/session/delivery, and worker lease behavior where relevant.

## Task 7: Release review and verification

1. Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and the full Core workspace tests with the required PostgreSQL setup.
2. Run namespaced WSLC PostgreSQL/API/worker and retain health, API, worker, and inspection logs.
3. Run Web build/check/Playwright against the live stack; run Android unit plus connected contract tests against the same release candidate serially under the live-stack claim.
4. Perform two reviews: batch review for every implementation and release review covering v1 invariants, normalization/migrations, owner authorization, idempotency/races, zero legacy new writes, client contract parity, WSLC rollback, and every EVIDENCE cell.
5. Do not mark this program complete while any matrix cell is missing, stale, based on direct DB fixture injection for a public flow, or has no current commit/artifact reference.
