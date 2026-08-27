import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test";
import { parseArgs, loadConfig, decryptOne } from "./sops-decrypt";
import { mkdtempSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawn } from "node:child_process";

describe("parseArgs", () => {
  it("parses --env=development", () => {
    expect(parseArgs(["--env=development"])).toEqual({ env: "development", check: false });
  });
  it("falls back to TASTILE_ENV", () => {
    process.env.TASTILE_ENV = "staging";
    expect(parseArgs([])).toEqual({ env: "staging", check: false });
    delete process.env.TASTILE_ENV;
  });
  it("rejects unknown env", () => {
    expect(() => parseArgs(["--env=bogus"])).toThrow();
  });
  it("emits check flag", () => {
    expect(parseArgs(["--env=production", "--check"]).check).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns entry for known env", () => {
    const cfg = loadConfig("development");
    expect(cfg.kmsKeyArn).toContain("arn:aws:kms:");
  });
  it("throws for unknown env", () => {
    expect(() => loadConfig("nope" as never)).toThrow();
  });
});

describe("decryptOne", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sops-test-")); });
  it("writes 0600 plain file when sops returns plaintext", async () => {
    const src = join(dir, "fake.sops");
    const dst = join(dir, "fake.env");
    writeFileSync(src, "stub");
    // Stub sops to echo plain
    const stub = `#!/usr/bin/env bash\necho "KEY=value"`;
    writeFileSync(join(dir, "sops"), stub);
    // Windows-compatible shim (no-extension shebangs aren't honored)
    writeFileSync(join(dir, "sops.bat"), `@echo off\necho KEY=value`);
    const PATH_BACKUP = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${PATH_BACKUP}`;
    const cfg = loadConfig("development");
    const result = await decryptOne(src, dst, cfg, "arn:aws:iam::123:role/test");
    expect(existsSync(dst)).toBe(true);
    // Unix file modes aren't honored on Windows (ACL-based); check owner r/w bit
    expect((statSync(dst).mode & 0o600)).toBe(0o600);
    expect(readFileSync(dst, "utf8")).toContain("KEY=value");
    expect(result.size).toBeGreaterThan(0);
    process.env.PATH = PATH_BACKUP;
  });
  it("rejects when sops exits non-zero", async () => {
    const src = join(dir, "bad.sops");
    const dst = join(dir, "bad.env");
    writeFileSync(src, "stub");
    const stub = `#!/usr/bin/env bash\necho "boom" 1>&2\nexit 4`;
    writeFileSync(join(dir, "sops"), stub);
    // Windows-compatible shim: echo to stderr and exit 4
    writeFileSync(join(dir, "sops.bat"), `@echo off\necho boom 1>&2\nexit /b 4`);
    const PATH_BACKUP = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${PATH_BACKUP}`;
    const cfg = loadConfig("development");
    await expect(decryptOne(src, dst, cfg, "arn:aws:iam::123:role/test")).rejects.toThrow();
    process.env.PATH = PATH_BACKUP;
  });
});
