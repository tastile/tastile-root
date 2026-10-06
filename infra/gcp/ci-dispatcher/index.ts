import { createSign } from "node:crypto";
import { unlink } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { serveDispatcher } from "./server";

type GitHubPull = {
  number: number;
  head: { sha: string };
  base: { ref: string };
};

type GitHubStatus = {
  state: "error" | "failure" | "pending" | "success";
  context: string;
  target_url?: string;
  updated_at: string;
};

type Build = {
  id: string;
  status?: string;
  logUrl?: string;
  tags?: string[];
};

type BuildOperation = {
  metadata?: { build?: Build };
  response?: Build;
};

const STATUS_CONTEXT = "tastile/cloud-build-ci";
const FINAL_BUILD_STATES = new Set(["SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"]);
const SUCCESS_BUILD_STATES = new Set(["SUCCESS"]);
const ALLOWED_BUILD_STEP_FIELDS = new Set(["id", "name", "entrypoint", "args", "env", "dir"]);

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
  const body = new URLSearchParams({ identityId: config.infisicalIdentityId, jwt });
  const payload = await fetchJson<{ accessToken: string }>(
    `${config.infisicalDomain}/api/v1/auth/gcp-auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
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

async function writeLock(gcpToken: string, sha: string, generation: string, phase: "preparing" | "submitting"): Promise<string | undefined> {
  const name = `locks/${sha}`;
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", name);
  url.searchParams.set("ifGenerationMatch", generation);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gcpToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phase, updatedAt: new Date().toISOString() }),
  });
  if (response.status === 412) return undefined;
  if (!response.ok) throw new Error(`GCS lock create failed with HTTP ${response.status}`);
  const payload = await response.json() as { generation: string };
  if (!payload.generation) throw new Error("GCS lock write returned no generation");
  return payload.generation;
}

export async function claimLock(gcpToken: string, sha: string): Promise<string | undefined> {
  const created = await writeLock(gcpToken, sha, "0", "preparing");
  if (created) return created;
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o/${encodeURIComponent(`locks/${sha}`)}`;
  const headers = { Authorization: `Bearer ${gcpToken}` };
  const metadata = await fetchJson<{ generation: string }>(base, { headers }, "GCS lock metadata");
  const url = new URL(base);
  url.searchParams.set("alt", "media");
  url.searchParams.set("generation", metadata.generation);
  const lock = await fetchJson<{ phase: string; updatedAt: string }>(url.toString(), { headers }, "GCS lock read");
  // Only an abandoned preparation lease is retryable. An uncertain submission is fenced permanently.
  if (lock.phase !== "preparing" || Date.now() - Date.parse(lock.updatedAt) < 5 * 60_000) return undefined;
  return writeLock(gcpToken, sha, metadata.generation, "preparing");
}

