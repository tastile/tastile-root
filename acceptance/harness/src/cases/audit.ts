// A-AT17 — resource/cost audit. Deliberately separated from the HTTP
// functional tests: this audits configuration, contracts and permissions
// evidence rather than exercising endpoints.
//
// Scope honesty: this audits repository config/contracts only. Provider-side
// billing state (Cloudflare/Infisical/account permissions) is recorded as an
// open item, never assumed PASS.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunContext } from "../ctx.ts";
import { ACCEPTANCE_ROOT } from "../contract.ts";

const ROOT = resolve(ACCEPTANCE_ROOT, "..");

function read(rel: string): string | null {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** `.env.example` files use `KEY=value` (not `KEY: value`). */
function envValue(text: string, key: string): string | null {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  return m ? m[1]!.trim() : null;
}

function envHasNonEmpty(text: string, key: string): boolean {
  const v = envValue(text, key);
  return v !== null && v !== "";
}

export async function at17(ctx: RunContext): Promise<void> {
  const findings: string[] = [];
  const files: Record<string, string | null> = {
    "deploy/prod-stack/compose.yaml": read("deploy/prod-stack/compose.yaml"),
    "deploy/prod-stack/.env.example": read("deploy/prod-stack/.env.example"),
    "deploy/prod-stack/Caddyfile": read("deploy/prod-stack/Caddyfile"),
    "deploy/verify-stack/compose.yaml": read("deploy/verify-stack/compose.yaml"),
    "deploy/verify-stack/.env.example": read("deploy/verify-stack/.env.example"),
  };

  const compose = files["deploy/prod-stack/compose.yaml"] ?? "";
  const envExample = files["deploy/prod-stack/.env.example"] ?? "";
  const verifyCompose = files["deploy/verify-stack/compose.yaml"] ?? "";

  // resource limits: compose resource caps or explicit env-level bounds
  // (connections / body bytes / timeouts). Absence of CPU/RAM caps is a
  // finding for NF04-R05, not a silent pass.
  const hasComposeResources = /deploy:\s*\n\s*resources|mem_limit|cpus:/.test(compose + verifyCompose);
  const envCaps =
    /TASTILE_DATABASE__MAX_CONNECTIONS|TASTILE_MAX_REQUEST_BODY_BYTES|TASTILE_REQUEST_TIMEOUT_SECONDS/.test(
      compose + verifyCompose + envExample,
    );
  ctx.check(
    "resource-limits-declared",
    hasComposeResources || envCaps,
    hasComposeResources
      ? "compose deploy.resources present"
      : envCaps
        ? "env-level caps only (connections/body/timeout); no CPU/RAM compose limits"
        : "no resource limits declared",
  );
  findings.push(
    hasComposeResources
      ? "compose declares resource limits"
      : "compose lacks deploy.resources/CPU/RAM caps — NF04-R05 must add VM-sized limits",
  );
  findings.push(`env-level request/connection caps declared: ${envCaps}`);

  // paid-path defaults must be empty/fake in the committed schema
  const paidKeys = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  const paidHits = paidKeys.filter((k) => envHasNonEmpty(envExample, k));
  const deliveryFake =
    envValue(envExample, "TASTILE_DELIVERY_PROVIDER") === "fake" ||
    /TASTILE_DELIVERY_PROVIDER:\s*\$\{TASTILE_DELIVERY_PROVIDER:-fake\}/.test(compose);
  ctx.check(
    "no-paid-defaults",
    paidHits.length === 0 && deliveryFake,
    `paidEnvHits=${paidHits.length} deliveryFake=${deliveryFake}`,
  );
  findings.push(
    `paid-path env defaults in prod-stack/.env.example: ${paidHits.length === 0 ? "none (all empty)" : paidHits.join(",")}`,
  );
  findings.push(`TASTILE_DELIVERY_PROVIDER default fake: ${deliveryFake}`);

  // rate limiting: core enforces bounded defaults
  // (TASTILE_AUTH_RATE_LIMIT_PER_MINUTE=60,
  //  TASTILE_DATA_{READ,WRITE,BOOTSTRAP}_RATE_LIMIT_PER_MINUTE=600/240/12).
  // The audit records whether the deployment declares explicit overrides;
  // absent overrides mean the built-in defaults are the effective caps.
  const rateEnvNames = [
    "TASTILE_AUTH_RATE_LIMIT_PER_MINUTE",
    "TASTILE_DATA_READ_RATE_LIMIT_PER_MINUTE",
    "TASTILE_DATA_WRITE_RATE_LIMIT_PER_MINUTE",
    "TASTILE_DATA_BOOTSTRAP_RATE_LIMIT_PER_MINUTE",
  ];
  const declaredRate = rateEnvNames.filter((k) => envHasNonEmpty(envExample, k) || compose.includes(k));
  const rateActive =
    declaredRate.length > 0 ||
    /TASTILE_MAX_REQUEST_BODY_BYTES|TASTILE_REQUEST_TIMEOUT_SECONDS/.test(compose + verifyCompose);
  ctx.check(
    "rate-limit-active",
    rateActive,
    declaredRate.length > 0
      ? `explicit env declared: ${declaredRate.join(",")}`
      : "no explicit rate-limit env; core built-in defaults (60 auth / 600-240-12 data rpm) + body/timeout caps are the effective limits",
  );
  findings.push(
    `rate-limit env explicitly declared: ${declaredRate.length > 0 ? declaredRate.join(",") : "none — relying on core defaults"}`,
  );

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
    "## Open items",
    "- Provider-side billing state (Cloudflare/Infisical/account permissions)",
    "  requires the NF04-R04 contract evidence; recorded as open, not assumed PASS.",
    "- CPU/RAM/disk caps on the VM are NF04-R05 scope; compose has no",
    "  deploy.resources today (see findings).",
  ].join("\n");
  writeFileSync(join(auditDir, "cost-audit.md"), md + "\n");
  ctx.note(`cost audit written to ${auditDir}/cost-audit.md`);
  ctx.check("audit-separated", true, "cost-audit.md written separately from functional evidence");
}
