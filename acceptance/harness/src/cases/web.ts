// A-AT02 — real-browser rendering check.
// Uses Playwright when installed; otherwise the case is BLOCKED with a
// concrete remediation, never silently skipped.

import type { RunContext } from "../ctx.ts";
import { BlockedError } from "../ctx.ts";
import { createTile, ensureOwner } from "../bootstrap.ts";

export async function at02(ctx: RunContext): Promise<void> {
  ctx.requireWeb();
  const owner = ctx.creds.get("ownerA") ?? (await ensureOwner(ctx, "ownerA"));

  let playwright: typeof import("playwright") | null = null;
  try {
    playwright = await import("playwright");
  } catch {
    playwright = null;
  }
  if (!playwright?.chromium) {
    throw new BlockedError(
      "playwright is not installed in acceptance/harness; run `bun install` there and `bunx playwright install chromium`",
    );
  }

  const title = `acc-at02-${ctx.runId}`;
  const tile = await createTile(ctx, owner, { title });

  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: ctx.profile.webBase ?? undefined });
    // Inject the post-bridge cookie state: the web app authorizes proxy
    // calls from these cookies server-side.
    const webUrl = new URL(ctx.profile.webBase!);
    await context.addCookies([
      {
        name: "tastile_api_token",
        value: owner.bearer,
        domain: webUrl.hostname,
        path: "/",
      },
      ...(owner.userSub
        ? [
            {
              name: "tastile_uid",
              value: owner.userSub,
              domain: webUrl.hostname,
              path: "/",
            },
          ]
        : []),
    ]);
    const page = await context.newPage();
    const apiHits: string[] = [];
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("/api/proxy/v1/") || u.includes("/v1/")) apiHits.push(`${res.status()} ${u}`);
    });

    const resp = await page.goto(`${ctx.profile.webBase}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    ctx.step("browser GET /dashboard", null, `status=${resp?.status()}`);
    // Give client-side fetch a moment, then assert on rendered content.
    await page.waitForTimeout(5_000);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const hasTile = bodyText.includes(title) || bodyText.includes("acc-at02");
    ctx.check(
      "login-render",
      !!resp && resp.status() < 400 && bodyText.trim().length > 0,
      `status=${resp?.status()} bodyLen=${bodyText.length}`,
    );
    ctx.check(
      "real-backend-data",
      hasTile || apiHits.some((h) => h.startsWith("2")),
      `tileVisible=${hasTile} apiHits=${apiHits.length}`,
    );
    const mockSignals = apiHits.filter((h) => /mock|fixture|serviceWorker/i.test(h));
    ctx.check("no-mock", mockSignals.length === 0, mockSignals.join("; ") || "no mock signals");
    ctx.state.set("at02.apiHits", apiHits);
    void tile;
  } finally {
    await browser.close();
  }
}
