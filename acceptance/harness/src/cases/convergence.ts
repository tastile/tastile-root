// A-AT10 — Web ↔ direct API convergence for the same owner.
// The web proxy (/api/proxy/v1/*) forwards with bridge headers derived
// from the Better Auth session cookies held in ctx.web.

import type { RunContext } from "../ctx.ts";
import { createTile, ensureOwner, idem } from "../bootstrap.ts";

export async function at10(ctx: RunContext): Promise<void> {
  ctx.requireWeb();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));
  const title = `acc-at10-${ctx.runId}`;

  // API-side write
  const tile = await createTile(ctx, owner, { title });

  // Web-side read of the same aggregate through the proxy (session cookies
  // in ctx.web carry the bridge identity). The proxy read model can lag the
  // command write by a few ms; poll briefly before declaring divergence.
  const cookieToken = ctx.web.getCookie("tastile_api_token");
  ctx.note(
    `proxy identity: cookieMatchesBearer=${cookieToken === owner.bearer} ` +
      `hasApiTokenCookie=${cookieToken !== null} hasUid=${ctx.web.getCookie("tastile_uid") !== null}`,
  );
  let viaWeb = await ctx.web.get(`/api/proxy/v1/tiles/${tile.tileId}`);
  const readDeadline = Date.now() + 15_000;
  while (
    (viaWeb.status !== 200 ||
      (viaWeb.json as { id?: string } | null)?.id !== tile.tileId) &&
    Date.now() < readDeadline
  ) {
    await new Promise((r) => setTimeout(r, 500));
    viaWeb = await ctx.web.get(`/api/proxy/v1/tiles/${tile.tileId}`);
  }
  ctx.step("GET /api/proxy/v1/tiles/{id}", viaWeb);
  const wview = viaWeb.json as { id?: string; title?: string; revision?: number } | null;
  ctx.check(
    "api-write-web-read",
    viaWeb.status === 200 && wview?.id === tile.tileId,
    `status ${viaWeb.status} title=${wview?.title ?? "?"}`,
  );

  // Web-side write (update title via proxy command path)
  const webWrite = await ctx.web.post(`/api/proxy/v1/tiles/${tile.tileId}/update`, {
    body: {
      idempotency_key: idem(),
      payload: { tile_id: tile.tileId, title: `${title}-web` },
    },
  });
  ctx.step("POST /api/proxy/v1/tiles/{id}/update", webWrite);

  // API-side readback must observe the same revision/content.
  const viaApi = await ctx.api.get(`/v1/tiles/${tile.tileId}`, { bearer: owner.bearer });
  const aview = viaApi.json as { title?: string; revision?: number } | null;
  ctx.step("GET /v1/tiles/{id} after web write", viaApi);
  ctx.check(
    "web-write-api-read",
    webWrite.status < 300 && viaApi.status === 200 && aview?.title === `${title}-web`,
    `webWrite=${webWrite.status} apiTitle=${aview?.title ?? "?"}`,
  );

  // revision convergence: both surfaces report the same revision
  const webRead2 = await ctx.web.get(`/api/proxy/v1/tiles/${tile.tileId}`);
  const w2 = webRead2.json as { revision?: number } | null;
  const sameRev =
    typeof aview?.revision === "number" && typeof w2?.revision === "number"
      ? aview.revision === w2.revision
      : aview?.title === `${title}-web` && w2 !== null;
  ctx.check("revision-match", sameRev, `api.rev=${aview?.revision} web.rev=${w2?.revision}`);
}
