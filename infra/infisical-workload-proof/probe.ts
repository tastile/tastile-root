import { createHash } from 'node:crypto';

export const origin = 'https://secrets.rebuildup.dev';
export const projectId = '949b4193-a226-4620-8371-726a37c7195b';
export const secretPath = '/tastile/oidc-g4-proof';
export const secretName = 'OIDC_PROOF_CANARY';
export const audience = 'https://github.com/tastile';
const mintHosts = new Set([
  'vstoken.actions.githubusercontent.com',
  'run-actions-2-azure-eastus.actions.githubusercontent.com',
  'run-actions-3-azure-eastus.actions.githubusercontent.com',
]);

export interface ProofConfig { enabled: boolean; identityId: string; projectId: string; canarySha256: string }
export interface Platform { requestUrl: string; requestToken: string; sourceSha: string }
export interface Receipt {
  status: 'inactive' | 'allowed' | 'denied' | 'failed';
  expected: 'allow' | 'deny'; sourceSha: string;
  mintStatus?: number; loginStatus?: number; secretStatus?: number;
  claims?: Record<string, string | number>; expiresIn?: number; check?: string;
  mintHost?: string;
}
class ProofError extends Error {}

export async function runProbe(config: ProofConfig, platform: Platform, expected: 'allow' | 'deny', request: typeof fetch = fetch, receipt: Receipt = { status: 'failed', expected, sourceSha: platform.sourceSha }): Promise<Receipt> {
  function require(valid: unknown, check: string): asserts valid { if (!valid) { receipt.check = check; throw new ProofError(check); } }
  require(typeof config.enabled === 'boolean', 'missing-active-state');
  if (!config.enabled) return { ...receipt, status: 'inactive' };
  require(config.projectId === projectId && /^[a-f0-9-]{36}$/.test(config.identityId) && /^[a-f0-9]{64}$/.test(config.canarySha256), 'invalid-nonsecret-configuration');
  require(platform.requestToken && platform.requestUrl, 'missing-github-oidc-context');
  const mintUrl = new URL(platform.requestUrl);
  receipt.mintHost = mintUrl.hostname;
  require(mintUrl.protocol === 'https:' && mintHosts.has(mintUrl.hostname), 'unexpected-github-oidc-origin');
  mintUrl.searchParams.set('audience', audience);
  const options = { redirect: 'error' as const, signal: AbortSignal.timeout(15_000) };
  const minted = await request(mintUrl, { ...options, headers: { Authorization: `Bearer ${platform.requestToken}` } });
  receipt.mintStatus = minted.status;
  require(minted.status === 200, 'github-token-mint-failed');
  const mintBody = await minted.json() as { value?: string };
  require(typeof mintBody.value === 'string', 'github-token-response-invalid');
  const jwt = mintBody.value!;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
  receipt.claims = Object.fromEntries(['iss', 'aud', 'sub', 'repository', 'repository_id', 'repository_owner_id', 'ref', 'ref_type', 'event_name', 'workflow_ref', 'workflow_sha'].filter(k => typeof claims[k] === 'string').map(k => [k, claims[k] as string]));
  const login = await request(origin + '/api/v1/auth/oidc-auth/login', { ...options, signal: AbortSignal.timeout(15_000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityId: config.identityId, jwt }) });
  receipt.loginStatus = login.status;
  if (expected === 'deny') {
    require(login.status === 401 || login.status === 403, 'untrusted-exchange-not-rejected');
    receipt.status = 'denied';
    return receipt;
  }
  require(login.status === 200, 'trusted-exchange-failed');
  const session = await login.json() as { accessToken?: string; expiresIn?: number; accessTokenMaxTTL?: number };
  require(typeof session.accessToken === 'string' && (session.expiresIn ?? 0) > 0 && session.expiresIn! <= 300 && (session.accessTokenMaxTTL ?? 0) > 0 && session.accessTokenMaxTTL! <= 300, 'short-lived-session-invalid');
  receipt.expiresIn = session.expiresIn;
  const query = new URLSearchParams({ projectId, environment: 'dev', secretPath, viewSecretValue: 'true', expandSecretReferences: 'false', includeImports: 'false' });
  const read = await request(`${origin}/api/v4/secrets/${secretName}?${query}`, { ...options, signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${session.accessToken}` } });
  receipt.secretStatus = read.status;
  require(read.status === 200, 'scoped-canary-read-failed');
  const value = await read.json() as { secret?: { secretValue?: string } };
  require(typeof value.secret?.secretValue === 'string' && createHash('sha256').update(value.secret.secretValue).digest('hex') === config.canarySha256, 'canary-fingerprint-mismatch');
  receipt.status = 'allowed';
  return receipt;
}

if (import.meta.main) {
  const expected = process.env.PROBE_EXPECTATION;
  if (expected !== 'allow' && expected !== 'deny') throw new Error('PROBE_EXPECTATION must be allow or deny');
  const receipt: Receipt = { status: 'failed', expected, sourceSha: process.env.GITHUB_SHA ?? '' };
  try {
    const config = await Bun.file('infra/infisical-workload-proof/config.json').json() as ProofConfig;
    await runProbe(config, { requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '', requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '', sourceSha: receipt.sourceSha }, expected, fetch, receipt);
    if (!config.enabled) receipt.status = 'inactive';
  } catch (error) {
    receipt.check ??= error instanceof ProofError ? error.message : 'probe-operation-failed';
    process.exitCode = 1;
  } finally {
    await Bun.write('.tmp/infisical-oidc-proof.json', JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  }
}
