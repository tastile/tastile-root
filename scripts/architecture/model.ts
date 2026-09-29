// Loads the Tastile architecture model (architecture/model/*.yaml) and builds a global ID index.
// Pure data access; no validation policy lives here.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export const ROOT = resolve(import.meta.dir, "..", "..");
export const MODEL_DIR = join(ROOT, "architecture", "model");
export const SCHEMA_DIR = join(ROOT, "architecture", "schema");

export const MODEL_FILES = [
  "elements",
  "relationships",
  "repositories",
  "sot-registry",
  "glossary",
  "environments",
  "deployment",
  "security",
  "data",
  "quality",
  "pocs",
  "risks",
  "roadmap",
] as const;
export type ModelFile = (typeof MODEL_FILES)[number];

// biome-ignore lint/suspicious/noExplicitAny: YAML documents are validated by JSON Schema before typed use.
export type Doc = Record<string, any>;

export interface IndexedItem {
  id: string;
  file: ModelFile | "adr";
  collection: string;
  // biome-ignore lint/suspicious/noExplicitAny: model item shape depends on collection.
  item: Record<string, any>;
}

export interface Adr {
  id: string; // adr.root.0014
  number: string;
  path: string;
  title: string;
  status: string;
  frontMatter: Doc | null;
}

export interface Model {
  docs: Record<ModelFile, Doc>;
  index: Map<string, IndexedItem>;
  duplicates: string[];
  adrs: Adr[];
}

const COLLECTIONS: Record<ModelFile, string[]> = {
  elements: ["elements"],
  relationships: ["relationships"],
  repositories: ["repositories"],
  "sot-registry": ["fact_domains"],
  glossary: ["terms"],
  environments: ["isolation_rules", "environments"],
  deployment: ["providers", "nodes"],
  security: ["trust_zones", "credentials", "data_classes", "controls", "secret_handling.rules"],
  data: ["stores", "datasets"],
  quality: ["quality_goals", "slos", "engineering_kpis"],
  pocs: ["pocs", "pocs[].findings"],
  risks: ["risks", "open_questions"],
  roadmap: ["milestones"],
};

function collect(doc: Doc, path: string): Doc[] {
  if (path.includes("[].")) {
    const [outer, inner] = path.split("[].");
    return (doc[outer] ?? []).flatMap((o: Doc) => o[inner] ?? []);
  }
  if (path.includes(".")) {
    const [outer, inner] = path.split(".");
    return doc[outer]?.[inner] ?? [];
  }
  return doc[path] ?? [];
}

export function loadAdrs(): Adr[] {
  const dir = join(ROOT, "docs", "adr");
  const adrs: Adr[] = [];
  for (const name of readdirSync(dir).sort()) {
    const m = /^(\d{4})-.+\.md$/.exec(name);
    if (!m) continue;
    const path = join("docs", "adr", name);
    const text = readFileSync(join(ROOT, path), "utf8");
    let frontMatter: Doc | null = null;
    let body = text;
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (fm) {
      frontMatter = parse(fm[1]) as Doc;
      body = text.slice(fm[0].length);
    }
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? name;
    const status =
      (frontMatter?.status as string | undefined) ??
      /^-\s*(?:状態|Status):\s*(.+)$/im.exec(body)?.[1]?.trim() ??
      "unknown";
    adrs.push({ id: `adr.root.${m[1]}`, number: m[1], path, title, status, frontMatter });
  }
  return adrs;
}

export function loadModel(): Model {
  const docs = {} as Record<ModelFile, Doc>;
  const index = new Map<string, IndexedItem>();
  const duplicates: string[] = [];
  for (const file of MODEL_FILES) {
    const path = join(MODEL_DIR, `${file}.yaml`);
    if (!existsSync(path)) throw new Error(`missing model file ${path}`);
    docs[file] = parse(readFileSync(path, "utf8")) as Doc;
    for (const collection of COLLECTIONS[file]) {
      for (const item of collect(docs[file], collection)) {
        if (typeof item?.id !== "string") continue;
        if (index.has(item.id)) duplicates.push(item.id);
        index.set(item.id, { id: item.id, file, collection, item });
      }
    }
  }
  const adrs = loadAdrs();
  for (const adr of adrs) {
    index.set(adr.id, { id: adr.id, file: "adr", collection: "adrs", item: adr as unknown as Doc });
  }
  return { docs, index, duplicates, adrs };
}

export function repoLocalPath(model: Model, repoId: string): string | null {
  const repo = model.index.get(repoId)?.item;
  if (!repo || repo.local_path == null) return null;
  const abs = join(ROOT, repo.local_path);
  return existsSync(abs) ? abs : null;
}

/** GitHub-compatible heading anchor (lowercase, strip punctuation except `-`/`_`, spaces → `-`). */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, (c) => (c === "_" ? "_" : ""))
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) anchors.add(slugify(m[1]));
  }
  return anchors;
}
