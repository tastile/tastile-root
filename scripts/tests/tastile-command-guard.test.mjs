import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..");
const GUARD = join(REPO_ROOT, ".claude", "hooks", "tastile-command-guard.mjs");
const TEMP_ROOT = join(REPO_ROOT, ".tmp");
const createdDirectories = [];

mkdirSync(TEMP_ROOT, { recursive: true });

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeJava17() {
  const jdk = mkdtempSync(join(TEMP_ROOT, "jdk-17-"));
  createdDirectories.push(jdk);
  const bin = join(jdk, "bin");
  mkdirSync(bin, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(bin, "java.cmd"), '@echo off\r\necho openjdk version "17.0.12" 1>&2\r\n');
  } else {
    const java = join(bin, "java");
    writeFileSync(java, '#!/bin/sh\necho \'openjdk version "17.0.12"\' >&2\n');
    chmodSync(java, 0o755);
  }
  return jdk;
}

function createGradleProperties(contents) {
  const directory = mkdtempSync(join(TEMP_ROOT, "gradle-properties-"));
  createdDirectories.push(directory);
  const path = join(directory, "gradle.properties");
  writeFileSync(path, contents);
  return path;
}

function invokeGuard(testCase) {
  const env = { ...process.env };
  if (testCase.javaHome !== undefined) env.JAVA_HOME = testCase.javaHome;

  if (testCase.gradleProperties !== undefined) {
    env.TASTILE_GUARD_GRADLE_PROPERTIES = createGradleProperties(testCase.gradleProperties);
  } else if (testCase.fakeJava17) {
    const jdk = createFakeJava17();
    env.TASTILE_GUARD_GRADLE_PROPERTIES = createGradleProperties(
      `org.gradle.java.home=${jdk}\n`,
    );
  } else {
    delete env.TASTILE_GUARD_GRADLE_PROPERTIES;
  }

  const input =
    testCase.rawPayload ??
    JSON.stringify({
      cwd: testCase.cwd,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: testCase.command },
    });

  return spawnSync("bun", [GUARD], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    input,
  });
}

const rootCases = [
  ["blocks npm install", "npm install", "deny"],
  ["blocks npm run", "npm run test", "deny"],
  ["blocks npx", "npx prettier .", "deny"],
  ["blocks yarn install", "yarn install", "deny"],
  ["blocks pnpm install", "pnpm install", "deny"],
  ["allows bun install", "bun install", "allow"],
  ["allows bun run", "bun run test", "allow"],
  ["allows bunx", "bunx prettier .", "allow"],
  ["allows harmless commands", "printf hello", "allow"],
  ["blocks a root child add", "git add tastile-core/src tastile-web/src", "deny"],
  ["blocks a root child commit", "git commit -m msg tastile-core/src/lib.rs", "deny"],
  [
    "blocks a root multi-child mutation",
    "git -C tastile-core status; git -C tastile-web add .",
    "deny",
  ],
  [
    "allows read-only child commands",
    "git -C tastile-core status; git -C tastile-web diff; git -C tastile-android log -1",
    "allow",
  ],
];

describe("Tastile command guard", () => {
  for (const [name, command, expected] of rootCases) {
    test(name, () => {
      const result = invokeGuard({ command, cwd: REPO_ROOT });
      expect(result.status).toBe(0);
      if (expected === "allow") {
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      } else {
        const output = JSON.parse(result.stdout);
        expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
        expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
        expect(output.hookSpecificOutput.permissionDecisionReason).toBeString();
      }
    });
  }

  for (const command of [
    "cargo test",
    "printf wsl --exec; cargo test",
    "cargo +stable test",
    "cargo --locked --color always check",
    "wsl --exec bash -lc 'cd /workspace/tastile-core && cargo test'",
    "cargo run",
    "cargo bench",
  ]) {
    test(`blocks host core execution: ${command}`, () => {
      const result = invokeGuard({ command, cwd: join(REPO_ROOT, "tastile-core") });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    });
  }

  test("allows core execution through wslc", () => {
    const result = invokeGuard({
      command: "wslc container run --rm tastile-v1-api cargo test",
      cwd: join(REPO_ROOT, "tastile-core"),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("allows a child-local mutation", () => {
    const result = invokeGuard({ command: "git add src", cwd: join(REPO_ROOT, "tastile-core") });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  for (const { name, command, cwd } of [
    {
      name: "blocks Android Gradle with a non-17 JAVA_HOME",
      command: "./gradlew test",
      cwd: join(REPO_ROOT, "tastile-android"),
    },
    {
      name: "blocks root Android Gradle with a non-17 JAVA_HOME",
      command: "./tastile-android/gradlew -p tastile-android test",
      cwd: REPO_ROOT,
    },
  ]) {
    test(name, () => {
      const result = invokeGuard({ command, cwd, javaHome: "/missing/jdk-11" });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    });
  }

  test("blocks Android Gradle with a nonexistent JDK 17 pin", () => {
    const result = invokeGuard({
      command: "./gradlew test",
      cwd: join(REPO_ROOT, "tastile-android"),
      gradleProperties: "org.gradle.java.home=/missing/jdk-17\n",
      javaHome: "/missing/jdk-11",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("allows Android Gradle with a verified JDK 17 pin", () => {
    const result = invokeGuard({
      command: "./gradlew test",
      cwd: join(REPO_ROOT, "tastile-android"),
      fakeJava17: true,
      javaHome: "/missing/jdk-11",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  for (const testCase of [
    { name: "allows malformed JSON", rawPayload: "{not-json" },
    { name: "allows an empty command", command: "", cwd: REPO_ROOT },
    { name: "allows a whitespace command", command: "   ", cwd: REPO_ROOT },
  ]) {
    test(testCase.name, () => {
      const result = invokeGuard(testCase);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });
  }
});
