import crypto from 'node:crypto';

export const SUBSCRIPTION_WINDOWS = [
  { provider: 'codex', windowId: '5h', label: 'Codex 5小时' },
  { provider: 'codex', windowId: 'week', label: 'Codex 周额度' },
  { provider: 'grok', windowId: 'week', label: 'Grok 周额度' },
  { provider: 'cursor', windowId: 'api', label: 'Cursor API 周额度' },
  { provider: 'cursor', windowId: 'auto', label: 'Cursor Auto 周额度' },
  { provider: 'cursor', windowId: 'bot', label: 'Grok Bot 周额度' },
];

export const SUBSCRIPTION_PROVIDERS = {
  codex: {
    id: 'codex',
    label: 'Codex',
    issuer: 'https://auth.openai.com',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    ports: [1455, 1457],
    callbackPath: '/auth/callback',
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    issuer: 'https://auth.x.ai',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scope: 'openid profile email offline_access grok-cli:access api:access',
    ports: [56121],
    callbackPath: '/callback',
    host: '127.0.0.1',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    loginURL: 'https://cursor.com/loginDeepControl',
    pollURL: 'https://api2.cursor.sh/auth/poll',
  },
};

const GROK_ORIGINS = new Set(['https://auth.x.ai', 'https://accounts.x.ai', 'https://accounts.x.com']);

export function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function makePkce(random = () => crypto.randomBytes(32)) {
  const verifier = base64url(random());
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(random());
  return { verifier, challenge, state };
}

export function codexAuthorizeURL(request) {
  const provider = SUBSCRIPTION_PROVIDERS.codex;
  const url = new URL(provider.issuer + '/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', request.redirectURI);
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', request.state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'codex_cli_rs');
  return url;
}

export function grokAuthorizeURL(request) {
  const provider = SUBSCRIPTION_PROVIDERS.grok;
  const url = new URL(provider.issuer + '/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', request.redirectURI);
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', request.state);
  url.searchParams.set('referrer', 'grok-build');
  return url;
}

export function cursorLoginURL(request) {
  const url = new URL(SUBSCRIPTION_PROVIDERS.cursor.loginURL);
  url.searchParams.set('challenge', request.challenge);
  url.searchParams.set('uuid', request.uuid);
  url.searchParams.set('mode', 'login');
  url.searchParams.set('redirectTarget', 'cli');
  return url;
}

export function cursorPollURL(request) {
  const url = new URL(SUBSCRIPTION_PROVIDERS.cursor.pollURL);
  url.searchParams.set('uuid', request.uuid);
  url.searchParams.set('verifier', request.verifier);
  return url;
}

export function codexRedirectURI(port) {
  return `http://localhost:${port}${SUBSCRIPTION_PROVIDERS.codex.callbackPath}`;
}

export function grokRedirectURI(port = 56121) {
  return `http://127.0.0.1:${port}${SUBSCRIPTION_PROVIDERS.grok.callbackPath}`;
}

export function isAllowedAuthorizeURL(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  return ['auth.openai.com', 'auth.x.ai', 'cursor.com'].includes(url.hostname);
}

export function callbackFromQuery(params, expectedState) {
  const values = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : { ...params };
  if (values.error) return { ok: false, error: values.error_description || ('授权被拒绝：' + values.error) };
  if (!expectedState || values.state !== expectedState) return { ok: false, error: '授权 state 校验失败' };
  if (!values.code) return { ok: false, error: '授权回调缺少 code' };
  return { ok: true, code: values.code, state: values.state };
}

