# Codex three-role agent setup

## Goal

Define a project-scoped Codex team in which Sol supervises, Luna implements,
and Terra independently inspects completed work.

## Changes

1. Pin the project-level parent model to `gpt-5.6-sol`; Codex enables
   subagents by default.
2. Add a Luna implementation agent with workspace-write access.
3. Add a Terra inspection agent with read-only access.
4. Add a Sol supervisor agent that delegates implementation and inspection,
   then decides whether findings require another implementation pass.

## Verification

- Parse every changed TOML file.
- Start Codex with `--strict-config` far enough to detect invalid settings.
- Confirm the three agent definitions expose the intended model, role, and
  sandbox boundaries.
