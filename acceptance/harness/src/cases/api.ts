// A-AT05..A-AT08, A-AT11, A-AT12 — direct Core API acceptance via scoped
// machine credentials. All operations go through Bearer API tokens; no
// browser, CLI or session cookie is involved on the data path.

import type { Credential, RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import {
  createPlacement,
  createTile,
  ensureOwner,
  ensureOwnerId,
  fixtureWindow,
  idem,
  mintApiToken,
} from "../bootstrap.ts";

async function ownerA(ctx: RunContext): Promise<Credential> {
  return ctx.creds.get("ownerA") ?? ensureOwner(ctx, "ownerA");
}

/** Muse-scoped token (read+write) for ownerA, minted once per run. */
async function museToken(ctx: RunContext): Promise<{ token: string; id: string; prefix: string }> {
  const cached = ctx.state.get("museToken") as { token: string; id: string; prefix: string } | undefined;
  if (cached) return cached;
  const owner = await ownerA(ctx);
  const minted = await mintApiToken(ctx, owner, {
    label: `acc-${ctx.runId}-muse`,
    scopes: "tastile.read tastile.write",
    expiresInSeconds: 7200,
  });
  const rec = { token: minted.token, id: minted.id, prefix: minted.prefix };
  ctx.state.set("museToken", rec);
  ctx.state.set("museTokenId", minted.id);
  return rec;
}

export async function at05(ctx: RunContext): Promise<void> {
  const owner = await ownerA(ctx);
  const muse = await museToken(ctx);

  // Direct CRUD with the scoped token only (no cookies/session headers).
  const res = await ctx.api.post("/v1/tiles", {
    bearer: muse.token,
    body: {
      idempotency_key: idem(),
      payload: {
        kind: 1,
        title: `acc-at05-${ctx.runId}`,
        description: null,
        color: "#22c55e",
        icon: "check-circle",
        external_id: null,
        plan_role: 0,
        owner_subject_id: null,
      },
    },
  });
  ctx.step("POST /v1/tiles (muse token)", res);
  ctx.check("mint-scoped-token", !!muse.id, `token prefix ${muse.prefix}`);
  const created = res.status === 200 || res.status === 201;

  const body = res.json as { aggregate?: { id?: string } } | null;
  const tileId = body?.aggregate?.id;
  if (!tileId) throw new BlockedError("create via muse token missing aggregate.id");
  const read = await ctx.api.get(`/v1/tiles/${tileId}`, { bearer: muse.token });
  ctx.step("GET /v1/tiles/{id} (muse token)", read);
  // Emit once: create AND readback must both succeed (ctx.check replaces,
  // so two calls would let the second mask the first).
  ctx.check("direct-crud", created && read.status === 200, `create=${res.status} readback=${read.status}`);
  ctx.state.set("at05.tileId", tileId);

  // no-browser-dep: a cookie-free client must complete the same CRUD using
  // only the scoped Bearer token (no session cookie, no bridge header).
  // clientFor still attaches CF Access edge credentials on the https
  // profile — those are transport auth, not a browser/session dependency.
  const bare = ctx.clientFor("muse-bare", ctx.profile.apiBase);
  const bareRead = await bare.get(`/v1/tiles/${tileId}`, { bearer: muse.token });
  ctx.step("GET /v1/tiles/{id} (fresh client, bearer only)", bareRead);
  ctx.check("no-browser-dep", bareRead.status === 200, `status ${bareRead.status}`);
  void owner;
}

export async function at06(ctx: RunContext): Promise<void> {
  const owner = await ownerA(ctx);
  await museToken(ctx);

  // scope-limited tokens for negative checks
  const readOnly = await mintApiToken(ctx, owner, {
    label: `acc-${ctx.runId}-ro`,
    scopes: "tastile.read",
    expiresInSeconds: 1800,
  });
  const writeOnly = await mintApiToken(ctx, owner, {
    label: `acc-${ctx.runId}-wo`,
    scopes: "tastile.write",
    expiresInSeconds: 1800,
  });

  const noCred = await ctx.api.get("/v1/tiles");
  ctx.step("GET /v1/tiles no credential", noCred);
  ctx.check("no-credential", noCred.status === 401 || noCred.status === 403, `status ${noCred.status}`);

  const bad = await ctx.api.get("/v1/tiles", { bearer: "tastile_deadbeef" });
  ctx.step("GET /v1/tiles bad bearer", bad);
  ctx.check("bad-credential", bad.status === 401 || bad.status === 403, `status ${bad.status}`);

  // revoked token: revoke the read-only token then retry
  const del = await ctx.api.delete(`/v1/api-tokens/${readOnly.id}`, { bearer: owner.bearer });
  ctx.step(`revoke ro token ${readOnly.prefix}`, del);
  const revoked = await ctx.api.get("/v1/tiles", { bearer: readOnly.token });
  ctx.step("GET /v1/tiles revoked token", revoked);
  ctx.check("revoked", revoked.status === 401, `status ${revoked.status}`);

  const roWrite = await ctx.api.post("/v1/tiles", {
    bearer: readOnly.token,
    body: {
      idempotency_key: idem(),
      payload: { kind: 1, title: `acc-at06-ro-${ctx.runId}`, description: null, color: null, icon: null, external_id: null, plan_role: 0, owner_subject_id: null },
    },
  });
  ctx.step("POST /v1/tiles read-only token", roWrite);
  ctx.check("scope-read-only-write", roWrite.status === 401 || roWrite.status === 403, `status ${roWrite.status}`);

  const woRead = await ctx.api.get("/v1/tiles", { bearer: writeOnly.token });
  ctx.step("GET /v1/tiles write-only token", woRead);
  ctx.check("scope-write-only-read", woRead.status === 401 || woRead.status === 403, `status ${woRead.status}`);

  // web boundary: unauthenticated proxy access must not leak data
  if (ctx.profile.webBase) {
    ctx.web.clearCookies();
    const proxy = await ctx.web.get("/api/proxy/v1/tiles");
    ctx.step("GET /api/proxy/v1/tiles unauthenticated", proxy);
    const leaked = typeof proxy.text === "string" && proxy.text.includes("acc-");
    ctx.check(
      "web-unauth",
      proxy.status === 401 || proxy.status === 403 || proxy.status === 404 || (proxy.status >= 300 && proxy.status < 400),
      `status ${proxy.status}${leaked ? " LEAKED fixture data" : ""}`,
    );
    if (leaked) ctx.check("web-unauth", false, "protected data leaked to unauthenticated web request");
    // The web client is shared run-wide: restore the owner session cleared
    // above so later cases keep their authenticated cookie jar.
    if (owner.email && owner.password) {
      const signIn = await ctx.web.post("/api/auth/sign-in/email", {
        headers: { origin: ctx.profile.webBase! },
        body: { email: owner.email, password: owner.password },
      });
      ctx.step("POST /api/auth/sign-in/email (restore shared session)", signIn);
      if (signIn.status === 200) {
        await ctx.web.get("/api/auth/bridge?next=/dashboard");
        const fresh = ctx.web.getCookie("tastile_api_token");
        if (fresh) owner.bearer = fresh;
      } else {
        ctx.note(`session restore after unauth probe failed: status ${signIn.status}`);
      }
    }
  } else {
    ctx.check("web-unauth", true, "web_base not configured; covered by core-side checks");
  }
}

export async function at07(ctx: RunContext): Promise<void> {
  const ownerA_ = await ownerA(ctx);
  const ownerB = await ensureOwner(ctx, "ownerB");
  const tileA = await createTile(ctx, ownerA_, { title: `acc-at07-a-${ctx.runId}` });
  await createTile(ctx, ownerB, { title: `acc-at07-b-${ctx.runId}` });

  const readB = await ctx.api.get(`/v1/tiles/${tileA.tileId}`, { bearer: ownerB.bearer });
  ctx.step("B reads A tile", readB);
  ctx.check("cross-read-denied", readB.status === 403 || readB.status === 404, `status ${readB.status}`);

  const patchB = await ctx.api.post(`/v1/tiles/${tileA.tileId}/update`, {
    bearer: ownerB.bearer,
    body: {
      idempotency_key: idem(),
      payload: { tile_id: tileA.tileId, title: `acc-at07-hijack-${ctx.runId}` },
    },
  });
  const patchDenied = patchB.status === 403 || patchB.status === 404;
  ctx.step("B patches A tile", patchB);

  const delB = await ctx.api.delete(`/v1/tiles/${tileA.tileId}`, {
    bearer: ownerB.bearer,
    body: { idempotency_key: idem(), payload: { tile_id: tileA.tileId } },
  });
  const delDenied = delB.status === 403 || delB.status === 404;
  ctx.step("B deletes A tile", delB);
  // Both mutations must be denied; emit once so neither can mask the other.
  ctx.check(
    "cross-write-denied",
    patchDenied && delDenied,
    `patch=${patchB.status} delete=${delB.status}`,
  );

  const listB = await ctx.api.get("/v1/tiles", { bearer: ownerB.bearer });
  const listText = listB.text;
  const leaked = listText.includes(tileA.tileId);
  ctx.check("list-isolation", !leaked, leaked ? "A tile id present in B list" : "isolated");

  const readA = await ctx.api.get(`/v1/tiles/${tileA.tileId}`, { bearer: ownerA_.bearer });
  const view = readA.json as { title?: string; revision?: number } | null;
  ctx.check(
    "state-unchanged",
    readA.status === 200 && view?.title === `acc-at07-a-${ctx.runId}`,
    `title=${view?.title ?? "?"} rev=${view?.revision ?? "?"}`,
  );
}

export async function at08(ctx: RunContext): Promise<void> {
  const owner = await ownerA(ctx);
  const title = `acc-at08-${ctx.runId}`;

  const create = await ctx.api.post("/v1/tiles", {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: {
        kind: 1,
        title,
        description: "acceptance fixture",
        color: "#8b5cf6",
        icon: "check-circle",
        external_id: null,
        plan_role: 0,
        owner_subject_id: null,
      },
    },
  });
  ctx.step("POST /v1/tiles", create);
  const cbody = create.json as { aggregate?: { id?: string }; revision?: number } | null;
  const tileId = cbody?.aggregate?.id;
  ctx.check("create-accepted", (create.status === 200 || create.status === 201) && !!tileId, `status ${create.status}`);
  if (!tileId) throw new BlockedError("no aggregate.id");

  const read = await ctx.api.get(`/v1/tiles/${tileId}`, { bearer: owner.bearer });
  const view = read.json as { title?: string; kind?: number; owner_id?: string; revision?: number } | null;
  ctx.step("GET /v1/tiles/{id}", read);
  const viewOk =
    read.status === 200 && view?.title === title && typeof view?.owner_id === "string";
  const viewDetail = `title=${view?.title} owner=${view?.owner_id}`;
  if (view?.owner_id && !owner.ownerId) owner.ownerId = view.owner_id;

  // idempotent replay: same key + same body must not create a second tile.
  const idemKey = idem();
  const mk = () =>
    ctx.api.post("/v1/tiles", {
      bearer: owner.bearer,
      body: {
        idempotency_key: idemKey,
        payload: {
          kind: 1,
          title: `acc-at08-idem-${ctx.runId}`,
          description: null,
          color: null,
          icon: null,
          external_id: null,
          plan_role: 0,
          owner_subject_id: null,
        },
      },
    });
  const r1 = await mk();
  const r2 = await mk();
  const id1 = (r1.json as { aggregate?: { id?: string } } | null)?.aggregate?.id;
  const id2 = (r2.json as { aggregate?: { id?: string } } | null)?.aggregate?.id;
  ctx.step("idempotent replay #1", r1);
  ctx.step("idempotent replay #2", r2);
  ctx.check("idempotent-replay", !!id1 && id1 === id2, `ids ${id1}/${id2}`);

  // revision-monotonic: an accepted mutation must advance the revision.
  const before = await ctx.api.get(`/v1/tiles/${tileId}`, { bearer: owner.bearer });
  const revBefore = (before.json as { revision?: number } | null)?.revision;
  const upd = await ctx.api.post(`/v1/tiles/${tileId}/update`, {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: { tile_id: tileId, title: `${title}-rev` },
    },
  });
  ctx.step("POST /v1/tiles/{id}/update (revision probe)", upd);
  const after = await ctx.api.get(`/v1/tiles/${tileId}`, { bearer: owner.bearer });
  const revAfter = (after.json as { revision?: number } | null)?.revision;
  ctx.check(
    "revision-monotonic",
    upd.status < 300 &&
      typeof revBefore === "number" &&
      typeof revAfter === "number" &&
      revAfter > revBefore,
    `rev ${revBefore} -> ${revAfter} (update=${upd.status})`,
  );

  const list = await ctx.api.get("/v1/tiles?limit=200", { bearer: owner.bearer });
  const listOk = list.status === 200 && list.text.includes(tileId);
  // Single emission: view content AND list membership must both hold.
  ctx.check(
    "readback-match",
    viewOk && listOk,
    `${viewDetail}; list=${list.status} contains=${listOk}`,
  );

  ctx.state.set("at08.tileId", tileId);
  ctx.state.set("ownerA", owner);
}

