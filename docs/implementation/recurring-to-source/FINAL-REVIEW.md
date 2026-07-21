# Final Cross-Cutting Review

Captured (UTC): '$utc'
Captured against commit: '$headSha'

## Scope

Cross-cutting review of the SourceTile-to-Execution v1 path and
the four complete baselines in this directory:
EVIDENCE.md, GAP-INVENTORY.md, OWNERSHIP.md, and STATUS.md.

## What is in scope for /goal

1. `Recurring 経由の新規書込みゼロ` end-to-end.  Code path:
   - core/auth.rs:signup (b269a18) and core/migrations.rs
     V1_015 backfill (b269a18) are both gated by
     TASTILE_LEGACY_RECURRING_SEED, default off.
   - web/tile-commands.ts:createRecurringCommand (cdd0bb4) is
     gated by NEXT_PUBLIC_TASTILE_LEGACY_RECURRING_WRITE, default
     off, and the bearer helper v1AuthHeaders (2bc331b) is the
     only auth path used by the e2e specs.
   - android/V1CommandPayloads.kt:298-318 still uses
     JsonObject/JsonArray, but a session with the Android SDK is
     required to ship a typed Kotlin mirror.
2. `SourceTile to Execution` public API.  Endpoint surface in
   core/openapi.rs (EV-WSLC-20260721-3) and core/handlers/
   source_tiles.rs maps to the wire contract.
3. `UC01-30 evidence`.  USECASE-AT matrix at
   core/docs/implementation/usecase-at-matrix.md (a6c1f17)
   covers all 30 USECASE scenarios against v1/12 AT-001..098.
4. `WSLC real API up`.  EV-WSLC-20260721-1 captures the live API +
   worker + DB run-scoped stack that worked at HEAD fe19ebb.
5. `Web E2E`.  All 12 e2e specs run on v1AuthHeaders (2bc331b +
   d76534e + f62c7e9).  bunx tsc 0 errors.
6. `Multi-user owner isolation`.  EV-WSLC-20260721-2 (714ca27)
   shows owner A returns 200 and owner B returns 404 on the same
   source tile id.
7. `fmt`, `clippy -D warnings`, and `cargo test --workspace`
   (host, 69 unit tests pass).  EV-WSLC-20260721-5 records the
   host clippy / cargo test pass.  Two integration tests need
   the WSLC stack to run; they pass on EV-WSLC-20260721-1.
8. Final review and STATUS.md reflection.  This document and
   commit 51a95d6 are the two artefacts for this P0.

## What is not in scope and why

- Android typed DTO mirror of v1/05 Condition AST: requires
  Android SDK and a Gradle build chain.  The session that ships
  that change will run gradle test, so it must be deferred to a
  session that has the Android build chain installed.
- Integration test re-run inside WSLC after the containerd
  metadata corruption (EV-WSLC-20260721-4) cleared: that is the
  same host-administrative dependency, the test would be the
  same code path already exercised in EV-WSLC-20260721-1.

## Commits reviewed

Most recent at capture time: '$headSha'
(reachable from the captured `git log`).

Earlier evidence-bearing commits in this session:
- 5283b9d docs(HARNESS): align v1 file count to 16
- 198e6af docs(root): distinguish WSL distro from WSLC engine
- b269a18 feat(v1): gate legacy default break Recurring seed
- fe19ebb docs(evidence): record WSLC API + worker + DB
- 714ca27 docs(evidence): record WSLC cross-owner isolation
- ecaeb9f docs(evidence): record WSLC env-gate signup
- 2bc331b feat(web): gate createRecurringCommand
- cdd0bb4 (Web env gate landed in 2bc331b, 7 _debug-* specs removed in f62c7e9)
- d76534e test(web/e2e): port remaining 12 e2e specs to v1AuthHeaders
- 21aabcc docs(evidence): record EV-WSLC-20260721-9
- a6c1f17 docs(USECASE-AT): build USECASE01-30 / AT-001..098 coverage matrix
- 51a95d6 docs(STATUS): reflect Web E2E bearer migration completion

Plus the pre-session commits 2107a6a, 8f1749f, 4b8a6e2, bd62d07 that
established the orchestration scaffolding this review reads against.

## EVIDENCE.md status

'$evCount' machine-traceable evidence rows in
docs/implementation/recurring-to-source/EVIDENCE.md, of which
EV-WSLC-20260721-1..3 / 5 / 6 / 7 / 8 / 9 are PASS.  EV-WSLC-20260721-4
is UNVERIFIED with the WSLC containerd metadata corruption
captured in the body.

## Recommendation

`/goal` should remain `active` until the Android typed DTO
commit lands and the WSLC containerd metadata is repaired so
the two integration tests can re-run.  Every other completion
criterion is satisfied or recorded as PASS in EVIDENCE.md.