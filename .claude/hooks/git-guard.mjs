#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks commonly-destructive commands.
//
// IMPORTANT — read before trusting this:
// This is pattern matching on the literal command string, not a shell
// interpreter. It cannot see through ${IFS} substitution, $(...) /
// backtick expansion inside quotes it doesn't unwrap, custom aliases,
// scripts written to a file and then executed, or a different tool
// entirely (Write can truncate a file just as thoroughly as `rm`).
// Treat this as a net against careless/accidental destructive commands
// from an agent working quickly, not as a boundary against deliberate
// evasion. It is one layer, not the layer.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";

// ---- read the PreToolUse event ---------------------------------------
const inputText = readFileSync(0, "utf8").trim();
let input = {};
try {
  input = inputText ? JSON.parse(inputText) : {};
} catch {
  input = {};
}

const tool = input.tool_name || "";
const rawCmd = input.tool_input?.command || "";

if (tool !== "Bash" || !rawCmd) process.exit(0);

// ---- helpers -----------------------------------------------------------

// Splits on shell sequencing operators. Does NOT understand quoting well
// enough to avoid splitting inside a quoted string that happens to
// contain ";" etc. — a known, accepted limitation (see header).
function splitSegments(cmd) {
  return cmd
    .split(/(?:&&|\|\||;|\n|\|)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Naive whitespace tokenizer with basic quote stripping.
function tokenize(segment) {
  return (
    segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, "")) || []
  );
}

// Skips env-var assignments and common wrapper commands to find the
// actual command and its arguments.
function commandAndArgs(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  while (i < tokens.length && ["sudo", "command", "env", "nice", "nohup"].includes(tokens[i])) i++;
  const cmd = (tokens[i] || "").replace(/^\\/, "").toLowerCase();
  return { cmd, args: tokens.slice(i + 1) };
}

// True if any long flag in `names` is present, or any short flag letter
// in `names` shows up inside a combined short-flag cluster (e.g. "-xdf"
// contains "f").
function hasFlag(args, ...names) {
  if (args.some((a) => names.includes(a))) return true;
  return args.some(
    (a) =>
      /^-[a-zA-Z]{2,}$/.test(a) &&
      names.some((n) => n.length === 2 && n.startsWith("-") && a.includes(n[1]))
  );
}

// ---- rule set ------------------------------------------------------------
// severity "block" -> exit 2, stops the tool call
// severity "warn"  -> logged only, does not stop execution
const rules = [
  { name: "git reset --hard", severity: "block", test: (c, a) => c === "git" && a[0] === "reset" && hasFlag(a, "--hard") },
  { name: "git clean (force)", severity: "block", test: (c, a) => c === "git" && a[0] === "clean" && hasFlag(a, "-f", "--force") },
  { name: "git checkout (force)", severity: "block", test: (c, a) => c === "git" && a[0] === "checkout" && hasFlag(a, "-f", "--force") },
  { name: "git switch (force/discard)", severity: "block", test: (c, a) => c === "git" && a[0] === "switch" && hasFlag(a, "-f", "--force", "--discard-changes") },
  {
    name: "git restore (worktree changes discarded)",
    severity: "block",
    test: (c, a) => c === "git" && a[0] === "restore" && (!a.includes("--staged") || a.includes("--worktree")),
  },
  { name: "git stash drop/clear", severity: "block", test: (c, a) => c === "git" && a[0] === "stash" && ["drop", "clear"].includes(a[1]) },
  {
    name: "git branch force-delete",
    severity: "block",
    test: (c, a) => c === "git" && a[0] === "branch" && (hasFlag(a, "-D") || (hasFlag(a, "-d", "--delete") && hasFlag(a, "-f", "--force"))),
  },
  {
    name: "git push --force (no lease)",
    severity: "block",
    test: (c, a) => c === "git" && a[0] === "push" && (hasFlag(a, "--force", "-f") || a.some((x) => x.startsWith("+"))) && !hasFlag(a, "--force-with-lease"),
  },
  { name: "git push --force-with-lease", severity: "warn", test: (c, a) => c === "git" && a[0] === "push" && hasFlag(a, "--force-with-lease") },
  {
    name: "git gc / reflog expire (unrecoverable prune)",
    severity: "block",
    test: (c, a) => c === "git" && ((a[0] === "gc" && hasFlag(a, "--prune=now")) || (a[0] === "reflog" && a[1] === "expire" && a.some((x) => x.startsWith("--expire=")))),
  },
  { name: "git update-ref -d", severity: "block", test: (c, a) => c === "git" && a[0] === "update-ref" && hasFlag(a, "-d") },
  { name: "git filter-branch / filter-repo", severity: "block", test: (c, a) => c === "git" && ["filter-branch", "filter-repo"].includes(a[0]) },
  { name: "git tag --delete + push", severity: "warn", test: (c, a) => c === "git" && a[0] === "tag" && hasFlag(a, "-d", "--delete") },

  { name: "rm -rf (any flag order)", severity: "block", test: (c, a) => c === "rm" && hasFlag(a, "-r", "-R", "--recursive") && hasFlag(a, "-f", "--force") },
  { name: "find -delete / -exec rm", severity: "block", test: (c, a) => c === "find" && (a.includes("-delete") || a.includes("rm")) },
  { name: "rimraf", severity: "block", test: (c, a) => c === "rimraf" || (c === "npx" && a[0] === "rimraf") },
  { name: "PowerShell Remove-Item -Recurse -Force", severity: "block", test: (c, a, tokens) => tokens.includes("Remove-Item") && hasFlag(a, "-Recurse", "-recurse") && hasFlag(a, "-Force", "-force") },
  { name: "cmd.exe recursive delete", severity: "block", test: (c, a) => ["del", "rd", "rmdir"].includes(c) && hasFlag(a, "/s") && hasFlag(a, "/q") },
  { name: "shred / dd overwrite", severity: "block", test: (c, a) => c === "shred" || (c === "dd" && a.some((x) => x.startsWith("of="))) },
  { name: "chmod -R 000/777 on root-ish path", severity: "warn", test: (c, a) => c === "chmod" && hasFlag(a, "-R", "--recursive") && (a.includes("000") || a.includes("777")) },
];

