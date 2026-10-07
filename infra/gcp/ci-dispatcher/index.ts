import { execFile } from "node:child_process";
import { createHash, createSign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { serveDispatcher } from "./server";

const execFileAsync = promisify(execFile);

type GitHubPull = {
  number: number;
  head: { sha: string };
  base: { ref: string; sha?: string };
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

type BuildStep = Record<string, unknown> & {
  id?: string;
  args?: unknown;
  env?: unknown;
};

type BuildConfig = Record<string, unknown> & {
  steps: BuildStep[];
  timeout: "1800s";
  options: { logging: "CLOUD_LOGGING_ONLY" };
  rollback_baseline?: "pull-base";
};

type ImmutableArchive = {
  generation: string;
  sha256: string;
};

const STATUS_CONTEXT = "tastile/cloud-build-ci";
const FINAL_BUILD_STATES = new Set(["SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"]);
const SUCCESS_BUILD_STATES = new Set(["SUCCESS"]);
const ALLOWED_BUILD_STEP_FIELDS = new Set(["id", "name", "entrypoint", "args", "env", "dir"]);
const ALLOWED_BUILD_CONFIG_FIELDS = new Set(["steps", "timeout", "options", "rollback_baseline"]);
const BASELINE_DOWNLOAD_STEP_ID = "rollback-baseline-download";
const BASELINE_ENV_NAMES = ["BASE_SHA", "BASE_ARCHIVE_PATH", "BASE_ARCHIVE_SHA256"] as const;
const BASELINE_ARCHIVE_PATH = ".tmp/rollback-baseline.tar.gz";
const CANONICAL_GITHUB_REPOSITORY = "tastile/tastile-core";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_TAR_LISTING_BYTES = 2 * 1024 * 1024;
const MAX_TAR_ENTRIES = 20_000;
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateSha(value: string | undefined, label: string): asserts value is string {
  if (!value || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`);
  }
}

function sha256(archive: Uint8Array): string {
  return createHash("sha256").update(archive).digest("hex");
}

function canonicalGithubRepository(): string {
  const configured = process.env.GITHUB_REPOSITORY;
  if (configured !== undefined && configured !== CANONICAL_GITHUB_REPOSITORY) {
    throw new Error(`GITHUB_REPOSITORY must be ${CANONICAL_GITHUB_REPOSITORY}`);
  }
  return CANONICAL_GITHUB_REPOSITORY;
}

function archiveSizeGuard(archive: Uint8Array, label: string): void {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`${label} exceeds 32 MiB trusted archive limit`);
  }
}

async function readResponseBytes(response: Response, maxBytes: number, label: string): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new Error(`${label} exceeds its response size limit`);
    }
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds its response size limit`);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} exceeds its response size limit`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function requestBytes(
  url: string | URL,
  init: RequestInit | undefined,
  maxBytes: number,
  label: string,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...(init ?? {}), signal: controller.signal });
    const bytes = await readResponseBytes(response, maxBytes, label);
    return { response, bytes };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBytes(
  url: string | URL,
  init: RequestInit | undefined,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const { response, bytes } = await requestBytes(url, init, maxBytes, label);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return bytes;
}

async function execTar(args: string[], maxBuffer: number, label: string, sizeDescription: string): Promise<Buffer> {
  try {
    const result = await execFileAsync("tar", args, {
      encoding: "buffer",
      maxBuffer,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return Buffer.from(result.stdout);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (/maxbuffer|stdout maxbuffer|stderr maxbuffer/i.test(details)) {
      throw new Error(`${label} exceeded ${sizeDescription}`);
    }
    if (/ETIMEDOUT|timed out/i.test(details)) {
      throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(label);
  }
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
  githubRepository: canonicalGithubRepository(),
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
  const bytes = await fetchBytes(url, init, MAX_HTTP_RESPONSE_BYTES, label);
  return new TextDecoder().decode(bytes);
}

async function fetchJson<T>(url: string, init?: RequestInit, label = "request"): Promise<T> {
  const text = await fetchText(url, init, label);
  return JSON.parse(text) as T;
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
  const { response, bytes } = await requestBytes(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gcpToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phase, updatedAt: new Date().toISOString() }),
  }, MAX_HTTP_RESPONSE_BYTES, "GCS lock write");
  if (response.status === 412) return undefined;
  if (!response.ok) throw new Error(`GCS lock create failed with HTTP ${response.status}`);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as { generation: string };
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
  validateSha(sha, "GitHub archive SHA");
  return await fetchBytes(
    `https://api.github.com/repos/${config.githubRepository}/tarball/${sha}`,
    { headers: githubHeaders(token), redirect: "follow" },
    MAX_ARCHIVE_BYTES,
    "GitHub source archive",
  );
}

