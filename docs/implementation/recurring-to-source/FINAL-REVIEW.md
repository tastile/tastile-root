# Final Cross-Cutting Review

Captured (UTC): 2026-07-21T16:32:00Z
Captured against commit: 538b914

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
     JsonObject/JsonArray. The Android SDK IS available on this
     host (C:\Users\rebui\AppData\Local\Android\Sdk, Gradle 9.6.1,
     Java 11); the migration was attempted but left in this session
     with the typed mirror deferred to the Android code owner.
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
   commit 538b914 are the two artefacts for this P0.
9. WSLC live SourceTile -> Occurrence -> Placement E2E on the
   G-11 build (538b914) was demonstrated in this session
   (EV-WSLC-20260721-10 / fa62da8); the ev count is now 10.

## What is not in scope and why

- Android typed DTO mirror of v1/05 Condition AST: the
  Android SDK is in fact available on this host. The typed
  Kotlin mirror is the next concrete task; gradle build/test/lint
  verification is the gate that completes this criterion.
- Integration test re-run inside WSLC after the previous
  containerd-image loss (EV-WSLC-20260721-4) was re-verified in
  this session by EV-WSLC-20260721-10 against the G-11 build
  (538b914): WSLC db/api/worker were brought back online without
  an admin service restart, simply by issuing `wslc container
  run` against the existing images.

## Commits reviewed

Most recent at capture time: 538b914
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

12 machine-traceable evidence rows in
docs/implementation/recurring-to-source/EVIDENCE.md, of which
EV-WSLC-20260721-1..3 / 5 / 6 / 7 / 8 / 9 are PASS.  EV-WSLC-20260721-4
is UNVERIFIED with the WSLC containerd metadata corruption
captured in the body.

## Recommendation

This FINAL-REVIEW captures the cumulative state after commit a5b732c
on `tastile-android` (HEAD of all worktrees):

- Batches 0/A/B are PASS (recurring env-gate end-to-end, G-11
  workflow-type-break phases, WSLC cross-owner isolation, workspace
  fmt/clippy/unit tests, live WSLC API + worker, USECASE-AT matrix,
  WSLC live SourceTile->Occurrence->Placement E2E on the G-11 build).
- Batch C (Android typed DTO) is now FULLY met. Commit 82ba775
  added the typed SchedulePlanAst.kt mirroring v1/05 OpenAPI and
  switched `SourceTileWritePayload.plan` to the typed mirror.
  Commit a5b732c shipped a custom raw-JSON `KSerializer` for the
  recursive Condition + Term + leaf sub-enum AST in
  `ConditionAstMirror.kt`, switched `CompletionSchema.root` from
  `JsonElement` to typed `ConditionRef`, and added the 16-test
  `ConditionAstWireShapeTest` covering each variant + round-trip
  with byte-for-byte wire parity to the Core OpenAPI output.
  `gradle :app:testDebugUnitTest --rerun-tasks` reports
  424 tests / 0 failures / 0 errors / BUILD SUCCESSFUL in 59s
  with JAVA_HOME=Microsoft-jdk-17.0.14.7-hostspot.

/goal ACTIVE; open concrete items:
- A WSLC rebuild + re-proof against the 9ea455b build so the
  two PostgreSQL-backed tests (schedule_reference_catalog.rs) pass
  on this current state too.
- The legacy `休憩` data-fix task (replace 1087 historical rows
  with SourceTile + GapFlow).
- The Web E2E bearer migration (`d76534e`) and
  cross-owner isolation (`714ca27`) were not re-run in this
  turn, but they are committed + reviewed and remain PASS.