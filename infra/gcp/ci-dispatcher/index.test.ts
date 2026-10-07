import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

for (const name of ["INFISICAL_DOMAIN", "INFISICAL_MACHINE_IDENTITY_ID", "INFISICAL_PROJECT_ID",
  "GITHUB_APP_ID", "GITHUB_INSTALLATION_ID", "CI_SOURCE_BUCKET", "CLOUD_BUILD_SERVICE_ACCOUNT"]) {
  process.env[name] = "test-placeholder";
}
process.env.GCP_PROJECT_ID = "test-project";
const {
  buildConfigFromArchive,
  claimLock,
  createBuild,
  injectBaselineBuildConfig,
  archiveManifest,
  processPull,
  uploadBaseline,
  uploadSource,
} = await import("./index");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const sha = "a".repeat(40);
const buildId = "12345678-1234-1234-1234-123456789abc";
const pr = { number: 1, head: { sha }, base: { ref: "release-0-7-0" } };
const statusUrl = `https://console.cloud.google.com/cloud-build/builds;region=asia-northeast1/${buildId}?project=test-project`;

const baselineSha = "b".repeat(40);

async function archiveForConfig(config: string, extraFiles: Record<string, string> = {}): Promise<Uint8Array> {
  const workspaceTmp = join(import.meta.dir, "../../..", ".tmp");
  await mkdir(workspaceTmp, { recursive: true });
  const work = await mkdtemp(join(workspaceTmp, "tastile-ci-dispatcher-test-"));
  try {
    const root = "tastile-core-test";
    const sourceRoot = join(work, root);
    await mkdir(join(sourceRoot, "cloudbuild"), { recursive: true });
    await Bun.write(join(sourceRoot, "cloudbuild", "ci.yaml"), config);
    for (const [path, content] of Object.entries(extraFiles)) {
      await Bun.write(join(sourceRoot, path), content);
    }
    const archivePath = join(work, "source.tar.gz");
    const tar = Bun.spawnSync(["tar", "-czf", archivePath, "-C", work, root], { stdout: "pipe", stderr: "pipe" });
    expect(tar.exitCode).toBe(0);
    return new Uint8Array(await Bun.file(archivePath).arrayBuffer());
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function archiveWithMultipleRoots(config: string): Promise<Uint8Array> {
  const workspaceTmp = join(import.meta.dir, "../../..", ".tmp");
  await mkdir(workspaceTmp, { recursive: true });
  const work = await mkdtemp(join(workspaceTmp, "tastile-ci-dispatcher-unsafe-"));
  try {
    const root = "tastile-core-test";
    await mkdir(join(work, root, "cloudbuild"), { recursive: true });
    await mkdir(join(work, "second-root"), { recursive: true });
    await Bun.write(join(work, root, "cloudbuild", "ci.yaml"), config);
    await Bun.write(join(work, "second-root", "unexpected.txt"), "unsafe");
    const archivePath = join(work, "source.tar.gz");
    const tar = Bun.spawnSync(["tar", "-czf", archivePath, "-C", work, root, "second-root"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(tar.exitCode).toBe(0);
    return new Uint8Array(await Bun.file(archivePath).arrayBuffer());
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const legacyConfig = `timeout: 1800s
options:
  logging: CLOUD_LOGGING_ONLY
steps:
  - id: rust-quality
    name: rust:1.97.1-bookworm
    env:
      - CARGO_TARGET_DIR=/tmp/tastile-ci-target
`;

const baselineConfig = `rollback_baseline: pull-base
timeout: 1800s
options:
  logging: CLOUD_LOGGING_ONLY
steps:
  - id: rust-quality
    name: rust:1.97.1-bookworm
    env:
      - CARGO_TARGET_DIR=/tmp/tastile-ci-target
`;

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

test("parses a baseline contract from a portable tar listing", async () => {
  const config = await buildConfigFromArchive(sha, await archiveForConfig(baselineConfig));
  expect(config.rollback_baseline).toBe("pull-base");
  expect(config.timeout).toBe("1800s");
  expect(config.options).toEqual({ logging: "CLOUD_LOGGING_ONLY" });
  expect(config.steps).toHaveLength(1);
});

test("keeps a legacy config shape unchanged", async () => {
  const config = await buildConfigFromArchive(sha, await archiveForConfig(legacyConfig));
  expect(config).toEqual({
    steps: [{
      id: "rust-quality",
      name: "rust:1.97.1-bookworm",
      env: ["CARGO_TARGET_DIR=/tmp/tastile-ci-target"],
      dir: "tastile-core-test",
    }],
    timeout: "1800s",
    options: { logging: "CLOUD_LOGGING_ONLY" },
  });
});

test("rejects an unknown rollback contract", async () => {
  await expect(buildConfigFromArchive(sha, await archiveForConfig(baselineConfig.replace("pull-base", "unknown")))).rejects.toThrow(
    "rollback_baseline",
  );
});

test("rejects unknown top-level config and invalid baseline SHA", async () => {
  const unknownField = `${legacyConfig}unexpected: true\n`;
  await expect(buildConfigFromArchive(sha, await archiveForConfig(unknownField))).rejects.toThrow(
    "unapproved build field",
  );
  const parsed = await buildConfigFromArchive(sha, await archiveForConfig(baselineConfig));
  expect(() => injectBaselineBuildConfig(parsed, {
    sha: "Z".repeat(40),
    generation: "17",
    sha256: "c".repeat(64),
  })).toThrow("full lowercase commit SHA");
});

test("rejects an archive with multiple top-level directories", async () => {
  await expect(buildConfigFromArchive(sha, await archiveWithMultipleRoots(legacyConfig))).rejects.toThrow(
    "one top-level directory",
  );
});

test("rejects an archive larger than the trusted 32 MiB bound before tar", async () => {
  const oversized = new Uint8Array(32 * 1024 * 1024 + 1);
  await expect(buildConfigFromArchive(sha, oversized)).rejects.toThrow("32 MiB");
});

test("bounds tar listing bytes and entry count", () => {
  const overBytes = `tastile-core-test/cloudbuild/ci.yaml\n${"tastile-core-test/" + "x".repeat(2 * 1024 * 1024)}\n`;
  expect(() => archiveManifest(overBytes)).toThrow("2 MiB");

  const overEntries = ["tastile-core-test/", "tastile-core-test/cloudbuild/ci.yaml"];
  for (let index = 0; index < 20_000; index += 1) overEntries.push(`tastile-core-test/entry-${index}`);
  expect(() => archiveManifest(overEntries.join("\n"))).toThrow("20,000");
});

test("rejects Cloud Build config YAML larger than 128 KiB", async () => {
  const oversizedConfig = `${baselineConfig}\n# ${"x".repeat(128 * 1024)}\n`;
  await expect(buildConfigFromArchive(sha, await archiveForConfig(oversizedConfig))).rejects.toThrow("128 KiB");
});

test("parses concurrent archives with the same SHA independently", async () => {
  const first = await archiveForConfig(`${legacyConfig}\n# first\n`);
  const second = await archiveForConfig(`${legacyConfig.replace("rust-quality", "rust-quality-second")}\n# second\n`);
  const results = await Promise.all([
    buildConfigFromArchive(sha, first),
    buildConfigFromArchive(sha, second),
  ]);
  expect(results[0]?.steps[0]?.id).toBe("rust-quality");
  expect(results[1]?.steps[0]?.id).toBe("rust-quality-second");
});

test("rejects a noncanonical GITHUB_REPOSITORY during startup", () => {
  const moduleUrl = pathToFileURL(join(import.meta.dir, "index.ts")).href;
  const child = Bun.spawnSync([
    "bun",
    "-e",
    `await import(${JSON.stringify(moduleUrl)})`,
  ], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "attacker/tastile-core",
      INFISICAL_DOMAIN: "https://infisical.example",
      INFISICAL_MACHINE_IDENTITY_ID: "identity",
      INFISICAL_PROJECT_ID: "project",
      GITHUB_APP_ID: "app",
      GITHUB_INSTALLATION_ID: "installation",
      GCP_PROJECT_ID: "project",
      CI_SOURCE_BUCKET: "bucket",
      CLOUD_BUILD_SERVICE_ACCOUNT: "service-account",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(child.exitCode).not.toBe(0);
  expect(child.stderr.toString()).toContain("GITHUB_REPOSITORY");
  expect(child.stderr.toString()).toContain("tastile/tastile-core");
});

test("marks a baseline config with a missing PR base SHA as an error", async () => {
  const archive = await archiveForConfig(baselineConfig);
  const posted: Record<string, unknown>[] = [];
  let sourceUploadCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(`/commits/${sha}/statuses`)) return Response.json([]);
    if (url.hostname === "storage.googleapis.com" && init?.method === "POST") {
      if (url.searchParams.get("name") === `locks/${sha}`) return Response.json({ generation: "1" });
      sourceUploadCount += 1;
      return Response.json({ generation: "2" });
    }
    if (url.pathname.endsWith(`/statuses/${sha}`)) {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    if (url.pathname.endsWith(`/tarball/${sha}`)) return new Response(archive);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  await processPull("test", "test", { number: 1, head: { sha }, base: { ref: "release-0-7-0" } });
  expect(posted.map((status) => status.state)).toEqual(["pending", "error"]);
  expect(sourceUploadCount).toBe(0);
});

test("rejects a baseline env collision and reserved step id", async () => {
  const envCollision = baselineConfig.replace("CARGO_TARGET_DIR=/tmp/tastile-ci-target", "BASE_SHA=attacker");
  const parsed = await buildConfigFromArchive(sha, await archiveForConfig(envCollision));
  expect(() => injectBaselineBuildConfig(parsed, {
    sha: baselineSha,
    generation: "17",
    sha256: "c".repeat(64),
  })).toThrow("BASE_SHA");

  const reservedId = baselineConfig.replace("id: rust-quality", "id: rollback-baseline-download\n  - id: rust-quality");
  const reservedConfig = await buildConfigFromArchive(sha, await archiveForConfig(reservedId));
  expect(() => injectBaselineBuildConfig(reservedConfig, {
    sha: baselineSha,
    generation: "17",
    sha256: "c".repeat(64),
  })).toThrow("rollback-baseline-download");
});

test("injects a fixed baseline download step and reserved env into the unique rust step", async () => {
  const parsed = await buildConfigFromArchive(sha, await archiveForConfig(baselineConfig));
  const injected = injectBaselineBuildConfig(parsed, {
    sha: baselineSha,
    generation: "17",
    sha256: "c".repeat(64),
  });
  const steps = injected.steps as Array<Record<string, unknown>>;
  expect(steps.map((step) => step.id)).toEqual(["rollback-baseline-download", "rust-quality"]);
  expect(steps[0]?.args).toEqual(expect.arrayContaining([
    expect.stringContaining(`gs://test-placeholder/baselines/${baselineSha}.tar.gz#17`),
    expect.stringContaining("sha256sum -c"),
  ]));
  expect(steps[0]?.env).toEqual(expect.arrayContaining([
    `BASE_SHA=${baselineSha}`,
    "BASE_ARCHIVE_PATH=.tmp/rollback-baseline.tar.gz",
    `BASE_ARCHIVE_SHA256=${"c".repeat(64)}`,
  ]));
  expect(steps[1]?.env).toEqual(expect.arrayContaining([
    `BASE_SHA=${baselineSha}`,
    "BASE_ARCHIVE_PATH=.tmp/rollback-baseline.tar.gz",
    `BASE_ARCHIVE_SHA256=${"c".repeat(64)}`,
  ]));
});

test("strips the dispatcher-only baseline contract before Cloud Build submission", async () => {
  const parsed = await buildConfigFromArchive(sha, await archiveForConfig(baselineConfig));
  const injected = injectBaselineBuildConfig(parsed, {
    sha: baselineSha,
    generation: "17",
    sha256: "c".repeat(64),
  });
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    submitted = JSON.parse(String(init?.body));
    return Response.json({ response: { id: buildId } });
  }) as typeof fetch;
  await createBuild("test", sha, "19", injected);
  expect(submitted?.rollback_baseline).toBeUndefined();
  expect((submitted?.options as Record<string, unknown>)?.logging).toBe("CLOUD_LOGGING_ONLY");
  expect(submitted?.timeout).toBe("1800s");
});

test("fetches and binds the PR base archive from the fixed Core repository", async () => {
  const candidateArchive = await archiveForConfig(baselineConfig);
  const baselineArchive = new TextEncoder().encode("base-archive");
  const posted: Record<string, unknown>[] = [];
  let buildRequest: Record<string, unknown> | undefined;
  const githubUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.github.com") {
      githubUrls.push(url.toString());
      if (url.pathname.endsWith(`/commits/${sha}/statuses`)) return Response.json([]);
      if (url.pathname.endsWith(`/tarball/${sha}`)) return new Response(candidateArchive);
      if (url.pathname.endsWith(`/tarball/${baselineSha}`)) return new Response(baselineArchive);
      if (url.pathname.endsWith(`/statuses/${sha}`)) {
        posted.push(JSON.parse(String(init?.body)));
        return Response.json({});
      }
    }
    if (url.hostname === "storage.googleapis.com" && init?.method === "POST") {
      const name = url.searchParams.get("name");
      if (name === `locks/${sha}`) {
        return Response.json({ generation: url.searchParams.get("ifGenerationMatch") === "0" ? "1" : "4" });
      }
      if (name === `sources/${sha}.tar.gz`) return Response.json({ generation: "2" });
      if (name === `baselines/${baselineSha}.tar.gz`) return Response.json({ generation: "3" });
    }
    if (url.hostname === "cloudbuild.googleapis.com") {
      buildRequest = JSON.parse(String(init?.body));
      return Response.json({ response: { id: buildId } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  await processPull("test", "test", {
    number: 1,
    head: { sha },
    base: { ref: "release-0-7-0", sha: baselineSha },
  });
  expect(githubUrls).toContain(`https://api.github.com/repos/tastile/tastile-core/tarball/${baselineSha}`);
  expect(githubUrls.some((url) => url.includes("/repos/attacker/"))).toBe(false);
  expect(posted.map((status) => status.state)).toEqual(["pending", "pending"]);
  expect(buildRequest?.rollback_baseline).toBeUndefined();
  const steps = buildRequest?.steps as Array<Record<string, unknown>>;
  expect(steps[0]?.id).toBe("rollback-baseline-download");
  expect(steps[1]?.id).toBe("rust-quality");
});

test("rejects an oversized streamed GitHub archive before source upload", async () => {
  const posted: Record<string, unknown>[] = [];
  let sourceUploadCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(`/commits/${sha}/statuses`)) return Response.json([]);
    if (url.hostname === "storage.googleapis.com" && init?.method === "POST") {
      if (url.searchParams.get("name") === `locks/${sha}`) return Response.json({ generation: "1" });
      sourceUploadCount += 1;
      return Response.json({ generation: "2" });
    }
    if (url.pathname.endsWith(`/statuses/${sha}`)) {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    if (url.pathname.endsWith(`/tarball/${sha}`)) {
      return new Response(new TextEncoder().encode("small"), {
        headers: { "content-length": String(32 * 1024 * 1024 + 1) },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  await processPull("test", "test", pr);
  expect(posted.map((status) => status.state)).toEqual(["pending", "error"]);
  expect(sourceUploadCount).toBe(0);
});

test("recovers an immutable source object after a create conflict", async () => {
  const archive = new TextEncoder().encode("source-archive");
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.toString()}`);
    if (init?.method === "POST") return new Response("", { status: 412 });
    if (url.searchParams.get("alt") === "media") return new Response(archive);
    return Response.json({ generation: "23" });
  }) as typeof fetch;
  await expect(uploadSource("test", sha, archive)).resolves.toBe("23");
  expect(requests[0]).toContain("ifGenerationMatch=0");
});

test("fails closed when a source create conflict has different bytes", async () => {
  const archive = new TextEncoder().encode("source-archive");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return new Response("", { status: 412 });
    if (url.searchParams.get("alt") === "media") return new Response(new TextEncoder().encode("tampered"));
    return Response.json({ generation: "24" });
  }) as typeof fetch;
  await expect(uploadSource("test", sha, archive)).rejects.toThrow("digest mismatch");
});

test("fails closed when an existing source object has no generation", async () => {
  const archive = new TextEncoder().encode("source-archive");
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return new Response("", { status: 412 });
    return Response.json({});
  }) as typeof fetch;
  await expect(uploadSource("test", sha, archive)).rejects.toThrow("no generation");
});

test("bounds a streamed source object recovered after a create conflict", async () => {
  const archive = new TextEncoder().encode("source-archive");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return new Response("", { status: 412 });
    if (url.searchParams.get("alt") === "media") {
      return new Response(new TextEncoder().encode("small"), {
        headers: { "content-length": String(32 * 1024 * 1024 + 1) },
      });
    }
    return Response.json({ generation: "25" });
  }) as typeof fetch;
  await expect(uploadSource("test", sha, archive)).rejects.toThrow("response size limit");
});

test("rejects an oversized archive before creating a source object", async () => {
  await expect(uploadSource("test", sha, new Uint8Array(32 * 1024 * 1024 + 1))).rejects.toThrow("32 MiB");
});

test("fails closed when a baseline create conflict contains different bytes", async () => {
  const archive = new TextEncoder().encode("baseline-archive");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return new Response("", { status: 412 });
    if (url.searchParams.get("alt") === "media") return new Response(new TextEncoder().encode("tampered"));
    return Response.json({ generation: "29" });
  }) as typeof fetch;
  await expect(uploadBaseline("test", baselineSha, archive)).rejects.toThrow("digest mismatch");
});

test("recovers an existing baseline generation when its bytes match", async () => {
  const archive = new TextEncoder().encode("baseline-archive");
  let mediaGeneration = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return new Response("", { status: 412 });
    if (url.searchParams.get("alt") === "media") {
      mediaGeneration = url.searchParams.get("generation") ?? "";
      return new Response(archive);
    }
    return Response.json({ generation: "31" });
  }) as typeof fetch;
  await expect(uploadBaseline("test", baselineSha, archive)).resolves.toEqual({
    generation: "31",
    sha256: "818d69071474c2b450fc80e34b4844105558d6361bdc8a1eed2994f20324de34",
  });
  expect(mediaGeneration).toBe("31");
});
