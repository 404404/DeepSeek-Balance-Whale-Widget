'use strict';

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const MAC_DEFAULT_BROWSER_SCRIPT = [
  'ObjC.import("AppKit");',
  'ObjC.import("Foundation");',
  'const u = $.NSURL.URLWithString("https://example.com/");',
  'const a = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(u);',
  'if (!a) throw new Error("No default HTTPS application");',
  'const b = $.NSBundle.bundleWithURL(a);',
  'JSON.stringify({ path: ObjC.unwrap(a.path), bundleId: ObjC.unwrap(b.bundleIdentifier) });',
].join(' ');

function execFileText(execFileImpl, file, args) {
  return new Promise((resolve, reject) => execFileImpl(file, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024 }, (error, stdout) => {
    if (error) reject(error); else resolve(String(stdout || '').trim());
  }));
}

function registryString(output, valueName) {
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(output || '').match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, 'i'));
  return match ? match[1].trim() : '';
}

function parseWindowsDefaultBrowser(progOutput, commandOutput) {
  const progId = registryString(progOutput, 'ProgId');
  if (!/^(?:ChromeHTML|MSEdgeHTM)$/i.test(progId)) return null;
  const command = registryString(commandOutput, '(Default)');
  const executable = command.match(/^\s*"([^"]+\.exe)"|^\s*([^\s]+\.exe)/i);
  const browserPath = executable && (executable[1] || executable[2]);
  if (!browserPath) return null;
  const name = path.win32.basename(browserPath).toLowerCase();
  if (name !== 'chrome.exe' && name !== 'msedge.exe') return null;
  return { path: browserPath, name: name === 'chrome.exe' ? 'Chrome' : 'Microsoft Edge', source: 'windows-url-handler' };
}

async function detectDefaultAppModeBrowser(platform, execFileImpl = execFile) {
  if (platform === 'win32') {
    try {
      const prog = await execFileText(execFileImpl, 'reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
      const progId = registryString(prog, 'ProgId');
      if (!/^(?:ChromeHTML|MSEdgeHTM)$/i.test(progId)) return null;
      const command = await execFileText(execFileImpl, 'reg.exe', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']);
      return parseWindowsDefaultBrowser(prog, command);
    } catch { return null; }
  }
  if (platform === 'darwin') {
    try {
      const result = await execFileText(execFileImpl, '/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_DEFAULT_BROWSER_SCRIPT]);
      const browser = JSON.parse(result);
      if (!browser || typeof browser.path !== 'string' || !path.isAbsolute(browser.path)) return null;
      const bundleId = String(browser.bundleId || '').toLowerCase();
      if (bundleId === 'com.google.chrome') return { path: browser.path, name: 'Chrome', source: 'launch-services' };
      if (bundleId === 'com.microsoft.edgemac') return { path: browser.path, name: 'Microsoft Edge', source: 'launch-services' };
      return null;
    } catch { return null; }
  }
  return null;
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function launchDetached(spawnImpl, executable, args, platform) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; resolve(value); };
    try {
      const child = spawnImpl(executable, args, {
        detached: true, stdio: 'ignore', windowsHide: platform === 'win32', shell: false,
      });
      child.once('spawn', () => { child.unref(); finish(true); });
      child.once('error', () => finish(false));
    } catch { finish(false); }
  });
}

function createQuickChatWindowHost({
  platform = process.platform,
  BrowserWindowImpl = null,
  execFileImpl = execFile,
  spawnImpl = spawn,
  detectBrowserImpl = detectDefaultAppModeBrowser,
  fixture = false,
} = {}) {
  let chatWindow = null;

  function appWindowOptions() {
    return {
      width: 960, height: 720, minWidth: 640, minHeight: 480,
      title: '快速聊天', autoHideMenuBar: true, show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: 'persist:whale-quick-chat',
        nodeIntegration: false, contextIsolation: true, sandbox: true,
      },
    };
  }

  function installRemotePageGuards(win) {
    const isHttps = value => !!safeHttps(value);
    win.webContents.on('will-redirect', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
    win.webContents.setWindowOpenHandler(({ url }) => isHttps(url)
      ? { action: 'allow', overrideBrowserWindowOptions: appWindowOptions() }
      : { action: 'deny' });
    win.webContents.on('will-navigate', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }

  async function open(urlValue) {
    const url = safeHttps(urlValue);
    if (!url) return { ok: false, error: '聊天网址无效：只允许安全的 HTTPS 地址' };
    if (fixture) return { ok: true, mode: 'fixture-window', cookieScope: 'fixture' };

    const browser = await detectBrowserImpl(platform, execFileImpl);
    if (browser && (platform === 'win32' || platform === 'darwin')) {
      const executable = platform === 'darwin'
        ? path.join(browser.path, 'Contents', 'MacOS', browser.name === 'Chrome' ? 'Google Chrome' : 'Microsoft Edge')
        : browser.path;
      const launched = await launchDetached(spawnImpl, executable, [`--app=${url}`, '--window-size=960,720', '--new-window'], platform);
      if (launched) return { ok: true, mode: 'browser-app', browser: browser.name, cookieScope: 'default-browser-profile' };
    }

    if (typeof BrowserWindowImpl !== 'function') return { ok: false, error: '无法创建聊天小窗；请检查浏览器安装或重试' };
    try {
      if (!chatWindow || chatWindow.isDestroyed()) {
        chatWindow = new BrowserWindowImpl(appWindowOptions());
        installRemotePageGuards(chatWindow);
        chatWindow.on('closed', () => { chatWindow = null; });
      }
      if (chatWindow.webContents.getURL() !== url) await chatWindow.loadURL(url);
      if (!chatWindow.isVisible()) chatWindow.show(); else chatWindow.focus();
      return { ok: true, mode: 'app-window', cookieScope: 'app-persistent-session' };
    } catch {
      try { chatWindow?.destroy(); } catch {}
      chatWindow = null;
      return { ok: false, error: '聊天小窗无法加载该网站，请检查网络或重试' };
    }
  }

  function close() {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.destroy();
    chatWindow = null;
  }

  return { open, close, get window() { return chatWindow; } };
}

module.exports = { MAC_DEFAULT_BROWSER_SCRIPT, registryString, parseWindowsDefaultBrowser, detectDefaultAppModeBrowser, launchDetached, createQuickChatWindowHost, safeHttps };
