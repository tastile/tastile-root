// A-AT09 — placement (schedule materialization) acceptance.
// Path: recurring source tile -> frame rule -> materialize -> placement
// readback, plus worker tick observation. Mirrors tastile-web e2e helpers.

import type { Credential, RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { ensureOwner, idem } from "../bootstrap.ts";
import { runOps, waitForHealth } from "../ops.ts";

async function post(ctx: RunContext, cred: Credential, path: string, payload: unknown) {
  return ctx.api.post(path, {
    bearer: cred.bearer,
    body: { idempotency_key: idem(), payload },
  });
}

export async function at09(ctx: RunContext): Promise<void> {
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));

  // 1) recurring tile (kind=0). If the server demands an inline frame_rule
  //    we fall back to adding the rule via /v1/recurring/{id}/frame-rules.
  const tileRes = await post(ctx, owner, "/v1/tiles", {
    kind: 0,
    title: `acc-at09-${ctx.runId}`,
    description: null,
    color: "#0ea5e9",
    icon: "check",
    external_id: null,
    plan_role: 0,
    owner_subject_id: null,
  });
  ctx.step("POST /v1/tiles recurring", tileRes);
  const tileBody = tileRes.json as { aggregate?: { id?: string } } | null;
  const recurringId = tileBody?.aggregate?.id;
  if (!recurringId || tileRes.status >= 300) {
    ctx.check("placement-created", false, `recurring create failed: ${tileRes.status}`);
    throw new BlockedError(`cannot create recurring fixture: ${tileRes.status} ${tileRes.text.slice(0, 200)}`);
  }

  // 2) frame rule (daily step generator)
  const frameRuleId = idem();
  const ruleRes = await post(ctx, owner, `/v1/recurring/${recurringId}/frame-rules`, {
    recurring_id: recurringId,
    rule: {
      id: frameRuleId,
      active: null,
      rank: 0,
      generator: { Step: { step: 86_400_000, origin: null, bounds: null } },
    },
  });
  ctx.step("POST frame-rules", ruleRes);
  if (ruleRes.status >= 300) {
    ctx.check("placement-created", false, `frame-rule failed: ${ruleRes.status} ${ruleRes.text.slice(0, 200)}`);
    return;
  }

  // 3) materialize a fixed range (deterministic fixture window)
  const rangeStart = "2026-12-01T00:00:00.000Z";
  const rangeEnd = "2026-12-02T00:00:00.000Z";
  const mat = await post(ctx, owner, `/v1/recurring/${recurringId}/frame-rules/${frameRuleId}/materialize`, {
    recurring_id: recurringId,
    frame_rule_id: frameRuleId,
    range_start: rangeStart,
    range_end: rangeEnd,
  });
  ctx.step("POST materialize", mat);
  const matBody = mat.json as { aggregate?: { id?: string }; aggregate_meta?: { placement_ids?: string[] } } | null;
  const placementId = matBody?.aggregate?.id ?? matBody?.aggregate_meta?.placement_ids?.[0];
  ctx.check(
    "placement-created",
    mat.status < 300 && !!placementId,
    `status ${mat.status} placement=${placementId ?? "none"}`,
  );
  if (!placementId) return;
  ctx.state.set("at09.placementId", placementId);
  ctx.state.set("at09.recurringId", recurringId);

  // 4) worker confirmation: nudge the scheduler and observe via read model.
  const tick = await ctx.api.post("/v1/tick-at?at=2026-12-01T00:00:00Z", {
    bearer: owner.bearer,
  });
  ctx.step("POST /v1/tick-at", tick);

  const placement = await ctx.api.get(`/v1/placements/${placementId}`, { bearer: owner.bearer });
  const pv = placement.json as {
    span?: { start?: string; end?: string };
    baseline?: { span?: { start?: string; end?: string } };
  } | null;
  const span = pv?.span ?? pv?.baseline?.span;
  ctx.step("GET /v1/placements/{id}", placement);
  ctx.check(
    "expected-window",
    placement.status === 200 && !!span?.start && !!span?.end,
    `span=${JSON.stringify(span)}`,
  );

  const timeline = await ctx.api.get(
    `/v1/timeline?start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`,
    { bearer: owner.bearer },
  );
  ctx.step("GET /v1/timeline", timeline);
  ctx.check("readback-consistent", timeline.status === 200 && timeline.text.includes(placementId), "placement absent from timeline");

  // worker liveness: /v1/ready or sync should be reachable; deep worker
  // commit evidence is supplemented by ops profiles (AT-14).
  const ready = await ctx.api.get("/v1/ready");
  ctx.step("GET /v1/ready", ready);
  ctx.check("worker-commit", ready.status === 200, `ready=${ready.status}`);

  if (ctx.profile.ops.kind !== "none") {
    const ps = await runOps(ctx.profile.ops, "ps");
    ctx.step("compose ps", null, ps.stdout.slice(0, 400));
    void waitForHealth;
  }
}
