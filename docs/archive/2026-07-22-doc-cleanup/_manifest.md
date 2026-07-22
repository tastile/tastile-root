# 2026-07-22 Doc Cleanup — manifest (parent repo)

> **Reason**: implementation-complete plans and specs moved out of
> `docs/plans/` and `docs/superpowers/{plans,specs}/` so future sessions do not
> re-read them as active. Classification and replacement evidence are retained
> per file.

| Source | New location | Class | Replacement |
| --- | --- | --- | --- |
| `docs/plans/2026-07-18-source-tile-product-completion.md` | this dir | Implemented (`8ae5e27`: 240/240 evidence cells PASS) | `docs/implementation/recurring-to-source/EVIDENCE.md:7-36` |
| `docs/plans/2026-07-20-cross-package-cd-unification.md` | this dir | Implemented (release tags: core `v0.5.0@c040871`, web `v0.1.47@3258a08`, Android `v0.3.1@893b93b`) | `tastile-core/.github/workflows/deploy.yml` · `tastile-web/.github/workflows/deploy.yml` · `tastile-android/.github/workflows/release.yml` |
| `docs/plans/2026-07-22-storage-reclaim-and-wslc-migration-design.md` | this dir | Implemented (`df4c99c`: Tasks 5–7 executed and measured) | `docs/archive/2026-07-22-doc-cleanup/2026-07-22-storage-reclaim-and-wslc-migration-design.md:506-539` |
| `docs/superpowers/plans/2026-07-07-tastile-android-main-canvas-implementation.md` | this dir | Implemented (`7498bda`: four main canvas tabs; `db4e051`: dead bottom bar removed) | `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` · `TilesScreen.kt` · `IntegrationsScreen.kt` · `SettingsScreen.kt` |
| `docs/superpowers/specs/2026-07-07-tastile-android-main-canvas-implementation-design.md` | this dir | Implemented (`7498bda`: four main canvas tabs; `db4e051`: dead bottom bar removed) | `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` · `TilesScreen.kt` · `IntegrationsScreen.kt` · `SettingsScreen.kt` |
| `docs/superpowers/plans/2026-07-17-timeline-header-menu.md` | this dir | Implemented (`70762a8`: calendar menu sections; `29f69ac`: scaffold state wiring) | `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt` · `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt` |
| `docs/superpowers/specs/2026-07-17-timeline-header-menu-design.md` | this dir | Implemented (`70762a8`: calendar menu sections; `29f69ac`: scaffold state wiring) | `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt` · `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt` |

## Kept (active)

- `docs/plans/2026-07-11-compositional-scheduling-input.md` — no complete implementation evidence; the previous sweep recorded pending editor split and acceptance work.
- `docs/plans/2026-07-11-schedule-composition-assistant.md` — no implementation commit or shipped replacement found.
- `docs/reviews/2026-07-10-workspace-review.md` — less than 30 days old, with no implementation or superseding replacement evidence.
- `docs/superpowers/plans/2026-07-06-cognito-hardening-phase1-mfa-required.md` — 76 unchecked steps remain.
- `docs/superpowers/specs/2026-07-06-cognito-aws-hardening-design.md` — no proved replacement or complete implementation of the full design.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a.md` — 74 unchecked steps remain; later phases are explicitly deferred.
- `docs/superpowers/plans/2026-07-07-cognito-avatar-integration-phase-a-runbook.md` — all 8 completion checks remain unchecked.
- `docs/superpowers/specs/2026-07-07-cognito-avatar-integration-design.md` — later web and Android phases remain active.
- `docs/superpowers/plans/2026-07-07-wslc-stack-and-schedule-fill-verification.md` — 112 unchecked steps remain.
- `docs/superpowers/specs/2026-07-15-account-data-deletion-design.md` — explicitly marked `Design — awaiting implementation plan`.
