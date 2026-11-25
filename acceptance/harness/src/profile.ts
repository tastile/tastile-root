// Environment profile resolution with fail-closed URL guards.
// A profile decides which base URLs are legal; a mismatch is a BLOCKED
// configuration error, never a silent fallback to localhost.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EnvironmentName } from "./contract.ts";

export interface OpsConfig {
  kind: "compose" | "shell" | "none";
  /** compose: directory containing compose.yaml. shell: unused. */
  dir?: string;
  /** compose project name (-p). */
  project?: string;
  /** env file passed via --env-file, if any. */
  envFile?: string;
  /** Extra env applied to compose invocations. */
  env?: Record<string, string>;
  /** shell: command template; {action} and {service} are substituted. */
  template?: string;
}

export interface ResolvedProfile {
  name: EnvironmentName;
  apiBase: string;
  webBase: string | null;
  ops: OpsConfig;
  notes: string[];
}

export class ProfileError extends Error {}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local")
  );
}

function isIpLiteral(hostname: string): boolean {
  return isIP(hostname) !== 0;
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** True when the host is loopback or resolves exclusively to private/loopback addresses. */
async function isPrivateOrLoopbackHost(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (isIP(h) !== 0) return isPrivateIpv4(h) || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  try {
    const res = await lookup(h, { all: true });
    if (res.length === 0) return false;
    return res.every((a) => isPrivateOrLoopbackLiteral(a.address));
  } catch {
    return false;
  }
}

function isPrivateOrLoopbackLiteral(addr: string): boolean {
  return isLoopbackHost(addr) || isPrivateIpv4(addr) || addr === "::1" || /^f[cd]/.test(addr) || addr.startsWith("fe80");
}

function parseHttpUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProfileError(`${what} is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProfileError(`${what} must be http(s), got ${url.protocol}`);
  }
  return url;
}

export async function resolveProfile(name: EnvironmentName, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedProfile> {
  const notes: string[] = [];
  const apiEnv = env.TASTILE_ACCEPTANCE_API_BASE;
  const webEnv = env.TASTILE_ACCEPTANCE_WEB_BASE;

  if (name === "local") {
    const apiBase = (apiEnv ?? "http://127.0.0.1:31410").replace(/\/+$/, "");
    const apiUrl = parseHttpUrl(apiBase, "TASTILE_ACCEPTANCE_API_BASE");
    if (apiUrl.protocol !== "http:") {
      throw new ProfileError("local profile requires http API base");
    }
    if (!isLoopbackHost(apiUrl.hostname)) {
      throw new ProfileError(
        `local profile refuses non-loopback API base ${apiUrl.hostname} (fail-closed against production SoT)`,
      );
    }
    let webBase: string | null = null;
    if (webEnv) {
      const webUrl = parseHttpUrl(webEnv, "TASTILE_ACCEPTANCE_WEB_BASE");
      if (webUrl.protocol !== "http:" || !isLoopbackHost(webUrl.hostname)) {
        throw new ProfileError("local profile web base must be loopback http");
      }
      webBase = webEnv.replace(/\/+$/, "");
    } else {
      notes.push("web_base not set; web-dependent checks will be BLOCKED");
    }
    const ops: OpsConfig =
      env.TASTILE_ACCEPTANCE_OPS === "none"
        ? { kind: "none" }
        : {
            kind: "compose",
            dir: env.TASTILE_ACCEPTANCE_COMPOSE_DIR ?? "deploy/verify-stack",
            project: env.TASTILE_ACCEPTANCE_COMPOSE_PROJECT ?? "verify-stack",
            envFile: env.TASTILE_ACCEPTANCE_COMPOSE_ENV_FILE,
            env: pickEnvPrefixes(env, [
              "TASTILE_VERIFY_",
              "TASTILE_API_",
              "TASTILE_CORE_",
              "TASTILE_WEB_BRIDGE_",
              "TASTILE_DATABASE__",
              "TASTILE_ALLOWED_",
            ]),
          };
    return { name, apiBase, webBase, ops, notes };
  }

  if (name === "prod-equivalent") {
    if (!apiEnv || !webEnv) {
      throw new ProfileError(
        "prod-equivalent requires TASTILE_ACCEPTANCE_API_BASE and TASTILE_ACCEPTANCE_WEB_BASE (no defaults; fail-closed)",
      );
    }
    const apiUrl = parseHttpUrl(apiEnv, "TASTILE_ACCEPTANCE_API_BASE");
    const webUrl = parseHttpUrl(webEnv, "TASTILE_ACCEPTANCE_WEB_BASE");
    for (const [label, u] of [
      ["api", apiUrl],
      ["web", webUrl],
    ] as const) {
      // http is only acceptable on loopback/private hosts; a public DNS
      // name over plaintext would expose credentials and tokens.
      if (u.protocol === "http:" && !(await isPrivateOrLoopbackHost(u.hostname))) {
        throw new ProfileError(`${label} base must be https or a loopback/private host, got ${u}`);
      }
    }
    // Ops injection is fail-closed: it must be explicitly requested via
    // TASTILE_ACCEPTANCE_OPS_CMD (shell) or TASTILE_ACCEPTANCE_OPS=compose.
    // Never default to the production compose project implicitly.
    const template = env.TASTILE_ACCEPTANCE_OPS_CMD;
    const ops: OpsConfig = template
      ? { kind: "shell", template }
      : env.TASTILE_ACCEPTANCE_OPS === "compose"
        ? {
            kind: "compose",
            dir: env.TASTILE_ACCEPTANCE_COMPOSE_DIR ?? "deploy/prod-stack",
            project: env.TASTILE_ACCEPTANCE_COMPOSE_PROJECT ?? "tastile-prod",
            envFile: env.TASTILE_ACCEPTANCE_COMPOSE_ENV_FILE,
          }
        : { kind: "none" };
    if (ops.kind === "none") {
      notes.push("no ops channel configured; A-AT13/14/15 will be BLOCKED (set TASTILE_ACCEPTANCE_OPS_CMD or TASTILE_ACCEPTANCE_OPS=compose)");
    }
    return {
      name,
      apiBase: apiEnv.replace(/\/+$/, ""),
      webBase: webEnv.replace(/\/+$/, ""),
      ops,
      notes,
    };
  }

  // https profile
  if (!apiEnv || !webEnv) {
    throw new ProfileError(
      "https profile requires TASTILE_ACCEPTANCE_API_BASE and TASTILE_ACCEPTANCE_WEB_BASE (public https origins)",
    );
  }
  const apiUrl = parseHttpUrl(apiEnv, "TASTILE_ACCEPTANCE_API_BASE");
  const webUrl = parseHttpUrl(webEnv, "TASTILE_ACCEPTANCE_WEB_BASE");
  for (const [label, u] of [
    ["api", apiUrl],
    ["web", webUrl],
  ] as const) {
    if (u.protocol !== "https:") throw new ProfileError(`${label} base must be https, got ${u.protocol}`);
    if (isLoopbackHost(u.hostname) || isIpLiteral(u.hostname)) {
      throw new ProfileError(`${label} base must be a public DNS name, got ${u.hostname}`);
    }
  }
  if (env.TASTILE_ACCEPTANCE_OPS_CMD) {
    notes.push("ops commands are ignored on https profile (no fault injection on the public path)");
  }
  return {
    name,
    apiBase: apiEnv.replace(/\/+$/, ""),
    webBase: webEnv.replace(/\/+$/, ""),
    ops: { kind: "none" },
    notes,
  };
}

function pickEnvPrefixes(env: NodeJS.ProcessEnv, prefixes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}

export function profileAllowsOps(profile: ResolvedProfile): boolean {
  return profile.ops.kind !== "none" && profile.name !== "https";
}
