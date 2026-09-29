import { createSign } from "node:crypto";
import { unlink } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

type GitHubPull = {
  number: number;
  head: { sha: string };
  base: { ref: string };
};

type GitHubStatus = {
  state: "error" | "failure" | "pending" | "success";
  context: string;
  updated_at: string;
};

type Build = {
  id: string;
  status?: string;
  logUrl?: string;
};

const STATUS_CONTEXT = "tastile/cloud-build-ci";
const FINAL_BUILD_STATES = new Set(["SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"]);
const SUCCESS_BUILD_STATES = new Set(["SUCCESS"]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const config = {
  infisicalDomain: required("INFISICAL_DOMAIN").replace(/\/$/, ""),
  infisicalIdentityId: required("INFISICAL_MACHINE_IDENTITY_ID"),
  infisicalProjectId: required("INFISICAL_PROJECT_ID"),
  infisicalEnvironment: process.env.INFISICAL_ENVIRONMENT?.trim() || "dev",
  infisicalSecretPath: process.env.INFISICAL_SECRET_PATH?.trim() || "/tastile/ci",
  githubPrivateKeySecretName: process.env.GITHUB_PRIVATE_KEY_SECRET_NAME?.trim() || "GITHUB_CI_APP_PRIVATE_KEY",
  githubAppId: required("GITHUB_APP_ID"),
  githubInstallationId: required("GITHUB_INSTALLATION_ID"),
  githubRepository: process.env.GITHUB_REPOSITORY?.trim() || "tastile/tastile-core",
  gcpProjectId: required("GCP_PROJECT_ID"),
  gcpRegion: process.env.GCP_REGION?.trim() || "asia-northeast1",
  sourceBucket: required("CI_SOURCE_BUCKET"),
  buildServiceAccount: required("CLOUD_BUILD_SERVICE_ACCOUNT"),
};

function base64url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function fetchText(url: string, init?: RequestInit, label = "request"): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return await response.text();
}

async function fetchJson<T>(url: string, init?: RequestInit, label = "request"): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return await response.json() as T;
}

async function metadataIdentityToken(audience: string): Promise<string> {
  const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  url.searchParams.set("audience", audience);
  url.searchParams.set("format", "full");
  return fetchText(url.toString(), { headers: { "Metadata-Flavor": "Google" } }, "GCP identity token");
}

async function metadataAccessToken(): Promise<string> {
  const payload = await fetchJson<{ access_token: string }>(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
    "GCP access token",
  );
  if (!payload.access_token) throw new Error("GCP metadata returned no access token");
  return payload.access_token;
}

async function infisicalAccessToken(): Promise<string> {
  const jwt = await metadataIdentityToken(config.infisicalIdentityId);
  const payload = await fetchJson<{ accessToken: string }>(
    `${config.infisicalDomain}/api/v1/auth/gcp-auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityId: config.infisicalIdentityId, jwt }),
    },
    "Infisical GCP auth",
  );
  if (!payload.accessToken) throw new Error("Infisical GCP auth returned no access token");
  return payload.accessToken;
}

async function readInfisicalSecret(accessToken: string, secretName: string): Promise<string> {
  const url = new URL(`${config.infisicalDomain}/api/v4/secrets/${encodeURIComponent(secretName)}`);
  url.searchParams.set("projectId", config.infisicalProjectId);
  url.searchParams.set("environment", config.infisicalEnvironment);
  url.searchParams.set("secretPath", config.infisicalSecretPath);
  url.searchParams.set("viewSecretValue", "true");
  url.searchParams.set("expandSecretReferences", "false");
  url.searchParams.set("includeImports", "false");
  const payload = await fetchJson<{ secret: { secretValue: string } }>(
    url.toString(),
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Infisical secret read",
  );
  if (!payload.secret?.secretValue) throw new Error(`Infisical secret ${secretName} is empty`);
  return payload.secret.secretValue;
}

function githubAppJwt(privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.githubAppId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const normalizedKey = privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
  const signature = signer.sign(normalizedKey);
  return `${unsigned}.${base64url(signature)}`;
}

async function githubInstallationToken(privateKey: string): Promise<string> {
  const appJwt = githubAppJwt(privateKey);
  const payload = await fetchJson<{ token: string }>(
    `https://api.github.com/app/installations/${encodeURIComponent(config.githubInstallationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
    "GitHub App installation token",
  );
  if (!payload.token) throw new Error("GitHub returned no installation token");
  return payload.token;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tastile-ci-dispatcher",
  };
}

