# Claude Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install project-scoped Tastile verification skills, reviewers, deterministic command guards, and read-only AWS/PostgreSQL MCP definitions.

**Architecture:** Use standard `.claude` project directories and a tracked `.mcp.json`. Extend the existing Bash PreToolUse hook without replacing it. Keep credentials outside Git and enforce read-only access at both MCP and IAM/database layers.

**Tech Stack:** Claude Code project settings, Markdown skills/agents, PowerShell 7, JSON, AWS API MCP Server, postgres-mcp.

---

### Task 1: Track Claude project customizations

**Files:**
- Modify: `.gitignore`

1. Add narrow exceptions for `.claude/settings.json`, `.claude/hooks/*.ps1`, `.claude/skills/**`, and `.claude/agents/*.md`.
2. Run `git check-ignore -v` for each planned path; expect the exception rules to make them trackable.

### Task 2: Create `verify-tastile-change`

**Files:**
- Create: `.claude/skills/verify-tastile-change/SKILL.md`

1. Run a baseline agent scenario without the skill and record whether it incorrectly accepts reviewed-only, skipped-test, or wrong-environment evidence.
2. Write the minimal skill covering the observed failures and repository-specific validation matrix.
3. Run the same scenario with the skill loaded; expect explicit execution evidence and correct repository routing.
4. Validate YAML frontmatter and keep the skill under 500 words.

### Task 3: Create `cross-repo-contract-check`

**Files:**
- Create: `.claude/skills/cross-repo-contract-check/SKILL.md`

1. Run a baseline scenario involving core and web contract drift.
2. Write the minimal skill requiring all affected instructions, canonical v1 chapters, per-repository diffs, and client parity checks.
3. Re-run the scenario; expect contract mismatches and repository-boundary risks to be reported.

### Task 4: Add specialized reviewers

**Files:**
- Create: `.claude/agents/tastile-verifier.md`
- Create: `.claude/agents/cross-repo-contract-reviewer.md`

1. Define read-only tools and concise evidence-focused prompts.
2. Start each agent against a synthetic review request; expect no edits and actionable findings.

### Task 5: Add the command guard

**Files:**
- Create: `.claude/hooks/tastile-command-guard.ps1`
- Modify: `.claude/settings.json`

1. Write failing JSON-input cases for npm/npx, Windows-side core cargo, wrong-JDK Android Gradle, and cross-child Git commands; include valid Bun, wslc, and repository-local controls.
2. Implement minimal parsing and Claude hook JSON output.
3. Pipe every case into the script and verify block/allow exit codes.
4. Append the command to the existing `PreToolUse/Bash` hooks array.
5. Parse settings JSON and trigger a harmless Bash call to verify hook discovery. If the watcher does not reload, instruct the user to open `/hooks` or restart Claude Code.

### Task 6: Register read-only MCP servers

**Files:**
- Create: `.mcp.json`

1. Add `aws-readonly` using `uvx awslabs.aws-api-mcp-server@latest`, `READ_OPERATIONS_ONLY=true`, no local-file access, and environment references for profile/region.
2. Add `postgres-readonly` using `uvx postgres-mcp --access-mode=restricted` and `${TASTILE_POSTGRES_READONLY_URI}`.
3. Parse JSON and run `claude mcp list/get`; missing credential variables may report disconnected but must not reveal secrets.
4. Provide commands for creating `tastile-readonly` AWS credentials and the PostgreSQL reader role only if they do not already exist.

### Task 7: Integrated review

**Files:** all files above.

1. Run syntax checks for JSON, PowerShell, skill frontmatter, and agent frontmatter.
2. Run `git status --short` and verify `check-prod.ps1` and `find-prod.ps1` remain untouched.
3. Dispatch `requesting-code-review`; process findings with `receiving-code-review`.
4. Report verified behavior, unresolved credential prerequisites, risks, rollback, and next improvements. Do not commit unless explicitly requested.
