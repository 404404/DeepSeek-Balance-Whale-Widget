import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createDispatcher } from '../runtime/dispatcher.mjs';
import { createSubscriptionService } from '../runtime/subscription-service.mjs';
import {
  codexAuthorizeURL, cursorLoginURL, grokAuthorizeURL, grokCorsHeaders, isAllowedAuthorizeURL, makePkce,
  parseCodexUsage, parseCursorPoll, parseCursorUsage, parseGrokLoopback, parseGrokUsage,
} from '../runtime/subscription-auth.mjs';

const pkce = makePkce(() => Buffer.from('0123456789abcdef0123456789abcdef'));
const codex = codexAuthorizeURL({ ...pkce, redirectURI: 'http://localhost:1455/auth/callback' });
assert.equal(codex.hostname, 'auth.openai.com');
assert.equal(codex.searchParams.get('code_challenge_method'), 'S256');
assert.equal(codex.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
assert.equal(codex.searchParams.has('code'), false);

const grok = grokAuthorizeURL({ ...pkce, redirectURI: 'http://127.0.0.1:56121/callback' });
assert.equal(grok.hostname, 'auth.x.ai');
assert.equal(grok.searchParams.get('referrer'), 'grok-build');
const loopback = parseGrokLoopback(Buffer.from('OPTIONS /callback HTTP/1.1\r\nOrigin: https://auth.x.ai\r\nAccess-Control-Request-Private-Network: true\r\n\r\n'));
assert.equal(loopback.method, 'OPTIONS');
assert.equal(loopback.requestsPrivateNetwork, true);
const headers = grokCorsHeaders({ origin: 'https://auth.x.ai', 'access-control-request-private-network': 'true' });
assert.equal(headers['access-control-allow-private-network'], 'true');
assert.equal(headers['access-control-allow-origin'], 'https://auth.x.ai');

const cursor = cursorLoginURL({ ...pkce, uuid: '11111111-1111-4111-8111-111111111111' });
assert.equal(cursor.hostname, 'cursor.com');
assert.equal(cursor.pathname, '/loginDeepControl');
assert.equal(cursor.searchParams.get('mode'), 'login');
assert.equal(parseCursorPoll({ accessToken: 'tok', refreshToken: 'ref', authId: 'user' }).accessToken, 'tok');
assert.equal(isAllowedAuthorizeURL('http://auth.openai.com/oauth/authorize'), false);
assert.equal(isAllowedAuthorizeURL('https://evil.example/oauth/authorize'), false);

const codexWindows = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 38, resets_at: '2026-09-23T12:00:00Z' }, secondary_window: { used_percent: 19 } } });
assert.deepEqual(codexWindows.map(window => window.id), ['5h', 'week']);
assert.equal(codexWindows[0].remainPct, 62);
const grokWindows = parseGrokUsage({ creditUsagePercent: 0.22 });
assert.equal(grokWindows[0].id, 'week');
assert.equal(grokWindows[0].remainPct, 78);
const grokWrapped = parseGrokUsage({ config: { creditUsagePercent: 8, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-09-30T00:00:00Z' }, productUsage: [{ product: 'GrokBuild', usagePercent: 8 }] } });
assert.equal(grokWrapped[0].remainPct, 92);
assert.ok(grokWrapped[0].resetAt);
const grokFresh = parseGrokUsage({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-09-30T00:00:00Z' } } });
assert.equal(grokFresh[0].remainPct, 100);
const cursorWindows = parseCursorUsage({ planUsage: { autoPercentUsed: 0.29, apiPercentUsed: 62 } }, { usagePercent: 12 });
assert.deepEqual(cursorWindows.map(window => window.id), ['auto', 'api', 'bot']);
assert.equal(cursorWindows[2].label, 'Grok Bot 周额度');
assert.equal(cursorWindows[2].remainPct, 88);

const dir = await mkdtemp(path.join(os.tmpdir(), 'whale-sub-'));
try {
  const service = createSubscriptionService({ dataDir: dir, openExternal: async () => { throw new Error('should not open'); } });
  fs.writeFileSync(path.join(dir, 'subscription-credentials.json'), JSON.stringify({ codex: { accessToken: 'secret-token', email: 'a@example.com', status: 'ok', windows: codexWindows } }), { mode: 0o600 });
  const status = service.publicStatus();
  const encoded = JSON.stringify(status);
  assert.equal(encoded.includes('secret-token'), false);
  assert.equal(encoded.includes('accessToken'), false);
  assert.equal(status.accounts.find(account => account.id === 'codex').windows[0].label, 'Codex 5小时');
  assert.equal(status.accounts.find(account => account.id === 'cursor').windows.map(window => window.label).join(','), 'Cursor API 周额度,Cursor Auto 周额度,Grok Bot 周额度');
  const dispatcher = createDispatcher({ dataDir: dir, monitor: false, autoRefresh: false, openExternal: async () => {} });
  const response = await dispatcher.dispatch('/api/subscriptions');
  const payload = JSON.parse(response.body.toString('utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.accounts.length, 3);
  assert.equal(JSON.stringify(payload).includes('secret-token'), false);
  await dispatcher.close();
  service.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log('subscription auth regression passed');
