import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..");
const HOOK_DIR = join(REPO_ROOT, ".claude", "hooks");
const TEMP_ROOT = join(REPO_ROOT, ".tmp");
const createdDirectories = [];

mkdirSync(TEMP_ROOT, { recursive: true });

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createEvent(command = "git status") {
  const cwd = mkdtempSync(join(TEMP_ROOT, "hook-event-"));
  createdDirectories.push(cwd);
  return JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8"));
}

describe("project hook adapters", () => {
  test("Claude resolves the shared dispatcher from a nested working directory", () => {
    const settings = loadJson(".claude/settings.json");
    const handler = settings.hooks.PreToolUse[0].hooks[0];
    const args = (handler.args ?? []).map((argument) =>
      argument.replaceAll("${CLAUDE_PROJECT_DIR}", REPO_ROOT),
    );

    const result = spawnSync(handler.command, args, {
      cwd: join(REPO_ROOT, "tastile-web", "src"),
      encoding: "utf8",
      input: createEvent(),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("Codex has one Tastile Bash hook and resolves it from a nested working directory", () => {
    const settings = loadJson(".codex/hooks.json");
    const handlers = settings.hooks.PreToolUse.filter(({ matcher = "" }) =>
      new RegExp(matcher || ".*").test("Bash"),
    ).flatMap(({ hooks }) => hooks);

    expect(handlers).toHaveLength(1);

    const handler = handlers[0];
    const command =
      process.platform === "win32" ? (handler.commandWindows ?? handler.command) : handler.command;
    const result = spawnSync(command, {
      cwd: join(REPO_ROOT, "tastile-web", "src"),
      encoding: "utf8",
      input: createEvent(),
      shell: true,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  for (const { name, nestedDirectory } of [
    { name: "tastile-core", nestedDirectory: "crates-v1" },
    { name: "tastile-android", nestedDirectory: "app/src" },
    { name: "tastile-desktop", nestedDirectory: "src" },
  ]) {
    test(`${name} resolves its standalone Claude guard from a nested working directory`, () => {
      const projectRoot = join(REPO_ROOT, name);
      const settings = JSON.parse(
        readFileSync(join(projectRoot, ".claude", "settings.json"), "utf8"),
      );
      const handler = settings.hooks.PreToolUse[0].hooks[0];
      const replaceProjectRoot = (value) =>
        value.replaceAll("${CLAUDE_PROJECT_DIR}", projectRoot);
      const options = {
        cwd: join(projectRoot, nestedDirectory),
        encoding: "utf8",
        input: createEvent(),
      };
      const result = handler.args
        ? spawnSync(handler.command, handler.args.map(replaceProjectRoot), options)
        : spawnSync(replaceProjectRoot(handler.command), { ...options, shell: true });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });
  }
});

describe("hook dispatcher", () => {
  test("returns the command-policy decision without requiring PowerShell", () => {
    const result = spawnSync("bun", [join(HOOK_DIR, "hook-dispatch.mjs"), "codex"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: createEvent("npm install"),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("routes git -C child mutations through the command-policy guard", () => {
    const result = spawnSync("bun", [join(HOOK_DIR, "hook-dispatch.mjs"), "codex"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: createEvent("git -C tastile-core status; git -C tastile-web add ."),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("denies a command when a selected guard script is missing", () => {
    const sandbox = mkdtempSync(join(TEMP_ROOT, "hook-dispatch-"));
    createdDirectories.push(sandbox);
    const sandboxHookDir = join(sandbox, ".claude", "hooks");
    mkdirSync(sandboxHookDir, { recursive: true });
    const sandboxDispatcher = join(sandboxHookDir, "hook-dispatch.mjs");
    copyFileSync(join(HOOK_DIR, "hook-dispatch.mjs"), sandboxDispatcher);

    const result = spawnSync("bun", [sandboxDispatcher, "codex"], {
      cwd: sandbox,
      encoding: "utf8",
      input: createEvent(),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git-guard");
    expect(result.stderr).toContain("missing");
  });

  test("translates an unexpected guard failure into a blocking hook failure", () => {
    const sandbox = mkdtempSync(join(TEMP_ROOT, "hook-dispatch-"));
    createdDirectories.push(sandbox);
    const sandboxHookDir = join(sandbox, ".claude", "hooks");
    mkdirSync(sandboxHookDir, { recursive: true });
    const sandboxDispatcher = join(sandboxHookDir, "hook-dispatch.mjs");
    copyFileSync(join(HOOK_DIR, "hook-dispatch.mjs"), sandboxDispatcher);
    writeFileSync(join(sandboxHookDir, "git-guard.mjs"), "process.exit(1);\n");

    const result = spawnSync("bun", [sandboxDispatcher, "codex"], {
      cwd: sandbox,
      encoding: "utf8",
      input: createEvent(),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git-guard");
    expect(result.stderr).toContain("exit 1");
  });
});
