import { afterEach, expect, test } from "bun:test";

for (const name of ["INFISICAL_DOMAIN", "INFISICAL_MACHINE_IDENTITY_ID", "INFISICAL_PROJECT_ID",
  "GITHUB_APP_ID", "GITHUB_INSTALLATION_ID", "CI_SOURCE_BUCKET", "CLOUD_BUILD_SERVICE_ACCOUNT"]) {
  process.env[name] = "test-placeholder";
}
process.env.GCP_PROJECT_ID = "test-project";
const { processPull, claimLock } = await import("./index");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const sha = "a".repeat(40);
const buildId = "12345678-1234-1234-1234-123456789abc";
const pr = { number: 1, head: { sha }, base: { ref: "release-0-7-0" } };
const statusUrl = `https://console.cloud.google.com/cloud-build/builds;region=asia-northeast1/${buildId}?project=test-project`;

function mockRecovery(options: { hasStatus?: boolean; hasBuild?: boolean; duplicate?: boolean; buildStatus?: string }) {
  const posted: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "storage.googleapis.com") {
      if (init?.method === "POST") return new Response("", { status: 412 });
      return Response.json(url.searchParams.get("alt") === "media"
        ? { phase: "submitting", updatedAt: "2020-01-01T00:00:00Z" } : { generation: "1" });
    }
    if (url.pathname.endsWith(`/commits/${sha}/statuses`)) {
      return Response.json(options.hasStatus === false ? [] : [{
        state: "pending", context: "tastile/cloud-build-ci", updated_at: "2020-01-01T00:00:00Z",
      }]);
    }
    if (url.pathname.endsWith(`/statuses/${sha}`)) {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    if (url.hostname === "cloudbuild.googleapis.com") {
      const build = { id: buildId, status: options.buildStatus ?? "SUCCESS", tags: ["tastile-core-ci", sha] };
      if (url.pathname.endsWith("/builds")) {
        expect(url.searchParams.get("filter")).toBe(`tags="tastile-core-ci" AND tags="${sha}"`);
        return Response.json({ builds: options.hasBuild === false ? [] : options.duplicate ? [build, build] : [build] });
      }
      if (url.pathname.endsWith(`/builds/${buildId}`)) return Response.json(build);
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  return posted;
}

test("recovers a completed build after its create response or GitHub update was lost", async () => {
  const posted = mockRecovery({});
  await processPull("test", "test", pr);
  expect(posted.map((status) => status.state)).toEqual(["pending", "success"]);
  expect(posted[1]?.target_url).toBe(statusUrl);
});

test("keeps a recovered queued build pending beyond the dispatcher invocation", async () => {
  const posted = mockRecovery({ buildStatus: "QUEUED" });
  await processPull("test", "test", pr);
  expect(posted.map((status) => status.state)).toEqual(["pending"]);
});

test("recovers the lock-to-status crash window without submitting another build", async () => {
  const posted = mockRecovery({ hasStatus: false });
  await processPull("test", "test", pr);
  expect(posted).toHaveLength(1);
  expect(posted[0]?.target_url).toBe(statusUrl);
});

test("fails a stale pending status only after checking for an orphaned build", async () => {
  const posted = mockRecovery({ hasBuild: false });
  await processPull("test", "test", pr);
  expect(posted.map((status) => status.state)).toEqual(["error"]);
});

test("refuses an ambiguous recovery result", async () => {
  const posted = mockRecovery({ duplicate: true });
  await expect(processPull("test", "test", pr)).rejects.toThrow("Multiple Cloud Builds");
  expect(posted).toHaveLength(0);
});

test("reclaims a stale preparation lease using its generation precondition", async () => {
  const writes: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") {
      const generation = url.searchParams.get("ifGenerationMatch")!;
      writes.push(generation);
      return generation === "0" ? new Response("", { status: 412 }) : Response.json({ generation: "2" });
    }
    return Response.json(url.searchParams.get("alt") === "media"
      ? { phase: "preparing", updatedAt: "2020-01-01T00:00:00Z" } : { generation: "1" });
  }) as typeof fetch;
  expect(await claimLock("test", sha)).toBe("2");
  expect(writes).toEqual(["0", "1"]);
});

test("a competing preparation lease owner wins the generation fence", async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return new Response("", { status: 412 });
    return Response.json(url.searchParams.get("alt") === "media"
      ? { phase: "preparing", updatedAt: "2020-01-01T00:00:00Z" } : { generation: "1" });
  }) as typeof fetch;
  expect(await claimLock("test", sha)).toBeUndefined();
});
