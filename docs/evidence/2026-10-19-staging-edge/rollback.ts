// Rollback for ctl.staging-edge-publication: delete route → DNS record → script, staging resources only.
import { appendFileSync } from 'node:fs';
import { cf, ZONE, ACCOUNT } from './g28-cf.ts';
const SCRIPT = 'tastile-edge-staging', HOST = 'staging-app.tastile.app', PATTERN = `${HOST}/*`;
const journal = (operation: string, evidence: unknown) => { const ts = new Date().toISOString(); appendFileSync(`docs/journal/staging/${ts.slice(0, 10)}.jsonl`, JSON.stringify({ id: crypto.randomUUID(), ts, agent: 'claude', issue_id: 50, execution_generation: 26, env: 'staging', target: 'cloudflare/rollback', operation, idempotency_key: 'generation26-edge-rollback-' + operation, result: 'ok', evidence: JSON.stringify(evidence) }) + '\n'); };
const routes = await cf(`/zones/${ZONE}/workers/routes`);
for (const r of routes.result.filter((x: any) => x.pattern === PATTERN && x.script === SCRIPT)) {
  const d = await cf(`/zones/${ZONE}/workers/routes/${r.id}`, { method: 'DELETE' }); journal('route-delete', { id: r.id, ok: d.success });
}
const dns = await cf(`/zones/${ZONE}/dns_records?name=${HOST}`);
for (const r of dns.result.filter((x: any) => x.type === 'AAAA' && x.content === '100::')) {
  const d = await cf(`/zones/${ZONE}/dns_records/${r.id}`, { method: 'DELETE' }); journal('dns-delete', { id: r.id, ok: d.success });
}
const s = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`, { method: 'DELETE' });
journal('script-delete', { script: SCRIPT, ok: s.success, status: s.status });
console.log(JSON.stringify({ rolled_back: true }));
