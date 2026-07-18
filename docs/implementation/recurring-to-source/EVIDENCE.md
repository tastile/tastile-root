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
