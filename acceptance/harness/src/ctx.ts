// Run context: profile, credentials, shared fixture state, check recording,
// and evidence writing. Check ids must exist in the contract case — the
// runner fails the case on unknown ids so contract and implementation
// cannot drift silently.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceContract, ContractCase, EnvironmentName } from "./contract.ts";
import { ACCEPTANCE_ROOT } from "./contract.ts";
import { redact, ApiClient, type HttpResponse } from "./http.ts";
import type { ResolvedProfile } from "./profile.ts";

export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "NOT-RUN" | "N-A";

export class BlockedError extends Error {}
export class FailFastError extends Error {}

export interface CheckResult {
  id: string;
  ok: boolean | null; // null = not evaluated (blocked/skip)
  detail?: string;
}

export interface StepRecord {
  name: string;
  status: number | null;
  detail?: string;
}

export interface CaseResult {
  id: string;
  title: string;
  environments: EnvironmentName[];
  verdict: Verdict;
  reason?: string;
  checks: CheckResult[];
  steps: StepRecord[];
  notes: string[];
  duration_ms: number;
}

/** A usable credential for one dedicated acceptance owner. */
export interface Credential {
  /** stable label, e.g. "ownerA" / "ownerB" / "muse" */
  name: string;
  /** Bearer token usable directly against the Core API. */
  bearer: string;
  /** better-auth user id when bootstrapped via web. */
  userSub?: string;
  /** Core owner UUID once discovered. */
  ownerId?: string;
  /** token prefix only — never the raw secret. */
  tokenPrefix: string;
  /** Signup coordinates kept in memory so a case can re-authenticate the
   *  same owner after a deliberate sign-out. Never written to evidence. */
  email?: string;
  password?: string;
  createdVia: "core-signup" | "web-bridge" | "api-token";
}

export class RunContext {
  readonly runId: string;
  readonly profile: ResolvedProfile;
  readonly contract: AcceptanceContract;
  readonly contractCase: ContractCase;
  /** Absolute path of the run's evidence directory (for separated artifacts). */
  evidenceDir: string | null = null;
  readonly startedAt = new Date();

  private checkIds: Set<string>;
  private results = new Map<string, CheckResult>();
  readonly steps: StepRecord[] = [];
  readonly notes: string[] = [];
  readonly state = new Map<string, unknown>();
  readonly creds = new Map<string, Credential>();
  readonly clients = new Map<string, ApiClient>();

  constructor(runId: string, profile: ResolvedProfile, contract: AcceptanceContract, contractCase: ContractCase) {
    this.runId = runId;
    this.profile = profile;
    this.contract = contract;
    this.contractCase = contractCase;
    this.checkIds = new Set(contractCase.checks.map((c) => c.id));
    for (const c of contractCase.checks) this.results.set(c.id, { id: c.id, ok: null });
  }

  get api(): ApiClient {
    return this.clientFor("api", this.profile.apiBase);
  }

  get web(): ApiClient {
    if (!this.profile.webBase) {
      throw new BlockedError("web_base is not configured for this profile");
    }
    return this.clientFor("web", this.profile.webBase);
  }

  clientFor(name: string, base: string): ApiClient {
    let c = this.clients.get(name);
    if (!c) {
      c = new ApiClient(base);
      this.clients.set(name, c);
    }
    return c;
  }

  /** Record a step outcome. */
  step(name: string, res?: HttpResponse | null, detail?: string): void {
    this.steps.push({
      name,
      status: res?.status ?? null,
      detail: detail ? redact(detail).slice(0, 500) : undefined,
    });
  }

  note(text: string): void {
    this.notes.push(redact(text));
  }

  /** Mark a contract check. Unknown ids throw — contract drift guard. */
  check(id: string, ok: boolean, detail?: string): void {
    if (!this.checkIds.has(id)) {
      throw new Error(`check id "${id}" is not declared in contract case ${this.contractCase.id}`);
    }
    this.results.set(id, { id, ok, detail: detail ? redact(detail).slice(0, 1000) : undefined });
  }

  /** Convenience: expect an HTTP status set; throws FailFast on mismatch. */
  expectStatus(res: HttpResponse, expected: number | number[], label: string): void {
    const exp = Array.isArray(expected) ? expected : [expected];
    if (!exp.includes(res.status)) {
      throw new FailFastError(
        `${label}: expected status ${exp.join("/")}, got ${res.status}: ${redact(res.text).slice(0, 300)}`,
      );
    }
  }

  requireWeb(): void {
    if (!this.profile.webBase) throw new BlockedError("web_base is not configured for this profile");
  }

  requireOps(): void {
    if (this.profile.ops.kind === "none" || this.profile.name === "https") {
      throw new BlockedError(`ops (fault injection) is not permitted on profile "${this.profile.name}"`);
    }
  }

  envEmail(prefix: string): string {
    const safe = this.runId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    return `${prefix}-${safe}-${Math.random().toString(36).slice(2, 8)}@tastile-acceptance.invalid`;
  }

  finalize(verdict: Verdict, reason?: string): CaseResult {
    // A case with any failed check cannot be PASS.
    let final = verdict;
    if (verdict === "PASS") {
      for (const r of this.results.values()) {
        if (r.ok === false) {
          final = "FAIL";
          reason = reason ?? `check ${r.id} failed`;
          break;
        }
        if (r.ok === null) {
          final = "FAIL";
          reason = reason ?? `check ${r.id} was not evaluated`;
          break;
        }
      }
    }
    return {
      id: this.contractCase.id,
      title: this.contractCase.title,
      environments: this.contractCase.environments,
      verdict: final,
      reason,
      checks: [...this.results.values()],
      steps: this.steps,
      notes: this.notes,
      duration_ms: Date.now() - this.startedAt.getTime(),
    };
  }
}

export class EvidenceWriter {
  readonly dir: string;
  private events: string[] = [];

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "cases"), { recursive: true });
  }

  event(kind: string, data: Record<string, unknown>): void {
    this.events.push(JSON.stringify({ at: new Date().toISOString(), kind, ...data }));
  }

  writeCase(result: CaseResult): void {
    writeFileSync(
      join(this.dir, "cases", `${result.id}.json`),
      JSON.stringify(result, null, 2) + "\n",
    );
    this.event("case", { id: result.id, verdict: result.verdict });
    this.flushEvents();
  }

  flushEvents(): void {
    writeFileSync(join(this.dir, "run.jsonl"), this.events.join("\n") + "\n");
  }

  writeSummary(results: CaseResult[], meta: Record<string, unknown>): void {
    const lines: string[] = [
      `# Acceptance baseline ${meta.runId}`,
      "",
      `- profile: ${meta.profile}`,
      `- started: ${meta.startedAt}`,
      `- contract: acceptance/contract/acceptance-contract.json v${meta.contractVersion}`,
      `- candidate api: ${meta.apiBase}`,
      `- candidate web: ${meta.webBase ?? "(none)"}`,
      "",
      "| case | verdict | reason |",
      "| --- | --- | --- |",
      ...results.map((r) => `| ${r.id} | ${r.verdict} | ${(r.reason ?? "").replace(/\|/g, "\\|")} |`),
      "",
    ];
    writeFileSync(join(this.dir, "summary.md"), lines.join("\n"));
    this.flushEvents();
  }
}

export { ACCEPTANCE_ROOT };
