# Codex / MiniMax-M3 Tool Usage

The Codex model in this project (`MiniMax-M3` via `api.minimax.io`) is configured with a low per-turn output cap. A single tool call whose `arguments` embed a multi-KB file (e.g. `exec_command` running `python -c '...'` or a heredoc to write a 150+ line Rust file) hits the cap, the response is truncated mid-JSON, the proxy returns `code: "invalid_prompt"` (HTTP-style 2013), and the session is unrecoverable.

## Rules

- **Use `apply_patch` for any file create / edit where the resulting change exceeds ~50 lines or ~4 KB.** The diff stays well under the output cap.
- For files **smaller than ~50 lines**, `apply_patch` is still preferred but `write_file` / `write` is acceptable.
- Do **not** embed large file contents inside `exec_command` arguments (no `python -c '...'`, no `cat <<EOF`, no Node `mcp__node_repl__js` write of multi-KB blobs).
- `exec_command` is fine for builds, tests, git, cargo, and other shell operations.
- If a write must exceed the cap (e.g. generating a long migration), split it across multiple turns: write the file in chunks via `apply_patch`, or write a small scaffold with `apply_patch` and append chunks with `exec_command` running `printf >> file` (each call stays small).

## Why

Direct evidence from session `rollout-2026-06-24T17-53-02`: the model emitted `function_call` for `exec_command` whose `arguments` was 7648 chars and ended mid-JSON (missing closing `}`). Local parser: `failed to parse function arguments: EOF while parsing an object at line 1 column 7648`. Proxy: `invalid params, invalid function arguments json string ... (2013) invalid_prompt`.