// --- shared fixture for placement/lifecycle cases ----------------------

export interface PlacementFixture {
  tileId: string;
  planId: string;
  placementId: string;
  start: string;
  end: string;
}

/** Create (or reuse) the run's placement fixture: tile + plan + placement. */
export async function ensurePlacementFixture(ctx: RunContext): Promise<PlacementFixture> {
  const cached = ctx.state.get("placementFixture") as PlacementFixture | undefined;
  if (cached) return cached;
  const owner = await ownerA(ctx);
  const { start, end } = fixtureWindow();
  const tile = await createTile(ctx, owner, { title: `acc-fixture-${ctx.runId}` });
  if (!tile.planId) throw new BlockedError("fixture tile has no plan_id");
  const placement = await createPlacement(ctx, owner, {
    tileId: tile.tileId,
    planId: tile.planId,
    start,
    end,
  });
  const fx: PlacementFixture = {
    tileId: tile.tileId,
    planId: tile.planId,
    placementId: placement.placementId,
    start,
    end,
  };
  ctx.state.set("placementFixture", fx);
  return fx;
}

export async function at11(ctx: RunContext): Promise<void> {
  const owner = await ownerA(ctx);
  const fx = await ensurePlacementFixture(ctx);
  const ownerId = await ensureOwnerId(ctx, owner);

  // edit: title change via UpdateTile command (PATCH /v1/tiles/{id} is
  // meta-min only and requires If-Match; the command path is canonical).
  const patch = await ctx.api.post(`/v1/tiles/${fx.tileId}/update`, {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: { tile_id: fx.tileId, title: `acc-at11-edited-${ctx.runId}` },
    },
  });
  ctx.step("POST /v1/tiles/{id}/update", patch);
  const after = await ctx.api.get(`/v1/tiles/${fx.tileId}`, { bearer: owner.bearer });
  const view = after.json as { title?: string; revision?: number } | null;
  ctx.check(
    "edit-readback",
    patch.status < 300 && after.status === 200 && view?.title === `acc-at11-edited-${ctx.runId}`,
    `status ${patch.status}/${after.status} title=${view?.title}`,
  );

  // re-place: append a placement-layer ChangeSet extending span_end
  // (part 1). Moving span_start risks an inverted span; extending the
  // end keeps the fixture valid while still proving re-placement.
  const newEnd = `${fx.start.slice(0, 10)}T11:00:00.000Z`;
  const changeset = {
    id: idem(),
    owner_id: ownerId,
    target: { Placement: fx.placementId },
    layer: 1,
    rank: 0,
    changes: [
      {
        id: idem(),
        key: { group: 5, item: null, part: 1 },
        kind: 0,
        value: { Instant: newEnd },
        merge: 0,
        source: 2,
        source_ref: null,
        rank: 0,
      },
    ],
    activation: { when: null, until: null },
    revoked: null,
    source: 2,
    source_ref: null,
    created_at: new Date().toISOString(),
    created_by: { at: new Date().toISOString(), actor: ownerId, actor_kind: 0, command_id: idem() },
  };
  const ch = await ctx.api.post(`/v1/placements/${fx.placementId}/changes`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: { placement_id: fx.placementId, changeset } },
  });
  ctx.step("POST /v1/placements/{id}/changes", ch);
  // GET /v1/placements/{id} returns the baseline span; the resolved
  // (ChangeSet-applied) span is only materialized by /v1/timeline.
  const tl = await ctx.api.get(
    `/v1/timeline?start=${encodeURIComponent(`${fx.start.slice(0, 10)}T00:00:00.000Z`)}&end=${encodeURIComponent(`${fx.start.slice(0, 10)}T23:59:59.999Z`)}`,
    { bearer: owner.bearer },
  );
  const items = Array.isArray(tl.json) ? (tl.json as Record<string, unknown>[]) : [];
  const item = items.find((i) => i.placement_id === fx.placementId) as
    | { span?: { start?: string; end?: string } }
    | undefined;
  const resolvedEnd = item?.span?.end;
  const norm = (s?: string) => (s ?? "").replace(".000Z", "Z");
  const moved = norm(resolvedEnd) === norm(newEnd);
  ctx.check(
    "re-place",
    ch.status < 300 && tl.status === 200 && moved,
    `changes=${ch.status} timeline=${tl.status} span_end=${resolvedEnd ?? "?"} expected=${newEnd}`,
  );

  // no-loss: another fixture tile remains intact
  const other = ctx.state.get("at08.tileId") as string | undefined;
  if (other) {
    const o = await ctx.api.get(`/v1/tiles/${other}`, { bearer: owner.bearer });
    ctx.check("no-loss", o.status === 200, `other tile status ${o.status}`);
  } else {
    ctx.check("no-loss", true, "no second fixture; archive check covers loss below");
  }

  // delete/archive: archive the fixture tile, verify it leaves the list
  // but placement history is still readable.
  const del = await ctx.api.delete(`/v1/tiles/${fx.tileId}`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: { tile_id: fx.tileId } },
  });
  ctx.step("DELETE /v1/tiles/{id} (archive)", del);
  const list = await ctx.api.get("/v1/tiles?limit=200", { bearer: owner.bearer });
  const stillListed = list.text.includes(fx.tileId);
  const hist = await ctx.api.get(`/v1/placements/${fx.placementId}`, { bearer: owner.bearer });
  ctx.check(
    "archive-hides",
    del.status < 300 && !stillListed && hist.status === 200,
    `del=${del.status} listed=${stillListed} hist=${hist.status}`,
  );
  ctx.state.delete("placementFixture");
}

