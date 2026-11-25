// A-AT17 — resource/cost audit. Deliberately separated from the HTTP
// functional tests: this audits configuration, contracts and permissions
// evidence rather than exercising endpoints.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunContext } from "../ctx.ts";
import { ACCEPTANCE_ROOT } from "../contract.ts";

const ROOT = resolve(ACCEPTANCE_ROOT, "..");

function read(rel: string): string | null {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export async function at17(ctx: RunContext): Promise<void> {
  const findings: string[] = [];
  const files: Record<string, string | null> = {
    "deploy/prod-stack/compose.yaml": read("deploy/prod-stack/compose.yaml"),
    "deploy/prod-stack/.env.example": read("deploy/prod-stack/.env.example"),
    "deploy/prod-stack/Caddyfile": read("deploy/prod-stack/Caddyfile"),
    "deploy/verify-stack/compose.yaml": read("deploy/verify-stack/compose.yaml"),
  };

  const compose = files["deploy/prod-stack/compose.yaml"] ?? "";
  const envExample = files["deploy/prod-stack/.env.example"] ?? "";

  // resource limits: compose must declare deploy.resources or the env
  // schema must carry explicit caps; absence is a finding, not silent pass.
  const hasResources = /deploy:\s*\n\s*resources|mem_limit|cpus:/.test(compose);
  ctx.check(
    "resource-limits-declared",
    hasResources || /MAX_CONNECTIONS|RATE_LIMIT|BODY_BYTES|TIMEOUT/.test(compose + envExample),
    hasResources ? "compose deploy.resources present" : "no compose resource limits; env-level caps only",
  );
  findings.push(
    hasResources
      ? "compose declares resource limits"
      : "compose lacks deploy.resources — NF04-R05 must add VM-sized caps",
  );

  // paid-path defaults must be empty/fake
  const paidPatterns = [
    /STRIPE_SECRET_KEY:\s*\S+/,
    /GOOGLE_CLIENT_SECRET:\s*\S+/,
    /AWS_ACCESS_KEY_ID:\s*\S+/,
    /oracle/i,
  ];
  const paidHits = paidPatterns.filter((re) => re.test(envExample)).map(String);
  const deliveryFake = /TASTILE_DELIVERY_PROVIDER:\s*\$\{TASTILE_DELIVERY_PROVIDER:-fake\}/.test(compose);
  ctx.check(
    "no-paid-defaults",
    paidHits.length === 0 && deliveryFake,
    `paidEnvHits=${paidHits.length} deliveryFake=${deliveryFake}`,
  );
  findings.push(`paid-path env defaults in prod-stack/.env.example: ${paidHits.length === 0 ? "none" : paidHits.join(",")}`);
  findings.push(`TASTILE_DELIVERY_PROVIDER default fake: ${deliveryFake}`);

  // rate limiting / request bounds declared for the API
  const rateLimited =
    /RATE_LIMIT/i.test(compose) ||
    /TASTILE_DATA_.*RATE_LIMIT|TASTILE_MAX_REQUEST_BODY_BYTES|TASTILE_REQUEST_TIMEOUT_SECONDS/.test(compose);
  ctx.check("rate-limit-active", rateLimited, rateLimited ? "env contract declares limits" : "no rate-limit env in compose");
  findings.push(`API rate-limit/body/timeout env present: ${rateLimited}`);

  // cloudflared is optional profile — confirm it is not default-on
  const tunnelOptional = /profiles:\s*\["tunnel"\]/.test(compose);
  findings.push(`cloudflared confined to 'tunnel' profile: ${tunnelOptional}`);

  // write the separated audit artifact
  const auditDir = join(ctx.evidenceDir ?? join(ACCEPTANCE_ROOT, ".tmp"), "audit");
  mkdirSync(auditDir, { recursive: true });
  const md = [
    `# A-AT17 cost/resource audit — run ${ctx.runId}`,
    "",
    `profile: ${ctx.profile.name}`,
    `date: ${new Date().toISOString()}`,
    "",
    "## Findings",
    ...findings.map((f) => `- ${f}`),
    "",
    "## Files inspected",
    ...Object.keys(files).map((f) => `- ${f}${files[f] ? "" : " (missing)"}`),
    "",
    "## Notes",
    "- This audit covers repository config/contracts only. Provider-side",
    "  billing state (Cloudflare/Infisical/account permissions) requires",
    "  the NF04-R04 contract evidence and is recorded as an open item,",
    "  not assumed PASS.",
  ].join("\n");
  writeFileSync(join(auditDir, "cost-audit.md"), md + "\n");
  ctx.note(`cost audit written to ${auditDir}/cost-audit.md`);
  ctx.check("audit-separated", true, "cost-audit.md written separately from functional evidence");
}
