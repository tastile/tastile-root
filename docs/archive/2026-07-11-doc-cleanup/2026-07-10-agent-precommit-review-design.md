# Agent Pre-Commit Review Loop Design

## Goal

When Claude Code, Codex, or OpenCode attempts a Git commit from the Tastile
workspace root, block that tool call until the intended diff passes the owning
repository's fast gate and an independent agent returns an explicit approval.
This is an agent lifecycle policy, not a Git hook; terminal commits by a human
remain unchanged.

## Baseline failure

A pressure test against the current workspace showed that
`git -C tastile-web commit -m "fix"` is mechanically unrestricted. Existing
Claude/Codex hooks only reject destructive Git commands, OpenCode has no
pre-tool hook, and no project review skills exist. Tests and separate-agent
review can be skipped with rationalizations such as "small change" or
"review after commit".

## Architecture

Three thin native adapters live at the workspace root:

- `.claude/settings.json`: `PreToolUse` for Bash commit attempts.
- `.codex/hooks.json`: `PreToolUse` for Bash commit attempts.
- `.opencode/plugins/tastile-precommit-review.js`: `tool.execute.before`.

All adapters call `.agent-loop/Invoke-PreCommitReview.ps1`. The engine parses
the pending command without executing it, resolves one of the five canonical
child repositories, captures the intended patch (staged diff, or tracked
working-tree diff for `git commit -a`), applies it to an isolated snapshot of
HEAD, then runs the repository's fast gate, loads the snapshot's
`.agents/skills/tastile-precommit-review/SKILL.md`, and launches a read-only
reviewer CLI from that exact snapshot.

Reviewer selection is deliberately cross-agent:

| Caller | Reviewer |
| --- | --- |
| Claude | Codex |
| Codex | Claude |
| OpenCode | Codex |

An environment override exists for deterministic tests, but production has no
self-review fallback. Missing CLI, timeout, malformed output, gate failure, or
any Critical/Important finding denies the original tool call.

## Review contract

The reviewer receives only the repository identity, project skill, gate
evidence, and exact intended patch. It cannot edit files. Its structured result
contains:

- `verdict`: `approve` or `block`
- `summary`
- `findings[]`: severity, file, line, message

Only correctness, security, data loss, specification violations, missing
tests, and release-breaking defects are blocking. Style preferences and minor
cleanup are out of scope.

Approval is intentionally not cached. The workspace is agent-writable, so an
approval file stored there could be forged. Every commit attempt reruns both
the deterministic gate and the independent reviewer.

## Project skills

Each child repository owns one concise skill. It specifies its source of truth,
architectural boundaries, fast verification command, generated-file policy,
and high-risk review areas. Mechanical execution stays in the root engine;
project judgment stays in the child skill.

OpenCode and Codex discover `.agents/skills` natively. Claude receives the
same skill content through the hook-launched reviewer prompt, avoiding
duplicated skill files.

## Safety and stopping conditions

- Simple direct non-commit commands pass without starting a reviewer.
- Shell/interpreter wrappers, expansion, encoded commands, and ambiguous commit
  forms fail closed because their actual process cannot be proven from hook text.
- Unknown repositories and clone/worktree copies fail closed.
- Empty intended patches fail closed.
- The reviewer receives no write tools and cannot commit.
- The engine never stages, edits, resets, stashes, or deploys.
- Gate, skill, and reviewer all operate on the same isolated intended snapshot.
- The original commit is allowed only after both deterministic and agent gates
  pass.

## Verification

Contract tests use fake Git, gate, Codex, and Claude executables to prove:

1. Non-commit commands pass.
2. Every canonical repository resolves to its own skill and gate.
3. A failed gate blocks before agent review.
4. Missing/unparseable/block reviewer responses fail closed.
5. Every approved commit attempt still launches an independent reviewer.
6. Dirty unstaged changes cannot mask defects in the staged snapshot.
7. Claude, Codex, and OpenCode adapters all invoke the common engine.

