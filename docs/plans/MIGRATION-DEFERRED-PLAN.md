# Migration and Deferred Plan

**Repository:** `tastile-web`  \n**Parent:** `tastile-root` / `tastile-core`  \n**Date:** 2026-08-06  \n**Status:** Active

## Executive Summary

This document consolidates all migration activities and deferred work for `tastile-web`. It identifies:
1. **Active migrations** currently in progress
2. **Deferred items** to be carried forward to future phases
3. **Blocked items** requiring parent repo changes
4. **Ready-to-start** items awaiting parent repo completion

---

## 1. Active Migrations

### 1.1 Dashboard Mantine Migration (2026-07-25)
**Status:** In Progress  \n**File:** `docs/plans/2026-07-25-mantine-dashboard-migration.md`  \n**Owner:** Codex  \n**Scope:** Replace Tailwind custom UI with Mantine primitives

**Progress:**
- Task 1: Button components — 50% complete (4/8 pages updated)
- Task 2: Raw `<button>` elements — 20% complete (1/5 instances)
- Task 3: `<input>` elements — 0% complete (0/4 instances)
- Task 4: `<textarea>` elements — 0% complete (0/1 instance)

**Remaining:** 3 tasks pending implementation
**Estimated Completion:** 2026-08-10

---

### 1.2 React-Doctor Remediation (2026-07-23)
**Status:** Pending Execution  \n**File:** `docs/plans/2026-07-23-react-doctor-remediation.md`  \n**Owner:** Codex  \n**Scope:** Fix React quality issues identified by React-Doctor

**Progress:** Awaiting React-Doctor scan results
**Estimated Completion:** TBD

---

## 2. Deferred Items (Phase 2+)

### 2.1 Reference Mode E2E (B2b)
**ID:** B2b  \n**Phase:** Deferred to Phase 2  \n**File:** `docs/plans/B2b-reference-mode-deferred.md`  \n**Parent:** `04-sub-projects/B-time-windows.md`  \n**Dependency:** B2a must complete first

**Deferred Reason:** Reference picker implementation not complete; e2e cannot be run without it  \n**Placeholder Guard:** Added `canSubmit()` check for `whenMode="reference"` + `referenceId === null`  \n**Phase 2 Pickup:** Remove guard when picker + core resolve is complete

---

### 2.2 Split Policy Split (C4b)
**ID:** C4b  \n**Phase:** Deferred  \n**File:** `docs/plans/C4b-split-policy-split-deferred.md`  \n**Parent:** `C4a-split-kind-policy.md`  \n**Dependency:** C4a must complete first

**Deferred Reason:** Policy split requires parent policy completion  \n**Status:** Pending C4a completion

---

### 2.3 Meta Project Spec (F2a)
**ID:** F2a  \n**Phase:** Deferred Design Memo  \n**File:** `docs/plans/F2a-meta-project-spec.md`  \n**Issue:** #85

**Content:** Defers decision on whether `Project` aggregate is:
- (a) A `v1_subject` row with `kind=1` (reuse existing `V1_004__access_grant.sql`)
- (b) Independent aggregate (requires new DDL, `v1_project` table, `v1_project_member` table)

**Decision Required:** User policy call before implementation

---

### 2.4 Meta Tags Spec (F2b)
**ID:** F2b  \n**Phase:** Pending Definition  \n**File:** `docs/plans/F2b-meta-tags-spec.md` (to be created)  \n**Content:** Define meta-tags aggregate structure and API surface

---

## 3. Blocked Items (Requires Parent Repo)

### 3.1 Owner Derived from Sub E2E (A4a)
**ID:** A4a  \n**Parent:** `tastile-core`  \n**Status:** Blocked — requires core implementation

**Blocker:** Owner derivation logic not in core yet

---

### 3.2 QuickCreate UI Binding (A5a)
**ID:** A5a  \n**Parent:** `tastile-core`  \n**Status:** Blocked — requires core implementation

**Blocker:** Core tile/command API not stable

---

### 3.3 Bridge Auth Curl Verify (H3a)
**ID:** H3a  \n**Parent:** `tastile-core`  \n**Status:** Blocked — requires core implementation

**Blocker:** Bridge auth endpoint not exposed in core

---

### 3.4 Bridge Endpoint Reachability (G5b)
**ID:** G5b  \n**Parent:** `tastile-core`  \n**Status:** Blocked — requires core implementation

**Blocker:** Bridge endpoint not accessible from web

---

## 4. Ready-to-Start (No Dependencies)

### 4.1 Floating Tile Input (2026-07-11)
**File:** `docs/plans/2026-07-11-floating-tile-input.md`  \n**Status:** Ready

---

### 4.2 Intuitive Tile Editor (2026-07-11)
**File:** `docs/plans/2026-07-11-intuitive-tile-editor.md`  \n**Status:** Ready

---

## 5. Migration Phases

### Phase 1: Foundation (Complete)
- [x] Event sourcing pattern implementation
- [x] Core domain models (Tile, Plan, Placement, Execution)
- [x] Command/Event/Reducer architecture
- [x] tastile-core API integration

### Phase 2: Dashboard Refactoring
- [ ] Mantine migration (4 tasks pending)
- [ ] React-Doctor remediation
- [ ] UI component library consolidation

### Phase 3: Feature Slices
- [ ] QuickCreate structured workflow
- [ ] Timeline mode improvements
- [ ] Calendar zoom smoothness
- [ ] QuickTile Mantine parity

### Phase 4: Core Integration
- [ ] Owner derivation from sub (requires core)
- [ ] QuickCreate UI binding (requires core)
- [ ] Bridge auth verification (requires core)
- [ ] Bridge endpoint reachability (requires core)

---

## 6. Risk Assessment

| Item | Risk Level | Mitigation |
|------|------------|------------|
| Mantine migration | Low | Component replacement only, no logic changes |
| Reference mode | Medium | Placeholder guard prevents silent 422 |
| Blocked items | High | Track parent repo PRs, unblock when ready |
| Deferred design | Medium | Clear decision criteria documented |

---

## 7. Next Steps

1. **Immediate:** Complete remaining 3 tasks of Mantine migration (inputs, textareas, remaining buttons)
2. **This Week:** Run React-Doctor scan, remediate issues
3. **This Sprint:** Evaluate Mantine-first vs Tailwind hybrid approach (2026-07-27 deferred)
4. **Next Sprint:** Start QuickCreate structured workflow design (2026-07-27 deferred)
5. **When Core Updates:** Unblock A4a, A5a, H3a, G5b as parent repo PRs merge

---

## 8. Related Documents

- **Migration Guide:** https://feature-sliced.design/docs/guides/migration/from-custom
- **tastile-core Spec:** `../tastile-core/v1/02-core-entities.md`
- **v1 Invariants:** `../tastile-core/v1/10-invariants.md`
- **API Schema:** `../tastile-core/v1/14-read-model-and-endpoint.md`
- **Architecture:** `AGENTS.md`
- **Implementation Order:** `docs/plans/05-impl-order.md`
- **Gap Matrix:** `docs/plans/03-gap-matrix.md`

---

**Last Updated:** 2026-08-06  \n**Owner:** Codex  \n**Review Cycle:** Bi-weekly
