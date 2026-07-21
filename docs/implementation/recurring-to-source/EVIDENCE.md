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
