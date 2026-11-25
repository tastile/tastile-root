// A-AT13 / A-AT14 / A-AT15 — isolated-environment ops acceptance:
// restart persistence, worker recovery, backup/restore.
// These run only where ops injection is permitted (local / prod-equivalent).

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import type { Credential, RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { ApiClient } from "../http.ts";
import { ACCEPTANCE_ROOT } from "../contract.ts";
import {
  composeBaseArgs,
  composeExec,
  runOps,
  runShell,
  waitForHealth,
  type CommandResult,
} from "../ops.ts";
import type { OpsConfig } from "../profile.ts";
import { createPlacement, createTile, ensureOwner, ensureOwnerId } from "../bootstrap.ts";
import { ensurePlacementFixture } from "./api.ts";

async function snapshot(ctx: RunContext, cred: Credential): Promise<Record<string, unknown>> {
  const snap: Record<string, unknown> = {};
  const tiles = await ctx.api.get("/v1/tiles?limit=200", { bearer: cred.bearer });
  snap.tilesStatus = tiles.status;
  snap.tiles = tiles.status === 200 ? tiles.json : null;
  const fx = ctx.state.get("placementFixture") as { placementId?: string } | undefined;
  if (fx?.placementId) {
    const p = await ctx.api.get(`/v1/placements/${fx.placementId}`, { bearer: cred.bearer });
    snap.placement = { status: p.status, body: p.json };
  }
  const execId = ctx.state.get("at12.executionId") as string | undefined;
  if (execId) {
    const e = await ctx.api.get(`/v1/executions/${execId}`, { bearer: cred.bearer });
    snap.execution = { status: e.status, body: e.json };
  }
  return snap;
}

function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const diffs: string[] = [];
  for (const key of ["tilesStatus", "placement", "execution"] as const) {
    const b = JSON.stringify(before[key]);
    const a = JSON.stringify(after[key]);
    if (b !== a) diffs.push(`${key} changed`);
  }
  return diffs;
}

/** Compose services declared by the target stack (empty for shell ops). */
async function composeServices(ops: OpsConfig): Promise<string[]> {
  if (ops.kind !== "compose") return [];
  const r = await composeExec(ops, ["ps", "--services"]);
  if (r.exitCode !== 0) return [];
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

export async function at13(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  await ensureOwnerId(ctx, owner);
  await ensurePlacementFixture(ctx);
  const before = await snapshot(ctx, owner);

  // Restart order per contract: db -> api -> worker -> web (when the stack
  // actually runs a web service; verify-stack has none).
  const services = ["db", "api", "worker"];
  const declared = await composeServices(ctx.profile.ops);
  if (declared.includes("web")) services.push("web");
  else ctx.note("no web service in this stack; web restart covered by prod-stack profile");

  for (const svc of services) {
    const r = await runOps(ctx.profile.ops, "restart", svc);
    ctx.step(`restart ${svc}`, null, `exit=${r.exitCode} ${r.stderr.slice(0, 200)}`);
    if (r.exitCode !== 0) {
      ctx.check("restart-api", false, `${svc} restart failed: ${r.stderr.slice(0, 200)}`);
      return;
    }
  }
  const health = await waitForHealth(ctx.profile.apiBase, 180_000);
  ctx.step("wait for health", null, `ok=${health.ok} attempts=${health.attempts}`);

  const after = await snapshot(ctx, owner);
  const diffs = diffSnapshots(before, after);
  ctx.check("restart-db", health.ok && diffs.length === 0, diffs.join(";") || "state preserved");
  ctx.check("restart-api", health.ok, `health=${health.ok}`);
  ctx.check("restart-worker", diffs.length === 0, diffs.join(";") || "worker state preserved");

  const tiles = await ctx.api.get("/v1/tiles?limit=5", { bearer: owner.bearer });
  ctx.check("auth-survives", tiles.status === 200, `status ${tiles.status}`);
}

interface SyncEntity {
  entity_kind: number;
  entity_id: string;
  state?: { tile_id?: string; placement_id?: string | null; state?: number } | null;
}

/** Poll the sync snapshot for worker-produced entities (kind 3 = Execution). */
async function waitForSyncEntity(
  ctx: RunContext,
  cred: Credential,
  match: (e: SyncEntity) => boolean,
  timeoutMs: number,
): Promise<{ found: SyncEntity[]; attempts: number; diag: string }> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastStatus: number | null = null;
  const kindCounts = new Map<number, number>();
  const execSamples: string[] = [];
  while (Date.now() < deadline) {
    attempts += 1;
    // The snapshot is paginated; owners with >limit entities (e.g. many
    // tiles) push executions onto later pages, so follow next_cursor.
    let cursor: string | null = null;
    let pages = 0;
    const found: SyncEntity[] = [];
    do {
      const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const res = await ctx.api.get(`/v1/sync/snapshot?limit=500${qs}`, { bearer: cred.bearer });
      lastStatus = res.status;
      if (res.status !== 200) break;
      const body = res.json as { entities?: SyncEntity[]; next_cursor?: string | null } | null;
      const entities = body?.entities ?? [];
      kindCounts.clear();
      execSamples.length = 0;
      for (const e of entities) {
        kindCounts.set(e.entity_kind, (kindCounts.get(e.entity_kind) ?? 0) + 1);
        if (e.entity_kind === 3 && execSamples.length < 3) {
          execSamples.push(`${e.entity_id} tile=${e.state?.tile_id ?? "?"} plc=${e.state?.placement_id ?? "?"}`);
        }
      }
      found.push(...entities.filter(match));
      cursor = body?.next_cursor ?? null;
      pages += 1;
    } while (cursor && pages < 20 && found.length === 0 && Date.now() < deadline);
    if (found.length > 0) return { found, attempts, diag: "" };
    await new Promise((r) => setTimeout(r, 3_000));
  }
  const kinds = [...kindCounts.entries()].map(([k, n]) => `${k}:${n}`).join(",");
  return {
    found: [],
    attempts,
    diag: `lastStatus=${lastStatus} kinds={${kinds}} execSamples=[${execSamples.join("; ")}]`,
  };
}

