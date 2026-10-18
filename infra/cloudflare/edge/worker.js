// cmp.edge.router (root ADR-0014): forwards public hostnames to their Cloud Run origins and adds
// the edge assertion (cred.edge-assertion) so origins can reject direct run.app requests.
// Bindings: ROUTES (JSON {hostname: origin URL}), EDGE_ASSERTION (secret).

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
// Client-supplied values that only the edge may set.
const EDGE_OWNED = ["x-tastile-edge-assertion", "x-serverless-authorization", "x-forwarded-host", "x-forwarded-proto"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const routes = JSON.parse(env.ROUTES);
    const origin = routes[url.hostname];
    if (!origin || !env.EDGE_ASSERTION) return new Response("Not found", { status: 404 });

    const headers = new Headers(request.headers);
    for (const name of [...HOP_BY_HOP, ...EDGE_OWNED]) headers.delete(name);
    headers.set("x-tastile-edge-assertion", env.EDGE_ASSERTION);
    headers.set("x-forwarded-host", url.hostname);
    headers.set("x-forwarded-proto", "https");

    const upstream = new URL(url.pathname + url.search, origin);
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
    const out = new Headers(response.headers);
    for (const name of HOP_BY_HOP) out.delete(name);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
  },
};