async function readImmutableArchive(gcpToken: string, objectName: string): Promise<{ generation: string; archive: Uint8Array }> {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o/${encodeURIComponent(objectName)}`;
  const headers = { Authorization: `Bearer ${gcpToken}` };
  const metadata = await fetchJson<{ generation?: string | number }>(base, { headers }, "GCS archive metadata");
  if (metadata.generation === undefined || metadata.generation === "") {
    throw new Error("GCS archive metadata returned no generation");
  }
  const url = new URL(base);
  url.searchParams.set("alt", "media");
  url.searchParams.set("generation", String(metadata.generation));
  const archive = await fetchBytes(url, { headers }, MAX_ARCHIVE_BYTES, "GCS archive read");
  return { generation: String(metadata.generation), archive };
}

async function uploadImmutableArchive(
  gcpToken: string,
  objectName: string,
  archive: Uint8Array,
  label: string,
): Promise<ImmutableArchive> {
  archiveSizeGuard(archive, label);
  const downloadedSha256 = sha256(archive);
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.sourceBucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", objectName);
  url.searchParams.set("ifGenerationMatch", "0");
  const { response, bytes } = await requestBytes(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gcpToken}`,
      "Content-Type": "application/gzip",
    },
    body: archive,
  }, MAX_HTTP_RESPONSE_BYTES, `${label} upload`);
  if (response.status === 412) {
    const stored = await readImmutableArchive(gcpToken, objectName);
    if (sha256(stored.archive) !== downloadedSha256) {
      throw new Error(`${label} immutable object digest mismatch`);
    }
    return { generation: stored.generation, sha256: downloadedSha256 };
  }
  if (!response.ok) throw new Error(`${label} upload failed with HTTP ${response.status}`);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as { generation?: string | number };
  if (payload.generation === undefined || payload.generation === "") {
    throw new Error(`${label} upload returned no generation`);
  }
  return { generation: String(payload.generation), sha256: downloadedSha256 };
}

export async function uploadSource(gcpToken: string, sha: string, archive: Uint8Array): Promise<string> {
  validateSha(sha, "Source archive SHA");
  const stored = await uploadImmutableArchive(gcpToken, `sources/${sha}.tar.gz`, archive, "GCS source");
  return stored.generation;
}

export async function uploadBaseline(gcpToken: string, sha: string, archive: Uint8Array): Promise<ImmutableArchive> {
  validateSha(sha, "Baseline archive SHA");
  return uploadImmutableArchive(gcpToken, `baselines/${sha}.tar.gz`, archive, "GCS baseline");
}

export function archiveManifest(listing: string): { root: string; path: string } {
  if (Buffer.byteLength(listing, "utf8") > MAX_TAR_LISTING_BYTES) {
    throw new Error("Core source archive tar listing exceeds 2 MiB");
  }
  const entries = listing.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("Core source archive is empty");
  if (entries.length > MAX_TAR_ENTRIES) {
    throw new Error("Core source archive tar listing exceeds 20,000 entries");
  }
  const roots = new Set<string>();
  const manifests: string[] = [];
  for (const entry of entries) {
    const path = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    if (!path || path.startsWith("/") || path.includes("\\")) {
      throw new Error("Core source archive contains an unsafe path");
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("Core source archive contains an unsafe path");
    }
    const root = parts[0];
    if (!/^[a-zA-Z0-9._-]+$/.test(root)) {
      throw new Error("Core source archive has no safe top-level directory");
    }
    roots.add(root);
    if (path === `${root}/cloudbuild/ci.yaml`) manifests.push(path);
  }
  if (roots.size !== 1) throw new Error("Core source archive must have one top-level directory");
  if (manifests.length !== 1) throw new Error("cloudbuild/ci.yaml not found in Core source archive");
  const root = [...roots][0]!;
  return { root, path: manifests[0]! };
}

