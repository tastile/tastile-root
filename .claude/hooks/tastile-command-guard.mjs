#!/usr/bin/env bun
// Tastile-specific PreToolUse policy for Bash commands.
//
// Keep this guard portable: it runs for routine commands on both WSL and
// Windows, while the PowerShell-based pre-commit review is selected only for
// commands that publish repository state.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const PACKAGE_MANAGER =
  /(^|[;&|\s])(npm\s+(install|i|run)\b|npx\b|yarn\s+(install|add|run)\b|^yarn\b|pnpm\s+(install|add|run)\b|^pnpm\b)/i;
const CORE_PATH = /(^|[\\/])tastile-core([\\/]|$)/i;
const CARGO_EXECUTION =
  /(^|\s)cargo(?:\s+\+\S+)?(?:\s+(?!--?build\b|--?test\b|--?check\b|--?run\b|--?bench\b)--?\S+(?:\s+(?!\+?build\b|\+?test\b|\+?check\b|\+?run\b|\+?bench\b|--\S+)\S+)*)*\s+(build|test|check|run|bench)\b/i;
const WSLC_CONTAINER = /^\s*wslc\s+container\b/i;
const ANDROID_PATH = /(^|[\\/])tastile-android([\\/]|$)/i;
const ANDROID_GRADLE = /(^|[;&|\s])(?:\.?[\\/])*(?:tastile-android[\\/])?gradlew(?:\.bat)?\b/i;
const CHILD_PATH = /(^|[\\/])tastile-(core|web|android|desktop|brands)([\\/]|$)/i;
const GIT_COMMAND = /(^|[;&|\s])git(?:\.exe)?\b/i;
const ROOT_CHILD_ADD_OR_COMMIT =
  /\bgit(?:\.exe)?\s+(?:add|commit)\b/i;
const CHILD_REFERENCE = /tastile-(?:core|web|android|desktop|brands)/i;
const CHILD_REFERENCES = /tastile-(?:core|web|android|desktop|brands)/gi;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function commandSegments(command) {
  return command
    .split(/(?<![>|&])[;&|](?![|&])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function javaCandidates(javaHome) {
  if (typeof javaHome !== "string" || !javaHome.trim()) return [];
  const trimmed = javaHome.trim();
  const home = isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  return ["java.exe", "java.cmd", "java"].map((name) => join(home, "bin", name));
}

function runJavaVersion(java) {
  if (process.platform === "win32" && java.toLowerCase().endsWith(".cmd")) {
    if (java.includes('"')) return null;
    const commandProcessor = process.env.ComSpec || "cmd.exe";
    return spawnSync(commandProcessor, ["/d", "/s", "/c", `""${java}" -version"`], {
      encoding: "utf8",
      windowsHide: true,
    });
  }
  return spawnSync(java, ["-version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function isJava17(javaHome) {
  const java = javaCandidates(javaHome).find(isFile);
  if (!java) return false;
  try {
    const result = runJavaVersion(java);
    if (!result || result.status !== 0) return false;
    const versionOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    return /^\s*(?:openjdk|java) version "17(?:[._]|")/im.test(versionOutput);
  } catch {
    return false;
  }
}

function configuredGradleJavaHome(propertiesPath) {
  if (!propertiesPath || !isFile(propertiesPath)) return "";
  try {
    const match = readFileSync(propertiesPath, "utf8").match(
      /^\s*org\.gradle\.java\.home\s*=\s*(.+?)\s*$/im,
    );
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const command =
  typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
if (!command.trim()) process.exit(0);

const cwd = typeof payload?.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();

if (PACKAGE_MANAGER.test(command)) {
  deny("Use bun install, bun add, bun run, or bunx instead of npm/npx/yarn/pnpm.");
}

const isCore = CORE_PATH.test(cwd) || CORE_PATH.test(command);
const unsafeCargo = commandSegments(command).some(
  (segment) => CARGO_EXECUTION.test(segment) && !WSLC_CONTAINER.test(segment),
);
if (isCore && unsafeCargo) {
  deny("Run tastile-core cargo build/test/check/run/bench through wslc container only.");
}

const isAndroidGradle =
  (ANDROID_PATH.test(cwd) || ANDROID_PATH.test(command)) && ANDROID_GRADLE.test(command);
if (isAndroidGradle) {
  let propertiesPath = process.env.TASTILE_GUARD_GRADLE_PROPERTIES?.trim() ?? "";
  if (!propertiesPath) {
    const androidRoot = ANDROID_PATH.test(cwd) ? cwd : join(cwd, "tastile-android");
    const candidate = join(androidRoot, "gradle.properties");
    if (isFile(candidate)) propertiesPath = candidate;
  }

  const pinnedJavaHome = configuredGradleJavaHome(propertiesPath);
  if (!isJava17(pinnedJavaHome) && !isJava17(process.env.JAVA_HOME ?? "")) {
    deny(
      "Android Gradle commands require Java 17 or a gradle.properties org.gradle.java.home JDK17 pin.",
    );
  }
}

const isRoot = !CHILD_PATH.test(cwd);
const isGit = GIT_COMMAND.test(command);
const gitSegmentCount = countMatches(command, /(?:^|[;&|])\s*git(?:\.exe)?\b/gi);
const readOnlyGitSegmentCount = countMatches(
  command,
  /(?:^|[;&|])\s*git(?:\.exe)?\s+(?:-C\s+[^\s;|]+\s+)*(status|diff|log|show|branch\s+--show-current)\b/gi,
);
const allGitReadOnly = gitSegmentCount > 0 && readOnlyGitSegmentCount === gitSegmentCount;
const childReferences = new Set(
  (command.match(CHILD_REFERENCES) ?? []).map((reference) => reference.toLowerCase()),
);

if (isRoot && isGit && !allGitReadOnly && childReferences.size >= 2) {
  deny("Do not mutate multiple independent tastile-* child repositories from the workspace root.");
}
if (
  isRoot &&
  ROOT_CHILD_ADD_OR_COMMIT.test(command) &&
  CHILD_REFERENCE.test(command)
) {
  deny("Run git add/commit inside the specific child repository, not from the workspace root.");
}

process.exit(0);
