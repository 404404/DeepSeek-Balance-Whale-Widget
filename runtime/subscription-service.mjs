import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { readJson, writeJson } from './paths.mjs';
import {
  SUBSCRIPTION_PROVIDERS, callbackFromQuery, codexAuthorizeURL, codexRedirectURI, cursorLoginURL, cursorPollURL,
  grokAuthorizeURL, grokCorsHeaders, grokRedirectURI, isAllowedAuthorizeURL, jwtAccountId, jwtEmail, makePkce,
  parseCodexUsage, parseCursorPoll, parseCursorUsage, parseGrokUsage, publicAccount,
} from './subscription-auth.mjs';

const PROVIDERS = ['codex', 'grok', 'cursor'];

function formBody(fields) {
  return Object.entries(fields).map(([key, value]) => key + '=' + encodeURIComponent(value ?? '')).join('&');
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function uuid() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function readJsonResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

export function createSubscriptionService({ dataDir, fetchImpl = fetch, openExternal = async () => {}, timeoutMs = 20000 } = {}) {
  const file = path.join(dataDir, 'subscription-credentials.json');
  const pending = new Map();
  const servers = new Set();
  let closed = false;

  function load() {
    const data = readJson(file, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }
  function save(data) { writeJson(file, data); }
  function update(provider, patch) {
    const data = load();
    data[provider] = { ...(data[provider] || {}), ...patch, updatedAt: new Date().toISOString() };
    save(data);
    return data[provider];
  }
  function publicStatus() {
    const data = load();
    return {
      accounts: PROVIDERS.map(provider => publicAccount(provider, {
        ...data[provider],
        ...(pending.has(provider) ? { status: 'pending', message: '已打开浏览器，完成页面登录即可，不用填写验证码' } : {}),
      })),
    };
  }
  async function exchange(url, fields) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: formBody(fields),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload?.access_token) throw new Error(String(payload?.error_description || payload?.error || ('授权换取凭据失败（HTTP ' + response.status + '）')).slice(0, 180));
    return payload;
  }
  async function refreshQuota(provider) {
    const record = load()[provider];
    if (!record?.accessToken) return;
    try {
      const windows = provider === 'codex' ? await codexQuota(record) : provider === 'grok' ? await grokQuota(record) : await cursorQuota(record);
      update(provider, { status: windows.length ? 'ok' : 'error', message: windows.length ? '额度已更新' : '登录成功，但接口没有返回额度窗口', windows });
    } catch (error) {
      update(provider, { status: 'error', message: String(error.message || error).slice(0, 180) });
    }
  }
  async function codexQuota(record) {
    const headers = { authorization: 'Bearer ' + record.accessToken, accept: 'application/json' };
    if (record.accountId) headers['ChatGPT-Account-ID'] = record.accountId;
    const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error('Codex 额度接口 HTTP ' + response.status);
    const windows = parseCodexUsage(payload);
    if (!windows.length) throw new Error('Codex 用量结构无法识别');
    return windows;
  }
  async function grokQuota(record) {
    const response = await fetchImpl('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
      headers: { authorization: 'Bearer ' + record.accessToken, accept: 'application/json', 'x-xai-token-auth': 'xai-grok-cli', 'user-agent': 'xai-grok-cli' },
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error('Grok 额度接口 HTTP ' + response.status);
    const windows = parseGrokUsage(payload);
    if (!windows.length) throw new Error('Grok 额度字段无法解析');
    return windows;
  }
  async function cursorQuota(record) {
    const headers = { authorization: 'Bearer ' + record.accessToken, 'content-type': 'application/json', 'connect-protocol-version': '1', origin: 'https://cursor.com' };
    const periodResponse = await fetchImpl('https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage', { method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const period = periodResponse.ok ? await readJsonResponse(periodResponse) : null;
    const sandResponse = await fetchImpl('https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus', { method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const sand = sandResponse.ok ? await readJsonResponse(sandResponse) : null;
    if (!period && !sand) throw new Error('Cursor 额度接口 HTTP ' + (periodResponse.status || sandResponse.status));
    const windows = parseCursorUsage(period || {}, sand || {});
    if (!windows.length) throw new Error('Cursor 用量无法解析');
    return windows;
  }
  function listen(port, host) {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const fail = error => { server.close(); reject(error); };
      server.once('error', fail);
      server.listen(port, host, () => { server.off('error', fail); servers.add(server); resolve(server); });
    });
  }
  function finishServer(server) { servers.delete(server); server.close(); }
  async function openLogin(url) {
    if (!isAllowedAuthorizeURL(url)) throw new Error('拒绝打开非官方登录页');
    await openExternal(url);
  }
  function track(provider, job) {
    pending.set(provider, job);
    job.finally(() => { if (pending.get(provider) === job) pending.delete(provider); });
    return { ok: true, status: 'pending', message: '已打开浏览器，完成页面登录即可，不用填写验证码' };
  }
  async function beginLogin(provider) {
    if (!PROVIDERS.includes(provider)) return { ok: false, error: '未知订阅' };
    if (closed) return { ok: false, error: '挂件正在退出' };
    if (pending.has(provider)) return { ok: true, status: 'pending', message: '正在等待浏览器完成登录' };
    if (provider === 'cursor') return loginCursor();
    if (provider === 'grok') return loginGrok();
    return loginCodex();
  }
  async function loginCodex() {
    const pkce = makePkce();
    let server, port, lastError;
    for (const candidate of SUBSCRIPTION_PROVIDERS.codex.ports) {
      try { server = await listen(candidate); port = candidate; break; }
      catch (error) { lastError = error; }
    }
    if (!server) return { ok: false, error: '无法监听 Codex 登录回调端口 1455/1457：' + (lastError?.message || '端口被占用') };
    const request = { ...pkce, redirectURI: codexRedirectURI(port) };
    const done = new Promise(resolve => {
      const timer = setTimeout(() => { finishServer(server); update('codex', { status: 'error', message: 'Codex 浏览器登录超时，请重试' }); resolve(); }, 8 * 60 * 1000);
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== '/auth/callback') { res.writeHead(404); res.end('not found'); return; }
        const callback = callbackFromQuery(url.searchParams, request.state);
        res.writeHead(callback.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end('<meta charset="utf-8"><p>' + (callback.ok ? 'Codex 登录完成，可以回到 AI Balance Whale。' : 'Codex 登录未完成，请回到挂件重试。') + '</p>');
        clearTimeout(timer); finishServer(server);
        resolve(callback.ok ? completeCodex(callback.code, request) : update('codex', { status: 'error', message: callback.error, windows: [] }));
      });
    });
    try { await openLogin(codexAuthorizeURL(request).href); }
    catch (error) { finishServer(server); return { ok: false, error: String(error.message || error) }; }
    return track('codex', done);
  }
  async function completeCodex(code, request) {
    try {
      const token = await exchange(SUBSCRIPTION_PROVIDERS.codex.issuer + '/oauth/token', {
        grant_type: 'authorization_code', code, redirect_uri: request.redirectURI, client_id: SUBSCRIPTION_PROVIDERS.codex.clientId, code_verifier: request.verifier,
      });
      update('codex', {
        accessToken: token.access_token, refreshToken: token.refresh_token || '', accountId: jwtAccountId(token.id_token || token.access_token),
        email: jwtEmail(token.id_token || ''), expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000, status: 'ok', message: '已连接，正在读取额度', windows: [],
      });
      await refreshQuota('codex');
    } catch (error) { update('codex', { status: 'error', message: error.message, windows: [] }); }
  }
  async function loginGrok() {
    const pkce = makePkce();
    let server;
    try { server = await listen(SUBSCRIPTION_PROVIDERS.grok.ports[0], '127.0.0.1'); }
    catch (error) { return { ok: false, error: '无法监听 Grok 登录回调端口 56121：' + error.message }; }
    const request = { ...pkce, redirectURI: grokRedirectURI() };
    const done = new Promise(resolve => {
      const timer = setTimeout(() => { finishServer(server); update('grok', { status: 'error', message: 'Grok 浏览器登录超时，请重试' }); resolve(); }, 8 * 60 * 1000);
      server.on('request', (req, res) => {
        const headers = grokCorsHeaders(req.headers);
        if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          let params = url.searchParams;
          const body = Buffer.concat(chunks).toString('utf8');
          if (!params.get('code') && body) {
            try {
              const json = JSON.parse(body);
              params = new URLSearchParams();
              for (const [key, value] of Object.entries(json)) params.set(key, String(value));
            } catch { params = new URLSearchParams(body); }
          }
          if (url.pathname !== '/callback') { res.writeHead(404, headers); res.end('not found'); return; }
          const callback = callbackFromQuery(params, request.state);
          res.writeHead(callback.ok ? 200 : 400, { ...headers, 'content-type': 'text/html; charset=utf-8' });
          res.end('<meta charset="utf-8"><p>' + (callback.ok ? 'Grok 登录完成，可以回到 AI Balance Whale。' : 'Grok 登录未完成，请回到挂件重试。') + '</p>');
          if (!params.get('code') && !params.get('error')) return;
          clearTimeout(timer); finishServer(server);
          resolve(callback.ok ? completeGrok(callback.code, request) : update('grok', { status: 'error', message: callback.error, windows: [] }));
        });
      });
    });
    try { await openLogin(grokAuthorizeURL(request).href); }
    catch (error) { finishServer(server); return { ok: false, error: String(error.message || error) }; }
    return track('grok', done);
  }
  async function completeGrok(code, request) {
    try {
      const token = await exchange(SUBSCRIPTION_PROVIDERS.grok.issuer + '/oauth2/token', {
        grant_type: 'authorization_code', code, redirect_uri: request.redirectURI, client_id: SUBSCRIPTION_PROVIDERS.grok.clientId, code_verifier: request.verifier,
      });
      update('grok', {
        accessToken: token.access_token, refreshToken: token.refresh_token || '', email: jwtEmail(token.id_token || ''),
        expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000, status: 'ok', message: '已连接，正在读取额度', windows: [],
      });
      await refreshQuota('grok');
    } catch (error) { update('grok', { status: 'error', message: error.message, windows: [] }); }
  }
  async function loginCursor() {
    const pkce = makePkce();
    const request = { ...pkce, uuid: uuid() };
    try { await openLogin(cursorLoginURL(request).href); }
    catch (error) { return { ok: false, error: String(error.message || error) }; }
    const done = (async () => {
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline && !closed) {
        await delay(2000);
        try {
          const response = await fetchImpl(cursorPollURL(request).href, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
          if (response.status === 404) continue;
          const parsed = parseCursorPoll(await readJsonResponse(response));
          if (!parsed.ok) continue;
          update('cursor', { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, accountId: parsed.userId, status: 'ok', message: '已连接，正在读取额度', windows: [] });
          await refreshQuota('cursor');
          return;
        } catch { /* browser login still in progress */ }
      }
      update('cursor', { status: 'error', message: 'Cursor 浏览器登录超时，请重试', windows: [] });
    })();
    return track('cursor', done);
  }
  function logout(provider) {
    if (!PROVIDERS.includes(provider)) return { ok: false, error: '未知订阅' };
    const data = load();
    delete data[provider];
    save(data);
    return { ok: true };
  }
  async function refreshAll() {
    await Promise.all(PROVIDERS.filter(provider => load()[provider]?.accessToken).map(provider => refreshQuota(provider)));
  }
  function close() {
    closed = true;
    for (const server of servers) server.close();
    servers.clear();
  }
  return { publicStatus, beginLogin, logout, refreshAll, refreshQuota, close };
}
