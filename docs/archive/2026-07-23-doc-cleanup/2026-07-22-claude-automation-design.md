# Claude Automation Design

**Date:** 2026-07-22

## Goal

Add project-scoped Claude Code automation that verifies Tastile changes, reviews cross-repository contracts, blocks known-invalid commands, and exposes AWS/PostgreSQL inspection through read-only MCP servers.

## Architecture

Use Claude Code's standard project locations: `.claude/skills`, `.claude/agents`, `.claude/settings.json`, and `.mcp.json`. Keep the existing pre-commit review hook unchanged and append a separate `PreToolUse/Bash` command guard. Track only the required `.claude` paths through narrow `.gitignore` exceptions.

The command guard enforces deterministic workspace constraints: Bun instead of npm/npx, no Windows-side Rust build/test for `tastile-core`, JDK 17 for Android Gradle commands, and no Git command that spans independent child repositories. It must allow ordinary reads, tests in correct environments, and repository-local Git operations.

AWS uses `awslabs.aws-api-mcp-server` with `READ_OPERATIONS_ONLY=true` and unrestricted local file access disabled. PostgreSQL uses `postgres-mcp --access-mode=restricted`. `.mcp.json` contains environment-variable references only. AWS IAM and a dedicated PostgreSQL reader role remain the actual authorization boundaries.

## Components

- `verify-tastile-change`: selects verification by affected repository and requires execution evidence.
- `cross-repo-contract-check`: checks canonical v1 contracts and independent repository boundaries.
- `tastile-verifier`: read-only agent that distinguishes reviewed from verified evidence.
- `cross-repo-contract-reviewer`: read-only agent for multi-repository API and UI parity review.
- `tastile-command-guard.ps1`: deterministic PreToolUse validator.
- `.mcp.json`: project-scoped read-only AWS and PostgreSQL servers.

## Safety and rollback

No credentials are committed. Missing MCP environment variables leave servers disconnected rather than weakening access. Rollback is removal of the new hook entry and newly added project files; the existing pre-commit hook remains intact throughout.
