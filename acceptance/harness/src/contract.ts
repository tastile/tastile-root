// Acceptance contract loader + validator.
// The contract JSON is the normative spec; this module only checks that it is
// well-formed and that every case has a harness implementation registered.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EnvironmentName = "local" | "prod-equivalent" | "https";
export type CaseKind =
  | "http"
  | "http+tls"
  | "browser"
  | "http+worker"
  | "http+browser"
  | "ops"
  | "http+ops"
  | "audit"
  | "mixed";

export interface ContractCheck {
  id: string;
  description: string;
}

export interface ContractCase {
  id: string;
  title: string;
  summary: string;
  environments: EnvironmentName[];
  kind: CaseKind;
  destructive: boolean;
  timeout_seconds: number;
  owner_issues: string[];
  prerequisites: unknown[];
  fixture: string;
  oracle: string;
  checks: ContractCheck[];
  steps: string[];
  api_refs: string[];
  evidence: string[];
  harness: string;
}

export interface AcceptanceContract {
  schema: string;
  contract_version: string;
  canonical_issue: string;
  contract_issue: string;
  spec_pins: Record<string, string>;
  profiles: Record<string, unknown>;
  common_rules: Record<string, string>;
  verdicts: string[];
  cases: ContractCase[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = resolve(HERE, "..");
export const ACCEPTANCE_ROOT = resolve(HARNESS_ROOT, "..");
export const CONTRACT_PATH = resolve(ACCEPTANCE_ROOT, "contract", "acceptance-contract.json");

const REQUIRED_CASE_FIELDS: (keyof ContractCase)[] = [
  "id",
  "title",
  "summary",
  "environments",
  "kind",
  "destructive",
  "timeout_seconds",
  "owner_issues",
  "prerequisites",
  "fixture",
  "oracle",
  "checks",
  "steps",
  "api_refs",
  "evidence",
  "harness",
];

export function loadContract(path: string = CONTRACT_PATH): AcceptanceContract {
  const raw = JSON.parse(readFileSync(path, "utf8")) as AcceptanceContract;
  if (raw.schema !== "tastile/acceptance-contract/v1") {
    throw new Error(`unsupported contract schema: ${raw.schema}`);
  }
  const ids = new Set<string>();
  for (const c of raw.cases) {
    for (const f of REQUIRED_CASE_FIELDS) {
      if (c[f] === undefined || c[f] === null) {
        throw new Error(`case ${c.id} missing field ${f}`);
      }
    }
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
    if (c.checks.length === 0) throw new Error(`case ${c.id} has no checks`);
    const checkIds = new Set(c.checks.map((k) => k.id));
    if (checkIds.size !== c.checks.length) {
      throw new Error(`case ${c.id} has duplicate check ids`);
    }
    for (const env of c.environments) {
      if (!["local", "prod-equivalent", "https"].includes(env)) {
        throw new Error(`case ${c.id} unknown environment ${env}`);
      }
    }
  }
  // The 17 acceptance tests plus the core scenario are mandatory.
  for (let i = 1; i <= 17; i++) {
    const id = `A-AT${String(i).padStart(2, "0")}`;
    if (!ids.has(id)) throw new Error(`contract missing required case ${id}`);
  }
  if (!ids.has("A-E2E-CORE")) throw new Error("contract missing A-E2E-CORE");
  return raw;
}
