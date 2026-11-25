// Owner bootstrap + Core API helpers shared by the acceptance cases.
// All credentials belong to dedicated `acc-<runId>-*` owners created for
// the run; nothing here touches operational data.

import { randomUUID } from "node:crypto";
import type { Credential, RunContext } from "./ctx.ts";
import { BlockedError } from "./ctx.ts";
import type { HttpResponse } from "./http.ts";

export function idem(): string {
  return randomUUID();
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
}

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

/**
 * Bootstrap a dedicated owner through the Web Better Auth surface.
 * Produces a Core API token (via /api/auth/bridge) usable as a Bearer
 * credential, plus the web session cookies kept inside ctx.web client.
 */
export async function signupViaWeb(
  ctx: RunContext,
  name: string,
  input: SignupInput,
): Promise<Credential> {
  ctx.requireWeb();
  const web = ctx.web;
  const res = await web.post("/api/auth/sign-up/email", {
    body: { email: input.email, password: input.password, name: input.name ?? input.email },
    timeoutMs: 30_000,
  });
  ctx.step(`signup.web ${name}`, res);
  if (res.status !== 200) {
    throw new BlockedError(`web sign-up failed for ${name}: status ${res.status}`);
  }
  // Bridge issues the core API token cookie and redirects; redirect:manual
  // keeps the 3xx while still absorbing Set-Cookie.
  const bridge = await web.get("/api/auth/bridge?next=/dashboard");
  ctx.step(`bridge ${name}`, bridge);
  const apiToken = web.getCookie("tastile_api_token");
  const userSub = web.getCookie("tastile_uid");
  if (!apiToken) {
    throw new BlockedError(`bridge did not issue tastile_api_token for ${name}`);
  }
  const cred: Credential = {
    name,
    bearer: apiToken,
    userSub: userSub ?? undefined,
    tokenPrefix: tokenPrefix(apiToken),
    createdVia: "web-bridge",
  };
  ctx.creds.set(name, cred);
  return cred;
}

/**
 * Bootstrap a dedicated owner directly against Core password auth.
 * Only valid where the Core enables password auth (non-production envs).
 */
export async function signupViaCore(
  ctx: RunContext,
  name: string,
  input: SignupInput,
): Promise<Credential> {
  const res = await ctx.api.post("/v1/auth/signup", {
    body: { email: input.email, password: input.password, display_name: input.name },
    timeoutMs: 30_000,
  });
  ctx.step(`signup.core ${name}`, res);
  if (res.status !== 200 && res.status !== 201) {
    throw new BlockedError(
      `core sign-up unavailable for ${name} (status ${res.status}); production profiles must bootstrap via web`,
    );
  }
  const view = res.json as { token?: string; owner_id?: string } | null;
  if (!view?.token) throw new BlockedError(`core sign-up response missing token for ${name}`);
  const cred: Credential = {
    name,
    bearer: view.token,
    ownerId: view.owner_id,
    tokenPrefix: tokenPrefix(view.token),
    createdVia: "core-signup",
  };
  ctx.creds.set(name, cred);
  return cred;
}

/**
 * Ensure an owner credential exists for this run. Prefers web bootstrap
 * when web_base exists (works in every profile); falls back to core
 * password auth otherwise.
 */
export async function ensureOwner(ctx: RunContext, name: string): Promise<Credential> {
  const existing = ctx.creds.get(name);
  if (existing) return existing;
  const email = ctx.envEmail(`acc-${name}`);
  const password = `Acc!${randomUUID().slice(0, 8)}xY9`;
  if (ctx.profile.webBase) {
    try {
      return await signupViaWeb(ctx, name, { email, password, name: `acc ${name}` });
    } catch (e) {
      if (e instanceof BlockedError && !ctx.profile.webBase) throw e;
      ctx.note(`web bootstrap for ${name} failed (${String(e)}); falling back to core signup`);
    }
  }
  return signupViaCore(ctx, name, { email, password, name: `acc ${name}` });
}

