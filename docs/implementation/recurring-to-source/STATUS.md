# Recurring-to-Source Status

This register is the resumable control plane. A row is not complete until its evidence is current for the recorded commit.

| Batch | Specification / scope | AT / UC | Owner | Exclusive scope | Depends on | Commit | Verification | Review | Next resume point |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0-control-plane | Plan Task 1; program controls and release gate | AT-UC: UC01-30 evidence control | Controller | `docs/implementation/recurring-to-source/**`, `scripts/orchestration/**` | None | `2107a6a`, `8f1749f` | Independent review approved; PowerShell parse and `verify-release.ps1 -WhatIf` passed | Approved; later root-glob regression fix uncommitted | Commit/review claim release + glob regression fix |
| A-source-scheduling | SourceTile-only new scheduling writer | AT SourceTile scheduling; UC01-30 as applicable | A | See `OWNERSHIP.md` | 0-control-plane | Pending | `cargo check -p storage`, `cargo check -p worker`, SourceTile storage test `--no-run` passed; DB run blocked | Review found calendar-write, Flow-replacement, default-break proof gaps | Fix review findings; WSLC DB required for runtime evidence |
| B-http-evidence | Canonical Core HTTP contract and evidence harness | AT HTTP/multi-user; UC01-30 as applicable | B | See `OWNERSHIP.md` | A schema/DTO decisions | Pending | `cargo check -p api --bin api`, `cargo test -p api --test openapi_schema` passed | Review found auth-order, numeric Flow wire, and owner/race gaps; auth-order partly fixed | Implement numeric registry only after specification decision; add owner/race HTTP fixture |
| C-clients-wslc | Web, Android, and live-contract harness | AT Web/Android/WSLC; UC01-30 as applicable | C | See `OWNERSHIP.md` | B HTTP contract | Pending | Web SourceTile focused test and TypeScript check passed; Android compile blocked before test | Review rejected arbitrary JSON/preliminary mismatched wire DTO | Finish Core-parity typed wire clients; repair Android base compile; WSLC recovery |
| release | Release verification and evidence closure | All AT-UC, especially UC01-30 | Controller | `live-stack` claim | A, B, C batches | Pending | Run `verify-release.ps1` without `-WhatIf` only under live-stack claim | Release review pending | Attach artifact paths to `EVIDENCE.md` |

## Update rule

Append a new table row or revise the affected row only after a focused gate. Record a commit SHA, UTC timestamp, fixture owner, and artifact path in `EVIDENCE.md`; otherwise leave the result `UNPROVEN`.
