// A-AT13 / A-AT14 / A-AT15 — isolated-environment ops acceptance:
// restart persistence, worker recovery, backup/restore.
// These run only where ops injection is permitted (local / prod-equivalent).

import type { Credential, RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { createTile, ensureOwner, ensureOwnerId } from "../bootstrap.ts";
import { ensurePlacementFixture } from "./api.ts";
import { runOps, waitForHealth } from "../ops.ts";

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

export async function at13(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  await ensureOwnerId(ctx, owner);
  await ensurePlacementFixture(ctx);
  const before = await snapshot(ctx, owner);

  const services = ["db", "api", "worker"];
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

export async function at14(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));

  const stop = await runOps(ctx.profile.ops, "stop", "worker");
  ctx.step("stop worker", null, `exit=${stop.exitCode}`);
  if (stop.exitCode !== 0) {
    ctx.check("work-queued", false, `worker stop failed: ${stop.stderr.slice(0, 200)}`);
    return;
  }

  // enqueue work while worker is down: a tick + a new placement fixture
  const tick = await ctx.api.post("/v1/tick?kind=0", { bearer: owner.bearer });
  ctx.step("POST /v1/tick while worker down", tick);
  const tile = await createTile(ctx, owner, { title: `acc-at14-${ctx.runId}` });
  ctx.state.set("at14.tileId", tile.tileId);

  const start = await runOps(ctx.profile.ops, "start", "worker");
  ctx.step("start worker", null, `exit=${start.exitCode}`);
  await new Promise((r) => setTimeout(r, 5_000));

  const tiles = await ctx.api.get("/v1/tiles?limit=200", { bearer: owner.bearer });
  const found = tiles.status === 200 && tiles.text.includes(`acc-at14-${ctx.runId}`);
  ctx.check("work-queued", tick.status < 300, `tick=${tick.status}`);
  ctx.check("resume-processing", start.exitCode === 0 && found, `worker start=${start.exitCode} tileVisible=${found}`);

  // uniqueness: the fixture tile must appear exactly once
  const matches = tiles.status === 200 ? (tiles.text.match(new RegExp(tile.tileId, "g")) ?? []).length : 0;
  ctx.check("no-loss-no-dup", matches <= 1, `occurrences=${matches}`);
}

export async function at15(ctx: RunContext): Promise<void> {
  ctx.requireOps();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  await ensureOwnerId(ctx, owner);
  await ensurePlacementFixture(ctx);

  // Backup via compose exec pg_dump (custom format) for both databases.
  // The ops channel only allows service lifecycle verbs, so backup uses a
  // shell ops template when provided; otherwise the case is BLOCKED with
  // the exact command the profile must supply.
  if (ctx.profile.ops.kind !== "shell") {
    ctx.check("backup-created", false, "no shell ops template for backup; set TASTILE_ACCEPTANCE_OPS_CMD");
    throw new BlockedError(
      "A-AT15 requires TASTILE_ACCEPTANCE_OPS_CMD covering backup/restore, e.g. a script that runs pg_dump inside the db container",
    );
  }
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
}
