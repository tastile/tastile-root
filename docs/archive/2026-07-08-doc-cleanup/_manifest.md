# 2026-07-08 Doc Cleanup — manifest (parent repo)

> **Reason**: implementation-complete or context-stale plan/spec files moved out of
> `docs/plans/` and `docs/superpowers/{plans,specs}/` so future sessions don't
> re-read them as active. Captures classification + replacement doc per file.

| Source | New location | Class | Replacement |
| --- | --- | --- | --- |
| `docs/plans/2026-07-01-tastile-cleanup-and-v1-recovery.md` | this dir | Implemented (cleanup done; Phases A–D green 2026-07-02) | `tastile/HARNESS.md` §3 + `tastile-core/HARNESS.md` §5 |
| `docs/plans/2026-07-04-owner-polymorphic-and-avatar.md` | this dir | Superseded (split into superpowers design + Phase A plan + runbook 2026-07-07) | `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md` · `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a.md` |
| `docs/superpowers/plans/2026-07-06-v1-schedule-packing-codex-prompt.md` | `superpowers-plans/` | Past task prompt (Phase C' complete 2026-07-06) | `tastile-core/HARNESS.md` §5 "Phase C'" |
| `docs/superpowers/plans/2026-07-06-v1-schedule-packing-plan.md` | `superpowers-plans/` | Implemented (Phase C' green 2026-07-06, AT-023..029 passing) | `tastile-core/HARNESS.md` §5 "Phase C'" + `tastile-core/v1/12-acceptance-tests.md` §C' |
| `docs/superpowers/plans/2026-07-07-v1-tile-list-view-model.md` | `superpowers-plans/` | Implemented (commits `5984d3d`, `d8eb116`, `db0dae4`, `8ce2486`, `c5cb9cd`, `c5ca0e0`) | `tastile-core/HARNESS.md` §5 "v1 tile-list view-model (live) — 2026-07-07" |
| `docs/superpowers/specs/2026-07-06-v1-schedule-packing-design.md` | `superpowers-specs/` | Superseded (absorbed into `tastile-core/v1/12-acceptance-tests.md` §C' AT-023..029) | `tastile-core/v1/12-acceptance-tests.md` |

## Kept (active)

- `docs/superpowers/plans/2026-07-06-cognito-hardening-phase1-mfa-required.md` — Cognito MFA live per memory `project_cognito_mfa_setup_flow.md`
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a{,-runbook}.md` — Phase A in progress
- `docs/superpowers/plans/2026-07-07-tastile-android-main-canvas-implementation.md` — recent commits `cae63a8`, `5bb4566`
- `docs/superpowers/plans/2026-07-07-wslc-stack-and-schedule-fill-verification.md` — wslc migration not yet landed
- `docs/superpowers/specs/2026-07-06-cognito-aws-hardening-design.md` — Cognito spec canonical
- `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md` — active design
- `docs/superpowers/specs/2026-07-07-tastile-android-main-canvas-implementation-design.md` — active design
- `docs/plans/2026-07-06-floating-menu-redesign.md` — partial (primitive landed in `d27fabe`; `DropdownMenu` migration still in progress)
- `docs/plans/2026-07-07-fix-timeline-zoom.md` — original premise superseded by Timeline v36 (memory `project_timeline_v36.md`) but kept for history until next sweep
