# Agent Pre-Commit Review Loop Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Enforce project-aware independent review before agent-initiated Tastile commits across Claude Code, Codex, and OpenCode.

**Architecture:** Native root-level tool hooks delegate to one fail-closed
PowerShell engine. Each child repository supplies a small review skill, while
the engine owns exact isolated snapshots, fast gates, cross-agent selection,
and structured no-cache verdicts.

**Tech Stack:** PowerShell 7, Git, Claude Code CLI, Codex CLI, OpenCode plugins,
SKILL.md.

---

### Task 1: Common review engine

**Files:**
- Create: `.agent-loop/repositories.json`
- Create: `.agent-loop/review-result.schema.json`
- Create: `.agent-loop/Invoke-PreCommitReview.ps1`
- Create: `.agent-loop/tests/Invoke-PreCommitReview.Tests.ps1`

1. Write fake-command tests for pass-through, repository routing, gate failure,
   reviewer failure, approval, mandatory repeated review, and snapshot isolation.
2. Run the tests and confirm RED because the engine does not exist.
3. Implement command detection, exact intended-patch capture, fast gates,
   cross-agent selection, structured output, and isolated exact snapshots.
4. Run the tests until GREEN.

### Task 2: Native agent adapters

**Files:**
- Create: `.claude/settings.json`
- Create: `.codex/hooks.json`
- Create: `.opencode/plugins/tastile-precommit-review.js`
- Create: `.agent-loop/tests/Test-AgentAdapters.ps1`

1. Write contract tests asserting all adapters intercept Bash before execution,
   identify their caller, invoke the common engine, and propagate denial.
2. Confirm RED before adapter creation.
3. Add the smallest native configuration for each agent.
4. Parse/load each configuration and run adapter contract tests.

### Task 3: Repository review skills

**Files:**
- Create in every canonical child repository:
  `.agents/skills/tastile-precommit-review/SKILL.md`
- Create: `.agent-loop/tests/Test-ReviewSkills.ps1`

1. Write structural tests for discovery, valid frontmatter, gate command,
   source-of-truth references, blocking severity, and no self-approval.
2. Confirm RED before skill creation.
3. Add one concise project-specific skill at a time.
4. Re-run structural tests after each skill.

### Task 4: Integration and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/HARNESS.md`
- Create: `.agent-loop/README.md`

1. Document the lifecycle, fail-closed behavior, no-cache policy, supported
   command forms, and troubleshooting.
2. Run all contract tests and the workspace fast harness.
3. Simulate approve/block paths with fake reviewers.
4. Dispatch an independent specification review, then a code-quality review.
5. Fix all Critical/Important findings and re-review until approved.

