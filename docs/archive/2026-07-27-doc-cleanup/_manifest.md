# 2026-07-27 Doc Cleanup — manifest (parent repo)

> **Reason**: implementation-complete plans and specs moved out of
> `docs/superpowers/{plans,specs}/` so future sessions do not re-read them as
> active. Classification and replacement evidence are retained per file.

| Source | New location | Class | Replacement |
| --- | --- | --- | --- |
| `docs/superpowers/plans/2026-07-23-tastile-web-login-minimal.md` | this dir | Implemented (`1939d43`: concrete font stacks; `c4d3567`: compact login; `f19557d`: clean build and zero-warning verification) | `tastile-web/src/app/login/page.tsx:54-135` · `tastile-web/src/app/layout.tsx:14-18,51` · `tastile-web/src/app/marketing-layout.test.tsx` |
| `docs/superpowers/specs/2026-07-23-tastile-web-login-minimal-design.md` | this dir | Implemented (`1939d43`: concrete font stacks; `c4d3567`: compact login; `f19557d`: clean build and zero-warning verification) | `tastile-web/src/app/login/page.tsx:54-135` · `tastile-web/src/app/layout.tsx:14-18,51` · `tastile-web/src/app/marketing-layout.test.tsx` |

## Kept (active)

- `docs/plans/2026-07-11-compositional-scheduling-input.md` — no complete implementation evidence; editor split and acceptance work remain unproved.
- `docs/plans/2026-07-11-schedule-composition-assistant.md` — no implementation commit or shipped replacement found.
- `docs/plans/2026-07-22-credential-rotation.md` — the runbook shipped, but no external-state evidence proves the rotation, demo infrastructure, and verification steps were executed.
- `docs/reviews/2026-07-10-workspace-review.md` — less than 30 days old, with no implementation or superseding replacement evidence.
- `docs/superpowers/plans/2026-07-06-cognito-hardening-phase1-mfa-required.md` — 76 completion steps remain unchecked and no post-sweep closeout evidence exists.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a-runbook.md` — all 8 completion checks remain unchecked.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a.md` — 74 completion steps remain unchecked; later phases are explicitly deferred.
- `docs/superpowers/plans/2026-07-07-wslc-stack-and-schedule-fill-verification.md` — 112 completion steps remain unchecked.
- `docs/superpowers/specs/2026-07-06-cognito-aws-hardening-design.md` — no proved replacement or complete implementation of the full design.
- `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md` — later web and Android phases remain active.
- `docs/superpowers/specs/2026-07-15-account-data-deletion-design.md` — explicitly marked `Design — awaiting implementation plan`.
