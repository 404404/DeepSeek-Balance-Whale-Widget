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
  onLayoutRequest: callback => ipcRenderer.on('whale-layout-request', (_event, value) => callback(value)),
  surfaceGeometryReady: epoch => ipcRenderer.send('whale-surface-geometry-ready', Number(epoch)),
  onNativeWidgetSize: callback => ipcRenderer.on('whale-native-widget-size', (_event, value) => callback(value)),
  onNativeRootOffset: callback => ipcRenderer.on('whale-native-root-offset', (_event, value) => callback(value)),
  save: values => ipcRenderer.send('whale-save-storage', values),
  openExternal: value => {
    if (!trustedClickAt || Date.now() - trustedClickAt > 1000 || !navigator.userActivation.isActive || typeof value !== 'string') return Promise.resolve(false);
    trustedClickAt = 0;
    return ipcRenderer.invoke('whale-open-external', value);
  },
  pickDesktopDemoFiles: () => ipcRenderer.invoke('desktop-demo-pick-files'),
  inspectDroppedDesktopDemoFiles: files => {
    if (!Array.isArray(files)) return Promise.resolve([]);
    const paths = files.slice(0, 20).map(file => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    });
    return ipcRenderer.invoke('desktop-demo-inspect-dropped-files', paths);
  },
  clearDroppedDesktopDemoFiles: ids => ipcRenderer.invoke('desktop-demo-clear-dropped-files', Array.isArray(ids) ? ids.slice(0, 20) : []),
  importDroppedDesktopDemoImage: (id, state) => ipcRenderer.invoke('desktop-demo-import-dropped-image', { id, state }),
  pickDesktopDemoStateImage: state => ipcRenderer.invoke('desktop-demo-pick-state-image', state),
  getDesktopDemoStateImages: () => ipcRenderer.invoke('desktop-demo-get-state-images'),
  resetDesktopDemoStateImage: state => ipcRenderer.invoke('desktop-demo-reset-state-image', state),
  testMode: process.argv.includes('--desktop-demo-render-test') || process.env.DESKTOP_DEMO_TEST === '1',
  standalone: process.platform === 'darwin' || process.argv.includes('--standalone') || process.env.DESKTOP_DEMO_MODE === 'standalone',
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