export function grokCorsHeaders(headers = {}) {
  const origin = headers.origin || headers.Origin || '';
  const requested = String(headers['access-control-request-private-network'] || headers['Access-Control-Request-Private-Network'] || '').toLowerCase() === 'true';
  const result = { 'cache-control': 'no-store' };
  if (GROK_ORIGINS.has(origin)) {
    result['access-control-allow-origin'] = origin;
    result['access-control-allow-credentials'] = 'true';
    result['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    result['access-control-allow-headers'] = 'content-type';
    result.vary = 'Origin';
  }
  if (requested || GROK_ORIGINS.has(origin)) result['access-control-allow-private-network'] = 'true';
  return result;
}

export function parseGrokLoopback(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  const splitAt = text.includes('\r\n\r\n') ? text.indexOf('\r\n\r\n') : text.indexOf('\n\n');
  if (splitAt < 0) return null;
  const separator = text.includes('\r\n\r\n') ? '\r\n' : '\n';
  const headerLength = separator === '\r\n' ? 4 : 2;
  const lines = text.slice(0, splitAt).split(separator).filter(Boolean);
  const [method = 'GET', target = '/'] = (lines[0] || '').split(' ');
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return {
    method: method.toUpperCase(),
    target,
    origin: headers.origin || '',
    requestsPrivateNetwork: headers['access-control-request-private-network'] === 'true',
    body: text.slice(splitAt + headerLength),
  };
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const scaled = number <= 1 ? number * 100 : number;
  return scaled <= 100 ? scaled : null;
}

function resetAt(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 10_000_000_000 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function windowFromUsed(id, label, used, reset) {
  const pct = percent(used);
  if (pct == null) return null;
  return { id, label, remainPct: Math.round((100 - pct) * 10) / 10, usedPct: Math.round(pct * 10) / 10, resetAt: resetAt(reset) };
}

export function parseCodexUsage(data) {
  const limit = data?.rate_limit && typeof data.rate_limit === 'object' ? data.rate_limit : data || {};
  const windows = [];
  const primary = windowFromUsed('5h', 'Codex 5小时', limit.primary_window?.used_percent ?? limit.primary?.used_percent, limit.primary_window?.resets_at ?? limit.primary?.resets_at);
  const secondary = windowFromUsed('week', 'Codex 周额度', limit.secondary_window?.used_percent ?? limit.secondary?.used_percent, limit.secondary_window?.resets_at ?? limit.secondary?.resets_at);
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);
  return windows;
}

export function parseGrokUsage(data) {
  const used = data?.used_percent ?? data?.weekly_used_percent ?? data?.creditUsagePercent ?? data?.weeklyPercentUsed;
  const remain = used == null ? percent(data?.remaining_percent) : null;
  const window = used != null
    ? windowFromUsed('week', 'Grok 周额度', used, data?.reset_at ?? data?.weekly_reset_at ?? data?.currentPeriod?.end)
    : (remain == null ? null : { id: 'week', label: 'Grok 周额度', remainPct: remain, usedPct: 100 - remain, resetAt: resetAt(data?.reset_at) });
  return window ? [window] : [];
}

export function parseCursorUsage(period, sand) {
  const plan = period?.planUsage || period?.individualUsage?.plan || {};
  const windows = [];
  const auto = windowFromUsed('auto', 'Cursor Auto 周额度', plan.autoPercentUsed, plan.autoResetAt || period?.resetAt);
  const api = windowFromUsed('api', 'Cursor API 周额度', plan.apiPercentUsed, plan.apiResetAt || period?.resetAt);
  if (auto) windows.push(auto);
  if (api) windows.push(api);
  const botUsed = plan.botPercentUsed ?? sand?.usagePercent ?? sand?.weeklyPercentUsed ?? sand?.percentUsed;
  const bot = windowFromUsed('bot', 'Grok Bot 周额度', botUsed, sand?.nextResetTimestampUtc || sand?.resetsAt);
  if (bot) windows.push(bot);
  return windows;
}

export function parseCursorPoll(data) {
  if (!data || typeof data !== 'object') return { ok: false, pending: true };
  const accessToken = data.accessToken || data.access_token || '';
  if (!accessToken) return { ok: false, pending: true };
  return { ok: true, accessToken, refreshToken: data.refreshToken || data.refresh_token || '', userId: data.userId || data.authId || data.user_id || '' };
}

export function publicAccount(provider, record = {}) {
  const spec = SUBSCRIPTION_WINDOWS.filter(item => item.provider === provider);
  const known = new Map((record.windows || []).map(window => [window.id, window]));
  return {
    id: provider,
    name: SUBSCRIPTION_PROVIDERS[provider].label,
    status: record.status || 'idle',
    email: record.email || '',
    message: record.message || '',
    connected: !!record.accessToken && record.status !== 'idle',
    windows: spec.map(item => known.get(item.windowId) || { id: item.windowId, label: item.label, remainPct: null, usedPct: null, resetAt: null }),
  };
}

export function jwtEmail(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(Buffer.from(part.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));
    return typeof json.email === 'string' ? json.email : '';
  } catch { return ''; }
}

export function jwtAccountId(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(Buffer.from(part.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));
    return json.chatgpt_account_id || json?.['https://api.openai.com/auth']?.chatgpt_account_id || json.sub || '';
  } catch { return ''; }
}
