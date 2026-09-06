import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Ticket = {
  id: string;
  repo: string;
  priority: string;
  status: string;
  generation: number;
  estimateHours: number;
  releaseBlocking: boolean;
  dependencies: string[];
  external: string[];
  acceptance: string[];
  ownership: string[];
  validation: string[];
};

const root = resolve(import.meta.dir, "..");
const plan = JSON.parse(readFileSync(resolve(root, "docs/releases/2026-09-19-tickets.json"), "utf8"));
const errors: string[] = [];
const contract = JSON.parse(readFileSync(resolve(root, "docs/releases/task-contract.schema.json"), "utf8"));
const profile = JSON.parse(readFileSync(resolve(root, "docs/releases/quality-profile.json"), "utf8"));
if (profile.schemaVersion !== 1) errors.push("Unsupported quality profile");
for (const field of ["issue_or_task_id", "base_snapshot", "spec_digest", "affected_repositories", "execution_generation", "runtime"]) {
  if (!contract.$defs?.task?.required?.includes(field)) errors.push(`Missing task contract field: ${field}`);
}
for (const field of ["agent_id", "actual_model", "task_digest", "execution_generation", "resolved_result_digest", "validation_results", "external_write_journal"]) {
  if (!contract.$defs?.result?.required?.includes(field)) errors.push(`Missing result contract field: ${field}`);
}
for (const gate of ["core-full", "web-full", "android-full", "android-release", "cross-repo-contract", "independent-review"]) {
  if (!profile.changeToGates?.release?.includes(gate)) errors.push(`Missing release gate: ${gate}`);
}
const tickets: Ticket[] = plan.tickets;
const ids = new Set(tickets.map((ticket) => ticket.id));
if (plan.schemaVersion !== 1 || plan.implementationWip !== 1) errors.push("Unsupported schema or WIP");
if (ids.size !== tickets.length) errors.push("Duplicate ticket IDs");
for (const [repo, sha] of Object.entries(plan.planningBaseline)) {
  if (!/^[a-f0-9]{40}$/.test(String(sha))) errors.push(`Invalid baseline: ${repo}`);
  if (!/^release-\d+-\d+-\d+$/.test(plan.releaseBranches[repo])) errors.push(`Invalid release branch: ${repo}`);
}
for (const ticket of tickets) {
  if (!(ticket.repo in plan.planningBaseline)) errors.push(`Unknown repo: ${ticket.id}`);
  if (!/^P[012]$/.test(ticket.priority)) errors.push(`Invalid priority: ${ticket.id}`);
  if (!["Ready", "Blocked", "Backlog"].includes(ticket.status)) errors.push(`Invalid initial state: ${ticket.id}`);
  if (ticket.generation !== 1 || !(ticket.estimateHours > 0)) errors.push(`Invalid budget/generation: ${ticket.id}`);
  for (const field of ["acceptance", "ownership", "validation"] as const) {
    if (!Array.isArray(ticket[field]) || !ticket[field].length || ticket[field].some((item) => !item.trim())) errors.push(`Missing ${field}: ${ticket.id}`);
  }
  for (const dep of ticket.dependencies) {
    if (!ids.has(dep)) errors.push(`Unknown dependency ${dep}: ${ticket.id}`);
    if (ticket.releaseBlocking && !tickets.find((item) => item.id === dep)?.releaseBlocking) errors.push(`Release depends on backlog: ${ticket.id}`);
  }
  if (ticket.status === "Ready" && ticket.dependencies.length) errors.push(`Ready with open dependencies: ${ticket.id}`);
  if (ticket.releaseBlocking && !["R02", "R03"].includes(ticket.id) && !ticket.dependencies.includes("R03")) errors.push(`Missing dispatch prerequisite: ${ticket.id}`);
}
const visiting = new Set<string>();
const visited = new Set<string>();
function visit(id: string) {
  if (visiting.has(id)) { errors.push(`Dependency cycle: ${id}`); return; }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dep of tickets.find((ticket) => ticket.id === id)?.dependencies ?? []) visit(dep);
  visiting.delete(id);
  visited.add(id);
}
for (const ticket of tickets) visit(ticket.id);
const release = tickets.filter((ticket) => ticket.releaseBlocking);
const closure = new Set<string>();
function collect(id: string) {
  if (closure.has(id)) return;
  closure.add(id);
  for (const dep of tickets.find((ticket) => ticket.id === id)?.dependencies ?? []) collect(dep);
}
collect("R06");
for (const ticket of release) if (!closure.has(ticket.id)) errors.push(`Release ticket not connected to publication gate: ${ticket.id}`);
const releaseHours = release.reduce((sum, ticket) => sum + ticket.estimateHours, 0);
console.log(JSON.stringify({
  result: errors.length ? "INVALID" : "PLAN_VALID",
  tickets: tickets.length,
  releaseTickets: release.length,
  estimateHours: releaseHours,
  ready: tickets.filter((ticket) => ticket.status === "Ready").map((ticket) => ticket.id),
  errors,
  limitation: "Validates the initial plan and DAG only. It does not validate runtime isolation, live GitHub status, task/result schema instances, product correctness, or release readiness.",
}, null, 2));
process.exitCode = errors.length ? 1 : 0;