export async function buildConfigFromArchive(sha: string, archive: Uint8Array): Promise<BuildConfig> {
  validateSha(sha, "Source archive SHA");
  archiveSizeGuard(archive, "Core source archive");
  const workDir = await mkdtemp(join(tmpdir(), "tastile-core-"));
  const path = join(workDir, "source.tar.gz");
  try {
    await Bun.write(path, archive);
    const listing = await execTar(["-tzf", path], MAX_TAR_LISTING_BYTES, "Core source archive could not be listed", "2 MiB");
    const { root, path: manifestPath } = archiveManifest(listing.toString());
    const configBytes = await execTar(
      ["-xOzf", path, manifestPath],
      MAX_CONFIG_BYTES,
      "cloudbuild/ci.yaml could not be extracted",
      "128 KiB",
    );
    if (configBytes.byteLength > MAX_CONFIG_BYTES) {
      throw new Error("cloudbuild/ci.yaml exceeds 128 KiB");
    }
    const parsed = parseYaml(configBytes.toString("utf8")) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("cloudbuild/ci.yaml is not a build configuration");
    }
    if (Object.keys(parsed).some((key) => !ALLOWED_BUILD_CONFIG_FIELDS.has(key))) {
      throw new Error("cloudbuild/ci.yaml contains an unapproved build field");
    }
    if (parsed.rollback_baseline !== undefined && parsed.rollback_baseline !== "pull-base") {
      throw new Error("cloudbuild/ci.yaml contains an unknown rollback_baseline contract");
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
      return { ...buildStep, dir: dir ? `${root}/${dir}` : root } as BuildStep;
    });
    return {
      steps,
      timeout: "1800s",
      options: { logging: "CLOUD_LOGGING_ONLY" },
      ...(parsed.rollback_baseline !== undefined ? { rollback_baseline: "pull-base" as const } : {}),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function envName(entry: unknown): string | undefined {
  if (typeof entry !== "string") return undefined;
  const separator = entry.indexOf("=");
  return separator > 0 ? entry.slice(0, separator) : undefined;
}

function baselineStep(sha: string, digest: string, generation: string, root: string): BuildStep {
  const substitutionSafeEnv = (name: string) => `$$` + `{${name}}`;
  return {
    id: BASELINE_DOWNLOAD_STEP_ID,
    name: "gcr.io/google.com/cloudsdktool/google-cloud-cli:slim",
    entrypoint: "bash",
    dir: root,
    env: [
      `BASE_SHA=${sha}`,
      `BASE_ARCHIVE_PATH=${BASELINE_ARCHIVE_PATH}`,
      `BASE_ARCHIVE_SHA256=${digest}`,
    ],
    args: [
      "-ceu",
      [
        `mkdir -p "$(dirname "${substitutionSafeEnv("BASE_ARCHIVE_PATH")}")"`,
        `gcloud storage cp --quiet "gs://${config.sourceBucket}/baselines/${sha}.tar.gz#${generation}" "${substitutionSafeEnv("BASE_ARCHIVE_PATH")}"`,
        `printf '%s  %s\\n' "${substitutionSafeEnv("BASE_ARCHIVE_SHA256")}" "${substitutionSafeEnv("BASE_ARCHIVE_PATH")}" | sha256sum -c -`,
      ].join("\n"),
    ],
  };
}

export function injectBaselineBuildConfig(
  buildConfig: BuildConfig,
  baseline: { sha: string; generation: string; sha256: string },
): BuildConfig {
  validateSha(baseline.sha, "Baseline archive SHA");
  if (!/^\d+$/.test(baseline.generation)) {
    throw new Error("Baseline archive generation must be a decimal object generation");
  }
  if (!/^[a-f0-9]{64}$/.test(baseline.sha256)) {
    throw new Error("Baseline archive SHA256 must be a lowercase hexadecimal digest");
  }
  if (buildConfig.rollback_baseline !== "pull-base") {
    throw new Error("cloudbuild/ci.yaml does not declare rollback_baseline: pull-base");
  }
  const steps = buildConfig.steps;
  if (steps.some((step) => step.id === BASELINE_DOWNLOAD_STEP_ID)) {
    throw new Error(`cloudbuild/ci.yaml reserves the ${BASELINE_DOWNLOAD_STEP_ID} step id`);
  }
  const rustQuality = steps.filter((step) => step.id === "rust-quality");
  if (rustQuality.length !== 1) {
    throw new Error("cloudbuild/ci.yaml must contain exactly one rust-quality step for rollback baseline");
  }
  for (const step of steps) {
    const stepEnv = step.env === undefined ? [] : step.env;
    if (!Array.isArray(stepEnv)) throw new Error("build step env must be an array");
    for (const entry of stepEnv) {
      const name = envName(entry);
      if (!name) throw new Error("build step env must contain KEY=VALUE entries");
      if ((BASELINE_ENV_NAMES as readonly string[]).includes(name)) {
        throw new Error(`build step env reserves ${name}`);
      }
    }
  }
  const rustStep = rustQuality[0]!;
  const root = typeof rustStep.dir === "string" ? rustStep.dir : "";
  if (!root || root.startsWith("/") || root.includes("\\") || root.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("rust-quality step has no safe source directory");
  }
  if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(root)) {
    throw new Error("rust-quality step has no safe source directory");
  }
  const rustEnv = rustStep.env === undefined ? [] : rustStep.env as unknown[];
  const env = [
    ...rustEnv,
    `BASE_SHA=${baseline.sha}`,
    `BASE_ARCHIVE_PATH=${BASELINE_ARCHIVE_PATH}`,
    `BASE_ARCHIVE_SHA256=${baseline.sha256}`,
  ];
  const nextSteps = steps.map((step) => step.id === "rust-quality" ? { ...step, env } : step);
  return {
    ...buildConfig,
    steps: [baselineStep(baseline.sha, baseline.sha256, baseline.generation, root), ...nextSteps],
  };
}

