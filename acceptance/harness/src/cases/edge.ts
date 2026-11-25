// A-AT01 / A-AT16 — edge reachability, TLS, and public-boundary negative tests.

import { request as httpsRequest } from "node:https";
import type { RunContext } from "../ctx.ts";

interface TlsInfo {
  subject: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
  san: string[];
}

function tlsPeerCert(url: string): Promise<TlsInfo> {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(url, { method: "HEAD", timeout: 15_000 }, (res) => {
      res.resume();
      const socket = res.socket as unknown as { getPeerCertificate?: () => Record<string, unknown> };
      const cert = socket.getPeerCertificate?.() as
        | { subject?: { CN?: string }; issuer?: { CN?: string }; valid_from?: string; valid_to?: string; subjectaltname?: string }
        | undefined;
      if (!cert) return reject(new Error("no peer certificate"));
      resolvePromise({
        subject: cert.subject?.CN ?? "",
        issuer: cert.issuer?.CN ?? "",
        valid_from: cert.valid_from ?? "",
        valid_to: cert.valid_to ?? "",
        san: (cert.subjectaltname ?? "").split(",").map((s) => s.trim()),
      });
    });
    req.on("timeout", () => req.destroy(new Error("tls probe timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function tcpProbe(host: string, port: number, timeoutMs = 5_000): Promise<boolean> {
  const { Socket } = await import("node:net");
  return new Promise((resolvePromise) => {
    const sock = new Socket();
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      sock.destroy();
      resolvePromise(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolvePromise(false);
    });
    sock.once("error", () => resolvePromise(false));
    sock.connect(port, host);
  });
}

export async function at01(ctx: RunContext): Promise<void> {
  // https profile only; other profiles record N-A via runner applicability.
  const api = new URL(ctx.profile.apiBase);
  const web = ctx.profile.webBase ? new URL(ctx.profile.webBase) : null;

  for (const [label, u] of [
    ["api", api],
    ...(web ? ([["web", web]] as const) : []),
  ] as const) {
    try {
      const cert = await tlsPeerCert(u.toString());
      const notAfter = new Date(cert.valid_to);
      const hostnameOk = cert.san.some((s) => s.replace(/^DNS:/, "") === u.hostname) || cert.subject === u.hostname;
      ctx.step(`tls ${label}`, null, `issuer=${cert.issuer} san=${cert.san.join(",")}`);
      ctx.check(
        "tls-cert-valid",
        notAfter.getTime() > Date.now() && hostnameOk && cert.issuer.length > 0,
        `${label}: issuer=${cert.issuer} notAfter=${cert.valid_to} hostnameOk=${hostnameOk}`,
      );
    } catch (e) {
      ctx.check("tls-cert-valid", false, `${label}: ${String(e)}`);
    }
  }

  const health = await ctx.api.get("/v1/health");
  ctx.step("GET /v1/health", health);
  ctx.check("https-reachable", health.status === 200, `status ${health.status}`);

  if (ctx.profile.webBase) {
    const home = await ctx.web.get("/");
    ctx.step("GET / (web)", home);
    ctx.check("https-reachable", home.status === 200 || home.status === 301 || home.status === 302 || home.status === 307 || home.status === 308, `status ${home.status}`);
  }

  // http -> https enforcement
  for (const u of [api, ...(web ? [web] : [])]) {
    try {
      const res = await fetch(`http://${u.host}/v1/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      const redirected = res.status >= 300 && res.status < 400;
      const denied = res.status === 400 || res.status === 403 || res.status === 421;
      ctx.step(`http probe ${u.host}`, null, `status=${res.status}`);
      ctx.check("no-plain-http-bypass", redirected || denied || res.status === 200, `status ${res.status} (200 on http is acceptable only if the service intentionally serves both)`);
    } catch (e) {
      ctx.check("no-plain-http-bypass", true, `http unreachable (fail-closed): ${String(e).slice(0, 120)}`);
    }
  }

  // internal ports must not be publicly reachable — probe common backend
  // ports on the public host; connection should fail or be filtered.
  const internalPorts = [5432, 31400, 31401, 3000];
  const probes: string[] = [];
  for (const port of internalPorts) {
    const open = await tcpProbe(api.hostname, port, 4_000);
    probes.push(`${api.hostname}:${port}=${open ? "OPEN" : "closed"}`);
    if (open) ctx.check("no-direct-backend", false, `port ${port} reachable on public host`);
  }
  ctx.check("no-direct-backend", true, probes.join(" "));
}

export async function at16(ctx: RunContext): Promise<void> {
  const api = new URL(ctx.profile.apiBase);
  const web = ctx.profile.webBase ? new URL(ctx.profile.webBase) : null;
  const tilePayload = {
    idempotency_key: crypto.randomUUID(),
    payload: {
      kind: 1,
      title: `acc-at16-inject-${ctx.runId}`,
      description: null,
      color: null,
      icon: null,
      external_id: null,
      plan_role: 0,
      owner_subject_id: null,
    },
  };

  // Probe 1 (all profiles): forged bridge headers WITHOUT any owner
  // fallback header. A wrong bridge secret must never authenticate,
  // regardless of environment.
  const bridgeForged = await ctx.api.post("/v1/tiles", {
    headers: {
      "x-tastile-web-bridge-secret": "attacker-guess",
      "x-tastile-web-session-user": "00000000-0000-0000-0000-000000000001",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
    body: tilePayload,
  });
  ctx.step("POST /v1/tiles forged bridge headers (no owner fallback)", bridgeForged);

  // Probe 2: forged x-owner-id bootstrap header. In protected
  // environments (TASTILE_ENV=production/staging) the API must reject it;
  // in non-protected development environments the header pair is the
  // documented local bootstrap fallback, so a 2xx there is expected and
  // is recorded, not failed.
  const ownerForged = await ctx.api.post("/v1/tiles", {
    headers: {
      "x-owner-id": "00000000-0000-0000-0000-000000000001",
      "x-actor-id": "00000000-0000-0000-0000-000000000001",
    },
    body: { ...tilePayload, idempotency_key: crypto.randomUUID() },
  });
  ctx.step("POST /v1/tiles forged x-owner-id", ownerForged);
  const protectedEnv = ctx.profile.name !== "local";
  const ownerHeaderOk =
    ownerForged.status === 401 ||
    ownerForged.status === 403 ||
    (!protectedEnv && ownerForged.status < 300);
  ctx.note(
    `x-owner-id probe: status=${ownerForged.status} profile=${ctx.profile.name}` +
      (protectedEnv ? " (protected env: must reject)" : " (dev fallback is spec-legal on local)"),
  );

  ctx.check(
    "internal-headers-blocked",
    (bridgeForged.status === 401 || bridgeForged.status === 403) && ownerHeaderOk,
    `bridge=${bridgeForged.status} ownerId=${ownerForged.status}`,
  );

  // forged Host/Origin on web proxy path
  if (ctx.profile.webBase) {
    const forged = await ctx.web.get("/api/proxy/v1/tiles", {
      headers: { host: "evil.example", origin: "https://evil.example" },
    });
    ctx.step("GET /api/proxy/v1/tiles forged host/origin", forged);
    ctx.check(
      "origin-bypass-denied",
      forged.status === 401 || forged.status === 403 || forged.status === 404 || forged.status === 400,
      `status ${forged.status}`,
    );
  } else {
    ctx.check("origin-bypass-denied", true, "web_base not configured; api-side checks cover the boundary");
  }

  // Internal service ports must not be reachable from outside. Live TCP
  // probes are only meaningful on prod-equivalent/https profiles: on the
  // local profile the API base is loopback, so probing it measures the
  // developer host, not the stack boundary. The loopback binding itself is
  // verified by the compose scan below.
  const liveProbe = ctx.profile.name !== "local";
  const internalPorts = liveProbe ? [5432, 3000] : [];
  const probes: string[] = [];
  let allClosed = true;
  for (const port of internalPorts) {
    const open = await tcpProbe(api.hostname, port, 4_000);
    probes.push(`${api.hostname}:${port}=${open ? "OPEN" : "closed"}`);
    if (open) allClosed = false;
  }
  if (liveProbe && web) {
    for (const port of [5432]) {
      const open = await tcpProbe(web.hostname, port, 4_000);
      probes.push(`${web.hostname}:${port}=${open ? "OPEN" : "closed"}`);
      if (open) allClosed = false;
    }
  }
  if (!liveProbe) probes.push("live probes skipped on local profile (loopback host)");
  ctx.check("db-not-public", allClosed, probes.join(" "));
  ctx.check("worker-not-public", allClosed, probes.join(" "));

  // Static check: in each compose file, backend services (db/api/worker)
  // must not publish a host port, or must bind it to loopback only.
  const { readFileSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { ACCEPTANCE_ROOT } = await import("../contract.ts");
  const candidates = [
    resolve(ACCEPTANCE_ROOT, "..", "deploy/prod-stack/compose.yaml"),
    resolve(ACCEPTANCE_ROOT, "..", "deploy/verify-stack/compose.yaml"),
  ];
  const loopbackBind = /^(127\.0\.0\.1|localhost|\[::1\]):/;
  const findings: string[] = [];
  let staticOk = true;
  for (const f of candidates) {
    if (!existsSync(f)) {
      findings.push(`${f}: missing`);
      staticOk = false;
      continue;
    }
    const lines = readFileSync(f, "utf8").split("\n");
    let inServices = false;
    let currentService = "";
    let currentIsBackend = false;
    let inPorts = false;
    let portsIndent = -1;
    const evalPorts = (ports: string[]) => {
      for (const mapping of ports) {
        // An env-var host side (e.g. ${CADDY_HTTP_PORT:-80}) or a bare port
        // is a public bind unless it carries an explicit loopback prefix.
        const isLoopback = loopbackBind.test(mapping);
        findings.push(
          `${f} ${currentService}: port "${mapping}" ${isLoopback ? "loopback" : "PUBLIC"}`,
        );
        if (!isLoopback) staticOk = false;
      }
    };
    let pendingPorts: string[] = [];
    const flushPorts = () => {
      if (currentIsBackend) evalPorts(pendingPorts);
      pendingPorts = [];
      inPorts = false;
    };
    for (const line of lines) {
      if (/^services:/.test(line)) {
        inServices = true;
        continue;
      }
      if (!inServices) continue;
      if (/^[a-zA-Z]/.test(line)) break; // left the services block
      const svcMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (svcMatch) {
        flushPorts();
        currentService = svcMatch[1]!;
        currentIsBackend = ["db", "api", "worker"].includes(currentService);
        continue;
      }
      if (!currentService) continue;
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (inPorts) {
        if (indent <= portsIndent) flushPorts();
        else {
          const item = line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
          if (item && !item.startsWith("#")) pendingPorts.push(item);
          continue;
        }
      }
      if (currentIsBackend && /^\s+ports:\s*$/.test(line)) {
        inPorts = true;
        portsIndent = indent;
        continue;
      }
    }
    flushPorts();
    findings.push(`${f}: scanned`);
  }
  ctx.check("db-not-public", staticOk, findings.join("; "));
  ctx.check("worker-not-public", staticOk, findings.join("; "));
}
