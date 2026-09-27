const { contextBridge, ipcRenderer, webUtils } = require('electron');
const saved = ipcRenderer.sendSync('whale-storage');
try { for (const [key, value] of Object.entries(saved)) if (localStorage.getItem(key) == null) localStorage.setItem(key, value); } catch {}
let trustedClickAt = 0;
for (const eventName of ['click', 'auxclick']) document.addEventListener(eventName, event => {
  if (!event.isTrusted || (event.button !== 0 && event.button !== 1)) return;
  trustedClickAt = Date.now(); ipcRenderer.send('whale-user-gesture');
}, true);
contextBridge.exposeInMainWorld('whaleDesktop', {
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
  pickDemoFiles: () => ipcRenderer.invoke('whale-demo-pick-files'),
  inspectDroppedDemoFiles: files => {
    if (!Array.isArray(files)) return Promise.resolve([]);
    const paths = files.slice(0, 20).map(file => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    });
    return ipcRenderer.invoke('whale-demo-inspect-dropped-files', paths);
  },
  clearDroppedDemoFiles: ids => ipcRenderer.invoke('whale-demo-clear-dropped-files', Array.isArray(ids) ? ids.slice(0, 20) : []),
  importDroppedDemoImage: (id, state) => ipcRenderer.invoke('whale-demo-import-dropped-image', { id, state }),
  pickDemoStateImage: state => ipcRenderer.invoke('whale-demo-pick-state-image', state),
  getDemoStateImages: () => ipcRenderer.invoke('whale-demo-get-state-images'),
  resetDemoStateImage: state => ipcRenderer.invoke('whale-demo-reset-state-image', state),
  testMode: process.argv.includes('--whale-render-test') || process.env.WHALE_DESKTOP_TEST === '1',
  standalone: process.platform === 'darwin' || process.argv.includes('--standalone'),
  surface: (expanded, reason) => ipcRenderer.send('whale-surface', { expanded: !!expanded, reason: typeof reason === 'string' ? reason : '' }),
  layoutReady: size => ipcRenderer.send('whale-layout-ready', size && typeof size === 'object' ? { width: Number(size.width), height: Number(size.height) } : null),
  widgetSize: size => {
    if (!size || typeof size !== 'object') return;
    ipcRenderer.send('whale-widget-size', {
      width: Number(size.width), height: Number(size.height),
      requestedWidth: Number(size.requestedWidth), requestedHeight: Number(size.requestedHeight),
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
});
ipcRenderer.on('whale-settings', () => window.dispatchEvent(new Event('whale-open-settings')));
