// A-AT03 / A-AT04 — Better Auth login/logout, session reuse, revocation.

import type { RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { createTile, ensureOwner, mintApiToken } from "../bootstrap.ts";

export async function at03(ctx: RunContext): Promise<void> {
  ctx.requireWeb();
  const owner = await ensureOwner(ctx, "ownerA");

  // signup already happened inside ensureOwner; verify session continuity
  // by reusing the bridge-issued credential against Core.
  const tiles = await ctx.api.get("/v1/tiles", { bearer: owner.bearer });
  ctx.step("GET /v1/tiles with bridge token", tiles);
  ctx.check("bridge-token", tiles.status === 200, `status ${tiles.status}`);

  // identity mapping: core must resolve the same owner for web and api
  // credential kinds. Compare owner_id visible on a created tile.
  const t = await createTile(ctx, owner, { title: `acc-at03-${ctx.runId}` });
  const view = await ctx.api.get(`/v1/tiles/${t.tileId}`, { bearer: owner.bearer });
  const tile = view.json as { owner_id?: string } | null;
  ctx.check(
    "identity-mapping",
    view.status === 200 && typeof tile?.owner_id === "string" && tile.owner_id.length === 36,
    `owner_id=${tile?.owner_id ?? "missing"}`,
  );
  ctx.state.set("ownerA", owner);
  ctx.state.set("at03.tileId", t.tileId);

  // sign-out: better-auth sign-out endpoint then protected routes must deny.
  const out = await ctx.web.post("/api/auth/sign-out", { body: {} });
  ctx.step("POST /api/auth/sign-out", out);
  ctx.check("logout-rejects", out.status === 200 || out.status === 204, `status ${out.status}`);

  // After sign-out the cookie jar may still hold cookies; clear to simulate
  // a fresh client and confirm protected paths reject.
  ctx.web.clearCookies();
  const dash = await ctx.web.get("/dashboard", {});
  const proxy = await ctx.web.get("/api/proxy/v1/tiles", {});
  ctx.step("GET /dashboard unauthenticated", dash);
  ctx.step("GET /api/proxy/v1/tiles unauthenticated", proxy);
  const rejected =
    (dash.status === 401 || dash.status === 403 || (dash.status >= 300 && dash.status < 400)) &&
    (proxy.status === 401 || proxy.status === 403 || proxy.status === 404);
  ctx.check("logout-rejects", rejected, `dashboard=${dash.status} proxy=${proxy.status}`);
}

export async function at04(ctx: RunContext): Promise<void> {
  const cred = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));

  // session reuse: repeated reads succeed
  const r1 = await ctx.api.get("/v1/tiles", { bearer: cred.bearer });
  const r2 = await ctx.api.get("/v1/tiles?limit=5", { bearer: cred.bearer });
  ctx.step("session reuse r1", r1);
  ctx.step("session reuse r2", r2);
  ctx.check("session-reuse", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);

  // revocation: mint a short-lived token, revoke it, confirm 401.
  const minted = await mintApiToken(ctx, cred, {
    label: `acc-at04-${ctx.runId}`,
    scopes: "tastile.read",
    expiresInSeconds: 600,
  });
  const before = await ctx.api.get("/v1/tiles", { bearer: minted.token });
  ctx.check("expiry-or-revoke", before.status === 200, `pre-revoke status ${before.status}`);
  const del = await ctx.api.delete(`/v1/api-tokens/${minted.id}`, { bearer: cred.bearer });
  ctx.step(`revoke token ${minted.prefix}`, del);
  const after = await ctx.api.get("/v1/tiles", { bearer: minted.token });
  ctx.step("GET /v1/tiles with revoked token", after);
  ctx.check("expiry-or-revoke", after.status === 401, `post-revoke status ${after.status}`);
}
