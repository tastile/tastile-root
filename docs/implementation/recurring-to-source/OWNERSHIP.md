# Main-Branch Ownership

Main is integration-only. Claims are mandatory before edits and must name the exact batch, agent, and file glob. A live-stack claim is exclusive across all slots.

| Role | May own | Cannot edit |
| --- | --- | --- |
| A — canonical scheduling | Domain/source schedule, storage/source lifecycle, seed, worker, migrations, storage tests | API/OpenAPI, Web, Android, root control files |
| B — Core HTTP and evidence | API routes/OpenAPI/handlers, API tests, core use-case harness | Scheduling/storage ownership, Web, Android, root control files |
| C — clients and WSLC harness | `tastile-web/**`, `tastile-android/**`, client WSLC harness | Core source/migrations/API contracts, root control files |
| Controller — integration review | Root control files, shared-contract approval, release-gate scripts, reviewed conflict resolution | Implementation-owned files except approved resolution |

Rules: at most three implementation slots (A/B/C) concurrently; shared DTO/OpenAPI work is serialized A then B then C; each batch requires failing test, focused gate, independent specification review, independent quality review, and a short conventional commit before controller evidence entry. No agent may replace `.agent-loop`; these controls layer above it.