async function downloadSource(token: string, sha: string): Promise<Uint8Array> {
  const response = await fetch(
    `https://api.github.com/repos/${config.githubRepository}/tarball/${sha}`,
    { headers: githubHeaders(token), redirect: "follow" },
  );
  if (!response.ok) throw new Error(`GitHub source archive failed with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadSource(gcpToken: string, sha: string, archive: Uint8Array): Promise<string> {
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

export async function buildConfigFromArchive(sha: string, archive: Uint8Array): Promise<Record<string, unknown>> {
  const path = `/tmp/tastile-core-${sha}.tar.gz`;
  await Bun.write(path, archive);
  try {
    const listing = Bun.spawnSync(["tar", "-tzf", path, "--wildcards", "*/cloudbuild/ci.yaml"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (listing.exitCode !== 0) throw new Error("Core source archive could not be listed");
    const manifest = listing.stdout.toString().trim().split("\n")[0];
    const root = manifest?.replace(/\/cloudbuild\/ci\.yaml$/, "");
    if (!root || !/^[a-zA-Z0-9._-]+$/.test(root)) {
      throw new Error("Core source archive has no safe top-level directory");
    }
    const proc = Bun.spawnSync(["tar", "-xOzf", path, "--wildcards", "*/cloudbuild/ci.yaml"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) throw new Error("cloudbuild/ci.yaml not found in Core source archive");
    const parsed = parseYaml(proc.stdout.toString()) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("cloudbuild/ci.yaml is not a build configuration");
    }
    if (Object.keys(parsed).some((key) => !["steps", "timeout", "options"].includes(key))) {
      throw new Error("cloudbuild/ci.yaml contains an unapproved build field");
    }
    if (parsed.timeout !== "1800s") throw new Error("cloudbuild/ci.yaml must use the approved 1800s timeout");
    const options = parsed.options;
    if (typeof options !== "object" || options === null || Array.isArray(options)
      || Object.keys(options).length !== 1 || (options as Record<string, unknown>).logging !== "CLOUD_LOGGING_ONLY") {
      throw new Error("cloudbuild/ci.yaml must use Cloud Logging only");
    }
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("cloudbuild/ci.yaml contains no build steps");
    }
    if (parsed.steps.length > 20) throw new Error("cloudbuild/ci.yaml contains too many build steps");
    const steps = parsed.steps.map((step) => {
      if (typeof step !== "object" || step === null || Array.isArray(step)) {
        throw new Error("cloudbuild/ci.yaml contains an invalid build step");
      }
      const buildStep = step as Record<string, unknown>;
      if (Object.keys(buildStep).some((key) => !ALLOWED_BUILD_STEP_FIELDS.has(key))) {
        throw new Error("cloudbuild/ci.yaml contains an unapproved build step field");
      }
      const dir = buildStep.dir;
      if (dir !== undefined && (typeof dir !== "string" || dir.startsWith("/")
        || dir.includes("\\") || dir.split("/").includes(".."))) {
        throw new Error("cloudbuild/ci.yaml contains an unsafe step directory");
      }
      return { ...buildStep, dir: dir ? `${root}/${dir}` : root };
    });
    return { steps, timeout: "1800s", options: { logging: "CLOUD_LOGGING_ONLY" } };
  } finally {
    await unlink(path).catch(() => {});
  }
}

export async function createBuild(
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
    tags: ["tastile-core-ci", sha],
  };
  const operation = await fetchJson<BuildOperation>(
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
  const build = operation.metadata?.build ?? operation.response;
  if (!build?.id) throw new Error("Cloud Build operation returned no build id");
  return build;
}

async function getBuild(gcpToken: string, id: string): Promise<Build> {
  return fetchJson<Build>(
    `https://cloudbuild.googleapis.com/v1/projects/${config.gcpProjectId}/locations/${config.gcpRegion}/builds/${id}`,
    { headers: { Authorization: `Bearer ${gcpToken}` } },
    "Cloud Build get",
  );
}

function buildConsoleUrl(id: string): string {
  const url = new URL(`https://console.cloud.google.com/cloud-build/builds;region=${config.gcpRegion}/${id}`);
  url.searchParams.set("project", config.gcpProjectId);
  return url.toString();
}

async function findBuildForSha(gcpToken: string, sha: string): Promise<Build | undefined> {
  const url = new URL(`https://cloudbuild.googleapis.com/v1/projects/${config.gcpProjectId}/locations/${config.gcpRegion}/builds`);
  url.searchParams.set("filter", `tags="tastile-core-ci" AND tags="${sha}"`);
  url.searchParams.set("pageSize", "100");
  const page = await fetchJson<{ builds?: Build[] }>(
    url.toString(),
    { headers: { Authorization: `Bearer ${gcpToken}` } },
    "Cloud Build recovery list",
  );
  const matches = page.builds?.filter((build) => build.tags?.includes("tastile-core-ci") && build.tags.includes(sha)) ?? [];
  if (matches.length > 1) throw new Error("Multiple Cloud Builds found for the same locked PR head");
  return matches[0];
}

function buildIdFromConsoleUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname !== "console.cloud.google.com" || url.searchParams.get("project") !== config.gcpProjectId) return undefined;
    const match = url.pathname.match(/^\/cloud-build\/builds;region=([^/]+)\/([a-f0-9-]{36})$/);
    if (!match || match[1] !== config.gcpRegion) return undefined;
    return match[2];
  } catch {
    return undefined;
  }
}

export async function processPull(token: string, gcpToken: string, pr: GitHubPull): Promise<void> {
  const sha = pr.head.sha;
  const existing = await latestCiStatus(token, sha);
  if (existing) {
    let id = existing.state === "pending" ? buildIdFromConsoleUrl(existing.target_url) : undefined;
    if (existing.state === "pending" && !id) {
      id = (await findBuildForSha(gcpToken, sha))?.id;
      if (id) await setCiStatus(token, sha, "pending", "Cloud Build Core CI running", buildConsoleUrl(id));
    }
    if (id) {
      const build = await getBuild(gcpToken, id);
      if (build.status && FINAL_BUILD_STATES.has(build.status)) {
        const success = SUCCESS_BUILD_STATES.has(build.status);
        await setCiStatus(token, sha, success ? "success" : "failure", `Cloud Build Core CI: ${build.status}`, buildConsoleUrl(id));
        console.log(`${success ? "PASS" : "FAIL"} PR #${pr.number} @ ${sha.slice(0, 12)} build=${id}`);
      } else {
        console.log(`pending PR #${pr.number} @ ${sha.slice(0, 12)} build=${id}`);
      }
      return;
    }
    if (existing.state !== "pending") {
      console.log(`skip PR #${pr.number} @ ${sha.slice(0, 12)}: status=${existing.state}`);
      return;
    }
  }

  const lockGeneration = await claimLock(gcpToken, sha);
  if (!lockGeneration) {
    const recovered = await findBuildForSha(gcpToken, sha);
    if (recovered || !existing) {
      await setCiStatus(token, sha, "pending", recovered ? "Cloud Build Core CI running" : "Cloud Build Core CI queued",
        recovered?.id ? buildConsoleUrl(recovered.id) : undefined);
    } else if (Date.now() - Date.parse(existing.updated_at) > 45 * 60_000) {
      await setCiStatus(token, sha, "error", "CI submission outcome unknown; push a new commit to retry");
    }
    console.log(`recovered PR #${pr.number} @ ${sha.slice(0, 12)}: lock already exists`);
    return;
  }

  await setCiStatus(token, sha, "pending", "Cloud Build Core CI queued");

  let targetUrl: string | undefined;
  let submissionStarted = false;
  try {
    const archive = await downloadSource(token, sha);
    const [generation, buildConfig] = await Promise.all([
      uploadSource(gcpToken, sha, archive),
      buildConfigFromArchive(sha, archive),
    ]);
    if (!(await writeLock(gcpToken, sha, lockGeneration, "submitting"))) {
      console.log(`skip PR #${pr.number} @ ${sha.slice(0, 12)}: preparation lease replaced`);
      return;
    }
    submissionStarted = true;
    const build = await createBuild(gcpToken, sha, generation, buildConfig);
    if (!build.id) throw new Error("Cloud Build create returned no build id");
    targetUrl = buildConsoleUrl(build.id);
    await setCiStatus(token, sha, "pending", "Cloud Build Core CI running", targetUrl);
    console.log(`submitted PR #${pr.number} @ ${sha.slice(0, 12)} build=${build.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!submissionStarted) {
      await setCiStatus(token, sha, "error", "CI dispatcher failed before submission").catch(() => {});
    }
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

if (import.meta.main) {
  const mode = required("CI_DISPATCHER_MODE");
  if (mode === "http") serveDispatcher(required("PORT"), main);
  else if (mode === "once") await main();
  else throw new Error("CI_DISPATCHER_MODE must be http or once");
}
