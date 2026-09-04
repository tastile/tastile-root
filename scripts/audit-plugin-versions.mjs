#!/usr/bin/env bun
//
// Plugin / runtime version audit script.
//
// Read-only audit of pinned dependencies in the Tastile workspace.
// - npm ecosystem (web / MCP): reads .mcp.json, .codex/config.toml,
//   tastile-web/package.json, and compares each pinned version against
//   `npm view <pkg> version` (existing 11-target set)
// - cargo ecosystem (core): reads tastile-core/crates-v1/Cargo.toml
//   [workspace.dependencies] and dumps pinned versions (no network resolution;
//   `cargo search` integration is deferred to CI per docs/kiban/deps-bump-log)
// - gradle ecosystem (android): reads tastile-android/build.gradle.kts,
//   tastile-android/app/build.gradle.kts, and
//   tastile-android/app/lint-rules/build.gradle.kts; dumps pinned versions
//   (Maven Central / Google Maven drift check deferred to CI)
// - nuget ecosystem (desktop): reads tastile-desktop/**/*.csproj
//   <PackageReference> elements and dumps pinned versions
//   (NuGet drift check deferred to CI)
//
// Exit codes:
//   0 = PASS — all npm/MCP pinned versions match latest, or no network resolution
//   1 = OUTDATED — at least one npm/MCP pinned version is behind latest
//   2 = BLOCKED — external prerequisite (network, npm registry) unreachable
//
// The cargo/gradle/nuget sections never affect exit codes (info-only).
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

// ---- cargo (tastile-core/crates-v1/Cargo.toml) ----
//
// Reads [workspace.dependencies] entries. Skips `path = "..."` deps
// (workspace-internal crates; kiban-substrate, domain, storage, api,
// worker, cli — they have no external latest to compare against).
async function readCargoWorkspaceDeps() {
  const file = "tastile-core/crates-v1/Cargo.toml";
  const text = await readText(file).catch(() => null);
  if (!text) return { source: file, deps: [] };
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const deps = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inSection = line === "[workspace.dependencies]";
      continue;
    }
    if (!inSection || !line || line.startsWith("#")) continue;
    // Match either `<name> = "X.Y.Z"` or `<name> = { version = "X.Y.Z", ... }`
    const simple = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"\s*$/);
    if (simple) {
      deps.push({ name: simple[1], version: simple[2] });
      continue;
    }
    const inline = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{([^}]+)\}\s*$/);
    if (inline) {
      const inner = inline[2];
      const verMatch = inner.match(/version\s*=\s*"([^"]+)"/);
      const pathMatch = inner.match(/path\s*=\s*"([^"]+)"/);
      if (pathMatch && !verMatch) continue; // workspace-internal
      if (verMatch) {
        const featuresMatch = inner.match(/features\s*=\s*\[([^\]]*)\]/);
        const features = featuresMatch
          ? Array.from(featuresMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
          : [];
        deps.push({ name: inline[1], version: verMatch[1], features });
      }
    }
  }
  return { source: file, deps };
}

// ---- gradle (tastile-android/**/*.gradle.kts) ----
//
// Walks the listed build files and extracts literal version strings of the
// shape `"X.Y.Z"`, `"X.Y"`, or `"X.Y.Z-rcN"`. Keeps the first literal per
// `group:name = "..."` token; treats everything else as a comment / config
// block. Drift check is deferred to Maven Central / Google Maven via CI.
async function readGradleVersions() {
  const files = [
    "tastile-android/build.gradle.kts",
    "tastile-android/app/build.gradle.kts",
    "tastile-android/app/lint-rules/build.gradle.kts",
  ];
  const out = [];
  for (const rel of files) {
    const text = await readText(rel).catch(() => null);
    if (!text) {
      out.push({ source: rel, deps: [], note: "missing" });
      continue;
    }
    const deps = [];
    // Match `group = "x.y.z"`, `version = "x.y.z"`, `"group:artifact:x.y.z"`
    const seen = new Set();
    const literalRe = /"([0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?)"/g;
    for (const match of text.matchAll(literalRe)) {
      const v = match[1];
      if (seen.has(v)) continue;
      // Heuristic: only record versions that look like a stable/pre-release
      // semantic version with at least two numeric segments.
      if (!/^\d+\.\d+/.test(v)) continue;
      seen.add(v);
      deps.push({ name: "literal", version: v });
    }
    out.push({ source: rel, deps });
  }
  return out;
}

// ---- nuget (tastile-desktop/**/*.csproj) ----
//
// Extracts <PackageReference Include="..." Version="..." /> from listed
// .csproj files. Skips project references and Version-less refs.
// Drift check deferred to NuGet API via CI.
async function readNuGetReferences() {
  const out = [];
  const csprojFiles = [
    "tastile-desktop/src/TastileDesktop/TastileDesktop.csproj",
    "tastile-desktop/tests/TastileDesktop.Tests/TastileDesktop.Tests.csproj",
  ];
  for (const rel of csprojFiles) {
    const text = await readText(rel).catch(() => null);
    if (!text) {
      out.push({ source: rel, deps: [], note: "missing" });
      continue;
    }
    const deps = [];
    const pkgRe =
      /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/>/g;
    for (const match of text.matchAll(pkgRe)) {
      deps.push({ name: match[1], version: match[2] });
    }
    out.push({ source: rel, deps });
  }
  return out;
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

  // Info-only pinned dumps (cargo / gradle / nuget). These never affect exit
  // codes; they exist so the audit output doubles as a baseline inventory.
  const cargo = await readCargoWorkspaceDeps().catch((err) => ({
    source: "tastile-core/crates-v1/Cargo.toml",
    deps: [],
    error: String(err?.message ?? err),
  }));
  const gradle = await readGradleVersions().catch((err) => ({
    error: String(err?.message ?? err),
  }));
  const nuget = await readNuGetReferences().catch((err) => ({
    error: String(err?.message ?? err),
  }));

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
    pinnedInventory: {
      cargo,
      gradle,
      nuget,
    },
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
