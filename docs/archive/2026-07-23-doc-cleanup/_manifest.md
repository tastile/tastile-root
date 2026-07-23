# 2026-07-23 Doc Cleanup — manifest (parent repo)

> **Reason**: implementation-complete plans moved out of `docs/plans/` so
> future sessions do not re-read them as active. Classification and replacement
> evidence are retained per file.

| Source | New location | Class | Replacement |
| --- | --- | --- | --- |
| `docs/plans/2026-07-22-claude-automation-design.md` | this dir | Implemented (`826aab5`; command guard `.claude/hooks/tastile-command-guard.ps1:40-88`; verification skill `.claude/skills/verify-tastile-change/SKILL.md:2-25`) | `.claude/settings.json:2-15` · `.claude/skills/cross-repo-contract-check/SKILL.md:2-52` · `.claude/agents/tastile-verifier.md:2-39` · `.claude/agents/cross-repo-contract-reviewer.md:2-43` · `.mcp.json` |
| `docs/plans/2026-07-22-claude-automation-implementation.md` | this dir | Implemented (`826aab5`; registered hook `.claude/settings.json:2-15`; command guard `.claude/hooks/tastile-command-guard.ps1:40-88`) | `.claude/hooks/test-tastile-command-guard.ps1` · `.claude/skills/verify-tastile-change/SKILL.md:2-25` · `.claude/skills/cross-repo-contract-check/SKILL.md:2-52` · `.claude/agents/tastile-verifier.md:2-39` · `.claude/agents/cross-repo-contract-reviewer.md:2-43` · `.mcp.json` |

## Kept (active)

- `docs/plans/2026-07-11-compositional-scheduling-input.md` — no complete implementation evidence; the previous sweep recorded pending editor split and acceptance work.
- `docs/plans/2026-07-11-schedule-composition-assistant.md` — no implementation commit or shipped replacement found.
- `docs/plans/2026-07-22-credential-rotation.md` — the runbook shipped, but no commit or external-state evidence proves its credential rotations, demo infrastructure, and verification steps were executed.
- `docs/reviews/2026-07-10-workspace-review.md` — less than 30 days old, with no implementation or superseding replacement evidence.
- `docs/superpowers/plans/2026-07-06-cognito-hardening-phase1-mfa-required.md` — 76 unchecked steps remain.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a-runbook.md` — all 8 completion checks remain unchecked.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a.md` — 74 unchecked steps remain; later phases are explicitly deferred.
- `docs/superpowers/plans/2026-07-07-wslc-stack-and-schedule-fill-verification.md` — 112 unchecked steps remain.
- `docs/superpowers/plans/2026-07-23-tastile-web-login-minimal.md` — current-sprint implementation plan with 15 unchecked steps.
- `docs/superpowers/specs/2026-07-06-cognito-aws-hardening-design.md` — no proved replacement or complete implementation of the full design.
- `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md` — later web and Android phases remain active.
- `docs/superpowers/specs/2026-07-15-account-data-deletion-design.md` — explicitly marked `Design — awaiting implementation plan`.
- `docs/superpowers/specs/2026-07-23-tastile-web-login-minimal-design.md` — current design whose paired implementation plan still has 15 unchecked steps.
