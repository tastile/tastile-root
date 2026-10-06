import { expect, test } from "bun:test";
import { dispatcherHandler } from "./server";

test("real HTTP dispatch completes only after the callback finishes", async () => {
  let completed = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: dispatcherHandler(async () => {
    await Bun.sleep(10);
    completed = true;
  }) });
  try {
    const response = await fetch(new URL("/dispatch", server.url), { method: "POST" });
    expect(response.status).toBe(200);
    expect(completed).toBe(true);
    expect(await response.json()).toEqual({ status: "complete" });
  } finally { server.stop(true); }
});

test("invalid real HTTP method, path and body never dispatch", async () => {
  let invoked = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: dispatcherHandler(async () => { invoked++; }) });
  try {
    for (const [path, method, body, status] of [
      ["/dispatch", "GET", undefined, 405],
      ["/missing", "POST", undefined, 404],
      ["/dispatch", "POST", "{}", 400],
    ] as const) {
      const response = await fetch(new URL(path, server.url), { method, body });
      expect(response.status).toBe(status);
    }
    expect(invoked).toBe(0);
  } finally { server.stop(true); }
});

test("real HTTP callback failure is unavailable rather than successful", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: dispatcherHandler(async () => { throw new Error("probe failure"); }) });
  try {
    const response = await fetch(new URL("/dispatch", server.url), { method: "POST" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "failed" });
  } finally { server.stop(true); }
});
