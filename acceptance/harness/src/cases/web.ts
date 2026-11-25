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
    // Inject the full web session state captured during bootstrap
    // (better-auth session cookie + bridge-issued tastile_* cookies);
    // the app authorizes proxy calls from these server-side.
    const webUrl = new URL(ctx.profile.webBase!);
    const jarCookies = ctx.web.allCookies().map((c) => ({
      name: c.name,
      value: c.value,
      domain: webUrl.hostname,
      path: "/",
    }));
    const fallback = [
      { name: "tastile_api_token", value: owner.bearer },
      ...(owner.userSub ? [{ name: "tastile_uid", value: owner.userSub }] : []),
    ].map((c) => ({ ...c, domain: webUrl.hostname, path: "/" }));
    const names = new Set(jarCookies.map((c) => c.name));
    await context.addCookies([...jarCookies, ...fallback.filter((c) => !names.has(c.name))]);
    const page = await context.newPage();
    const apiHits: string[] = [];
    const consoleErrors: string[] = [];
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("/api/proxy/v1/") || u.includes("/v1/")) apiHits.push(`${res.status()} ${u}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 200)}`));

    const resp = await page.goto(`${ctx.profile.webBase}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    ctx.step("browser GET /dashboard", null, `status=${resp?.status()}`);
    // Dev-mode Next compiles routes on first hit; poll until the page
    // has real content instead of sampling once.
    let bodyText = "";
    const contentDeadline = Date.now() + 45_000;
    while (Date.now() < contentDeadline) {
      bodyText = await page.locator("body").innerText().catch(() => "");
      if (bodyText.trim().length > 200 || bodyText.includes(title)) break;
      await page.waitForTimeout(1_000);
    }
    ctx.step("browser dashboard content", null, `finalUrl=${page.url()} bodyLen=${bodyText.length}`);
    const hasTile = bodyText.includes(title) || bodyText.includes("acc-at02");
    // A proxy read that returned real data is the network-level oracle;
    // any 2xx on the tiles collection specifically.
    const proxyTilesOk = apiHits.some((h) => h.startsWith("2") && h.includes("/v1/tiles"));
    // Stronger oracle per contract: the API-created fixture tile must be
    // readable through the web proxy with matching content — a bare 2xx
    // on the collection does not prove the specific aggregate crossed
    // the Web<->Core boundary.
    let proxyTileOk = false;
    let proxyDetail = "proxy read skipped";
    try {
      const viaProxy = await ctx.web.get(`/api/proxy/v1/tiles/${tile.tileId}`);
      const pv = viaProxy.json as { title?: string; id?: string } | null;
      proxyTileOk = viaProxy.status === 200 && pv?.title === title;
      proxyDetail = `status=${viaProxy.status} title=${pv?.title ?? "?"}`;
      ctx.step("GET /api/proxy/v1/tiles/{id} fixture", viaProxy);
    } catch (e) {
      proxyDetail = `proxy read error: ${String(e).slice(0, 120)}`;
    }
    ctx.check(
      "login-render",
      !!resp && resp.status() < 400 && bodyText.trim().length > 0,
      `status=${resp?.status()} bodyLen=${bodyText.length}`,
    );
    ctx.check(
      "real-backend-data",
      hasTile || proxyTileOk,
      `tileVisible=${hasTile} proxyTile=${proxyTileOk} (${proxyDetail}) proxyTiles2xx=${proxyTilesOk} apiHits=${apiHits.length}`,
    );
    const mockSignals = apiHits.filter((h) => /mock|fixture|serviceWorker/i.test(h));
    ctx.check("no-mock", mockSignals.length === 0, mockSignals.join("; ") || "no mock signals");
    ctx.state.set("at02.apiHits", apiHits);
    ctx.state.set("at02.consoleErrors", consoleErrors.slice(0, 20));
    ctx.note(`browser console errors: ${consoleErrors.length}`);
    if (ctx.evidenceDir) {
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      mkdirSync(join(ctx.evidenceDir, "cases"), { recursive: true });
      await page.screenshot({ path: join(ctx.evidenceDir, "cases", "A-AT02.png"), fullPage: true });
    }
    void tile;
  } finally {
    await browser.close();
  }
}
