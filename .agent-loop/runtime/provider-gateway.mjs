import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const providers = {
  minimax: {
    upstream: "https://api.minimax.io/anthropic",
    secret: process.env.MINIMAX_API_KEY,
    allowed: [/^\/v1\/messages(?:\/count_tokens)?$/],
    authorize(headers, secret) {
      headers.set("authorization", `Bearer ${secret}`);
      headers.set("x-api-key", secret);
    },
  },
  openai: {
    upstream: "https://api.openai.com",
    secret: process.env.OPENAI_API_KEY,
    allowed: [/^\/v1\/(?:responses(?:\/.*)?|chat\/completions)$/],
    authorize(headers, secret) {
      headers.set("authorization", `Bearer ${secret}`);
    },
  },
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "gateway"}`);
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", providers: Object.keys(providers) }));
    return;
  }

  const [, providerName, ...pathParts] = requestUrl.pathname.split("/");
  const provider = providers[providerName];
  const upstreamPath = `/${pathParts.join("/")}`;
  if (request.method !== "POST" || !provider || !provider.secret || !provider.allowed.some((pattern) => pattern.test(upstreamPath))) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "request is outside the provider gateway policy" }));
    return;
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ["authorization", "connection", "cookie", "host", "proxy-authorization", "x-api-key"].includes(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  provider.authorize(headers, provider.secret);

  const body = [];
  for await (const chunk of request) body.push(chunk);
  try {
    const upstreamUrl = `${provider.upstream}${upstreamPath}${requestUrl.search}`;
    const upstream = await fetch(upstreamUrl, { method: "POST", headers, body: Buffer.concat(body) });
    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (!["connection", "content-encoding", "transfer-encoding"].includes(name.toLowerCase())) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
    console.log(JSON.stringify({ provider: providerName, path: upstreamPath, status: upstream.status }));
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "provider request failed" }));
    console.error(JSON.stringify({ provider: providerName, path: upstreamPath, error: error instanceof Error ? error.message : "unknown" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ status: "ready", port, providers: Object.keys(providers) }));
});
