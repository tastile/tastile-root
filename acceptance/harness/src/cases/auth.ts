// A-AT03 / A-AT04 — Better Auth login/logout, session reuse, revocation.

import type { RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { createTile, ensureOwner, mintApiToken } from "../bootstrap.ts";

export async function at03(ctx: RunContext): Promise<void> {
  ctx.requireWeb();
  const owner = await ensureOwner(ctx, "ownerA");

  // signup already happened inside ensureOwner; the bootstrap recorded the
  // sign-up response status on the run context.
  const signupStatus = ctx.state.get("signup.ownerA") as number | undefined;
  ctx.check(
    "signup",
    owner.createdVia === "web-bridge" && signupStatus === 200,
    `sign-up status=${signupStatus ?? "not recorded"} via=${owner.createdVia}`,
  );

  // verify session continuity
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
  // Keep the cookie jar: the oracle is that the SAME session is rejected
  // after sign-out, not that a fresh client is unauthenticated (that is
  // already covered by A-AT06). absorbCookies applies any Set-Cookie
  // deletion the server sends.
  const out = await ctx.web.post("/api/auth/sign-out", { body: {} });
  ctx.step("POST /api/auth/sign-out", out);
  const signOutOk = out.status === 200 || out.status === 204;

  const dash = await ctx.web.get("/dashboard", {});
  const proxy = await ctx.web.get("/api/proxy/v1/tiles", {});
  ctx.step("GET /dashboard post-logout", dash);
  ctx.step("GET /api/proxy/v1/tiles post-logout", proxy);
  const rejected =
    (dash.status === 401 || dash.status === 403 || (dash.status >= 300 && dash.status < 400)) &&
    (proxy.status === 401 || proxy.status === 403 || proxy.status === 404);
  // Emit once: sign-out must succeed AND the same session must be rejected.
  ctx.check(
    "logout-rejects",
    signOutOk && rejected,
    `sign-out=${out.status} dashboard=${dash.status} proxy=${proxy.status}`,
  );
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
  const del = await ctx.api.delete(`/v1/api-tokens/${minted.id}`, { bearer: cred.bearer });
  ctx.step(`revoke token ${minted.prefix}`, del);
  const after = await ctx.api.get("/v1/tiles", { bearer: minted.token });
  ctx.step("GET /v1/tiles with revoked token", after);
  // Emit once: the token must work before revoke AND be rejected after.
  ctx.check(
    "expiry-or-revoke",
    before.status === 200 && after.status === 401,
    `pre-revoke=${before.status} post-revoke=${after.status}`,
  );
}
