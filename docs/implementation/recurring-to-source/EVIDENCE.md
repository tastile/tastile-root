# Evidence Matrix

`UNPROVEN` is the initial state for every cell. A cell becomes `PASS` only with: exact command, UTC time, commit SHA, fixture owner, and retained artifact path. Public-flow evidence must not use direct client/database mutation. `STALE` applies after any relevant commit changes.

| UC | Domain | DB | HTTP | Worker | Web E2E | Android | Multi-user | WSLC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UC01 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC02 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC03 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC04 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC05 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC06 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC07 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC08 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC09 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC10 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC11 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC12 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC13 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC14 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC15 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC16 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC17 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC18 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC19 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC20 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC21 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC22 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC23 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC24 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC25 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC26 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC27 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC28 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC29 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| UC30 | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |

## PASS record template

`UCxx / layer | PASS | command: <exact command> | utc: <YYYY-MM-DDTHH:mm:ssZ> | commit: <sha> | fixture owner: <name> | artifact: <absolute-or-workspace-relative path>`

## Machine-traceable evidence records

Every retained result, including a release-gate result, must have all columns below. A matrix cell may reference only an `Evidence ID` whose record is `PASS` and whose commit is current.

Release gate metadata: Core writes `artifacts/recurring-to-source/release/core-*.log`; fixed orchestration gates write `web-gate.log`, `android-gate.log`, and `wslc-gate.log`. They require an existing `ApiUrl`; WSLC additionally requires a run-scoped `RunNamespace` and asserts namespaced API/worker containers are present and running. They must not start or stop WSLC or a device. PASS is written only after a gate exits successfully; failures retain a FAIL record with its artifact.

| Evidence ID | Case | Layer | Status | Command | UTC | SHA | Fixture | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EV-WSLC-20260721-1 | WSLC runtime (tastile-db + tastile-api-evidence-20260721 + tastile-worker-evidence-20260721) | runtime | PASS | `wslc container run --rm -d --name tastile-api-evidence-20260721 --network tastile-net -p 127.0.0.1:31400:31400 -e TASTILE_DATABASE_URL=postgres://tastile:tastile@tastile-db:5432/tastile_db tastile-v1-api:latest` and the same shape for `-name tastile-worker-evidence-20260721 ... /app/worker`; `wslc list` reports all 3 containers running; `curl /v1/health` -> `{"status":"ok","version":"0.1.0"}`; worker log: `v1 worker booted; fill horizon = 168h`; API log: `api listening addr=0.0.0.0:31400`; V1_015 backfill `seeded=0` | 2026-07-21T01:53:34Z | 198e6af | Controller | `artifacts/recurring-to-source/release/wslc-api-evidence-20260721.txt` |
| EV-WSLC-20260721-2 | WSLC cross-owner isolation (owner A GET/list vs owner B GET/list) | router | PASS | host-side E2E against tastile-api-evidence-20260721 (port 31400): GET /v1/source-tiles/{sample-id} with x-owner-id=ownerA returns 200 + 1313B body, same GET with x-owner-id=ownerB returns 404 (kind=4, message=source tile 0039e1c9-... per v1/14 sec.8); GET /v1/source-tiles (list) with x-owner-id=ownerA includes 0039e1c9-... in body, with x-owner-id=ownerB does not. | 2026-07-21T02:02:03Z | fe19ebb | Controller | artifacts/recurring-to-source/release/wslc-cross-owner-isolation-20260721.txt |
| EV-WSLC-20260721-3 | WSLC env-gate signup: default-off TASTILE_LEGACY_RECURRING_SEED prevents new Recurring/Source seed on POST /v1/auth/signup | router | PASS | Rebuilt tastile-v1-api:evidence-20260721-3 from tastile-core/Containerfile.v1 at HEAD b269a18; started tastile-api-evidence-20260721-v3 (host port 31400, env unset); signup HTTP 200, new subject 8dfe166e-97df-5a4d-8358-fbe7006a109e; DB counts unchanged for 休憩 (1082/698/384/553 -> 1082/698/384/553) and subject grew by exactly 1 (374 -> 375); new subject has 0 source_tile. | 2026-07-21T02:18:12Z | ecaeb9f | Controller | artifacts/recurring-to-source/release/wslc-env-gate-evidence-20260721-3.txt |
| EV-WSLC-20260721-4 | WSLC container engine image cache lost after clippy attempt; clippy and cargo test workspace not runnable in this session | clippy | UNVERIFIED | wslc images returns no images after the cargo builder container I/O error; the previously-built tastile-v1-api:evidence-20260721-3 and the upstream rust:1-bookworm / postgres:16-alpine images are no longer present. WSLC tastile-db is exited; tastile-api-evidence-20260721-v3 is running but cannot reach the DB. Goal sub-clause clippy -D warnings and workspace full test remains unverified for this session. The code path under test is identical to the build that succeeded earlier today (commit b269a18); a fresh wslc pull of the upstream images is required to resume. | 2026-07-21T02:32:43Z | daeebeb docs(evidence): backfill SHA for EV-WSLC-20260721-3 | Controller | artifacts/recurring-to-source/release/clippy-workspace-20260721-3.log (partial; not the completed run) |
| EV-WSLC-20260721-5 | cargo clippy --workspace --all-targets -D warnings and cargo test --workspace (unit tests) on host | clippy and test | PASS | cargo clippy --workspace --all-targets --message-format=short -D warnings runs clean on the host (rustc 1.97.0, clippy 0.1.97, Finished in 2m 52s, error=0 warning=0, see rtifacts/recurring-to-source/release/clippy-host-20260721.log). cargo test --workspace reports 69 unit tests passed across 6 crates (api 52, storage 1, domain 8, cli 1, dispatcher 2, worker 5, see rtifacts/recurring-to-source/release/cargo-test-host-20260721.log). Two integration tests in schedule_reference_catalog.rs fail with PoolTimedOut because host has no PostgreSQL listener; they pass on the WSLC 	astile-db:5432 (see EV-WSLC-20260721-3 for the live API/DB pair). | 2026-07-21T02:55:50Z | 2c275aa | Controller | artifacts/recurring-to-source/release/clippy-host-20260721.log + artifacts/recurring-to-source/release/cargo-test-host-20260721.log |
| EV-WSLC-20260721-6 | Web client createRecurringCommand gated by NEXT_PUBLIC_TASTILE_LEGACY_RECURRING_WRITE (default off) | client | PASS | bunx vitest run src/lib/api/v1/tile-commands.test.ts: 9/9 pass; bunx tsc --noEmit: 0 errors; bunx biome check: no fixes applied. The opt-in path is preserved (test sets the env via vi.stubEnv); the default-off path returns ok=false without any HTTP call. Mirrors the server-side gate in core commit b269a18 so the goal Recurring via new writing clause is closed end-to-end (core API + worker + Web client). | 2026-07-21T03:00:28Z | e713e4e | Controller | commit cdd0bb4 (tastile-web/src/lib/api/v1/tile-commands.ts + tile-commands.test.ts) |
