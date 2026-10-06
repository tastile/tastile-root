export function dispatcherHandler(dispatch: () => Promise<void>) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return Response.json({ status: "ready" });
    }
    if (path !== "/dispatch") return new Response(null, { status: 404 });
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    if ((await request.arrayBuffer()).byteLength !== 0) return new Response(null, { status: 400 });
    try {
      await dispatch();
      return Response.json({ status: "complete" });
    } catch {
      console.error("CI dispatcher invocation failed");
      return Response.json({ status: "failed" }, { status: 503 });
    }
  };
}

export function serveDispatcher(portValue: string, dispatch: () => Promise<void>) {
  if (!/^[0-9]+$/.test(portValue)) throw new Error("PORT must be a positive u16");
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a positive u16");
  return Bun.serve({ hostname: "0.0.0.0", port, fetch: dispatcherHandler(dispatch) });
}