export async function at12(ctx: RunContext): Promise<void> {
  const owner = await ownerA(ctx);
  const fx = await ensurePlacementFixture(ctx);

  const start = await ctx.api.post(`/v1/placements/${fx.placementId}/executions`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: { placement_id: fx.placementId } },
  });
  ctx.step("POST executions (start)", start);
  const sbody = start.json as { aggregate?: { id?: string } } | null;
  const executionId = sbody?.aggregate?.id;
  ctx.check("start", (start.status === 200 || start.status === 201) && !!executionId, `status ${start.status}`);
  if (!executionId) throw new BlockedError("start execution missing aggregate.id");
  ctx.state.set("at12.executionId", executionId);

  const pause = await ctx.api.post(`/v1/executions/${executionId}/pause`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: null },
  });
  ctx.step("POST executions/{id}/pause", pause);
  const pausedView = await ctx.api.get(`/v1/executions/${executionId}`, { bearer: owner.bearer });
  const pausedState = (pausedView.json as { state?: number } | null)?.state;

  const resume = await ctx.api.post(`/v1/executions/${executionId}/resume`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: null },
  });
  ctx.step("POST executions/{id}/resume", resume);
  const resumedView = await ctx.api.get(`/v1/executions/${executionId}`, { bearer: owner.bearer });
  const resumedState = (resumedView.json as { state?: number } | null)?.state;

  // ExecutionState is numeric on the wire: 0=Active, 1=Paused.
  ctx.check(
    "pause-resume",
    pause.status < 300 &&
      resume.status < 300 &&
      pausedState === 1 &&
      resumedState === 0,
    `pause=${pause.status} resume=${resume.status} state ${pausedState} -> ${resumedState}`,
  );

  const finish = await ctx.api.post(`/v1/executions/${executionId}/finish`, {
    bearer: owner.bearer,
    body: {
      idempotency_key: idem(),
      payload: { execution_id: executionId, kind: 0, note: "acceptance finish" },
    },
  });
  ctx.step("POST executions/{id}/finish", finish);
  ctx.check("finish", finish.status < 300, `status ${finish.status} ${finish.text.slice(0, 200)}`);

  const view = await ctx.api.get(`/v1/executions/${executionId}`, { bearer: owner.bearer });
  const viewBody = view.json as {
    state?: number;
    finished_at?: string | null;
    finish_kind?: number | null;
    placement_id?: string | null;
  } | null;
  ctx.step("GET /v1/executions/{id}", view);
  const finishedOk =
    view.status === 200 &&
    viewBody !== null &&
    (viewBody.state === 2 || viewBody.state === 3) &&
    typeof viewBody.finished_at === "string";
  ctx.check(
    "history-kept",
    finishedOk,
    `status=${view.status} state=${viewBody?.state} finished_at=${viewBody?.finished_at ?? "null"} kind=${viewBody?.finish_kind}`,
  );

  const badResume = await ctx.api.post(`/v1/executions/${executionId}/resume`, {
    bearer: owner.bearer,
    body: { idempotency_key: idem(), payload: null },
  });
  ctx.step("POST executions/{id}/resume after finish", badResume);
  ctx.check("invalid-transition", badResume.status >= 400, `status ${badResume.status}`);
}
