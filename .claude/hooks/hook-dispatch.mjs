#!/usr/bin/env node
// PreToolUse dispatcher (matcher: Bash).
//
// WHY THIS EXISTS
// ---------------
// The three Bash guards used to be registered as three separate hooks, so
// every Bash tool call paid for all three process spawns. Measured on this
// host: Invoke-AgentHook.ps1 ~690ms + tastile-command-guard.ps1 ~540ms +
// git-guard.mjs ~100ms = ~1.33s of latency on *every* command, including
// `ls`, `cat`, and `rg`. Over a long build session that is minutes of dead
// time.
//
// This dispatcher reads the PreToolUse event once and runs only the guards
// whose subject matter actually appears in the command string. The guards
// themselves are unmodified and keep their own full-string regex checks, so
// routing here narrows *how often* a guard runs, never *what it decides*.
//
// SAFETY PROPERTIES
// -----------------
//  - Routing matches raw substrings/word-boundaries against the whole command
//    string, not a prefix. `cd tastile-core && git commit -m x` still routes to
//    the commit-review gate.
//  - git-guard.mjs is cheap and broadly protective, so it always runs.
//  - Fail closed: if stdin is unparseable, or a guard cannot be spawned, every
//    guard is run / the call is denied rather than silently allowed.
//  - A guard exiting 2 blocks the call and its stderr is forwarded verbatim.
//  - A guard printing a permissionDecision JSON payload has that payload
//    forwarded verbatim on stdout.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HOOK_DIR, "..", "..");

// `spawn` with shell:false does no PATHEXT resolution, so a bare "bun" or
// "pwsh" is ENOENT on Windows. Resolve against PATH once, keeping shell:false
// so the command string is never re-parsed by a shell.
function resolveExecutable(name) {
  if (process.platform !== "win32") return name;
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const dir of (process.env.PATH || "").split(";")) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

// ---- read the event --------------------------------------------------
let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  raw = "";
}

let event = null;
try {
  event = raw.trim() ? JSON.parse(raw) : null;
} catch {
  event = null;
}

const command =
  typeof event?.tool_input?.command === "string" ? event.tool_input.command : "";

// Not a Bash call with a command: nothing any of these guards inspects.
if (event && event.tool_name !== "Bash") process.exit(0);
if (event && !command) process.exit(0);

// ---- routing ---------------------------------------------------------
// `unparseable` forces every guard to run: we could not prove the command is
// uninteresting, so we do not get to skip anything.
const unparseable = event === null;

// The pre-commit review gate cares about commands that publish work.
const PUBLISHES = /\bgit(?:\.exe)?\b[\s\S]*\b(?:commit|push|merge|tag|revert|cherry-pick)\b|\bgh(?:\.exe)?\b[\s\S]*\b(?:pr|release|api)\b/i;

// The command-policy guard cares about package managers, cargo, and gradle,
// plus root-level git add/commit.
const POLICY = /(?:^|[^\w.-])(?:npm|npx|yarn|pnpm|cargo|gradlew(?:\.bat)?)\b|\bgit(?:\.exe)?\s+(?:add|commit)\b/i;

const GUARDS = [
  {
    name: "git-guard",
    // Always: the destructive-command net is the cheap one and applies to
    // every command shape (rm, dd, truncate, mkfs, nested bash -c, ...).
    when: () => true,
    exec: "bun",
    args: [join(REPO_ROOT, ".claude", "hooks", "git-guard.mjs")],
    requires: join(REPO_ROOT, ".claude", "hooks", "git-guard.mjs"),
  },
  {
    name: "tastile-command-guard",
    when: () => unparseable || POLICY.test(command),
    exec: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      join(REPO_ROOT, ".claude", "hooks", "tastile-command-guard.ps1"),
    ],
    requires: join(REPO_ROOT, ".claude", "hooks", "tastile-command-guard.ps1"),
  },
  {
    name: "agent-loop-precommit-review",
    when: () => unparseable || PUBLISHES.test(command),
    exec: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      join(REPO_ROOT, ".agent-loop", "Invoke-AgentHook.ps1"),
      "-Caller",
      "claude",
    ],
    requires: join(REPO_ROOT, ".agent-loop", "Invoke-AgentHook.ps1"),
  },
];

// The guards read cwd from the event payload themselves; the child's own cwd
// only needs to be a real directory. A malformed cwd must not turn every
// command into a spawn failure, so fall back to the repo root.
const guardCwd =
  typeof event?.cwd === "string" && existsSync(event.cwd) ? event.cwd : REPO_ROOT;

function runGuard(guard) {
  return new Promise((done) => {
    const child = spawn(resolveExecutable(guard.exec), guard.args, {
      cwd: guardCwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      done({ guard, code: 2, out: "", err: `${guard.name} could not be spawned: ${e.message}` })
    );
    child.on("close", (code) => done({ guard, code: code ?? 0, out, err }));
    child.stdin.on("error", () => {});
    child.stdin.end(raw);
  });
}

const selected = GUARDS.filter((g) => {
  // A guard whose script is missing is a broken install, not a pass.
  if (!existsSync(g.requires)) return false;
  return g.when();
});

const results = await Promise.all(selected.map(runGuard));

// ---- decide ----------------------------------------------------------
// Any guard that blocks (exit 2) blocks the call. Any guard that emitted a
// structured permissionDecision has it forwarded so the deny reason reaches
// Claude the same way it did when the guards were registered directly.
let exitCode = 0;
for (const r of results) {
  if (r.out.trim()) process.stdout.write(r.out.endsWith("\n") ? r.out : `${r.out}\n`);
  if (r.code === 2) {
    if (r.err.trim()) process.stderr.write(r.err.endsWith("\n") ? r.err : `${r.err}\n`);
    exitCode = 2;
  }
}
process.exit(exitCode);