export async function createBuild(
  gcpToken: string,
  sha: string,
  generation: string,
  buildConfig: BuildConfig,
): Promise<Build> {
  const { rollback_baseline: _rollbackBaseline, ...cloudBuildConfig } = buildConfig;
  const body = {
    ...cloudBuildConfig,
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
  validateSha(sha, "PR head SHA");
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
    const buildConfig = await buildConfigFromArchive(sha, archive);
    if (buildConfig.rollback_baseline === "pull-base") validateSha(pr.base.sha, "PR base SHA");
    const generation = await uploadSource(gcpToken, sha, archive);
    let submittedConfig = buildConfig;
    if (buildConfig.rollback_baseline === "pull-base") {
      const baselineArchive = await downloadSource(token, pr.base.sha);
      const baseline = await uploadBaseline(gcpToken, pr.base.sha, baselineArchive);
      submittedConfig = injectBaselineBuildConfig(buildConfig, {
        sha: pr.base.sha,
        generation: baseline.generation,
        sha256: baseline.sha256,
      });
    }
    if (!(await writeLock(gcpToken, sha, lockGeneration, "submitting"))) {
      console.log(`skip PR #${pr.number} @ ${sha.slice(0, 12)}: preparation lease replaced`);
      return;
    }
    submissionStarted = true;
    const build = await createBuild(gcpToken, sha, generation, submittedConfig);
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
