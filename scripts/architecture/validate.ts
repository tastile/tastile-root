// Validates the Tastile architecture SoT.
//   bun scripts/architecture/validate.ts               → root checks (exit 0 PASS / 1 FAIL / 2 BLOCKED)
//   bun scripts/architecture/validate.ts --cross-repo  → also audit sibling checkouts for stale canonical claims
//   add --strict to make cross-repo advisories blocking; --json <path> writes a machine-readable result.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { costSummary, generateAll } from "./generate.ts";
import {
  type Doc,
  MODEL_FILES,
  type Model,
  ROOT,
  SCHEMA_DIR,
  headingAnchors,
  loadModel,
  repoLocalPath,
} from "./model.ts";

type Level = "error" | "advisory" | "info";
interface Finding {
  level: Level;
  code: string;
  message: string;
}
const findings: Finding[] = [];
const add = (level: Level, code: string, message: string) => findings.push({ level, code, message });

const args = new Set(process.argv.slice(2));
const jsonIdx = process.argv.indexOf("--json");
const jsonPath = jsonIdx > 0 ? process.argv[jsonIdx + 1] : undefined;

// ------------------------------------------------------------------ 1. schema
function checkSchemas(model: Model) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const common = JSON.parse(readFileSync(join(SCHEMA_DIR, "common.schema.json"), "utf8"));
  ajv.addSchema(common, "common.json");
  for (const file of MODEL_FILES) {
    const schemaPath = join(SCHEMA_DIR, `${file}.schema.json`);
    if (!existsSync(schemaPath)) {
      add("error", "schema.missing", `no schema for ${file}.yaml`);
      continue;
    }
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const validate = ajv.compile(schema);
    if (!validate(model.docs[file])) {
      for (const e of validate.errors ?? []) {
        add("error", "schema.invalid", `${file}.yaml ${e.instancePath || "/"} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
      }
    }
  }
}

// ------------------------------------------------------------------ 2. references
const PREFIXES = [
  "actor", "sys", "ctr", "cmp", "ext", "rel", "repo", "fd", "term", "iso", "env", "prov", "node", "tz", "cred",
  "dc", "sec", "ctl", "store", "ds", "qg", "slo", "kpi", "poc", "f", "risk", "oq", "ms",
];
const TEXT_REF = new RegExp(`(?<![\\w./:#-])((?:${PREFIXES.join("|")})\\.[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)*|adr\\.root\\.\\d{4})(?![\\w-])`, "g");

function expectRef(model: Model, where: string, value: unknown, allowed: string[]) {
  if (value === undefined || value === null) return;
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const hit = model.index.get(v);
    if (!hit) {
      add("error", "ref.unknown", `${where}: unknown reference '${v}'`);
      continue;
    }
    const prefix = v.split(".")[0];
    if (!allowed.includes(prefix)) add("error", "ref.kind", `${where}: '${v}' must be one of ${allowed.join("/")}`);
  }
}

function walkStrings(value: unknown, visit: (s: string) => void) {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, visit);
  else if (value && typeof value === "object") for (const v of Object.values(value)) walkStrings(v, visit);
}

function checkTextRefs(model: Model, where: string, text: string) {
  for (const m of text.matchAll(TEXT_REF)) {
    const id = m[1].replace(/[.-]+$/, "");
    if (!model.index.has(id)) add("error", "ref.text", `${where}: mentions unknown id '${id}'`);
  }
}

function checkReferences(model: Model) {
  const d = model.docs;
  for (const e of d.elements.elements as Doc[]) {
    expectRef(model, e.id, e.parent, ["sys", "ctr"]);
    expectRef(model, e.id, e.repository, ["repo"]);
    expectRef(model, e.id, e.retire_by, ["ms"]);
  }
  for (const r of d.relationships.relationships as Doc[]) {
    expectRef(model, r.id, [r.from, r.to], ["actor", "ctr", "cmp", "ext", "repo"]);
    expectRef(model, r.id, r.credential, ["cred"]);
    expectRef(model, r.id, r.current?.credential, ["cred"]);
    expectRef(model, r.id, r.data, ["dc"]);
    expectRef(model, r.id, r.retire_by, ["ms"]);
  }
  for (const r of d.repositories.repositories as Doc[]) expectRef(model, r.id, r.owns, ["fd"]);
  for (const x of d.environments.environments as Doc[]) expectRef(model, x.id, x.retire_by, ["ms"]);
  for (const p of d.deployment.providers as Doc[]) {
    expectRef(model, p.id, p.decision, ["adr"]);
    expectRef(model, p.id, p.retire_by, ["ms"]);
  }
  for (const n of d.deployment.nodes as Doc[]) {
    expectRef(model, n.id, n.env, ["env"]);
    expectRef(model, n.id, n.provider, ["prov"]);
    expectRef(model, n.id, n.hosts, ["ctr", "cmp", "ext"]);
    expectRef(model, n.id, n.identity, ["cred"]);
    expectRef(model, n.id, n.retire_by, ["ms"]);
  }
  for (const z of d.security.trust_zones as Doc[]) expectRef(model, z.id, z.members, ["actor", "ctr", "cmp", "ext", "repo"]);
  for (const c of d.security.credentials as Doc[]) {
    expectRef(model, c.id, c.decision, ["adr"]);
    expectRef(model, c.id, c.retire_by, ["ms"]);
  }
  expectRef(model, "security.secret_handling", d.security.secret_handling.decision, ["adr"]);
  for (const s of d.data.stores as Doc[]) expectRef(model, s.id, s.element, ["ctr"]);
  for (const s of d.data.datasets as Doc[]) {
    expectRef(model, s.id, s.store, ["store"]);
    expectRef(model, s.id, s.classes, ["dc"]);
    expectRef(model, s.id, s.owner_repo, ["repo"]);
  }
  for (const s of [...(d.quality.slos as Doc[]), ...(d.quality.engineering_kpis as Doc[])]) expectRef(model, s.id, s.goal, ["qg"]);
  for (const p of d.pocs.pocs as Doc[]) expectRef(model, p.id, p.decides, ["adr"]);
  for (const o of d.risks.open_questions as Doc[]) expectRef(model, o.id, o.owner_repo, ["repo"]);
  for (const m of d.roadmap.milestones as Doc[]) {
    expectRef(model, m.id, m.repos, ["repo"]);
    expectRef(model, m.id, m.depends_on, ["ms"]);
  }
  for (const file of MODEL_FILES) walkStrings(model.docs[file], (s) => checkTextRefs(model, `${file}.yaml`, s));
}

// ------------------------------------------------------------------ 3. lifecycle & consistency
function checkLifecycle(model: Model) {
  const all = [...model.index.values()];
  for (const { id, item } of all) {
    if (item.lifecycle === "retiring" && !item.retire_by) add("error", "lifecycle.retire-by", `${id}: retiring without retire_by`);
  }
  for (const r of model.docs.relationships.relationships as Doc[]) {
    for (const end of [r.from, r.to]) {
      const e = model.index.get(end)?.item;
      if (!e) continue;
      if (r.lifecycle === "retained" && e.lifecycle === "planned")
        add("error", "lifecycle.rel-endpoint", `${r.id}: retained relationship touches planned element ${end}`);
      if (r.lifecycle !== "retiring" && e.lifecycle === "retiring")
        add("error", "lifecycle.rel-endpoint", `${r.id}: target relationship touches retiring element ${end}`);
    }
    const cred = r.credential ? model.index.get(r.credential)?.item : undefined;
    if (cred && r.lifecycle === "retained" && cred.lifecycle === "planned" && !r.current)
      add("error", "lifecycle.rel-credential", `${r.id}: retained relationship uses planned ${r.credential} without a 'current' deviation`);
    if (cred && r.lifecycle !== "retiring" && cred.lifecycle === "retiring")
      add("error", "lifecycle.rel-credential", `${r.id}: target relationship uses retiring ${r.credential}`);
  }
  // roadmap acyclic
  const ms = new Map((model.docs.roadmap.milestones as Doc[]).map((m) => [m.id, m.depends_on ?? []]));
  const state = new Map<string, number>();
  const visit = (id: string, stack: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      add("error", "roadmap.cycle", `dependency cycle: ${[...stack, id].join(" → ")}`);
      return;
    }
    state.set(id, 1);
    for (const dep of ms.get(id) ?? []) visit(dep, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of ms.keys()) visit(id, []);
}

// ------------------------------------------------------------------ 4. trust zones
function checkZones(model: Model) {
  const zoneOf = new Map<string, string[]>();
  for (const z of model.docs.security.trust_zones as Doc[]) for (const m of z.members) zoneOf.set(m, [...(zoneOf.get(m) ?? []), z.id]);
  for (const e of model.docs.elements.elements as Doc[]) {
    if (e.kind === "software_system") continue;
    const zs = zoneOf.get(e.id) ?? [];
    if (zs.length !== 1) add("error", "zone.membership", `${e.id}: must be in exactly one trust zone (found ${zs.length})`);
  }
  for (const r of model.docs.relationships.relationships as Doc[]) {
    const a = zoneOf.get(r.from)?.[0];
    const b = zoneOf.get(r.to)?.[0];
    if (!a || !b || a === b) continue;
    const publicOnly = (r.data ?? []).length > 0 && (r.data as string[]).every((x) => x === "dc.public");
    if (!r.credential && !publicOnly)
      add("error", "zone.unauthenticated-crossing", `${r.id}: crosses ${a} → ${b} without credential (and carries non-public data)`);
  }
}

// ------------------------------------------------------------------ 5. deployment coverage & cost
function checkDeployment(model: Model) {
  const zoneOf = new Map<string, string>();
  for (const z of model.docs.security.trust_zones as Doc[]) for (const m of z.members) zoneOf.set(m, z.id);
  const hosted = new Set<string>();
  for (const n of model.docs.deployment.nodes as Doc[]) {
    if (n.env === "env.production" && n.lifecycle !== "retiring") for (const h of n.hosts) hosted.add(h);
  }
  for (const e of model.docs.elements.elements as Doc[]) {
    if (!["container", "data_store"].includes(e.kind) || e.lifecycle === "retiring") continue;
    if (!["tz.app-runtime", "tz.data", "tz.edge", "tz.public-object"].includes(zoneOf.get(e.id) ?? "")) continue;
    if (!hosted.has(e.id)) add("error", "deploy.unhosted", `${e.id}: server-side container has no production target node`);
  }
  const c = costSummary(model);
  const budget = Number(model.docs.quality.cost_budget.target.pre_launch);
  if (c.total > budget) add("error", "cost.over-budget", `target estimate $${c.total} exceeds pre-launch budget $${budget}`);
  else if (c.totalMax > budget) add("advisory", "cost.upper-bound", `target upper bound $${c.totalMax} exceeds budget $${budget} (expected $${c.total})`);
  add("info", "cost.summary", `target expected $${c.total}/mo, upper $${c.totalMax}/mo, current (unverified) $${c.current}/mo, budget $${budget}/mo`);
}

// ------------------------------------------------------------------ 6. SoT registry
function checkSot(model: Model) {
  const fds = model.docs["sot-registry"].fact_domains as Doc[];
  const owners = new Map<string, string[]>();
  for (const r of model.docs.repositories.repositories as Doc[]) for (const fd of r.owns) owners.set(fd, [...(owners.get(fd) ?? []), r.id]);
  for (const fd of fds) {
    const repo = fd.canonical.repo as string;
    const own = owners.get(fd.id) ?? [];
    if (repo === "external") {
      if (own.length) add("error", "sot.owner", `${fd.id}: live/external fact must not be owned by a repository (${own.join(", ")})`);
    } else if (repo === "*") {
      if (own.length < 1) add("error", "sot.owner", `${fd.id}: per-repository fact must be owned by at least one repository`);
    } else if (own.length !== 1 || own[0] !== repo) {
      add("error", "sot.owner", `${fd.id}: canonical repo ${repo} but owned by [${own.join(", ")}] — exactly one owner, matching canonical, is required`);
    }
    for (const [label, loc] of [["canonical", fd.canonical], ["structured", fd.structured], ...(fd.derived ?? []).map((x: Doc) => ["derived", x])] as [string, Doc | undefined][]) {
      if (!loc || loc.repo === "external" || loc.repo === "*") continue;
      const base = repoLocalPath(model, loc.repo);
      if (!base) {
        add("info", "sot.path-unchecked", `${fd.id} ${label}: ${loc.repo} not checked out locally; path ${loc.path} unchecked`);
        continue;
      }
      if (!existsSync(join(base, loc.path))) add(loc.repo === "repo.root" ? "error" : "advisory", "sot.path-missing", `${fd.id} ${label}: ${loc.repo}:${loc.path} does not exist`);
    }
  }
  for (const [fd] of owners) if (!fds.some((f) => f.id === fd)) add("error", "sot.unknown-fd", `repository owns unregistered ${fd}`);
}

// ------------------------------------------------------------------ 7. glossary
function checkGlossary(model: Model) {
  const core = repoLocalPath(model, "repo.core");
  if (!core) {
    add("info", "glossary.unchecked", "tastile-core not checked out; core domain_ref anchors unchecked");
    for (const t of model.docs.glossary.terms as Doc[]) if (t.domain_ref) add("info", "glossary.unchecked", `${t.id}: ${t.domain_ref} unchecked`);
    return;
  }
  const anchorCache = new Map<string, Set<string>>();
  for (const t of model.docs.glossary.terms as Doc[]) {
    if (!t.domain_ref) continue;
    const [path, anchor] = String(t.domain_ref).replace(/^core:/, "").split("#");
    const abs = join(core, path);
    if (!existsSync(abs)) {
      add("error", "glossary.domain-ref", `${t.id}: ${t.domain_ref} — file missing in tastile-core`);
      continue;
    }
    if (!anchor) continue;
    if (!anchorCache.has(abs)) anchorCache.set(abs, headingAnchors(readFileSync(abs, "utf8")));
    if (!anchorCache.get(abs)?.has(anchor)) add("error", "glossary.domain-ref", `${t.id}: anchor #${anchor} not found in core ${path}`);
  }
}

// ------------------------------------------------------------------ 7b. core product.yaml (foreign schema)
function checkCoreProduct() {
  const core = repoLocalPath(modelGlobal!, "repo.core");
  if (!core) {
    add("info", "core-product.unchecked", "tastile-core not checked out; docs/product/product.yaml unchecked");
    return;
  }
  const docPath = join(core, "docs", "product", "product.yaml");
  const schemaPath = join(core, "docs", "product", "product.schema.json");
  if (!existsSync(docPath) || !existsSync(schemaPath)) {
    add("advisory", "core-product.missing", "core docs/product/product.yaml or product.schema.json missing (canonical for fd.product-definition)");
    return;
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
  const doc = parse(readFileSync(docPath, "utf8")) as Doc;
  if (!validate(doc)) {
    for (const e of validate.errors ?? []) add("advisory", "core-product.schema", `product.yaml ${e.instancePath || "/"} ${e.message}`);
  }
  const oqs = new Set((modelGlobal!.docs.risks.open_questions as Doc[]).map((q) => q.id));
  for (const n of (doc.notes ?? []) as unknown[]) {
    if (typeof n !== "string") continue;
    for (const m of n.matchAll(/(?<![A-Za-z0-9-])(oq\.[a-z0-9-]+)/g))
      if (!oqs.has(m[1])) add("error", "ref.text", `core product.yaml mentions unknown id '${m[1]}'`);
  }
}
let modelGlobal: Model | null = null;

// ------------------------------------------------------------------ 8. prose (forbidden terms + id refs)
function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listMarkdown(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function checkProse(model: Model) {
  const canonicalProse = [
    ...listMarkdown(join(ROOT, "architecture", "docs")),
    join(ROOT, "architecture", "README.md"),
    join(ROOT, "AGENTS.md"),
    join(ROOT, "README.md"),
    join(ROOT, "CLAUDE.md"),
    join(ROOT, "docs", "HARNESS.md"),
  ].filter(existsSync);
  const forbidden = (model.docs.glossary.forbidden_terms as Doc[]).map((f) => ({ ...f, re: new RegExp(f.pattern) }));
  for (const file of canonicalProse) {
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const f of forbidden) if (f.re.test(line)) add("error", "prose.forbidden-term", `${rel}:${i + 1}: '${f.pattern}' — ${f.reason}; use ${f.replacement}`);
    });
    checkTextRefs(model, rel, lines.join("\n"));
  }
  for (const adr of model.adrs) {
    if (Number(adr.number) < 13) continue;
    checkTextRefs(model, adr.path, readFileSync(join(ROOT, adr.path), "utf8"));
  }
}

// ------------------------------------------------------------------ 9. ADRs
function checkAdrs(model: Model) {
  const numbers = new Set<string>();
  for (const a of model.adrs) {
    if (numbers.has(a.number)) add("error", "adr.duplicate-number", `ADR number ${a.number} used twice`);
    numbers.add(a.number);
    if (Number(a.number) < 13) continue;
    const fm = a.frontMatter;
    if (!fm) {
      add("error", "adr.front-matter", `${a.path}: ADR ≥ 0013 requires YAML front matter`);
      continue;
    }
    for (const k of ["id", "status", "date", "scope"]) if (!fm[k]) add("error", "adr.front-matter", `${a.path}: front matter missing '${k}'`);
    if (fm.id && fm.id !== a.id) add("error", "adr.front-matter", `${a.path}: id '${fm.id}' must be '${a.id}'`);
    if (fm.status && !["Proposed", "Accepted", "Superseded", "Deprecated"].includes(fm.status)) add("error", "adr.status", `${a.path}: invalid status ${fm.status}`);
    for (const k of ["supersedes", "amends", "relates"]) expectRef(model, a.path, fm[k], ["adr"]);
    for (const k of ["gated_by"]) expectRef(model, a.path, fm[k], ["poc", "ms"]);
  }
}

// ------------------------------------------------------------------ 10. PoCs
function checkPocs(model: Model) {
  for (const p of model.docs.pocs.pocs as Doc[]) {
    const results = (p.criteria as Doc[]).map((c) => c.result);
    const executed = results.filter(Boolean);
    if (p.status === "planned" && executed.length) add("error", "poc.status", `${p.id}: planned but has results`);
    if (p.status === "passed" && results.some((r) => r !== "pass")) {
      add("error", "poc.status", `${p.id}: passed requires every criterion to be executed and pass`);
    }
    if (p.status === "failed" && !results.includes("fail")) add("error", "poc.status", `${p.id}: failed without a failing criterion`);
    if (p.status === "partial" && !(results.includes("fail") && results.includes("pass"))) add("error", "poc.status", `${p.id}: partial requires both pass and fail`);
    if (p.evidence && !existsSync(join(ROOT, p.evidence))) add("error", "poc.evidence", `${p.id}: evidence ${p.evidence} missing`);
  }
}

// ------------------------------------------------------------------ 11. generated freshness
function sha256(s: string | Buffer) {
  return createHash("sha256").update(s).digest("hex");
}

function checkGenerated(model: Model) {
  const expected = generateAll(model);
  for (const [rel, content] of expected) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) add("error", "generated.missing", `${rel} missing — run bun run architecture:generate`);
    else if (readFileSync(abs, "utf8") !== content) add("error", "generated.stale", `${rel} is stale — run bun run architecture:generate`);
  }
  const manifestPath = join(ROOT, "architecture", "views", "render-manifest.json");
  if (!existsSync(manifestPath)) {
    add("advisory", "render.missing", "architecture/views/render-manifest.json missing — run bun run architecture:render");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { views: Record<string, { d2_sha256: string; svg: string }> };
  for (const [rel, content] of expected) {
    if (!rel.endsWith(".d2")) continue;
    const entry = manifest.views[rel];
    if (!entry || entry.d2_sha256 !== sha256(content)) add("error", "render.stale", `${rel}: SVG not rendered from current source — run bun run architecture:render`);
    else if (!existsSync(join(ROOT, entry.svg))) add("error", "render.missing", `${entry.svg} missing`);
  }
}

// ------------------------------------------------------------------ 12. cross-repo audit (advisory)
const STALE_CLAIMS: { pattern: RegExp; why: string }[] = [
  // Build-time coupling to a sibling checkout or the root openapi submodule (ADR-0019).
  // Only parent-relative paths are coupling; a repository-local `openapi/` submodule is the intended pattern.
  { pattern: /(^|[^.\w])\.\.\/?(\.\.\/)?openapi\/openapi\.yaml/, why: "openapi must be pinned as tastile-openapi tag inside the repository, not read from a sibling path (ADR-0019)" },
  { pattern: /\.\.\/tastile-core\/crates|\.\.\/\.\.\/tastile-core\/crates/, why: "build must not reach into a sibling core checkout (root#44, ADR-0019)" },
  { pattern: /\.\.\/\.agents\/skills/, why: "workspace skills are not a build dependency; vendor or link explicitly" },
  { pattern: /Cognito/, why: "account auth is Better Auth (cmp.web.auth, ADR-0016); describing Cognito as the current provider is stale" },
  { pattern: /beta\.tastile\.app/, why: "retired hostname (environments.yaml)" },
  { pattern: /ADR catalog 11|ADR 11 件|11 件（Accepted）|配下 15 ファイル|00\.\.14-/, why: "count / range claims are generated (architecture/generated/*)" },
];

function checkCrossRepo(model: Model) {
  const rootAdrTitles = new Map(model.adrs.map((a) => [a.number, a.title]));
  for (const repo of model.docs.repositories.repositories as Doc[]) {
    if (repo.id === "repo.root") continue;
    const base = repoLocalPath(model, repo.id);
    if (!base) {
      add("info", "cross.absent", `${repo.id}: not checked out`);
      continue;
    }
    for (const name of ["AGENTS.md", "CLAUDE.md", "README.md", "HARNESS.md"]) {
      const p = join(base, name);
      if (!existsSync(p)) continue;
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const s of STALE_CLAIMS) if (s.pattern.test(line)) add("advisory", "cross.stale-claim", `${repo.id} ${name}:${i + 1}: ${s.why}`);
        });
    }
    const adrDir = join(base, "docs", "adr");
    if (existsSync(adrDir)) {
      for (const f of readdirSync(adrDir)) {
        const m = /^(\d{4})-(.+)\.md$/.exec(f);
        if (!m) continue;
        const rootTitle = rootAdrTitles.get(m[1]);
        if (rootTitle && /release-branch|recovery-checkpoint|github-projects/.test(m[2]))
          add("advisory", "cross.adr-copy", `${repo.id} docs/adr/${f}: copies root ADR-${m[1]} (R4: link instead of copying)`);
      }
    }
  }
}

