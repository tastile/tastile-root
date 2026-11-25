// A-AT09 — placement (schedule materialization) acceptance.
// Canonical path: tile+plan -> POST /v1/placements with a fixed fixture
// window -> worker tick -> readback via /v1/placements + /v1/timeline.
// Window/flow/recurring fixtures are created per the contract; the legacy
// recurring write path (kind=0 via POST /v1/tiles) is probed separately:
// it is expected to be rejected (GONE) since recurring writes moved to
// /v1/source-tiles; the outcome is recorded as evidence, not as the case
// oracle.

import type { Credential, RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import {
  createPlacement,
  createTile,
  ensureOwner,
  ensureOwnerId,
  fixtureWindow,
  idem,
} from "../bootstrap.ts";

export async function at09(ctx: RunContext): Promise<void> {
  const owner: Credential = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));

  // Fixed-shape fixture window on a future UTC date (past_span_guard safe).
  const { start, end } = fixtureWindow();

  const tile = await createTile(ctx, owner, { title: `acc-at09-${ctx.runId}` });
  if (!tile.planId) throw new BlockedError("at09 tile has no plan_id");

  // Window fixture: Calendar window bounded by the fixture span.
  const win = await ctx.api.post("/v1/windows", {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: { kind: 0, bounds: { start, end }, rules: [] },
    },
  });
  ctx.step("POST /v1/windows (fixture)", win);
  ctx.note(`window fixture status=${win.status}`);

  // Flow fixture: best-effort minimal flow; the condition DSL is heavy, so
  // the outcome is evidence, not the oracle.
  const ownerId = await ensureOwnerId(ctx, owner).catch(() => null);
  if (ownerId) {
    const flow = await ctx.api.post("/v1/flows", {
      bearer: owner.bearer,
      body: {
        idempotency_key: idem(),
        payload: {
          flow: {
            id: crypto.randomUUID(),
            owner_id: ownerId,
            observes: [],
            when: null,
            candidates: [],
          },
        },
      },
    });
    ctx.step("POST /v1/flows (fixture probe)", flow);
    ctx.note(`flow fixture probe status=${flow.status}`);
  }

  const placement = await createPlacement(ctx, owner, {
    tileId: tile.tileId,
    planId: tile.planId,
    start,
    end,
    title: `acc-at09-placement-${ctx.runId}`,
  });
  ctx.state.set("at09.placementId", placement.placementId);
  ctx.state.set("at09.tileId", tile.tileId);

  // Probe the legacy recurring write path for evidence (not the oracle).
  const legacy = await ctx.api.post("/v1/tiles", {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: {
        kind: 0,
        title: `acc-at09-recurring-probe-${ctx.runId}`,
        description: null,
        color: null,
        icon: null,
        external_id: null,
        plan_role: 0,
      },
    },
  });
  ctx.step("POST /v1/tiles kind=0 (legacy recurring probe)", legacy);
  ctx.note(
    `legacy recurring write probe: status=${legacy.status} ` +
      `(410 GONE expected; recurring writes live under /v1/source-tiles)`,
  );

  // Worker confirmation: nudge the scheduler at the fixture instant.
  const tickAt = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const tick = await ctx.api.post(`/v1/tick-at?at=${encodeURIComponent(tickAt)}`, {
    bearer: owner.bearer,
  });
  ctx.step("POST /v1/tick-at", tick);
  ctx.check("worker-commit", tick.status < 300, `tick-at status ${tick.status}`);

  const view = await ctx.api.get(`/v1/placements/${placement.placementId}`, { bearer: owner.bearer });
  const pv = view.json as {
    id?: string;
    tile_id?: string;
    plan_id?: string;
    span_start?: string;
    span_end?: string;
    revision?: number;
  } | null;
  const span = pv ? { start: pv.span_start, end: pv.span_end } : null;
  const norm = (s?: string) => (s ?? "").replace(".000Z", "Z");
  ctx.step("GET /v1/placements/{id}", view);
  ctx.check(
    "placement-created",
    view.status === 200 && pv?.id === placement.placementId,
    `status ${view.status} id=${pv?.id ?? "?"}`,
  );
  ctx.check(
    "expected-window",
    norm(span?.start) === norm(start) && norm(span?.end) === norm(end),
    `expected ${start}..${end} got ${JSON.stringify(span)}`,
  );
  const timelineEnd = new Date(new Date(end).getTime() + 24 * 60 * 60_000).toISOString();
  const timeline = await ctx.api.get(
    `/v1/timeline?start=${encodeURIComponent(start)}&end=${encodeURIComponent(timelineEnd)}`,
    { bearer: owner.bearer },
  );
  ctx.step("GET /v1/timeline", timeline);
  ctx.check(
    "readback-consistent",
    timeline.status === 200 && timeline.text.includes(placement.placementId),
    `timeline status ${timeline.status}; placement absent from range`,
  );
}
