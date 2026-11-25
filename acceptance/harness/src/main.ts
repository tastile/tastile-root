// Acceptance harness entry point.
//
//   bun src/main.ts --profile local [--only A-AT01,A-AT05] [--evidence <dir>]
//   bun src/main.ts --list
//
// Env:
//   TASTILE_ACCEPTANCE_API_BASE / TASTILE_ACCEPTANCE_WEB_BASE  target origins
//   TASTILE_ACCEPTANCE_OPS / TASTILE_ACCEPTANCE_OPS_CMD / TASTILE_ACCEPTANCE_COMPOSE_*
//     ops channel for fault-injection cases (local / prod-equivalent only)

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadContract, type EnvironmentName } from "./contract.ts";
import { ACCEPTANCE_ROOT } from "./contract.ts";
import { resolveProfile, ProfileError, type ResolvedProfile } from "./profile.ts";
import {
  BlockedError,
  EvidenceWriter,
  FailFastError,
  RunContext,
  type CaseResult,
  type Verdict,
} from "./ctx.ts";
import { CASES } from "./cases/index.ts";

interface CliArgs {
  profile: EnvironmentName;
  only: string[] | null;
  evidenceDir: string | null;
  list: boolean;
  runId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    profile: (process.env.TASTILE_ACCEPTANCE_PROFILE ?? "local") as EnvironmentName,
    only: null,
    evidenceDir: null,
    list: false,
    runId: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") args.profile = argv[++i] as EnvironmentName;
    else if (a === "--only") args.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--evidence") args.evidenceDir = argv[++i] ?? null;
    else if (a === "--run-id") args.runId = argv[++i] ?? args.runId;
    else if (a === "--list") args.list = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: bun src/main.ts --profile <local|prod-equivalent|https> [--only ids] [--evidence dir] [--run-id id] [--list]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const contract = loadContract();

  // registry must cover the contract exactly
  const contractIds = contract.cases.map((c) => c.id).sort();
  const implIds = Object.keys(CASES).sort();
  const missing = contractIds.filter((id) => !implIds.includes(id));
  const extra = implIds.filter((id) => !contractIds.includes(id));
  if (missing.length || extra.length) {
    console.error(`contract/impl mismatch: missing=${missing} extra=${extra}`);
    return 2;
  }

  if (args.list) {
    for (const c of contract.cases) {
      console.log(`${c.id}\t${c.environments.join(",")}\t${c.title}`);
    }
    return 0;
  }

  let profile: ResolvedProfile;
  try {
    profile = resolveProfile(args.profile);
  } catch (e) {
    if (e instanceof ProfileError) {
      console.error(`profile error: ${e.message}`);
      return 2;
    }
    throw e;
  }
  for (const n of profile.notes) console.error(`note: ${n}`);

  const evidenceDir =
    args.evidenceDir ??
    join(ACCEPTANCE_ROOT, ".tmp", "acceptance", `${args.runId}-${args.profile}`);
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = new EvidenceWriter(evidenceDir);
  evidence.event("run-start", {
    runId: args.runId,
    profile: args.profile,
    apiBase: profile.apiBase,
    webBase: profile.webBase,
    contractVersion: contract.contract_version,
  });

  const results: CaseResult[] = [];
  const selected = args.only ? new Set(args.only) : null;

  for (const contractCase of contract.cases) {
    if (selected && !selected.has(contractCase.id)) continue;

    // environment applicability
    if (!contractCase.environments.includes(args.profile)) {
      const ctx = new RunContext(args.runId, profile, contract, contractCase);
      ctx.evidenceDir = evidenceDir;
      results.push(
        ctx.finalize("N-A", `profile "${args.profile}" not in contract environments [${contractCase.environments.join(", ")}]`),
      );
      continue;
    }

    // case prerequisites of type {"type":"case"}
    const unmet: string[] = [];
    for (const p of contractCase.prerequisites) {
      const pr = p as { type?: string; id?: string; ids?: string[] };
      if (pr.type === "case" && pr.id) {
        const dep = results.find((r) => r.id === pr.id);
        if (!dep || dep.verdict !== "PASS") unmet.push(pr.id);
      }
      if (pr.type === "cases" && pr.ids) {
        for (const id of pr.ids) {
          const dep = results.find((r) => r.id === id);
          if (!dep || dep.verdict !== "PASS") unmet.push(id);
        }
      }
    }
    if (unmet.length) {
      const ctx = new RunContext(args.runId, profile, contract, contractCase);
      ctx.evidenceDir = evidenceDir;
      results.push(ctx.finalize("NOT-RUN", `unmet case prerequisites: ${unmet.join(", ")}`));
      continue;
    }

    const impl = CASES[contractCase.id];
    if (!impl) {
      const ctx = new RunContext(args.runId, profile, contract, contractCase);
      results.push(ctx.finalize("BLOCKED", "no harness implementation registered"));
      continue;
    }

    const ctx = new RunContext(args.runId, profile, contract, contractCase);
    ctx.evidenceDir = evidenceDir;
    const started = Date.now();
    let result: CaseResult;
    try {
      const timeout = contractCase.timeout_seconds * 1000;
      await Promise.race([
        impl(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new FailFastError(`case timeout ${contractCase.timeout_seconds}s`)), timeout),
        ),
      ]);
      result = ctx.finalize("PASS");
    } catch (e) {
      if (e instanceof BlockedError) {
        result = ctx.finalize("BLOCKED", e.message);
      } else if (e instanceof FailFastError) {
        result = ctx.finalize("FAIL", e.message);
      } else {
        result = ctx.finalize("FAIL", `unexpected error: ${String(e).slice(0, 500)}`);
      }
    }
    void started;
    results.push(result);
    evidence.writeCase(result);
    console.log(`${result.id}\t${result.verdict}\t${result.reason ?? ""}`);
  }

  evidence.writeSummary(results, {
    runId: args.runId,
    profile: args.profile,
    startedAt: new Date().toISOString(),
    contractVersion: contract.contract_version,
    apiBase: profile.apiBase,
    webBase: profile.webBase,
  });

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nevidence: ${resolve(evidenceDir)}`);
  console.log(`verdicts: ${JSON.stringify(counts)}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`harness error: ${String(e)}`);
    process.exit(2);
  });
