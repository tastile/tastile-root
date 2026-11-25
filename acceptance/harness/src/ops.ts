// Ops runner for isolated-environment fault injection (restart/stop/backup).
// Allowlisted actions only; never runs on the https profile.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { OpsConfig } from "./profile.ts";
import { ACCEPTANCE_ROOT } from "./contract.ts";
import { BlockedError } from "./ctx.ts";

const execFileAsync = promisify(execFile);

export type OpsAction =
  | "ps"
  | "restart"
  | "stop"
  | "start"
  | "backup"
  | "restore";

const ALLOWED_SERVICES = new Set(["db", "api", "worker", "web", "caddy", "cloudflared"]);

export interface OpsResult {
  action: OpsAction;
  service?: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function composeArgs(ops: OpsConfig, action: OpsAction, service?: string): string[] {
  if (ops.kind !== "compose" || !ops.dir) throw new BlockedError("compose ops not configured");
  const dir = resolve(ACCEPTANCE_ROOT, "..", ops.dir);
  const args = ["compose"];
  if (ops.project) args.push("-p", ops.project);
  if (ops.envFile) args.push("--env-file", ops.envFile);
  args.push("--project-directory", dir);
  // compose reads the file in --project-directory; -f pins it explicitly.
  args.push("-f", resolve(dir, "compose.yaml"));
  switch (action) {
    case "ps":
      args.push("ps");
      break;
    case "restart":
    case "stop":
    case "start":
      args.push(action);
      if (service) args.push(service);
      break;
    case "backup":
    case "restore":
      throw new BlockedError(`compose has no built-in "${action}"; use shell ops or extend the profile`);
  }
  return args;
}

export async function runOps(
  ops: OpsConfig,
  action: OpsAction,
  service?: string,
): Promise<OpsResult> {
  if (service && !ALLOWED_SERVICES.has(service)) {
    throw new Error(`service "${service}" is not in the ops allowlist`);
  }
  if (ops.kind === "compose") {
    const args = composeArgs(ops, action, service);
    const env = { ...process.env, ...(ops.env ?? {}) };
    try {
      const { stdout, stderr } = await execFileAsync("docker", args, {
        env,
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return { action, service, command: `docker ${args.join(" ")}`, stdout, stderr, exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return {
        action,
        service,
        command: `docker ${args.join(" ")}`,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(e),
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  }
  if (ops.kind === "shell" && ops.template) {
    const cmd = ops.template
      .replaceAll("{action}", action)
      .replaceAll("{service}", service ?? "");
    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-c", cmd], {
        timeout: 600_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { action, service, command: cmd, stdout, stderr, exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return {
        action,
        service,
        command: cmd,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(e),
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
  }
  throw new BlockedError("no ops channel configured for this profile");
}

export async function waitForHealth(
  apiBase: string,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; lastStatus: number | null; attempts: number }> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastStatus: number | null = null;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const res = await fetch(`${apiBase}/v1/health`, { signal: AbortSignal.timeout(5_000) });
      lastStatus = res.status;
      if (res.ok) return { ok: true, lastStatus, attempts };
    } catch {
      lastStatus = null;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { ok: false, lastStatus, attempts };
}
