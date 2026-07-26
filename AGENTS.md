# Large Tool Argument Safety

Some model and proxy configurations may truncate tool calls when a single argument contains several kilobytes of embedded text. Truncation can produce invalid JSON and make the current session unusable.

This section applies only to commands that create or modify files. It does not affect normal tool selection, code search, repository exploration, builds, tests, or other shell commands.

## File editing

* Use `apply_patch` for substantial file creation or modification.
* Avoid placing large file contents directly inside a shell command or another tool argument.
* In particular, do not use large heredocs, `python -c`, `node -e`, or equivalent commands to transmit an entire source file.
* Small, simple writes are acceptable when the complete tool call remains compact.
* For generated files that are too large for one patch, create them incrementally with multiple reasonably sized patches.

## Shell commands

Use ordinary shell commands normally for:

* repository search and inspection
* `rg`, `find`, and similar command-line utilities
* builds and tests
* `git`, `cargo`, and project scripts
* formatting, linting, and code generation

Choose tools based on the task. Do not prefer an MCP tool merely because one is available.

## Failure prevention

Before sending a file-writing tool call, check whether the command embeds a large block of source code or data. If it does, replace it with `apply_patch` or split the change into smaller patches.

Do not discuss this constraint during normal work unless it directly affects the current operation or a related tool call fails.
