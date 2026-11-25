// A-AT01 / A-AT16 — edge reachability, TLS, and public-boundary negative tests.

import { request as httpsRequest } from "node:https";
import type { RunContext } from "../ctx.ts";
import { ensureOwner } from "../bootstrap.ts";

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
  return new Promise((resolve) => {
    const sock = new Socket();
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

interface ComposeContainerPorts {
  name: string;
  ports: string;
}

/** Published/exposed ports of every container in a compose project. */
async function composeProjectPorts(project: string): Promise<ComposeContainerPorts[] | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--format",
        "{{.Names}}\t{{.Ports}}",
      ],
      { timeout: 15_000 },
    );
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const tab = l.indexOf("\t");
        return tab === -1
          ? { name: l, ports: "" }
          : { name: l.slice(0, tab), ports: l.slice(tab + 1) };
      });
  } catch {
    return null;
  }
}

export async function at01(ctx: RunContext): Promise<void> {
  // https profile only; other profiles record N-A via runner applicability.
  const api = new URL(ctx.profile.apiBase);
  const web = ctx.profile.webBase ? new URL(ctx.profile.webBase) : null;

  // Each contract check is emitted exactly once; per-target probes are
  // AND-accumulated so an earlier failure can never be overwritten by a
  // later success (ctx.check replaces the previous result for an id).
  let tlsOk = true;
  const tlsDetails: string[] = [];
  for (const [label, u] of [
    ["api", api],
    ...(web ? ([["web", web]] as const) : []),
  ] as const) {
    try {
      const cert = await tlsPeerCert(u.toString());
      const notAfter = new Date(cert.valid_to);
      const hostnameOk = cert.san.some((s) => s.replace(/^DNS:/, "") === u.hostname) || cert.subject === u.hostname;
      const ok = notAfter.getTime() > Date.now() && hostnameOk && cert.issuer.length > 0;
      tlsOk = tlsOk && ok;
      tlsDetails.push(`${label}: issuer=${cert.issuer} notAfter=${cert.valid_to} hostnameOk=${hostnameOk} san=${cert.san.join(",")}`);
      ctx.step(`tls ${label}`, null, `issuer=${cert.issuer} san=${cert.san.join(",")}`);
    } catch (e) {
      tlsOk = false;
      tlsDetails.push(`${label}: ${String(e)}`);
    }
  }
  ctx.check("tls-cert-valid", tlsOk, tlsDetails.join(" | "));

  const health = await ctx.api.get("/v1/health");
  ctx.step("GET /v1/health", health);
  let reachable = health.status === 200;
  const reachableDetails = [`api /v1/health=${health.status}`];
  if (ctx.profile.webBase) {
    const home = await ctx.web.get("/");
    ctx.step("GET / (web)", home);
    const webOk = home.status === 200 || home.status === 301 || home.status === 302 || home.status === 307 || home.status === 308;
    reachable = reachable && webOk;
    reachableDetails.push(`web /=${home.status}`);
  }
  ctx.check("https-reachable", reachable, reachableDetails.join(" "));

  // http -> https enforcement. The contract oracle requires the plain-HTTP
  // origin to redirect or deny; a 200 over http is a plaintext bypass and
  // must FAIL, not pass.
  let httpOk = true;
  const httpDetails: string[] = [];
  for (const u of [api, ...(web ? [web] : [])]) {
    try {
      const res = await fetch(`http://${u.host}/v1/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      const redirected = res.status >= 300 && res.status < 400;
      const denied = res.status === 400 || res.status === 403 || res.status === 421;
      const ok = redirected || denied;
      httpOk = httpOk && ok;
      httpDetails.push(`${u.host}: status=${res.status}`);
      ctx.step(`http probe ${u.host}`, null, `status=${res.status}`);
    } catch (e) {
      httpDetails.push(`${u.host}: unreachable (fail-closed) ${String(e).slice(0, 120)}`);
      ctx.step(`http probe ${u.host}`, null, `unreachable ${String(e).slice(0, 120)}`);
    }
  }
  ctx.check("no-plain-http-bypass", httpOk, httpDetails.join(" "));

  // internal ports must not be publicly reachable — probe common backend
  // ports on the public host; connection should fail or be filtered.
  const internalPorts = [5432, 31400, 31401, 3000];
  const probes: string[] = [];
  let backendsClosed = true;
  for (const port of internalPorts) {
    const open = await tcpProbe(api.hostname, port, 4_000);
    probes.push(`${api.hostname}:${port}=${open ? "OPEN" : "closed"}`);
    if (open) backendsClosed = false;
  }
  ctx.check("no-direct-backend", backendsClosed, probes.join(" "));
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

  // forged Host/Origin on web proxy path. The shared run web client may hold
  // a valid session; the boundary under test is an UNAUTHENTICATED caller
  // forging headers, so clear the jar first and restore it afterwards.
  if (ctx.profile.webBase) {
    const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
    ctx.web.clearCookies();
    const forged = await ctx.web.get("/api/proxy/v1/tiles", {
      headers: { host: "evil.example", origin: "https://evil.example" },
    });
    ctx.step("GET /api/proxy/v1/tiles forged host/origin", forged);
    // Contract oracle: the bypass must be "rejected OR invalidated". A 4xx is
    // a rejection; a 2xx/3xx is acceptable only when it serves no protected
    // data — e.g. the edge (caddy) answering an unknown Host with an empty
    // body, or an app-level login page. Any payload carrying aggregate
    // identifiers would be a real bypass.
    const denied = [400, 401, 403, 404].includes(forged.status);
    const leaked = /"tile_id"|"owner_id"|"placement_id"|"execution_id"|acc-/.test(forged.text ?? "");
    const ineffective = forged.status >= 200 && forged.status < 400 && !leaked;
    ctx.check(
      "origin-bypass-denied",
      denied || ineffective,
      `status ${forged.status}${denied ? " (rejected)" : ineffective ? " (ineffective, no data)" : " BYPASSED"}`,
    );
    if (owner.email && owner.password) {
      const signIn = await ctx.web.post("/api/auth/sign-in/email", {
        headers: { origin: ctx.profile.webBase },
        body: { email: owner.email, password: owner.password },
      });
      ctx.step("POST /api/auth/sign-in/email (restore shared session)", signIn);
      if (signIn.status === 200) {
        await ctx.web.get("/api/auth/bridge?next=/dashboard");
        const fresh = ctx.web.getCookie("tastile_api_token");
        if (fresh) owner.bearer = fresh;
      } else {
        ctx.note(`session restore after forged probe failed: status ${signIn.status}`);
      }
    }
  } else {
    ctx.check("origin-bypass-denied", true, "web_base not configured; api-side checks cover the boundary");
  }

  // A valid Better Auth web session must not double as a Core credential.
  // Replay only the session cookie (no bearer / bridge headers) directly
  // against the API for both a read and a mutation: the API must reject
  // both, proving the authenticated web path cannot be bypassed by
  // presenting web-layer session material to Core.
  if (ctx.profile.webBase) {
    const sessionToken =
      ctx.web.getCookie("__Secure-better-auth.session_token") ??
      ctx.web.getCookie("better-auth.session_token");
    if (sessionToken) {
      const cookieHeader = `__Secure-better-auth.session_token=${sessionToken}`;
      const sessRead = await ctx.api.get("/v1/tiles", { headers: { cookie: cookieHeader } });
      const sessWrite = await ctx.api.post("/v1/tiles", {
        headers: { cookie: cookieHeader },
        body: { ...tilePayload, idempotency_key: crypto.randomUUID() },
      });
      ctx.step("GET /v1/tiles web-session-cookie-only", sessRead);
      ctx.step("POST /v1/tiles web-session-cookie-only", sessWrite);
      ctx.check(
        "session-cookie-not-api-credential",
        [sessRead.status, sessWrite.status].every((s) => s === 401 || s === 403),
        `read=${sessRead.status} write=${sessWrite.status}`,
      );
    } else {
      // web_base is configured but signup/session issuance produced no
      // cookie: the authenticated-path bypass surface cannot be probed,
      // which must not count as a pass in any environment that runs web.
      ctx.check(
        "session-cookie-not-api-credential",
        false,
        "web_base configured but no better-auth session cookie in jar; cannot prove bypass denial",
      );
    }
  } else {
    ctx.check(
      "session-cookie-not-api-credential",
      true,
      "web_base not configured; api-side checks cover the boundary",
    );
  }

  // Internal service ports must not be reachable from outside. When the
  // ops channel names a compose project (prod-equivalent runbook), audit the
  // project's actual published ports: TCP-probing a loopback api_base would
  // measure unrelated host services, not the stack boundary. On https (no
  // ops project) live TCP probes against the public host remain meaningful.
  const liveProbe = ctx.profile.name !== "local";
  const probes: string[] = [];
  let allClosed = true;
  const project = ctx.profile.ops.project;
  if (liveProbe && project) {
    const published = await composeProjectPorts(project);
    if (published === null) {
      probes.push(`compose project ${project}: docker ps failed`);
      allClosed = false;
    } else if (published.length === 0) {
      probes.push(`compose project ${project}: no containers found`);
      allClosed = false;
    } else {
      for (const c of published) {
        const svc = c.name.startsWith(`${project}-`) ? c.name.slice(project.length + 1) : c.name;
        // caddy/cloudflared ARE the public edge; every other service must
        // not publish a non-loopback host port (db/api/worker/web included).
        const edge = svc === "caddy" || svc === "cloudflared";
        for (const mapping of c.ports.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!mapping.includes("->")) {
            probes.push(`${c.name}: exposed-only ${mapping}`);
            continue;
          }
          const hostSide = mapping.split("->")[0]!.trim();
          const loopback = /^(127\.0\.0\.1|localhost|\[?::1\]?):/.test(hostSide);
          probes.push(`${c.name}: ${mapping} ${loopback ? "loopback" : "PUBLIC"}`);
          if (!loopback && !edge) allClosed = false;
        }
      }
    }
  } else if (liveProbe) {
    const internalPorts = [5432, 3000];
    for (const port of internalPorts) {
      const open = await tcpProbe(api.hostname, port, 4_000);
      probes.push(`${api.hostname}:${port}=${open ? "OPEN" : "closed"}`);
      if (open) allClosed = false;
    }
    if (web) {
      for (const port of [5432]) {
        const open = await tcpProbe(web.hostname, port, 4_000);
        probes.push(`${web.hostname}:${port}=${open ? "OPEN" : "closed"}`);
        if (open) allClosed = false;
      }
    }
  } else {
    probes.push("live probes skipped on local profile (loopback host)");
  }
  // NOTE: db-not-public / worker-not-public are emitted once at the end,
  // AND-ing live probes with the static compose scan. Emitting the live
  // result early would let the later static check overwrite a failure.

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
  ctx.check("db-not-public", allClosed && staticOk, `live: ${probes.join(" ")} | static: ${findings.join("; ")}`);
  ctx.check("worker-not-public", allClosed && staticOk, `live: ${probes.join(" ")} | static: ${findings.join("; ")}`);
}
