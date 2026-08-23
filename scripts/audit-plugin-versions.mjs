#!/usr/bin/env bun
//
// Plugin / runtime version audit script.
//
// Read-only audit of pinned dependencies in the Tastile workspace.
// - Reads .mcp.json, .codex/config.toml, and tastile-web/package.json
// - Compares each pinned version against npm view <pkg> version
// - Emits a deterministic report; never writes to any file
//
// Exit codes:
//   0 = PASS — all pinned versions match latest, or no network resolution
//   1 = OUTDATED — at least one pinned version is behind latest
//   2 = BLOCKED — external prerequisite (network, npm registry) unreachable
//
// Per policy §30, never writes report files into the repository root.
// Stdout-only output. Caller can redirect to .tmp/audit-plugin-versions.json.
//
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const targets = [
  { name: "chrome-devtools-mcp", source: ".mcp.json", kind: "mcp" },
  { name: "chrome-devtools-mcp", source: ".codex/config.toml", kind: "mcp-toml" },
  { name: "@upstash/context7-mcp", source: ".mcp.json", kind: "mcp" },
  { name: "@upstash/context7-mcp", source: ".codex/config.toml", kind: "mcp-toml" },
  { name: "@biomejs/biome", source: "tastile-web/package.json", kind: "pkg-dev" },
  { name: "knip", source: "tastile-web/package.json", kind: "pkg-dev" },
  { name: "vitest", source: "tastile-web/package.json", kind: "pkg-dev" },
  { name: "@vitest/coverage-v8", source: "tastile-web/package.json", kind: "pkg-dev" },
  { name: "@playwright/test", source: "tastile-web/package.json", kind: "pkg-dev" },
  { name: "next", source: "tastile-web/package.json", kind: "pkg-dep" },
  { name: "openapi-typescript", source: "tastile-web/package.json", kind: "pkg-dev" },
];

async function readJson(relativePath) {
  const text = await readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(text);
}

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function extractMcpPinnedVersion(mcpJson, packageName) {
  const servers = mcpJson?.mcpServers ?? {};
  for (const server of Object.values(servers)) {
    const args = server?.args ?? [];
    for (const arg of args) {
      if (typeof arg !== "string") continue;
      const match = arg.match(/^(@[^@]+|[^@]+)@(.+)$/);
      if (match && match[1] === packageName) return match[2];
    }
  }
  return null;
}

function extractTomlPinnedVersion(tomlText, packageName) {
  const lines = tomlText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^"(@[^@"]+|[^@"]+)@([^"]+)"(?:,|$)/);
    if (match && match[1] === packageName) return match[2];
  }
  return null;
}

function extractPackageJsonVersion(pkgJson, packageName, kind) {
  if (kind === "pkg-dev") return pkgJson?.devDependencies?.[packageName] ?? null;
  if (kind === "pkg-dep") return pkgJson?.dependencies?.[packageName] ?? null;
  return null;
}

function resolvePinned(target) {
  return readJson(target.source)
    .then((content) => {
      if (target.kind === "mcp") return extractMcpPinnedVersion(content, target.name);
      if (target.kind === "pkg-dev" || target.kind === "pkg-dep")
        return extractPackageJsonVersion(content, target.name, target.kind);
      return null;
    })
    .catch(async () => {
      if (target.kind === "mcp-toml") {
        const text = await readText(target.source);
        return extractTomlPinnedVersion(text, target.name);
      }
      throw new Error(`Cannot read ${target.source}`);
    });
}

function queryLatest(packageName) {
  return new Promise((resolve) => {
    const child = spawn("bunx", ["-y", "npm", "view", packageName, "version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve({ ok: false, error: "spawn_failed", stderr }));
    child.on("close", (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        resolve({ ok: true, latest: trimmed });
      } else {
        resolve({ ok: false, error: `exit_${code}`, stderr: stderr.trim() });
      }
    });
  });
}

function stripRange(pinned) {
  if (!pinned) return null;
  // strip leading ^, ~, >=, =, and trailing wildcards like 1.2.x
  return pinned.replace(/^[\^~>=]+/, "").replace(/\.x$/, "");
}

function compareSemver(current, latest) {
  const parse = (v) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10));
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if (![cMaj, cMin, cPat, lMaj, lMin, lPat].every(Number.isFinite)) return null;
  if (cMaj !== lMaj) return "major";
  if (cMin !== lMin) return "minor";
  if (cPat !== lPat) return "patch";
  return "current";
}

async function main() {
  const now = new Date().toISOString();
  const results = [];
  let outdatedCount = 0;
  let blockedCount = 0;

  for (const target of targets) {
    const pinnedRaw = await resolvePinned(target).catch(() => null);
    const pinned = stripRange(pinnedRaw);
    const query = await queryLatest(target.name);
    if (!query.ok) {
      blockedCount += 1;
      results.push({
        name: target.name,
        source: target.source,
        kind: target.kind,
        pinned: pinnedRaw,
        latest: null,
        status: "blocked",
        detail: query.error ?? "network_failed",
      });
      continue;
    }
    const cmp = pinned ? compareSemver(pinned, query.latest) : null;
    const status = cmp === null || cmp === "current" ? "current" : "outdated";
    if (status === "outdated") outdatedCount += 1;
    results.push({
      name: target.name,
      source: target.source,
      kind: target.kind,
      pinned: pinnedRaw,
      latest: query.latest,
      drift: cmp,
      status,
    });
  }

  const report = {
    auditedAt: now,
    repoRoot,
    targets: results,
    summary: {
      total: targets.length,
      current: targets.length - outdatedCount - blockedCount,
      outdated: outdatedCount,
      blocked: blockedCount,
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (blockedCount > 0 && outdatedCount === 0) {
    process.exit(2);
  }
  if (outdatedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

await main();
