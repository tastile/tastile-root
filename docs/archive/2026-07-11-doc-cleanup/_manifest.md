# 2026-07-11 Doc Cleanup — manifest (parent repo)

> **Reason**: implementation-complete plan files moved out of `docs/plans/`
> so future sessions don't re-read them as active. Captures classification
> + replacement doc per file.

| Source | Class | Replacement |
| --- | --- | --- |
| `docs/plans/2026-07-06-floating-menu-redesign.md` | Implemented (FloatingMenu compound component shipped; `NotificationsMenu` migrated from `NotificationsDropdown`) | `tastile-web/src/components/ui/FloatingMenu.tsx` + `tastile-web/src/components/notifications/NotificationsMenu.tsx` |
| `docs/plans/2026-07-07-fix-timeline-zoom.md` | Implemented (use-zoom `applyAnchored` callback dep fix landed; 10/10 tests green via vitest jsdom env) | `tastile-web/src/lib/hooks/use-zoom.ts:212` |
| `docs/plans/2026-07-10-workspace-harness-loop.md` | Implemented (workspace gate + CLAUDE.md + README/HARNESS usage shipped) | `tastile/HARNESS.md` §13 + `tastile/scripts/check-workspace.ps1` |
| `docs/plans/2026-07-10-agent-precommit-review-design.md` | Implemented (pre-commit review hook design landed) | `.agent-loop/Invoke-PreCommitReview.ps1` + `.agent-loop/Invoke-AgentHook.ps1` |
| `docs/plans/2026-07-10-agent-precommit-review.md` | Implemented (PowerShell engine with Claude/Codex/OpenCode adapters live) | `.agent-loop/Invoke-PreCommitReview.ps1` + `.claude/settings.json` |

## Kept (active)

- `docs/plans/2026-07-11-compositional-scheduling-input.md` — Phases 1–3 landed
  (aggregate command `POST /v1/schedule-definitions` + storage repo + API handler;
  Web adapter `tastile-web/src/lib/api/v1/schedule-definition.ts`; reference
  catalog with `GapAnchor` selector). Phase 4 (QuickTileCreate.tsx split) and
  Phase 5 (acceptance tests) still pending.
- `docs/plans/2026-07-11-schedule-composition-assistant.md` — Composition
  Assistant design + plan; not yet started.