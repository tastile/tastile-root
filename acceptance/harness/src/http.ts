// Minimal HTTP client for the acceptance harness.
// - cookie jar per client instance
// - explicit bearer token per request (never ambient)
// - secrets are redacted before anything reaches evidence/logs

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
  url: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bearer?: string;
  /** raw body string (used for negative tests) */
  rawBody?: string;
  timeoutMs?: number;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/tastile_[0-9a-f]{64}/g, "tastile_<redacted>"],
  [/Bearer\s+\S+/gi, "Bearer <redacted>"],
  [/"token"\s*:\s*"[^"]+"/g, '"token":"<redacted>"'],
  [/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"<redacted>"'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export class ApiClient {
  readonly base: string;
  private cookies = new Map<string, string>();

  constructor(base: string) {
    this.base = base.replace(/\/+$/, "");
  }

  cookieHeader(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  getCookie(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  /** Store cookies from a response's set-cookie headers. */
  absorbCookies(res: Response): void {
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
    for (const sc of setCookies) {
      const first = sc.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      // An empty value with Max-Age=0 / Expires in past deletes the cookie.
      const expired = /max-age=0\b/i.test(sc) || /expires=Thu, 01 Jan 1970/i.test(sc);
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(path: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const method = opts.method ?? "GET";
    const url = path.startsWith("http") ? path : `${this.base}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    const cookie = this.cookieHeader();
    if (cookie && !headers.cookie) headers.cookie = cookie;
    let body: string | undefined;
    if (opts.rawBody !== undefined) {
      body = opts.rawBody;
      headers["content-type"] ??= "application/json";
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["content-type"] ??= "application/json";
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    this.absorbCookies(res);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json, url };
  }

  get(path: string, opts?: RequestOptions) {
    return this.request(path, { ...opts, method: "GET" });
  }
  post(path: string, opts?: RequestOptions) {
    return this.request(path, { ...opts, method: "POST" });
  }
  patch(path: string, opts?: RequestOptions) {
    return this.request(path, { ...opts, method: "PATCH" });
  }
  delete(path: string, opts?: RequestOptions) {
    return this.request(path, { ...opts, method: "DELETE" });
  }
}
