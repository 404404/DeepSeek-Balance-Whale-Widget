const { contextBridge, ipcRenderer, webUtils } = require('electron');
const saved = ipcRenderer.sendSync('whale-storage');
try { for (const [key, value] of Object.entries(saved)) if (localStorage.getItem(key) == null) localStorage.setItem(key, value); } catch {}
let trustedClickAt = 0;
let trustedQuickChatAt = 0;
let trustedFileDropAt = 0;
for (const eventName of ['click', 'auxclick']) document.addEventListener(eventName, event => {
  if (!event.isTrusted || (event.button !== 0 && event.button !== 1)) return;
  trustedClickAt = Date.now(); ipcRenderer.send('whale-user-gesture');
  if (eventName === 'click' && event.button === 0 && event.composedPath().some(node => node instanceof Element && (node.matches('.dshwv-chat-btn') || node.matches('#chat-test-open')))) {
    trustedQuickChatAt = Date.now();
    ipcRenderer.send('whale-quick-chat-gesture');
  }
}, true);
document.addEventListener('dragenter', event => {
  if (event.isTrusted && Array.from(event.dataTransfer?.types || []).includes('Files')) trustedFileDropAt = Date.now();
}, true);
document.addEventListener('drop', event => {
  if (event.isTrusted && Array.from(event.dataTransfer?.types || []).includes('Files')) trustedFileDropAt = Date.now();
}, true);
document.addEventListener('dragover', event => {
  if (event.isTrusted && Array.from(event.dataTransfer?.types || []).includes('Files')) trustedFileDropAt = Date.now();
}, true);
window.addEventListener('blur', () => {
  trustedClickAt = 0;
  trustedQuickChatAt = 0;
  ipcRenderer.send('whale-external-drop-active', false);
}, true);
const desktopBridge = {
  ready: () => ipcRenderer.send('whale-ready'),
  keyboardFocus: value => ipcRenderer.send('whale-keyboard-focus', !!value),
  interactive: value => ipcRenderer.send('whale-interactive', !!value),
  onCursor: callback => ipcRenderer.on('whale-cursor', (_event, point) => callback(point)),
  onLayoutRequest: callback => ipcRenderer.on('whale-layout-request', () => callback()),
  onNativeWidgetSize: callback => ipcRenderer.on('whale-native-widget-size', (_event, value) => callback(value)),
  onNativeRootOffset: callback => ipcRenderer.on('whale-native-root-offset', (_event, value) => callback(value)),
  save: values => ipcRenderer.send('whale-save-storage', values),
  openExternal: value => {
    if (!trustedClickAt || Date.now() - trustedClickAt > 1000 || !navigator.userActivation.isActive || typeof value !== 'string') return Promise.resolve(false);
    trustedClickAt = 0;
    return ipcRenderer.invoke('whale-open-external', value);
  },
  openQuickChat: config => {
    if (!trustedQuickChatAt || Date.now() - trustedQuickChatAt > 1000) return Promise.resolve({ ok: false, error: '请直接点击快速聊天按钮后重试' });
    trustedQuickChatAt = 0;
    return ipcRenderer.invoke('whale-open-quick-chat', config);
  },
  saveChatConfig: config => ipcRenderer.invoke('whale-save-chat-config', config),
  shareDroppedFiles: files => {
    if (!processIsTestMode() && (!trustedFileDropAt || Date.now() - trustedFileDropAt > 2000)) return Promise.resolve({ ok: false, code: 'untrusted-drop', message: '请从系统文件管理器将文件拖到人偶上' });
    trustedFileDropAt = 0;
    if (!files || typeof files[Symbol.iterator] !== 'function') return Promise.resolve({ ok: false, code: 'no-files', message: '没有检测到可分享的本地文件' });
    const paths = [];
    for (const file of Array.from(files).slice(0, 21)) {
      try { paths.push(webUtils.getPathForFile(file)); } catch { paths.push(''); }
    }
    return ipcRenderer.invoke('whale-share-files', paths);
  },
  externalDropActive: value => {
    if (value) {
      if (!trustedFileDropAt || Date.now() - trustedFileDropAt > 2000) return false;
      trustedFileDropAt = Date.now();
    }
    ipcRenderer.send('whale-external-drop-active', !!value);
    return true;
  },
  testMode: process.argv.includes('--whale-render-test') || process.env.WHALE_DESKTOP_TEST === '1',
  standalone: process.platform === 'darwin' || process.argv.includes('--standalone'),
  surface: (expanded, reason) => ipcRenderer.send('whale-surface', { expanded: !!expanded, reason: typeof reason === 'string' ? reason : '' }),
  layoutReady: size => ipcRenderer.send('whale-layout-ready', size && typeof size === 'object' ? { width: Number(size.width), height: Number(size.height) } : null),
  widgetSize: size => {
    if (!size || typeof size !== 'object') return;
    ipcRenderer.send('whale-widget-size', {
      width: Number(size.width), height: Number(size.height),
      requestedWidth: Number(size.requestedWidth), requestedHeight: Number(size.requestedHeight),
      anchorRatioX: Number(size.anchorRatioX),
    });
  },
  // The main process uses this local DOM rectangle with the global cursor
  // position. It avoids relying on macOS forwarding mouse moves into an
  // ignored transparent BrowserWindow.
  hitRegion: region => {
    if (!region || typeof region !== 'object') return;
    const regions = Array.isArray(region.regions) ? region.regions : [region];
    ipcRenderer.send('whale-hit-region', {
      regions: regions.map(value => ({
        left: Number(value?.left), top: Number(value?.top),
        width: Number(value?.width), height: Number(value?.height),
      })),
    });
  },
  layoutDiagnostic: value => {
    if (value && typeof value === 'object') ipcRenderer.send('whale-layout-diagnostic', value);
  },
  dragStart: point => ipcRenderer.send('whale-drag-start', { x: Number(point?.x), y: Number(point?.y) }),
  dragMove: point => ipcRenderer.send('whale-drag-move', { x: Number(point?.x), y: Number(point?.y) }),
  dragEnd: () => ipcRenderer.send('whale-drag-end'),
  onNativeDragMoved: callback => ipcRenderer.on('whale-native-drag-moved', () => callback()),
};
function processIsTestMode() { return process.argv.includes('--whale-interaction-test') || process.env.WHALE_DESKTOP_TEST === '1'; }
if (processIsTestMode()) desktopBridge.testShareFiles = paths => ipcRenderer.invoke('whale-test-share-files', Array.isArray(paths) ? paths.slice(0, 21) : []);
contextBridge.exposeInMainWorld('whaleDesktop', desktopBridge);
ipcRenderer.on('whale-settings', () => window.dispatchEvent(new Event('whale-open-settings')));