/** Mint a scoped API token for an existing owner credential. */
export async function mintApiToken(
  ctx: RunContext,
  owner: Credential,
  opts: { label: string; scopes: string; expiresInSeconds?: number },
): Promise<{ id: string; token: string; prefix: string; scopes: string }> {
  const expiresAt = new Date(Date.now() + (opts.expiresInSeconds ?? 3600) * 1000).toISOString();
  const res = await ctx.api.post("/v1/api-tokens", {
    bearer: owner.bearer,
    body: { label: opts.label, scopes: opts.scopes, expires_at: expiresAt },
  });
  ctx.step(`mint token ${opts.label}`, res);
  if (res.status !== 200 && res.status !== 201) {
    throw new BlockedError(`mint api token failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const view = res.json as { id?: string; token?: string; prefix?: string; scopes?: string };
  if (!view?.token) throw new BlockedError("api-token response missing raw token");
  return { id: view.id ?? "", token: view.token, prefix: view.prefix ?? "", scopes: view.scopes ?? opts.scopes };
}

/** Discover the Core owner UUID for a credential (needed by changeset payloads). */
export async function ensureOwnerId(ctx: RunContext, cred: Credential): Promise<string> {
  if (cred.ownerId) return cred.ownerId;
  const res = await ctx.api.get("/v1/tiles?limit=1", { bearer: cred.bearer });
  if (res.status === 200) {
    const body = res.json as { items?: { owner_id?: string }[] } | { owner_id?: string }[] | null;
    const items = Array.isArray(body) ? body : (body?.items ?? []);
    const oid = items[0]?.owner_id;
    if (oid) {
      cred.ownerId = oid;
      return oid;
    }
  }
  // Fall back: create a probe tile and read owner_id from the view.
  const created = await createTile(ctx, cred, { title: `acc-probe-${ctx.runId}` });
  const view = await ctx.api.get(`/v1/tiles/${created.tileId}`, { bearer: cred.bearer });
  const tile = view.json as { owner_id?: string } | null;
  if (!tile?.owner_id) throw new BlockedError(`cannot resolve owner_id for ${cred.name}`);
  cred.ownerId = tile.owner_id;
  return tile.owner_id;
}

// --- fixture builders -------------------------------------------------

export interface CreatedTile {
  tileId: string;
  planId: string | null;
  revision: number | null;
  raw: HttpResponse;
}

export async function createTile(
  ctx: RunContext,
  cred: Credential,
  input: { title: string; kind?: number; color?: string; icon?: string },
): Promise<CreatedTile> {
  const res = await ctx.api.post("/v1/tiles", {
    bearer: cred.bearer,
    body: {
      idempotency_key: idem(),
      payload: {
        kind: input.kind ?? 1, // 1 = PLACEMENT tile
        title: input.title,
        description: null,
        color: input.color ?? "#3b82f6",
        icon: input.icon ?? "check-circle",
        external_id: null,
        plan_role: 0,
        owner_subject_id: null,
      },
    },
  });
  ctx.step(`create tile "${input.title}"`, res);
  if (res.status >= 300) {
    throw new BlockedError(`create tile failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const body = res.json as {
    aggregate?: { id?: string };
    aggregate_meta?: { tile_id?: string; plan_id?: string };
    revision?: number;
  } | null;
  const tileId = body?.aggregate?.id ?? body?.aggregate_meta?.tile_id;
  if (!tileId) throw new BlockedError("create tile response missing aggregate.id");
  let planId = body?.aggregate_meta?.plan_id ?? null;
  if (!planId) {
    const tv = await ctx.api.get(`/v1/tiles/${tileId}`, { bearer: cred.bearer });
    const view = tv.json as { plan_id?: string; planId?: string } | null;
    planId = view?.plan_id ?? view?.planId ?? null;
  }
  return { tileId, planId, revision: body?.revision ?? null, raw: res };
}

export interface CreatedPlacement {
  placementId: string;
  tileId: string;
  planId: string;
}

export async function createPlacement(
  ctx: RunContext,
  cred: Credential,
  input: { tileId: string; planId: string; start: string; end: string; title?: string },
): Promise<CreatedPlacement> {
  const res = await ctx.api.post("/v1/placements", {
    bearer: cred.bearer,
    body: {
      idempotency_key: idem(),
      payload: {
        tile_id: input.tileId,
        plan_id: input.planId,
        source: 0, // MANUAL
        source_ref: {
          created: null,
          recurring: null,
          flow: null,
          frame: null,
          proposal: null,
          source_text: null,
          external_id: null,
        },
        baseline: { span: { start: input.start, end: input.end }, inside: null },
      },
    },
  });
  ctx.step(`create placement ${input.tileId}`, res);
  if (res.status >= 300) {
    throw new BlockedError(`create placement failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const body = res.json as { aggregate?: { id?: string } } | null;
  const placementId = body?.aggregate?.id;
  if (!placementId) throw new BlockedError("create placement response missing aggregate.id");
  return { placementId, tileId: input.tileId, planId: input.planId };
}

export async function getJson(ctx: RunContext, cred: Credential | null, path: string) {
  return ctx.api.get(path, cred ? { bearer: cred.bearer } : {});
}