// ------------------------------------------------------------------ main
function main() {
  let model: Model;
  try {
    model = loadModel();
  } catch (e) {
    console.error(`BLOCKED: cannot load model: ${(e as Error).message}`);
    process.exit(2);
  }
  modelGlobal = model;
  for (const id of model.duplicates) add("error", "id.duplicate", `duplicate id ${id}`);
  checkSchemas(model);
  checkReferences(model);
  checkLifecycle(model);
  checkZones(model);
  checkDeployment(model);
  checkSot(model);
  checkGlossary(model);
  checkCoreProduct();
  checkProse(model);
  checkAdrs(model);
  checkPocs(model);
  checkGenerated(model);
  if (args.has("--cross-repo")) checkCrossRepo(model);

  const errors = findings.filter((f) => f.level === "error");
  const advisories = findings.filter((f) => f.level === "advisory");
  for (const f of findings) {
    if (f.level === "info" && !args.has("--verbose") && f.code !== "cost.summary") continue;
    console.log(`${f.level.toUpperCase().padEnd(8)} ${f.code.padEnd(28)} ${f.message}`);
  }
  const strictFail = args.has("--strict") && advisories.length > 0;
  const verdict = errors.length || strictFail ? "FAIL" : "PASS";
  console.log(`\narchitecture:validate ${verdict} — ${errors.length} error(s), ${advisories.length} advisory, ${model.index.size} ids`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ verdict, errors, advisories, info: findings.filter((f) => f.level === "info") }, null, 2));
  process.exit(verdict === "PASS" ? 0 : 1);
}

main();