async function openReleasePulls(token: string): Promise<GitHubPull[]> {
  const pulls = await fetchJson<GitHubPull[]>(
    `https://api.github.com/repos/${config.githubRepository}/pulls?state=open&per_page=100`,
    { headers: githubHeaders(token) },
    "GitHub pull list",
  );
  return pulls.filter((pr) => pr.base.ref.startsWith("release-"));
}

async function latestCiStatus(token: string, sha: string): Promise<GitHubStatus | undefined> {
  const statuses = await fetchJson<GitHubStatus[]>(
    `https://api.github.com/repos/${config.githubRepository}/commits/${sha}/statuses?per_page=100`,
    { headers: githubHeaders(token) },
    "GitHub status list",
  );
  return statuses.find((status) => status.context === STATUS_CONTEXT);
}

async function setCiStatus(
  token: string,
  sha: string,
  state: GitHubStatus["state"],
  description: string,
  targetUrl?: string,
): Promise<void> {
  await fetchJson(
    `https://api.github.com/repos/${config.githubRepository}/statuses/${sha}`,
    {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        context: STATUS_CONTEXT,
        description: description.slice(0, 140),
        ...(targetUrl ? { target_url: targetUrl } : {}),
      }),
    },
    "GitHub status update",
  );
}

async function createLock(gcpToken: string, sha: string): Promise<boolean> {
  const name = `locks/${sha}`;
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", name);
  url.searchParams.set("ifGenerationMatch", "0");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gcpToken}`,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: new Date().toISOString(),
  });
  if (response.status === 412) return false;
  if (!response.ok) throw new Error(`GCS lock create failed with HTTP ${response.status}`);
  return true;
}

async function downloadSource(token: string, sha: string): Promise<Uint8Array> {
  const response = await fetch(
    `https://api.github.com/repos/${config.githubRepository}/tarball/${sha}`,
    { headers: githubHeaders(token), redirect: "follow" },
  );
  if (!response.ok) throw new Error(`GitHub source archive failed with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function uploadSource(gcpToken: string, sha: string, archive: Uint8Array): Promise<string> {
  const objectName = `sources/${sha}.tar.gz`;
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", objectName);
  const payload = await fetchJson<{ generation: string }>(
    url.toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gcpToken}`,
        "Content-Type": "application/gzip",
      },
      body: archive,
    },
    "GCS source upload",
  );
  if (!payload.generation) throw new Error("GCS source upload returned no generation");
  return payload.generation;
}

async function buildConfigFromArchive(sha: string, archive: Uint8Array): Promise<Record<string, unknown>> {
  const path = `/tmp/tastile-core-${sha}.tar.gz`;
  await Bun.write(path, archive);
  try {
    const proc = Bun.spawnSync(["tar", "-xOzf", path, "--wildcards", "*/cloudbuild/ci.yaml"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) throw new Error("cloudbuild/ci.yaml not found in Core source archive");
    const parsed = parseYaml(proc.stdout.toString()) as Record<string, unknown>;
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("cloudbuild/ci.yaml contains no build steps");
    }
    return parsed;
  } finally {
    await unlink(path).catch(() => {});
  }
}

