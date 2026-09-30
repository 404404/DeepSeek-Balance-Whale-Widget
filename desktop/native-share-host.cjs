'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateDroppedPaths } = require('./native-share.cjs');

function createNativeShareHost({ app, window, screen, platform = process.platform, fixture = false, onActive = () => {}, onOpened = () => {}, spawnImpl = spawn, ShareMenuImpl = null, windowsHelperPath = null, existsSyncImpl = fs.existsSync } = {}) {
  let active = false, menu = null, child = null, disposed = false;
  const setActive = value => {
    if (active === value) return;
    active = value;
    try { onActive(active); } catch {}
  };

  function close() {
    disposed = true;
    try { menu?.closePopup(window); } catch {}
    try { if (child && child.exitCode === null) child.kill(); } catch {}
    menu = null;
    child = null;
    setActive(false);
  }

  function macShare(paths) {
    let ShareMenuCtor = ShareMenuImpl;
    if (!ShareMenuCtor) { try { ShareMenuCtor = require('electron').ShareMenu; } catch {} }
    if (typeof ShareMenuCtor !== 'function') return { ok: false, code: 'share-api-unavailable', message: '当前 Electron 不支持 macOS 系统分享菜单' };
    const bounds = window.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const x = Math.max(0, Math.min(bounds.width, Math.round(cursor.x - bounds.x)));
    const y = Math.max(0, Math.min(bounds.height, Math.round(cursor.y - bounds.y)));
    setActive(true);
    try {
      menu = new ShareMenuCtor({ filePaths: paths });
      menu.popup({ browserWindow: window, x, y, callback: () => {
        // Electron's callback only reports dismissal, not whether the target
        // completed sending. Never present this as delivery confirmation.
        menu = null;
        setActive(false);
      } });
      onOpened({ platform: 'darwin', fileCount: paths.length });
      return { ok: true, status: 'opened', fileCount: paths.length };
    } catch {
      menu = null;
      setActive(false);
      return { ok: false, code: 'share-ui-failed', message: '无法打开 macOS 系统分享菜单，请重试' };
    }
  }

  function windowsShare(paths) {
    const helper = windowsHelperPath || (app.isPackaged
      ? path.join(process.resourcesPath, 'whale-share.exe')
      : path.join(__dirname, 'native', 'bin', 'whale-share.exe'));
    if (!existsSyncImpl(helper)) return { ok: false, code: 'share-helper-missing', message: 'Windows 原生分享组件不存在；请重新安装完整版本' };
    let handle;
    try { handle = window.getNativeWindowHandle().readBigUInt64LE().toString(16); }
    catch { return { ok: false, code: 'window-handle-unavailable', message: '无法定位挂件窗口，请重试' }; }
    setActive(true);
    let settled = false, output = '';
    const result = new Promise(resolve => {
      const finish = value => { if (settled) return; settled = true; resolve(value); };
      try {
        child = spawnImpl(helper, [handle, ...paths], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], shell: false });
      } catch {
        child = null; setActive(false); finish({ ok: false, code: 'share-helper-start-failed', message: 'Windows 分享组件无法启动，请重试' }); return;
      }
      child.stdout?.on('data', chunk => {
        output = (output + chunk.toString('utf8')).slice(-4096);
        const lines = output.split(/\r?\n/);
        output = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.status === 'opened') {
              onOpened({ platform: 'win32', fileCount: paths.length });
              finish({ ok: true, status: 'opened', fileCount: paths.length });
            } else if (message.status === 'error') {
              finish({ ok: false, code: String(message.code || 'share-ui-failed').slice(0, 64), message: 'Windows 系统分享面板无法打开，请重试' });
            }
          } catch {}
        }
      });
      child.once('error', () => finish({ ok: false, code: 'share-helper-start-failed', message: 'Windows 分享组件无法启动，请重试' }));
      child.once('exit', code => {
        child = null;
        setActive(false);
        if (!settled) finish({ ok: false, code: code === 0 ? 'share-helper-ended' : 'share-ui-failed', message: 'Windows 系统分享面板无法打开，请重试' });
      });
    });
    return result;
  }

  async function share(input) {
    if (disposed) return { ok: false, code: 'app-closing', message: '应用正在退出' };
    if (active) return { ok: false, code: 'share-busy', message: '系统分享面板仍在使用中，请关闭后再分享' };
    const checked = await validateDroppedPaths(input);
    if (!checked.ok) return checked;
    const paths = checked.files.map(file => file.path);
    if (fixture) {
      onOpened({ platform, fileCount: paths.length, fixture: true });
      return { ok: true, status: 'opened', fileCount: paths.length, fixture: true };
    }
    if (platform === 'darwin') return macShare(paths);
    if (platform === 'win32') return windowsShare(paths);
    return { ok: false, code: 'platform-unsupported', message: '此平台暂不支持系统文件分享' };
  }

  return { share, close, get active() { return active; } };
}

module.exports = { createNativeShareHost };