export async function at14(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  await ensureOwnerId(ctx, owner);

  const stop = await runOps(ctx.profile.ops, "stop", "worker");
  ctx.step("stop worker", null, `exit=${stop.exitCode}`);
  if (stop.exitCode !== 0) {
    ctx.check("work-queued", false, `worker stop failed: ${stop.stderr.slice(0, 200)}`);
    return;
  }

  // Enqueue durable work while the worker is down:
  //  - a placement whose span.start lands inside the worker's due-work
  //    horizon and start grace, so the restarted worker must auto-start
  //    exactly one execution for it (real worker-produced work);
  //  - a tick row (recorded durably by the API).
  const tile = await createTile(ctx, owner, { title: `acc-at14-${ctx.runId}` });
  if (!tile.planId) throw new BlockedError("at14 tile has no plan_id");
  const start = new Date(Date.now() + 90_000).toISOString();
  const end = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const placement = await createPlacement(ctx, owner, {
    tileId: tile.tileId,
    planId: tile.planId,
    start,
    end,
  });
  ctx.state.set("at14.placementId", placement.placementId);
  ctx.state.set("at14.tileId", tile.tileId);
  const tick = await ctx.api.post("/v1/tick?kind=0", { bearer: owner.bearer });
  ctx.step("POST /v1/tick while worker down", tick);

  // On non-protected environments the debug event stream gives direct
  // evidence the tick was recorded; on protected envs the endpoint is
  // absent by design and the accepted command status is the evidence.
  let debugSeen: string | null = null;
  const dbg = await ctx.api.get("/v1/debug/events", { bearer: owner.bearer });
  if (dbg.status === 200 && Array.isArray(dbg.json)) {
    const hit = (dbg.json as { kind?: string }[]).some((e) => e.kind === "tick");
    debugSeen = hit ? "tick event present" : "no tick event in last 200";
  } else {
    debugSeen = `debug/events unavailable (status ${dbg.status}; protected env)`;
  }
  ctx.note(`queued-work evidence: ${debugSeen}`);
  ctx.check(
    "work-queued",
    tick.status < 300,
    `tick=${tick.status} placement=${placement.placementId} ${debugSeen}`,
  );

  const startOps = await runOps(ctx.profile.ops, "start", "worker");
  ctx.step("start worker", null, `exit=${startOps.exitCode}`);
  if (startOps.exitCode !== 0) {
    ctx.check("resume-processing", false, `worker start failed: ${startOps.stderr.slice(0, 200)}`);
    return;
  }

  // The worker's drain loop seeds due-work for the placement and
  // auto-starts an execution once `now` enters [span.start, start+grace].
  // The sync snapshot exposes the worker-produced Execution entity.
  const { found, attempts, diag } = await waitForSyncEntity(
    ctx,
    owner,
    (e) =>
      e.entity_kind === 3 &&
      (e.state?.tile_id === tile.tileId || e.state?.placement_id === placement.placementId),
    300_000,
  );
  ctx.step("sync snapshot poll for worker execution", null, `attempts=${attempts} matches=${found.length} ${diag}`);
  ctx.check(
    "resume-processing",
    found.length >= 1,
    `worker-produced executions for fixture: ${found.length} (attempts=${attempts}) ${diag}`,
  );
  ctx.check(
    "no-loss-no-dup",
    found.length === 1,
    `expected exactly one worker-started execution, got ${found.length}`,
  );
}