// ---- scan (with limited recursion into bash -c / eval) -------------------
const NESTED_INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const CODE_EVAL_KEYWORDS = /\brm\s+-rf\b|rmtree\(|rmSync\(|unlinkSync\(|fs\.rm\(/;

function scan(cmd, depth = 0, hits = []) {
  if (depth > 3) return hits;
  for (const seg of splitSegments(cmd)) {
    const tokens = tokenize(seg);
    if (tokens.length === 0) continue;
    const { cmd: c, args } = commandAndArgs(tokens);

    for (const rule of rules) {
      if (rule.test(c, args, tokens)) hits.push({ rule: rule.name, severity: rule.severity, segment: seg, depth });
    }

    // Recurse into `bash -c "..."` / `sh -c "..."` / `eval "..."`
    if (NESTED_INTERPRETERS.has(c) && args.includes("-c")) {
      const idx = args.indexOf("-c");
      const nested = args.slice(idx + 1).join(" ");
      if (nested) scan(nested, depth + 1, hits);
    } else if (c === "eval") {
      const nested = args.join(" ");
      if (nested) scan(nested, depth + 1, hits);
    } else if (["node", "python", "python3", "ruby", "perl"].includes(c) && (args.includes("-e") || args.includes("-c"))) {
      const nested = args.join(" ");
      if (CODE_EVAL_KEYWORDS.test(nested)) {
        hits.push({ rule: `${c} -e/-c contains destructive filesystem call`, severity: "warn", segment: seg, depth });
      }
    }
  }
  return hits;
}

const hits = scan(rawCmd);

// ---- audit log (always — allowed and blocked both) ------------------------
try {
  const logDir = ".claude/logs";
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  appendFileSync(
    `${logDir}/git-guard.log`,
    JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      command: rawCmd,
      matched: hits.map((h) => ({ rule: h.rule, severity: h.severity, depth: h.depth })),
    }) + "\n"
  );
} catch {
  // logging must never break the hook
}

// ---- decision --------------------------------------------------------
const blocking = hits.filter((h) => h.severity === "block");

if (blocking.length > 0) {
  const reasons = [...new Set(blocking.map((h) => h.rule))];
  process.stderr.write(
    `Blocked by git-guard hook: ${reasons.join(", ")}\n` +
      `Command: ${rawCmd}\n` +
      `If this is intentional, run it manually outside the agent session.\n`
  );
  process.exit(2); // PreToolUse: exit 2 blocks the call; stderr is surfaced to Claude
}

process.exit(0);