async function createBuild(
  gcpToken: string,
  sha: string,
  generation: string,
  buildConfig: Record<string, unknown>,
): Promise<Build> {
  const body = {
    ...buildConfig,
    source: {
      storageSource: {
        bucket: config.sourceBucket,
        object: `sources/${sha}.tar.gz`,
        generation,
      },
    },
    serviceAccount: config.buildServiceAccount,
    tags: ["tastile-core-ci", sha.slice(0, 12)],
  };
  return fetchJson<Build>(
    `https://cloudbuild.googleapis.com/v1/projects/${config.gcpProjectId}/locations/${config.gcpRegion}/builds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gcpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Cloud Build create",
  );
}

async function waitForBuild(gcpToken: string, id: string): Promise<Build> {
  for (;;) {
    const build = await fetchJson<Build>(
      `https://cloudbuild.googleapis.com/v1/projects/${config.gcpProjectId}/locations/${config.gcpRegion}/builds/${id}`,
      { headers: { Authorization: `Bearer ${gcpToken}` } },
      "Cloud Build get",
    );
    if (build.status && FINAL_BUILD_STATES.has(build.status)) return build;
    await Bun.sleep(10_000);
  }
}

function buildConsoleUrl(id: string): string {
  const url = new URL(`https://console.cloud.google.com/cloud-build/builds;region=${config.gcpRegion}/${id}`);
  url.searchParams.set("project", config.gcpProjectId);
  return url.toString();
}

async function processPull(token: string, gcpToken: string, pr: GitHubPull): Promise<void> {
  const sha = pr.head.sha;
  const existing = await latestCiStatus(token, sha);
  if (existing) {
    console.log(`skip PR #${pr.number} @ ${sha.slice(0, 12)}: status=${existing.state}`);
    return;
  }

  if (!(await createLock(gcpToken, sha))) {
    console.log(`skip PR #${pr.number} @ ${sha.slice(0, 12)}: lock already exists`);
    return;
  }

  await setCiStatus(token, sha, "pending", "Cloud Build Core CI queued");

  let targetUrl: string | undefined;
  try {
    const archive = await downloadSource(token, sha);
    const [generation, buildConfig] = await Promise.all([
      uploadSource(gcpToken, sha, archive),
      buildConfigFromArchive(sha, archive),
    ]);
    const build = await createBuild(gcpToken, sha, generation, buildConfig);
    if (!build.id) throw new Error("Cloud Build create returned no build id");
    targetUrl = buildConsoleUrl(build.id);
    await setCiStatus(token, sha, "pending", "Cloud Build Core CI running", targetUrl);

    const finished = await waitForBuild(gcpToken, build.id);
    if (finished.status && SUCCESS_BUILD_STATES.has(finished.status)) {
      await setCiStatus(token, sha, "success", "Cloud Build Core CI passed", targetUrl);
      console.log(`PASS PR #${pr.number} @ ${sha.slice(0, 12)} build=${build.id}`);
    } else {
      await setCiStatus(token, sha, "failure", `Cloud Build Core CI: ${finished.status ?? "unknown failure"}`, targetUrl);
      console.error(`FAIL PR #${pr.number} @ ${sha.slice(0, 12)} build=${build.id} status=${finished.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setCiStatus(token, sha, "error", "CI dispatcher failed before completion", targetUrl).catch(() => {});
    console.error(`ERROR PR #${pr.number} @ ${sha.slice(0, 12)}: ${message}`);
  }
}

async function main(): Promise<void> {
  const infisicalToken = await infisicalAccessToken();
  const githubPrivateKey = await readInfisicalSecret(infisicalToken, config.githubPrivateKeySecretName);
  const githubToken = await githubInstallationToken(githubPrivateKey);
  const gcpToken = await metadataAccessToken();

  const pulls = await openReleasePulls(githubToken);
  console.log(`eligible open Core PRs: ${pulls.length}`);
  for (const pr of pulls) await processPull(githubToken, gcpToken, pr);
}

await main();