// --- A-AT15 backup / isolated restore ---------------------------------

function isVerifyStackCompose(ops: OpsConfig): boolean {
  if (ops.kind !== "compose" || !ops.dir) return false;
  const f = resolve(ACCEPTANCE_ROOT, "..", ops.dir, "compose.yaml");
  return existsSync(f) && readFileSync(f, "utf8").includes("TASTILE_VERIFY_PREFIX");
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

interface DumpManifest {
  databases: { name: string; file: string; sha256: string; bytes: number }[];
}

async function verifyStackBackup(ctx: RunContext, ops: OpsConfig): Promise<DumpManifest> {
  const outDir = join(ctx.evidenceDir ?? join(ACCEPTANCE_ROOT, ".tmp"), "backup");
  mkdirSync(outDir, { recursive: true });
  const pgUser = ops.env?.TASTILE_VERIFY_PG_USER ?? process.env.TASTILE_VERIFY_PG_USER ?? "tastile";

  const list = await composeExec(ops, [
    "exec", "-T", "db", "psql", "-U", pgUser, "-d", "postgres", "-tAc",
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1",
  ]);
  if (list.exitCode !== 0) {
    throw new BlockedError(`cannot list databases: ${list.stderr.slice(0, 200)}`);
  }
  const dbs = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (dbs.length === 0) throw new BlockedError("no application databases found to back up");

  const manifest: DumpManifest = { databases: [] };
  // Dumps can exceed execFile's maxBuffer, so stream stdout straight into
  // the evidence file via a shell redirect instead of capturing it.
  const baseArgv = `docker ${composeBaseArgs(ops).map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ")}`;
  for (const db of dbs) {
    const file = join(outDir, `${db}.sql`);
    const cmd = `${baseArgv} exec -T db pg_dump -U ${pgUser} -d '${db}' --no-owner --no-privileges > '${file.replaceAll("'", "'\\''")}'`;
    const dump = await runShell(cmd, {
      env: { ...(ops.env ?? {}) },
      timeoutMs: 300_000,
    });
    const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
    ctx.step(`pg_dump ${db}`, null, `exit=${dump.exitCode} bytes=${bytes.length}`);
    if (dump.exitCode !== 0 || bytes.length === 0) {
      throw new BlockedError(`pg_dump ${db} failed: ${dump.stderr.slice(0, 200)}`);
    }
    manifest.databases.push({
      name: db,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function verifyStackRestoreIsolated(
  ctx: RunContext,
  ops: OpsConfig,
  manifest: DumpManifest,
): Promise<{ ok: boolean; apiBase: string; detail: string; dispose: () => Promise<void> }> {
  const safeRun = ctx.runId.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 40);
  const project = `acc-restore-${safeRun}`;
  const prefix = `acc-restore-${safeRun}`;
  const pgPort = await freePort();
  const apiPort = await freePort();
  // Reuse the source stack's core image tag: the verify-stack compose
  // defaults TASTILE_CORE_TAG to "local", but running instances pin a
  // built tag (e.g. acc-<sha>) that exists only locally.  Locate the api
  // container through compose labels so no prefix env is needed.
  const srcProject = ops.project ?? "verify-stack";
  const imgRes = await runShell(
    `docker ps --filter label=com.docker.compose.project='${srcProject}' --filter label=com.docker.compose.service=api --format '{{.Names}}' | head -1`,
  );
  const apiContainer = imgRes.exitCode === 0 ? imgRes.stdout.trim() : "";
  const imgRes2 = apiContainer
    ? await runShell(`docker inspect '${apiContainer}' --format '{{.Config.Image}}'`)
    : { exitCode: 1, stdout: "", stderr: "no api container", command: "" };
  const srcImage = imgRes2.exitCode === 0 ? imgRes2.stdout.trim() : "";
  const coreTag = srcImage.includes(":") ? srcImage.slice(srcImage.lastIndexOf(":") + 1) : "";
  ctx.step(
    "resolve source core image",
    null,
    srcImage || `inspect failed: ${apiContainer || "no api container"} ${imgRes2.stderr.slice(0, 120)}`,
  );
  const restoreOps: OpsConfig = {
    kind: "compose",
    dir: ops.dir,
    project,
    envFile: ops.envFile,
    env: {
      ...(ops.env ?? {}),
      TASTILE_VERIFY_PREFIX: prefix,
      TASTILE_VERIFY_PG_PORT: String(pgPort),
      TASTILE_API_PORT: String(apiPort),
      TASTILE_WEB_BRIDGE_SECRET: randomBytes(24).toString("hex"),
      ...(coreTag ? { TASTILE_CORE_TAG: coreTag } : {}),
    },
  };
  const pgUser = restoreOps.env?.TASTILE_VERIFY_PG_USER ?? process.env.TASTILE_VERIFY_PG_USER ?? "tastile";
  const defaultDb = restoreOps.env?.TASTILE_VERIFY_PG_DB ?? process.env.TASTILE_VERIFY_PG_DB ?? "tastile_verify";
  const apiBase = `http://127.0.0.1:${apiPort}`;

  const cleanup = async () => {
    const down = await composeExec(restoreOps, ["down", "-v", "--remove-orphans"], { timeoutMs: 120_000 });
    ctx.step("restore stack teardown", null, `exit=${down.exitCode}`);
  };

  // NOTE: the caller owns teardown via `dispose` — the restored stack
  // must stay up while readback checks run against it.
  const fail = async (detail: string) => {
    await cleanup();
    return { ok: false, apiBase, detail, dispose: async () => {} };
  };

  // 1. Bring up an isolated db (fresh project + fresh named volume).
  const upDb = await composeExec(restoreOps, ["up", "-d", "db"], { timeoutMs: 300_000 });
  ctx.step("restore stack up db", null, `exit=${upDb.exitCode} ${upDb.stderr.slice(0, 200)}`);
  if (upDb.exitCode !== 0) return fail(`up db failed: ${upDb.stderr.slice(0, 200)}`);

  // Wait for pg_isready inside the container.
  const readyDeadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const probe = await composeExec(restoreOps, ["exec", "-T", "db", "pg_isready", "-U", pgUser]);
    if (probe.exitCode === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!ready) return fail("restored db did not become ready");

  // 2. Create non-default databases, then stream each dump into psql.
  for (const d of manifest.databases) {
    if (d.name === defaultDb) continue;
    const mk = await composeExec(restoreOps, [
      "exec", "-T", "db", "psql", "-U", pgUser, "-d", "postgres", "-c",
      `CREATE DATABASE "${d.name.replace(/"/g, "")}"`,
    ]);
    ctx.step(`create database ${d.name}`, null, `exit=${mk.exitCode}`);
    if (mk.exitCode !== 0) return fail(`create database ${d.name} failed`);
  }
  const baseArgv = `docker ${composeBaseArgs(restoreOps).map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ")}`;
  for (const d of manifest.databases) {
    const cmd = `${baseArgv} exec -T db psql -U ${pgUser} -d '${d.name}' -v ON_ERROR_STOP=1 -q < '${d.file.replaceAll("'", "'\\''")}'`;
    const r: CommandResult = await runShell(cmd, {
      env: { ...(restoreOps.env ?? {}) },
      timeoutMs: 300_000,
    });
    ctx.step(`restore ${d.name}`, null, `exit=${r.exitCode} ${r.stderr.slice(0, 200)}`);
    if (r.exitCode !== 0) return fail(`psql restore ${d.name} failed: ${r.stderr.slice(0, 200)}`);
  }

  // 3. Bring up the api against the restored data and wait for health.
  const upApi = await composeExec(restoreOps, ["up", "-d", "api"], { timeoutMs: 300_000 });
  ctx.step("restore stack up api", null, `exit=${upApi.exitCode} ${upApi.stderr.slice(0, 200)}`);
  if (upApi.exitCode !== 0) return fail(`up api failed: ${upApi.stderr.slice(0, 200)}`);
  const health = await waitForHealth(apiBase, 180_000);
  ctx.step("restore api health", null, `ok=${health.ok} attempts=${health.attempts}`);
  if (!health.ok) return fail("restored api health did not recover");
  return {
    ok: true,
    apiBase,
    detail: `isolated project ${project} healthy on ${apiBase}`,
    dispose: cleanup,
  };
}

export async function at15(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  await ensureOwnerId(ctx, owner);
  await ensurePlacementFixture(ctx);

  if (ctx.profile.ops.kind === "shell") {
    // Profile-supplied ops channel owns backup/restore semantics (e.g. a
    // prod-equivalent runbook script). The harness records outcomes only.
    const backup = await runOps(ctx.profile.ops, "backup");
    ctx.step("ops backup", null, `exit=${backup.exitCode}`);
    ctx.check("backup-created", backup.exitCode === 0, backup.stderr.slice(0, 300));
    const restore = await runOps(ctx.profile.ops, "restore");
    ctx.step("ops restore", null, `exit=${restore.exitCode}`);
    ctx.check("restore-into-isolated", restore.exitCode === 0, restore.stderr.slice(0, 300));
    const tiles = await ctx.api.get("/v1/tiles?limit=5", { bearer: owner.bearer });
    ctx.check("identity-preserved", tiles.status === 200, `status ${tiles.status}`);
    const fx = ctx.state.get("placementFixture") as { tileId?: string } | undefined;
    if (fx?.tileId) {
      const t = await ctx.api.get(`/v1/tiles/${fx.tileId}`, { bearer: owner.bearer });
      ctx.check("data-preserved", t.status === 200, `status ${t.status}`);
    } else {
      ctx.check("data-preserved", tiles.status === 200, "list readback only");
    }
    return;
  }

  if (!isVerifyStackCompose(ctx.profile.ops)) {
    ctx.check("backup-created", false, "compose ops target is not deploy/verify-stack");
    throw new BlockedError(
      "built-in backup/restore supports deploy/verify-stack only; for other stacks set TASTILE_ACCEPTANCE_OPS_CMD to a backup/restore runbook",
    );
  }

  // 1. Backup every application database via pg_dump inside the db
  //    container (plain SQL, owner/privilege statements stripped).
  const manifest = await verifyStackBackup(ctx, ctx.profile.ops);
  ctx.check(
    "backup-created",
    manifest.databases.length > 0,
    manifest.databases.map((d) => `${d.name}=${d.bytes}B`).join(", "),
  );

  // 2. Restore into a second, isolated compose project (fresh volume,
  //    fresh ports), then read back through its own api.
  const restored = await verifyStackRestoreIsolated(ctx, ctx.profile.ops, manifest);
  ctx.step("isolated restore", null, restored.detail);
  ctx.check("restore-into-isolated", restored.ok, restored.detail);
  if (!restored.ok) return;

  try {
    // 3. Readback against the restored stack with the same owner credential.
    const restoredApi = new ApiClient(restored.apiBase);
    const tiles = await restoredApi.get("/v1/tiles?limit=200", { bearer: owner.bearer });
    ctx.step("restored GET /v1/tiles", tiles);
    ctx.check(
      "identity-preserved",
      tiles.status === 200,
      `same bearer token authenticated on restored api: status ${tiles.status}`,
    );

    const fx = ctx.state.get("placementFixture") as { tileId?: string; placementId?: string } | undefined;
    let dataOk = tiles.status === 200;
    const details: string[] = [];
    if (fx?.tileId) {
      const t = await restoredApi.get(`/v1/tiles/${fx.tileId}`, { bearer: owner.bearer });
      details.push(`tile=${t.status}`);
      dataOk = dataOk && t.status === 200;
    }
    if (fx?.placementId) {
      const p = await restoredApi.get(`/v1/placements/${fx.placementId}`, { bearer: owner.bearer });
      details.push(`placement=${p.status}`);
      dataOk = dataOk && p.status === 200;
    }
    ctx.check("data-preserved", dataOk, details.join(" ") || "list readback only");
  } finally {
    await restored.dispose();
  }
}
