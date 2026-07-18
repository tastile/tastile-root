# Recurring-to-Source Status

This register is the resumable control plane. A row is not complete until its evidence is current for the recorded commit.

| Batch | Specification / scope | AT / UC | Owner | Exclusive scope | Depends on | Commit | Verification | Review | Next resume point |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0-control-plane | Plan Task 1; program controls and release gate | AT-UC: UC01-30 evidence control | Controller | `docs/implementation/recurring-to-source/**`, `scripts/orchestration/**` | None | Pending | `claim.ps1`, `review-batch.ps1`, and `verify-release.ps1 -WhatIf` | Pending independent spec + integration review | Populate claims before parallel work |
| A-source-scheduling | SourceTile-only new scheduling writer | AT SourceTile scheduling; UC01-30 as applicable | A | See `OWNERSHIP.md` | 0-control-plane | Pending | Pending | Pending | Claim Slot A files and add failing storage test |
| B-http-evidence | Canonical Core HTTP contract and evidence harness | AT HTTP/multi-user; UC01-30 as applicable | B | See `OWNERSHIP.md` | A schema/DTO decisions | Pending | Pending | Pending | Claim Slot B files after DTO approval |
| C-clients-wslc | Web, Android, and live-contract harness | AT Web/Android/WSLC; UC01-30 as applicable | C | See `OWNERSHIP.md` | B HTTP contract | Pending | Pending | Pending | Claim Slot C files after endpoint approval |
| release | Release verification and evidence closure | All AT-UC, especially UC01-30 | Controller | `live-stack` claim | A, B, C batches | Pending | Run `verify-release.ps1` without `-WhatIf` only under live-stack claim | Release review pending | Attach artifact paths to `EVIDENCE.md` |

## Update rule

Append a new table row or revise the affected row only after a focused gate. Record a commit SHA, UTC timestamp, fixture owner, and artifact path in `EVIDENCE.md`; otherwise leave the result `UNPROVEN`.
