// Renders architecture/views/*.d2 to SVG with a pinned D2 version and records a manifest
// (d2 source hash → svg) so validate.ts can detect stale renders without needing D2 installed.
//   bun scripts/architecture/render.ts            → exit 0 rendered / 1 render error / 2 BLOCKED (d2 missing or wrong version)
// D2 binary lookup: $D2_BIN, then `d2` on PATH, then .tmp/tools/d2-v<version>/bin/d2 (workspace scratch install).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAll } from "./generate.ts";
import { ROOT, loadModel } from "./model.ts";

export const D2_VERSION = "0.9.0";

function findD2(): string | null {
  const candidates = [process.env.D2_BIN, Bun.which("d2"), join(ROOT, ".tmp", "tools", `d2-v${D2_VERSION}`, "bin", "d2")];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

const d2 = findD2();
if (!d2) {
  console.error(`BLOCKED: d2 v${D2_VERSION} not found (set D2_BIN or install from github.com/terrastruct/d2/releases/tag/v${D2_VERSION})`);
  process.exit(2);
}
const version = Bun.spawnSync([d2, "--version"]).stdout.toString().trim();
if (version !== `v${D2_VERSION}`) {
  console.error(`BLOCKED: d2 ${version} found, v${D2_VERSION} required (layout output differs between versions)`);
  process.exit(2);
}

const model = loadModel();
const views: Record<string, { d2_sha256: string; svg: string }> = {};
let failed = 0;
for (const [rel, content] of generateAll(model)) {
  if (!rel.endsWith(".d2")) continue;
  const src = join(ROOT, rel);
  if (!existsSync(src) || readFileSync(src, "utf8") !== content) {
    console.error(`stale source ${rel}: run bun run architecture:generate first`);
    process.exit(1);
  }
  const svgRel = rel.replace(/\.d2$/, ".svg");
  const r = Bun.spawnSync([d2, "--layout", "elk", "--pad", "40", src, join(ROOT, svgRel)], { stderr: "pipe", stdout: "pipe" });
  if (r.exitCode !== 0) {
    failed++;
    console.error(`FAIL ${rel}\n${r.stderr.toString()}`);
    continue;
  }
  views[rel] = { d2_sha256: createHash("sha256").update(content).digest("hex"), svg: svgRel };
  console.log(`rendered ${svgRel}`);
}
if (failed) process.exit(1);
writeFileSync(
  join(ROOT, "architecture", "views", "render-manifest.json"),
  `${JSON.stringify({ generator: "scripts/architecture/render.ts", d2: `v${D2_VERSION}`, layout: "elk", views }, null, 2)}\n`,
);
console.log(`render manifest updated (${Object.keys(views).length} views)`);
