import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { audience, origin, projectId, runProbe, type ProofConfig } from './probe';

const secret = 'memory-only-unit-canary';
const jwt = `header.${Buffer.from(JSON.stringify({ aud: audience, sub: 'repo:tastile/tastile-root:pull_request', ref: 'refs/pull/86/merge' })).toString('base64url')}.signature`;
const config: ProofConfig = { enabled: true, identityId: '11111111-1111-1111-1111-111111111111', projectId, canarySha256: createHash('sha256').update(secret).digest('hex') };
const platform = { requestUrl: 'https://vstoken.actions.githubusercontent.com/token', requestToken: 'memory-only-request-token', sourceSha: 'a'.repeat(40) };

function mock(status = 200, readValue = secret) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = (async (url: URL | string, options?: RequestInit) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return Response.json({ value: jwt });
    if (calls.length === 2) return Response.json({ accessToken: 'memory-only-session', expiresIn: 300, accessTokenMaxTTL: 300 }, { status });
    return Response.json({ secret: { secretValue: readValue } });
  }) as typeof fetch;
  return { request, calls };
}

test('reads exactly one scoped canary without persisting credential values', async () => {
  const { request, calls } = mock();
  const receipt = await runProbe(config, platform, 'allow', request);
  expect(receipt.status).toBe('allowed');
  expect(calls).toHaveLength(3);
  expect(calls[1].url).toBe(origin + '/api/v1/auth/oidc-auth/login');
  expect(new URL(calls[2].url).searchParams.get('secretPath')).toBe('/tastile/oidc-g4-proof');
  expect(calls.every(c => c.options?.redirect === 'error')).toBe(true);
  for (const value of [jwt, secret, platform.requestToken, 'memory-only-session']) expect(JSON.stringify(receipt)).not.toContain(value);
});
test('rejects a real token at exchange and never requests a secret', async () => {
  const { request, calls } = mock(403);
  expect((await runProbe(config, platform, 'deny', request)).status).toBe('denied');
  expect(calls).toHaveLength(2);
});
test('unexpected login success or server failure cannot count as denial', async () => {
  for (const status of [200, 500]) {
    const { request, calls } = mock(status);
    await expect(runProbe(config, platform, 'deny', request)).rejects.toThrow('untrusted-exchange-not-rejected');
    expect(calls).toHaveLength(2);
  }
});
test('missing GitHub token permission cannot count as Infisical denial', async () => {
  const request = (async () => new Response('masked', { status: 403 })) as typeof fetch;
  await expect(runProbe(config, platform, 'deny', request)).rejects.toThrow('github-token-mint-failed');
});
test('rejects a different project and a mismatched canary fingerprint', async () => {
  await expect(runProbe({ ...config, projectId: 'foreign' }, platform, 'allow', mock().request)).rejects.toThrow('invalid-nonsecret-configuration');
  await expect(runProbe(config, platform, 'allow', mock(200, 'different').request)).rejects.toThrow('canary-fingerprint-mismatch');
});
test('inactive probe is explicit and makes no network requests', async () => {
  const { request, calls } = mock();
  expect((await runProbe({ ...config, enabled: false }, platform, 'allow', request)).status).toBe('inactive');
  expect(calls).toHaveLength(0);
});
test('an unlisted mint host is rejected before sending the request bearer', async () => {
  const { request, calls } = mock();
  await expect(runProbe(config, { ...platform, requestUrl: 'https://unlisted.actions.githubusercontent.com/token' }, 'allow', request)).rejects.toThrow('unexpected-github-oidc-origin');
  expect(calls).toHaveLength(0);
});
test('observed GitHub mint hosts keep redirect and receipt safeguards', async () => {
  for (const host of ['run-actions-2-azure-eastus.actions.githubusercontent.com', 'run-actions-3-azure-eastus.actions.githubusercontent.com']) {
    const { request } = mock(403);
    const receipt = await runProbe(config, { ...platform, requestUrl: `https://${host}/token` }, 'deny', request);
    expect(receipt.status).toBe('denied');
    expect(receipt.mintHost).toBe(host);
    expect(JSON.stringify(receipt)).not.toContain(platform.requestToken);
  }
});
