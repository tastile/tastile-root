# Workspace Harness Loop Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans or subagent-driven-development task-by-task.

**Goal:** Give Tastile one bounded, repeatable workspace command that drives every canonical repository to an evidence-backed green state.

**Architecture:** A root PowerShell orchestrator invokes each repository's existing canonical quality gate without duplicating project logic. It records a JSON result per run, supports fail-fast and bounded repeat modes, and treats environment blockers separately from code failures.

**Tech Stack:** PowerShell 7, existing bun/cargo/Gradle/dotnet entrypoints.

---

### Task 1: Pin the baseline and review findings

**Files:**
- Create: `docs/reviews/2026-07-10-workspace-review.md`

1. Record dirty-worktree boundaries and canonical repositories.
2. Run each existing quality gate and capture exact failures.
3. Classify findings as Critical, Important, or environment blocker.
4. Verify every claimed failure with a reproducible command.

### Task 2: Add the workspace orchestrator

**Files:**
- Create: `scripts/check-workspace.ps1`
- Create: `scripts/tests/check-workspace.Tests.ps1`

1. Write tests for repository selection, fail-fast, keep-going, bounded retries, and JSON output.
2. Run tests and confirm they fail before the script exists.
3. Implement the smallest orchestrator using existing child commands.
4. Ensure default execution never deploys, installs globally, or touches archive/worktree clones.
5. Verify Pester tests pass.

### Task 3: Document the operator loop

**Files:**
- Modify: `README.md`
- Modify: `docs/HARNESS.md`

1. Document quick and full verification commands.
2. Define stop conditions: all selected gates green, retry budget exhausted, or environment blocker.
3. Document canonical repository scope and exclusion of `*.wslc` / `*.avatar` clones.
4. Verify commands in docs match the script help.

### Task 4: Close findings and independently review

**Files:**
- Modify only files directly required by verified Critical/Important findings.

1. For each code defect, add a failing regression test first.
2. Apply one root-cause fix at a time and rerun the owning repository gate.
3. Run the full workspace harness until green or a documented external blocker remains.
4. Dispatch spec-compliance review, then code-quality review.
5. Record final commands, results, residual risks, and follow-up ownership.
