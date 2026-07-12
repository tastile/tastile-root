# Tastile Agent Pre-Commit Review Loop

This directory enforces independent review when Claude Code, Codex, or OpenCode
tries to commit from the Tastile workspace root. It is an agent lifecycle hook,
not a Git hook. Human terminal commits are unchanged.

## Flow

1. The native agent hook receives every Bash tool call.
2. Simple non-commit commands pass. Ambiguous wrappers and expansions fail closed.
3. A direct `git -C <canonical-repo> commit ...` resolves its intended patch.
4. The engine exports HEAD into an isolated temporary snapshot and applies only
   that patch. Dirty unstaged files cannot make the gate pass.
5. The repository fast gate runs in the snapshot.
6. The repository's `.agents/skills/tastile-precommit-review/SKILL.md` is loaded.
7. A different read-only CLI agent reviews the exact patch.
8. Only an explicit structured `approve` allows the original tool call.

Reviewer routing:

| Implementing agent | Reviewing agent |
| --- | --- |
| Claude Code | Codex |
| Codex | Claude Code |
| OpenCode | Codex |

Every attempt is reviewed. Approval is not cached because the workspace is
agent-writable.

## Supported commit form

Start the agent in the `tastile` root and use one simple direct command:

```powershell
git -C tastile-web commit -m "fix: verify identity"
```

`-a/--all`, message, author, and template options are supported. Pathspec,
`--only`, `--include`, `--amend`, Git target-changing global options,
shell/interpreter wrappers, command expansion, aliases, encoded commands, and
compound commands containing a commit are denied. Split preparation and commit
into separate tool calls.

## Native adapters

- Claude Code: `.claude/settings.json`
- Codex: `.codex/hooks.json`
- OpenCode: `.opencode/plugins/tastile-precommit-review.js`
- Shared stdin adapter: `Invoke-AgentHook.ps1`
- Review engine: `Invoke-PreCommitReview.ps1`
- Repository catalog: `repositories.json`

Codex project hooks require trusting the project hook definition. Inspect and
trust it with `/hooks`. Restart/new-session behavior may be required after
changing hook or plugin files.

## Prerequisites

- `pwsh`, `git`, `tar`
- Authenticated `claude` CLI (used as the fixed independent reviewer)
- Each repository's normal fast-gate toolchain
- Agents started from the Tastile workspace root

Missing tools, authentication, malformed reviewer output, timeout, failed gate,
missing skill, or reviewer findings all deny the commit.

## Tests

```powershell
pwsh -NoProfile -File .\.agent-loop\tests\Invoke-PreCommitReview.Tests.ps1
pwsh -NoProfile -File .\.agent-loop\tests\Test-AgentAdapters.ps1
pwsh -NoProfile -File .\.agent-loop\tests\Test-ReviewSkills.ps1
```

The engine test uses fake Git, gate, and reviewer processes. It never invokes a
real reviewer or commit.

All callers route review through Claude Code using its standard model; no model
selection flag is supplied. Claude and Codex hooks locate `.agent-loop` by
searching from the current working directory toward its parents, so they also
work when launched from a repository subdirectory.

## Troubleshooting

- **Hook is not listed:** start the agent from the Tastile root; use Claude
  `/hooks` or Codex `/hooks`; restart OpenCode after plugin changes.
- **Commit denied as ambiguous:** issue a single direct `git -C ... commit`
  command without wrappers or expansion.
- **Fast gate fails:** run the repository gate directly and fix it first.
- **Reviewer unavailable:** authenticate the required independent CLI. There is
  no self-review fallback.
- **Core full DB tests are blocked:** the commit loop intentionally uses the
  Core fast domain gate; release verification still requires the workspace full
  harness and PostgreSQL configuration.

## Security boundary

Lifecycle hooks are guardrails around agent tool calls, not an operating-system
security boundary. They cover the native Bash tool paths documented by the
three agents. They do not replace repository permissions, branch protection,
CI, or human review. Do not enable bypass-hook-trust modes for ordinary work.
