const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, globalShortcut, shell, protocol, session, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { UiStateStore } = require('./ui-state-store.cjs');
const { shutdownCompanion } = require('./lifecycle.cjs');
const { externalWebUrl } = require('./external-links.cjs');
const { createNativeShareHost } = require('./native-share-host.cjs');
const QuickChatConfig = require('./quick-chat-config.cjs');
const { pathToFileURL } = require('node:url');
const { targetWidgetSize, widgetSizeApplied, clampFrameToArea, resizeKeepingBottomRight: resizeFrameKeepingBottomRight, resizeKeepingWidgetAnchor, widgetScreenAnchor, nativeDragMovement, cursorInRegions, surfaceRootOffset } = require('./standalone-interaction-model.cjs');

const root = path.resolve(__dirname, '..');
const MIN_WIDGET_SIZE = 122;
const DEFAULT_WIDGET_SIZE = 375;
const MAX_WIDGET_SIZE = 625;
const ROLE_ANCHOR_RATIO = 0.70275;
const args = process.argv.slice(1);
const fixture = process.env.WHALE_DESKTOP_TEST === '1';
const layoutTest = fixture || process.argv.includes('--whale-render-test');
const interactionTest = process.argv.includes('--whale-interaction-test');
const explicitDataDir = args.find(value => value.startsWith('--whale-data='))?.slice('--whale-data='.length);
const productName = 'DeepSeek-Balance-Whale-Widget';
const defaultDataDir = path.join(app.getPath('appData'), productName);
const dataDir = path.resolve(explicitDataDir || process.env.WHALE_HOME || defaultDataDir);
const startupAt = Date.now();
const startup = { revision: 'mac-standalone-0.1.0', requestedAt: Number(process.env.WHALE_LAUNCH_TIME) || startupAt, mainAt: startupAt, mode: 'standalone', phases: {} };
const markStartup = phase => { if (startup.phases[phase] == null) startup.phases[phase] = Date.now() - startup.requestedAt; };
const writeStartup = () => fs.promises.writeFile(path.join(dataDir, "startup-timings.json"), JSON.stringify(startup, null, 2)).catch(() => {});
markStartup('main');

if (!path.isAbsolute(dataDir)) app.exit(1);
protocol.registerSchemesAsPrivileged([{ scheme: 'whale', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
fs.mkdirSync(dataDir, { recursive: true });
// Electron's own profile is separate from the user-owned whale data. Both
// paths are stable across upgrades and neither is inside the .app bundle.
app.setPath('userData', path.join(dataDir, 'electron-profile'));
fs.mkdirSync(path.join(dataDir, 'electron-profile'), { recursive: true });

const lock = app.requestSingleInstanceLock();
let window;
let tray;
let dispatcher;
let bridge;
let rendererReady = false;
let layoutConfigReady = false;
let layoutReady = false;
let inputEnabled = false;
let externalDropActive = false;
let nativeShareHost = null;
let keyboardFocus = false;
let manuallyHidden = false;
let surfaceExpanded = false;
let pendingSurface = null;
let surfaceReason = 'none';
let nativeDrag = null;
let pendingWidgetSize = null;
let quitting = false;
let visibilityWatchdog = null;
let inputRoutingWatchdog = null;
let frameSaveTimer = null;
let lastCursor = '';
let syntheticCursorScreen = null;
let presents = 0;
let trustedGestureAt = 0;
let trustedQuickChatAt = 0;
let widgetAnchor = null;
let widgetAnchorRatio = ROLE_ANCHOR_RATIO;
let lastWidgetSize = '';
let lastNativeWidgetSize = '';
let lastNativeRootOffset = '';
let lastLayoutDiagnostic = null;
let hitRegions = [];
let inputRoutingReason = 'startup';
let interactionTestStarted = false;
const rendererErrors = [];
const fixtureOpenedLinks = [];
const stateFile = path.join(dataDir, 'ui-state.json');
const windowStateFile = path.join(dataDir, 'window-state.json');
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const save = (file, value) => {
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
};
const uiStore = new UiStateStore(stateFile);
const values = () => uiStore.get();
const storeValues = input => uiStore.set(input);

function validFrame(frame) {
  return frame && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(frame[key]))) && Number(frame.width) >= MIN_WIDGET_SIZE && Number(frame.height) >= MIN_WIDGET_SIZE;
}
function numericFrame(frame) {
  return { x: Number(frame.x), y: Number(frame.y), width: Number(frame.width), height: Number(frame.height) };
}
function workAreaFor(frame) {
  try { return screen.getDisplayMatching(frame).workArea; } catch { return screen.getPrimaryDisplay().workArea; }
}
function clampFrame(frame) {
  return clampFrameToArea(frame, workAreaFor(frame), MIN_WIDGET_SIZE);
}
function configuredWidgetSize() {
  const saved = read(path.join(dataDir, '.dshw-size.json'), {});
  const scale = Number(saved?.scale);
  return targetWidgetSize(scale, { base: 250, min: MIN_WIDGET_SIZE, max: MAX_WIDGET_SIZE });
}
function defaultFrame() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = configuredWidgetSize();
  const width = Math.min(size, area.width);
  const height = Math.min(size, area.height);
  return { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24, width, height };
}
function initialFrame() {
  const saved = read(windowStateFile, {});
  const size = configuredWidgetSize();
  if (!validFrame(saved.frame)) return clampFrame({ ...defaultFrame(), width: size, height: size });
  const frame = numericFrame(saved.frame);
  // The native frame remembers the screen position only. Its old width/height
  // can be a feedback-loop artifact, a pre-fix 248x274 frame, or an expanded
  // settings surface. Preserve the role-layout bottom-centre screen anchor,
  // not the window corner. A v2 anchor is authoritative after the first run.
  const ratio = Number.isFinite(saved.widgetAnchorRatio) && saved.widgetAnchorRatio >= 0 && saved.widgetAnchorRatio <= 1 ? saved.widgetAnchorRatio : ROLE_ANCHOR_RATIO;
  const anchor = saved.version >= 2 && saved.widgetAnchor && Number.isFinite(saved.widgetAnchor.x) && Number.isFinite(saved.widgetAnchor.y)
    ? saved.widgetAnchor
    : widgetScreenAnchor(frame, ratio);
  return clampFrame({
    ...resizeKeepingWidgetAnchor(frame, size, size, workAreaFor(frame), ratio, anchor, MIN_WIDGET_SIZE),
  });
}
function readWindowState() { return read(windowStateFile, {}); }
let alwaysOnTop = readWindowState().alwaysOnTop === true;
function persistWindowState() {
  if (!window || window.isDestroyed()) return;
  try {
    const [width, height] = compactWidgetDimensions();
    const actual = window.getBounds();
    const anchor = widgetAnchor || widgetScreenAnchor(actual, widgetAnchorRatio);
    const compact = resizeKeepingWidgetAnchor(actual, width, height, workAreaFor(actual), widgetAnchorRatio, anchor, MIN_WIDGET_SIZE);
    save(windowStateFile, { version: 2, frame: compact, widgetAnchor: { x: anchor.x, y: anchor.y }, widgetAnchorRatio, alwaysOnTop, updatedAt: new Date().toISOString() });
  } catch {}
}
function scheduleFrameSave() {
  if (!window || window.isDestroyed()) return;
  clearTimeout(frameSaveTimer);
  frameSaveTimer = setTimeout(() => { frameSaveTimer = null; persistWindowState(); }, 250);
}
function applyAlwaysOnTop() {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(alwaysOnTop, 'floating');
}
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏小鲸鱼', click: toggle },
    { label: '打开设置', click: () => { show(); window.webContents.send('whale-settings'); } },
    { label: '人偶置顶', type: 'checkbox', checked: alwaysOnTop, click: item => setPinned(!!item.checked) },
    { label: '恢复人偶位置', click: restoreWidget },
    { type: 'separator' },
    { label: '退出 AI Balance Whale', click: () => app.quit() },
  ]));
}
function setPinned(next) {
  alwaysOnTop = !!next;
  applyAlwaysOnTop();
  persistWindowState();
  refreshTrayMenu();
}
function invalidate() { if (window && !window.isDestroyed()) { presents++; window.webContents.invalidate(); } }
function setKeyboardFocus(editing) {
  if (!window || window.isDestroyed() || keyboardFocus === editing) return;
  keyboardFocus = editing;
  if (editing) window.focus();
}
function sendCursor(force = false) {
  if (!window || window.isDestroyed() || !rendererReady || !window.isVisible()) return;
  const bounds = window.getContentBounds();
  const cursor = interactionTest && syntheticCursorScreen ? syntheticCursorScreen : screen.getCursorScreenPoint();
  const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  const encoded = point.x + ',' + point.y;
  if (force || encoded !== lastCursor) { lastCursor = encoded; window.webContents.send('whale-cursor', point); }
}
function setInputEnabled(enabled, reason = 'state') {
  if (!window || window.isDestroyed()) return;
  const next = !!enabled;
  inputRoutingReason = reason;
  if (next === inputEnabled) return;
  inputEnabled = next;
  try { window.setIgnoreMouseEvents(!next, { forward: true }); } catch {}
  writeInputRoutingDiagnostic();
}
function cursorInsideHitRegion() {
  if (!window || window.isDestroyed() || !hitRegions.length) return false;
  try {
    const bounds = window.getContentBounds();
    const cursor = interactionTest && syntheticCursorScreen ? syntheticCursorScreen : screen.getCursorScreenPoint();
    return cursorInRegions(cursor, bounds, hitRegions);
  } catch { return false; }
}
function updateNativeInputRouting() {
  if (!window || window.isDestroyed() || !rendererReady || !window.isVisible()) {
    setInputEnabled(false, 'renderer-not-visible');
    return;
  }
  // Do not ask the renderer to toggle setIgnoreMouseEvents on every forwarded
  // mouse move. On macOS a transparent ignored BrowserWindow can stop
  // forwarding the very event needed to make it interactive, which causes a
  // click/hover race and apparent window flight. The main process owns this
  // state and polls the stable screen-coordinate hit rectangle instead.
  const next = !!nativeDrag || externalDropActive || !!nativeShareHost?.active || surfaceExpanded || cursorInsideHitRegion();
  setInputEnabled(next, next ? (nativeDrag ? 'native-drag' : externalDropActive ? 'external-file-drop' : nativeShareHost?.active ? 'native-share' : surfaceExpanded ? 'expanded-surface' : 'role-hit-region') : 'outside-role');
  sendCursor();
}
function writeInputRoutingDiagnostic() {
  if (!layoutTest || !window || window.isDestroyed()) return;
  try {
    save(path.join(dataDir, 'input-routing.json'), {
      mode: 'native-screen-hit-region',
      enabled: inputEnabled,
      reason: inputRoutingReason,
      rendererReady,
      layoutConfigReady,
      layoutReady,
      requestedWidgetSize: lastWidgetSize,
      visible: window.isVisible(),
      surfaceExpanded,
      surfaceReason,
      nativeDrag: !!nativeDrag,
      contentBounds: window.getContentBounds(),
      hitRegions,
      at: new Date().toISOString(),
    });
  } catch {}
}
function interactionFrame() {
  return window && !window.isDestroyed() ? window.getBounds() : null;
}
function interactionDelay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function interactionMouseMove(x, y) {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getContentBounds();
  syntheticCursorScreen = { x: bounds.x + Number(x), y: bounds.y + Number(y) };
  updateNativeInputRouting();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: Number(x), y: Number(y) });
}
async function interactionRendererEval(source) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('renderer unavailable');
  return window.webContents.executeJavaScript(source, true);
}
async function captureInteractionScreenshot(name) {
  if (!layoutTest || !window || window.isDestroyed()) return null;
  const image = await window.webContents.capturePage();
  const folder = path.join(dataDir, 'screenshots');
  await fs.promises.mkdir(folder, { recursive: true });
  const target = path.join(folder, `${name}.png`);
  await fs.promises.writeFile(target, image.toPNG());
  return target;
}
async function waitForInteractionFrame(width, height) {
  let frame = interactionFrame();
  for (let i = 0; i < 80; i += 1) {
    frame = interactionFrame();
    if (frame && Math.abs(frame.width - width) <= 2 && Math.abs(frame.height - height) <= 2) return frame;
    await interactionDelay(20);
  }
  return frame;
}
async function waitForInteractionReady() {
  for (let i = 0; i < 120; i += 1) {
    if (rendererReady && layoutReady && window && !window.isDestroyed() && window.isVisible()) return true;
    await interactionDelay(20);
  }
  return false;
}
async function waitForInteractionLayout(width, height) {
  let frame = interactionFrame();
  let dom = null;
  for (let i = 0; i < 100; i += 1) {
    frame = interactionFrame();
    dom = await interactionRendererEval("(() => { const root=document.querySelector('.dshwv-root')?.getBoundingClientRect(),html=document.documentElement; return {root:root&&{width:root.width,height:root.height},viewport:{width:html.clientWidth,height:html.clientHeight}}; })()");
    if (frame && dom?.root && dom?.viewport && Math.abs(frame.width - width) <= 2 && Math.abs(frame.height - height) <= 2 && Math.abs(dom.root.width - width) <= 2 && Math.abs(dom.root.height - height) <= 2 && Math.abs(dom.viewport.width - width) <= 2 && Math.abs(dom.viewport.height - height) <= 2) return { frame, dom };
    await interactionDelay(20);
  }
  return { frame, dom };
}
async function runInteractionTest() {
  if (interactionTestStarted || !window || window.isDestroyed()) return;
  interactionTestStarted = true;
  const evidence = { version: 'desktop-interaction-3', syntheticInputOnly: true, osPointerValidated: false, pass: false, screenshots: [], steps: [] };
  try {
    const startupReady = await waitForInteractionReady();
    const readiness = { rendererReady, layoutConfigReady, layoutReady, visible: !!window && !window.isDestroyed() && window.isVisible(), frame: interactionFrame(), contentBounds: window && !window.isDestroyed() ? window.getContentBounds() : null };
    evidence.steps.push({ name: 'packaged-window-layout-ready-before-input', pass: startupReady, readiness });
    if (!startupReady) throw new Error(`packaged window did not become interactive: ${JSON.stringify(readiness)}`);
    const initial = interactionFrame();
    const initialScale = Number(await interactionRendererEval("Number.parseFloat(getComputedStyle(document.querySelector('.dshwv-root')).getPropertyValue('--dshw-scale'))")) || 1.5;
    setInputEnabled(true, 'interaction-test-hover');
    const initialRolePoint = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r ? {x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)} : null; })()");
    if (initialRolePoint) interactionMouseMove(initialRolePoint.x, initialRolePoint.y);
    await interactionDelay(220);
    const hoverButtons = await interactionRendererEval("(() => { const c=document.querySelector('.dshwv-chat-btn'),m=document.querySelector('.dshwv-menu-btn'); const r=c?.getBoundingClientRect(); return {chat:!!c&&c.classList.contains('dshwv-chat-btn-visible'),menu:!!m&&m.classList.contains('dshwv-menu-btn-visible'),chatRect:r&&{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}}; })()");
    if (hoverButtons?.chatRect) interactionMouseMove(hoverButtons.chatRect.x, hoverButtons.chatRect.y);
    await interactionDelay(220);
    evidence.screenshots.push(await captureInteractionScreenshot('widget-initial'));
    const hoverFrame = interactionFrame();
    const hoverStable = !!initial && !!hoverFrame && JSON.stringify({ x: initial.x, y: initial.y, width: initial.width, height: initial.height }) === JSON.stringify({ x: hoverFrame.x, y: hoverFrame.y, width: hoverFrame.width, height: hoverFrame.height });
    evidence.steps.push({ name: 'real-page-hover-reveals-buttons-without-native-resize', pass: hoverStable && hoverButtons?.chat && hoverButtons?.menu, before: initial, after: hoverFrame, buttons: hoverButtons });

    const scaleResults = [];
    const sequence = [1.5, 0.6, 2.5, 1.0, 1.5];
    for (let cycle = 0; cycle < 20; cycle += 1) for (const scale of sequence) {
      const before = interactionFrame();
      const expectedAnchor = before ? widgetScreenAnchor(before, widgetAnchorRatio) : null;
      await interactionRendererEval(`window.__whaleRenderTest?.scale(${scale})`);
      const expected = Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.round(250 * scale)));
      const expectedFrame = before ? resizeKeepingWidgetAnchor(before, expected, expected, workAreaFor(before), widgetAnchorRatio, expectedAnchor, MIN_WIDGET_SIZE) : null;
      const settledLayout = await waitForInteractionLayout(expected, expected);
      const frame = settledLayout.frame;
      const dom = await interactionRendererEval("(() => { const root=document.querySelector('.dshwv-root')?.getBoundingClientRect(); const img=document.querySelector('.dshwv-img')?.getBoundingClientRect(); const html=document.documentElement,style=getComputedStyle(html); return {root:root && {left:root.left,top:root.top,width:root.width,height:root.height}, image:img && {left:img.left,top:img.top,width:img.width,height:img.height}, viewport:{width:html.clientWidth,height:html.clientHeight}, overflowX:style.overflowX,overflowY:style.overflowY,scrollWidth:html.scrollWidth,scrollHeight:html.scrollHeight}; })()");
      const actualAnchor = frame ? widgetScreenAnchor(frame, widgetAnchorRatio) : null;
      const targetAnchor = expectedFrame ? widgetScreenAnchor(expectedFrame, widgetAnchorRatio) : null;
      const sizePass = !!frame && !!dom?.root && Math.abs(dom.root.width - expected) <= 3 && Math.abs(dom.root.height - expected) <= 3 && Math.abs(frame.width - expected) <= 3 && Math.abs(frame.height - expected) <= 3;
      const anchorPass = !!expectedFrame && !!frame && !!actualAnchor && !!targetAnchor && Math.abs(actualAnchor.x - targetAnchor.x) <= 1 && Math.abs(actualAnchor.y - targetAnchor.y) <= 1;
      const rootInViewport = !!dom?.viewport && dom.root.left >= -2 && dom.root.top >= -2 && dom.root.left + dom.root.width <= dom.viewport.width + 2 && dom.root.top + dom.root.height <= dom.viewport.height + 2;
      const visiblePass = !!dom?.image && dom.image.width > 0 && dom.image.height > 0 && dom.image.left >= dom.root.left - 2 && dom.image.top >= dom.root.top - 2 && dom.image.left + dom.image.width <= dom.root.left + dom.root.width + 2 && dom.image.top + dom.image.height <= dom.root.top + dom.root.height + 2 && rootInViewport && dom.overflowX === 'hidden' && dom.overflowY === 'hidden';
      scaleResults.push({ cycle, scale, expected, anchorBefore: expectedAnchor, anchorAfter: actualAnchor, frame, dom, sizePass, anchorPass, visiblePass });
      if (!sizePass || !anchorPass || !visiblePass) {
        evidence.steps.push({ name: 'same-run-scale-roundtrip-first-failure', pass: false, cycle, scale, expected, frame, dom, sizePass, anchorPass, visiblePass });
        throw new Error(`scale ${scale} did not settle within the native layout contract`);
      }
    }
    evidence.steps.push({ name: 'same-run-20-cycle-scale-roundtrip', pass: scaleResults.length === 100 && scaleResults.every(step => step.sizePass && step.anchorPass && step.visiblePass), cycles: 20, sequence, failures: scaleResults.filter(step => !step.sizePass || !step.anchorPass || !step.visiblePass), samples: scaleResults.filter(step => step.cycle === 0 || step.cycle === 19) });

    const menuRolePoint = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r&&{x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)}; })()");
    if (menuRolePoint) interactionMouseMove(menuRolePoint.x, menuRolePoint.y);
    await interactionDelay(100);
    const beforeMenuFrame = interactionFrame();
    const beforeMenuDom = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(),b=document.querySelector('.dshwv-menu-btn')?.getBoundingClientRect(); return r&&b ? {left:r.left,right:r.right,bottom:r.bottom,buttonX:Math.round(b.left+b.width/2),buttonY:Math.round(b.top+b.height/2)} : null; })()");
    if (beforeMenuDom) {
      interactionMouseMove(beforeMenuDom.buttonX, beforeMenuDom.buttonY);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: beforeMenuDom.buttonX, y: beforeMenuDom.buttonY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: beforeMenuDom.buttonX, y: beforeMenuDom.buttonY, button: 'left', clickCount: 1 });
    }
    let menuOpened = false;
    for (let i = 0; i < 60; i += 1) {
      menuOpened = await interactionRendererEval("!!document.querySelector('.dshwv-menu')?.classList.contains('dshwv-menu-open')");
      if (menuOpened) break;
      await interactionDelay(25);
    }
    await interactionDelay(300);
    if (menuOpened) evidence.screenshots.push(await captureInteractionScreenshot('menu-open'));
    const menuFrame = interactionFrame();
    const menuDom = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r && {left:r.left,right:r.right,bottom:r.bottom}; })()");
    const menuRoleStable = !!beforeMenuFrame && !!menuFrame && !!beforeMenuDom && !!menuDom && Math.abs(beforeMenuFrame.x + (beforeMenuDom.left+beforeMenuDom.right)/2 - (menuFrame.x + (menuDom.left+menuDom.right)/2)) <= 3 && Math.abs(beforeMenuFrame.y + beforeMenuDom.bottom - (menuFrame.y + menuDom.bottom)) <= 3;
    evidence.steps.push({ name: 'native-input-opens-menu-and-keeps-role-anchor', pass: menuOpened && menuRoleStable, opened: menuOpened, before: { frame: beforeMenuFrame, role: beforeMenuDom }, after: { frame: menuFrame, role: menuDom } });
    const menuCloseQueueBefore = await interactionRendererEval("window.__whaleRenderTest?.status() || null");
    const closeMenuPoint = await interactionRendererEval("(() => { const m=document.querySelector('.dshwv-menu')?.getBoundingClientRect(),w=innerWidth,h=innerHeight; const candidates=[{x:8,y:8},{x:w-8,y:8},{x:8,y:h-8},{x:w-8,y:h-8},{x:w/2,y:8},{x:8,y:h/2},{x:w-8,y:h/2}]; const ignored='.dshwv-menu,.dshwv-img,.dshwv-chat-btn,.dshwv-menu-btn,.dshwv-pop,.dshwv-rolelist,.dshwv-audiolist,dialog,#settings-dialog,.dshwv-qedit'; const p=candidates.find(p=>{ const e=document.elementFromPoint(p.x,p.y); return (!m||p.x<m.left||p.x>m.right||p.y<m.top||p.y>m.bottom)&&!(e&&e.closest&&e.closest(ignored)); }); return p&&{x:Math.round(p.x),y:Math.round(p.y),target:document.elementFromPoint(p.x,p.y)?.tagName||null}; })()");
    if (closeMenuPoint) {
      interactionMouseMove(closeMenuPoint.x, closeMenuPoint.y);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: closeMenuPoint.x, y: closeMenuPoint.y, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: closeMenuPoint.x, y: closeMenuPoint.y, button: 'left', clickCount: 1 });
    }
    let menuClosed = false, menuFrameRestored = false, closeMenuDom = null;
    for (let i = 0; i < 60; i += 1) {
      menuClosed = !(await interactionRendererEval("!!document.querySelector('.dshwv-menu')?.classList.contains('dshwv-menu-open')"));
      const currentFrame = interactionFrame();
      menuFrameRestored = !!currentFrame && !!beforeMenuFrame && Math.abs(currentFrame.width - beforeMenuFrame.width) <= 2 && Math.abs(currentFrame.height - beforeMenuFrame.height) <= 2;
      if (menuClosed && menuFrameRestored) break;
      await interactionDelay(25);
    }
    closeMenuDom = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r&&{left:r.left,right:r.right,bottom:r.bottom}; })()");
    const closeFrame = interactionFrame();
    const menuCloseQueueAfter = await interactionRendererEval("window.__whaleRenderTest?.status() || null");
    const menuCloseDoesNotActivatePet = !!menuCloseQueueBefore && !!menuCloseQueueAfter && menuCloseQueueBefore.epoch === menuCloseQueueAfter.epoch && menuCloseQueueBefore.shown === menuCloseQueueAfter.shown;
    const menuCloseAnchorStable = !!beforeMenuFrame && !!beforeMenuDom && !!closeMenuDom && !!closeFrame && Math.abs(beforeMenuFrame.x + (beforeMenuDom.left + beforeMenuDom.right) / 2 - (closeFrame.x + (closeMenuDom.left + closeMenuDom.right) / 2)) <= 3 && Math.abs(beforeMenuFrame.y + beforeMenuDom.bottom - (closeFrame.y + closeMenuDom.bottom)) <= 3;
    evidence.steps.push({ name: 'native-input-outside-click-closes-menu-without-activating-pet-and-restores-anchor', pass: menuClosed && menuFrameRestored && menuCloseAnchorStable && menuCloseDoesNotActivatePet, closed: menuClosed, compactFrameRestored: menuFrameRestored, anchorStable: menuCloseAnchorStable, doesNotActivatePet: menuCloseDoesNotActivatePet, outsidePoint: closeMenuPoint, before: { frame: beforeMenuFrame, role: beforeMenuDom }, after: { frame: closeFrame, role: closeMenuDom }, queueBefore: menuCloseQueueBefore, queueAfter: menuCloseQueueAfter });
    await interactionDelay(300);

    const defaultChatConfig = QuickChatConfig.storedConfig(values());
    const defaultChatPass = defaultChatConfig.provider === 'chatgpt';
    const openedBeforeSettings = fixtureOpenedLinks.length;
    await interactionRendererEval("window.dispatchEvent(new Event('whale-open-settings'))");
    let settingsOpened = false;
    for (let i = 0; i < 80; i += 1) {
      settingsOpened = await interactionRendererEval("!!document.querySelector('#settings-dialog')?.open");
      if (settingsOpened) break;
      await interactionDelay(25);
    }
    if (settingsOpened) await interactionRendererEval("(() => { const p=document.querySelector('[name=chatProvider]'),u=document.querySelector('[name=customChatUrl]'),n=document.querySelector('[name=customChatName]'),f=document.querySelector('#settings-form'); if(!p||!u||!n||!f)return false; p.value='custom'; p.dispatchEvent(new Event('change',{bubbles:true})); u.value='https://chat.example.test/from-settings'; u.dispatchEvent(new Event('input',{bubbles:true})); n.value='验收聊天'; n.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()");
    let savedChatConfig = QuickChatConfig.storedConfig(values());
    let settingsClosed = false;
    for (let i = 0; i < 100; i += 1) {
      savedChatConfig = QuickChatConfig.storedConfig(values());
      settingsClosed = await interactionRendererEval("!document.querySelector('#settings-dialog')?.open");
      if (savedChatConfig.provider === 'custom' && settingsClosed) break;
      await interactionDelay(25);
    }
    const settingsSurface = await interactionRendererEval("(() => ({title:document.querySelector('.dshwv-chat-btn')?.title,stored:localStorage.getItem('dshw-quick-chat'),error:document.querySelector('#settings-error')?.textContent||''}))()");
    const settingsSavePass = defaultChatPass && settingsOpened && settingsClosed && savedChatConfig.provider === 'custom' && savedChatConfig.customUrl === 'https://chat.example.test/from-settings' && settingsSurface?.title?.includes('验收聊天') && fixtureOpenedLinks.length === openedBeforeSettings;
    evidence.steps.push({ name: 'quick-chat-settings-default-edit-save-without-opening-browser', pass: settingsSavePass, initialProvider: defaultChatConfig.provider, saved: savedChatConfig, surface: settingsSurface, openedLinks: fixtureOpenedLinks.slice(openedBeforeSettings) });
    await interactionDelay(250);

    const chatFrameBefore = interactionFrame();
    const chatNativeContent = window.getContentBounds();
    const chatQueueBefore = await interactionRendererEval("window.__whaleRenderTest?.status() || null");
    const chatRolePoint = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r&&{x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)}; })()");
    let chatButton = null, chatHitRegionReady = false;
    if (chatRolePoint) {
      interactionMouseMove(8, 8);
      await interactionDelay(80);
      interactionMouseMove(chatRolePoint.x, chatRolePoint.y);
      for (let i = 0; i < 100; i += 1) {
        chatButton = await interactionRendererEval("(() => { const chat=document.querySelector('.dshwv-chat-btn'), settings=document.querySelector('.dshwv-menu-btn'); if(!chat||!settings||!chat.classList.contains('dshwv-chat-btn-visible'))return null; const c=chat.getBoundingClientRect(),s=settings.getBoundingClientRect(); return {x:Math.round(c.left+c.width/2),y:Math.round(c.top+c.height/2),left:c.left,top:c.top,right:c.right,bottom:c.bottom,settingsTop:s.top}; })()");
        chatHitRegionReady = !!chatButton && hitRegions.some(region => region.left <= chatButton.x && region.left + region.width >= chatButton.x && region.top <= chatButton.y && region.top + region.height >= chatButton.y);
        if (chatHitRegionReady) break;
        await interactionDelay(20);
      }
    }
    await interactionDelay(60);
    const chatRegionChecks = {
      visibleButton: !!chatButton,
      withinWebView: !!chatButton && chatButton.top >= 0 && chatButton.bottom <= chatNativeContent.height + 1,
      aboveSettingsButton: !!chatButton && chatButton.bottom <= chatButton.settingsTop,
      insideNativeHitRegion: chatHitRegionReady,
      nativeContentBounds: chatNativeContent,
    };
    const chatRegionPass = chatRegionChecks.visibleButton && chatRegionChecks.withinWebView && chatRegionChecks.aboveSettingsButton && chatRegionChecks.insideNativeHitRegion;
    const openedBeforeChat = fixtureOpenedLinks.length;
    const expectedChat = QuickChatConfig.resolveChatConfig(QuickChatConfig.storedConfig(values()));
    setInputEnabled(true, 'quick-chat-button-test');
    if (chatButton) {
      interactionMouseMove(chatButton.x, chatButton.y);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: chatButton.x, y: chatButton.y, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: chatButton.x, y: chatButton.y, button: 'left', clickCount: 1 });
      await interactionDelay(120);
    }
    evidence.screenshots.push(await captureInteractionScreenshot('quick-chat-button'));
    const chatQueueAfter = await interactionRendererEval("window.__whaleRenderTest?.status() || null");
    const chatFrameAfter = interactionFrame();
    const chatOpenedOnce = !!expectedChat && fixtureOpenedLinks.length === openedBeforeChat + 1 && fixtureOpenedLinks[openedBeforeChat] === expectedChat.url;
    const chatDidNotMoveOrClick = !!chatFrameBefore && !!chatFrameAfter && chatFrameBefore.x === chatFrameAfter.x && chatFrameBefore.y === chatFrameAfter.y && chatFrameBefore.width === chatFrameAfter.width && chatFrameBefore.height === chatFrameAfter.height && chatQueueBefore?.epoch === chatQueueAfter?.epoch;
    evidence.steps.push({ name: 'quick-chat-button-native-input-opens-once-without-moving-or-clicking-pet', pass: chatRegionPass && chatOpenedOnce && chatDidNotMoveOrClick, checks: { ...chatRegionChecks, chatRegionPass, chatOpenedOnce, chatDidNotMoveOrClick }, button: chatButton, expectedUrl: expectedChat?.url, hitRegions, opened: fixtureOpenedLinks.slice(openedBeforeChat), queueBefore: chatQueueBefore, queueAfter: chatQueueAfter, frameBefore: chatFrameBefore, frameAfter: chatFrameAfter });

    const role = await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r && {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom}; })()");
    const roleRegionPass = !!role && hitRegions.some(region => region.left <= role.left + 2 && region.top <= role.top + 2 && region.left + region.width >= role.right - 2 && region.top + region.height >= role.bottom - 2);
    evidence.steps.push({ name: 'role-hit-region-before-input', pass: roleRegionPass, role, hitRegions });
    setInputEnabled(true, 'synthetic-input-test');
    if (!role) throw new Error('role geometry missing for input test');
    const inputX = Math.round(role.x), inputY = Math.round(role.y);
    const sendRoleClick = async () => {
      interactionMouseMove(inputX, inputY);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: inputX, y: inputY, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: inputX, y: inputY, button: 'left', clickCount: 1 });
      await interactionDelay(900);
      return interactionRendererEval("window.__whaleRenderTest?.status() || null");
    };
    // Use a deterministic three-item queue, then drive it through the same
    // packaged BrowserWindow input path used by the smoke test. This keeps
    // random text and quota refreshes out of the click-state assertion.
    await interactionRendererEval("window.__whaleRenderTest?.queue([{kind:'custom',modules:[{type:'text',text:'A',size:6}]},{kind:'custom',modules:[{type:'text',text:'B',size:6}]},{kind:'custom',modules:[{type:'text',text:'C',size:6}]}])");
    const beforeClick = await interactionRendererEval("window.__whaleRenderTest?.status() || null");
    const afterClick = await sendRoleClick();
    const clickPass = !!beforeClick && !!afterClick && afterClick.shown === true && afterClick.epoch !== beforeClick.epoch;
    evidence.steps.push({ name: 'synthetic-input-chain-click', pass: clickPass, before: beforeClick, after: afterClick });
    const afterSecondClick = await sendRoleClick();
    const secondClickPass = !!afterClick && !!afterSecondClick && afterSecondClick.shown === true && afterSecondClick.epoch !== afterClick.epoch;
    evidence.steps.push({ name: 'synthetic-input-chain-second-click-advances', pass: secondClickPass, first: afterClick, second: afterSecondClick });
    evidence.screenshots.push(await captureInteractionScreenshot('bubble-after-second-click'));
    await interactionRendererEval(`window.__whaleRenderTest?.scale(${initialScale})`);
    const restoredFrame = await waitForInteractionFrame(Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.round(250 * initialScale))), Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.round(250 * initialScale))));
    const restorePass = !!restoredFrame;
    evidence.steps.push({ name: 'restore-persisted-scale', pass: restorePass, initialScale, frame: restoredFrame });
    restoreWidget();
    const restoredReady = await waitForInteractionReady();
    const restoredRole = restoredReady ? await interactionRendererEval("(() => { const r=document.querySelector('.dshwv-img')?.getBoundingClientRect(); return r && {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; })()") : null;
    const restoredRoleRegionPass = !!restoredRole && hitRegions.some(region => region.left <= restoredRole.left + 2 && region.top <= restoredRole.top + 2 && region.left + region.width >= restoredRole.right - 2 && region.top + region.height >= restoredRole.bottom - 2);
    evidence.steps.push({ name: 'restore-widget-reports-role-hit-region', pass: restoredReady && restoredRoleRegionPass, restoredReady, role: restoredRole, hitRegions, frame: interactionFrame() });
    evidence.pass = evidence.steps.every(step => step.pass);
  } catch (error) {
    evidence.error = String(error?.message || error).slice(0, 300);
  }
  try { save(path.join(dataDir, 'interaction-test.json'), evidence); } catch {}
  syntheticCursorScreen = null;
  updateNativeInputRouting();
}
function visibility() {
  if (!window || window.isDestroyed()) return;
  // Do not reveal a window whose first DOM measurement still reflects the
  // 1.5 fallback while the persisted scale asks for another size. This avoids
  // a clipped first frame and makes the ready handshake include layout.
  if (rendererReady && layoutReady && !manuallyHidden) {
    if (!window.isVisible()) window.showInactive();
    if (startup.phases.interactive == null) {
      markStartup('interactive');
      writeStartup();
    }
  } else if (window.isVisible()) window.hide();
}
function show() { manuallyHidden = false; visibility(); }
function hide() { manuallyHidden = true; if (window && !window.isDestroyed()) window.hide(); }
function toggle() { manuallyHidden ? show() : hide(); }
function restoreWidget() {
  manuallyHidden = false;
  const frame = defaultFrame();
  widgetAnchorRatio = ROLE_ANCHOR_RATIO;
  widgetAnchor = widgetScreenAnchor(frame, widgetAnchorRatio);
  if (window && !window.isDestroyed()) {
    surfaceExpanded = false;
    surfaceReason = 'restore-widget';
    // Do not let the old page remain visible or keep its old hit rectangles
    // while BrowserWindow.reload() is asynchronous. The new renderer must
    // complete whale-ready and report the role region again before input is
    // enabled.
    rendererReady = false;
    layoutConfigReady = false;
    layoutReady = false;
    lastWidgetSize = '';
    lastNativeWidgetSize = '';
    lastNativeRootOffset = '';
    lastCursor = '';
    hitRegions = [];
    window.setBounds(frame);
    setInputEnabled(false, 'restore-widget');
    scheduleFrameSave();
    window.webContents.reload();
  }
  visibility();
}
function isMainFrame(event) { return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame; }
async function openWebLink(value, gestureRequired = true) {
  if (gestureRequired && (!trustedGestureAt || Date.now() - trustedGestureAt > 1000)) return false;
  trustedGestureAt = 0;
  let target = value;
  if (value === 'whale://widget/provider-dashboard') {
    try { target = dispatcher.whale.config.resolve().dashboardUrl; } catch { return false; }
  }
  const url = externalWebUrl(target);
  if (!url) return false;
  try {
    if (fixture || interactionTest) fixtureOpenedLinks.push(url);
    else await shell.openExternal(url);
    return true;
  } catch { return false; }
}
async function openQuickChat(event, input) {
  if (!isMainFrame(event) || !trustedQuickChatAt || Date.now() - trustedQuickChatAt > 1000) {
    trustedQuickChatAt = 0;
    return { ok: false, error: '请直接点击快速聊天按钮后重试' };
  }
  trustedQuickChatAt = 0;
  const config = input === undefined ? QuickChatConfig.storedConfig(values()) : QuickChatConfig.parseChatConfig(input);
  const target = QuickChatConfig.resolveChatConfig(config);
  if (!target) return { ok: false, error: '快速聊天网址无效，请在设置中填写 HTTPS 地址' };
  try {
    if (fixture || interactionTest) fixtureOpenedLinks.push(target.url);
    else await shell.openExternal(target.url);
    return { ok: true, provider: target.provider };
  } catch { return { ok: false, error: '系统默认浏览器无法打开该网址，请稍后重试' }; }
}
function resizeKeepingBottomRight(width, height) {
  if (!window || window.isDestroyed() || nativeDrag) return null;
  const current = window.getBounds();
  const target = resizeFrameKeepingBottomRight(current, width, height, workAreaFor(current), MIN_WIDGET_SIZE);
  if (target.width === current.width && target.height === current.height && target.x === current.x && target.y === current.y) return target;
  window.setBounds(target);
  scheduleFrameSave();
  sendCursor(true);
  updateNativeInputRouting();
  return target;
}
function resizeWidgetAroundAnchor(width, height, requestedRatio = widgetAnchorRatio) {
  if (!window || window.isDestroyed() || nativeDrag) return null;
  const current = window.getBounds();
  const ratio = Number.isFinite(requestedRatio) && requestedRatio >= 0 && requestedRatio <= 1 ? requestedRatio : ROLE_ANCHOR_RATIO;
  const anchor = widgetAnchor || widgetScreenAnchor(current, widgetAnchorRatio);
  const target = resizeKeepingWidgetAnchor(current, width, height, workAreaFor(current), ratio, anchor, MIN_WIDGET_SIZE);
  widgetAnchorRatio = ratio;
  widgetAnchor = widgetScreenAnchor(target, ratio);
  if (target.width === current.width && target.height === current.height && target.x === current.x && target.y === current.y) return target;
  window.setBounds(target);
  scheduleFrameSave();
  sendCursor(true);
  updateNativeInputRouting();
  return target;
}
function confirmWidgetLayout() {
  if (!layoutConfigReady || !lastWidgetSize || !window || window.isDestroyed()) return false;
  if (surfaceExpanded || nativeDrag) return layoutReady;
  const [width, height] = lastWidgetSize.split('x').map(Number);
  if (![width, height].every(Number.isFinite)) return false;
  const actual = window.getContentBounds();
  const area = workAreaFor(actual);
  layoutReady = widgetSizeApplied({ width, height }, actual, area, MIN_WIDGET_SIZE, 2);
  if (layoutReady) visibility();
  writeInputRoutingDiagnostic();
  writeStartup();
  return layoutReady;
}
function requestRendererLayout() {
  if (window && !window.isDestroyed() && rendererReady) {
    try { window.webContents.send('whale-layout-request'); } catch {}
  }
}
function sendNativeRootOffset(left, top) {
  if (!window || window.isDestroyed() || !rendererReady) return;
  const value = { left: Math.round(Number(left) || 0), top: Math.round(Number(top) || 0) };
  const key = value.left + ',' + value.top;
  if (key === lastNativeRootOffset) return;
  lastNativeRootOffset = key;
  try { window.webContents.send('whale-native-root-offset', value); } catch {}
}
function compactWidgetDimensions() {
  if (lastWidgetSize) {
    const values = lastWidgetSize.split('x').map(Number);
    if (values.length === 2 && values.every(Number.isFinite)) return values;
  }
  const size = configuredWidgetSize();
  return [size, size];
}
function reportNativeWidgetSize(requestedWidth, requestedHeight) {
  if (!window || window.isDestroyed() || surfaceExpanded || !rendererReady) return;
  const native = window.getContentBounds();
  const constrained = native.width + 2 < requestedWidth || native.height + 2 < requestedHeight;
  const key = native.width + 'x' + native.height + ':' + constrained;
  if (key === lastNativeWidgetSize) return;
  lastNativeWidgetSize = key;
  try { window.webContents.send('whale-native-widget-size', { width: native.width, height: native.height, constrained }); } catch {}
}
function applySurfaceGeometry(expanded) {
  if (!window || window.isDestroyed() || nativeDrag) return;
  if (expanded) {
    const before = window.getBounds();
    const screenAnchor = widgetAnchor || widgetScreenAnchor(before, widgetAnchorRatio);
    const target = resizeKeepingBottomRight(760, 700) || window.getBounds();
    const [width, height] = compactWidgetDimensions();
    // The role is laid out at the compact root's bottom/right. Preserve its
    // pre-expansion screen anchor when the expanded frame fits; when the
    // display edge clamps that frame, clamp the local offset to the feasible
    // part of the new content instead of moving the role to the new corner.
    const offset = surfaceRootOffset(target, width, height, screenAnchor, widgetAnchorRatio);
    sendNativeRootOffset(offset.left, offset.top);
  } else {
    const [width, height] = compactWidgetDimensions();
    resizeWidgetAroundAnchor(width, height);
    sendNativeRootOffset(0, 0);
  }
  requestRendererLayout();
}
function setSurface(expanded, reason) {
  if (!window || window.isDestroyed()) return;
  const next = !!expanded;
  surfaceReason = typeof reason === 'string' && reason ? reason.slice(0, 80) : (next ? 'expanded-surface' : 'none');
  if (surfaceExpanded === next && pendingSurface === null) return;
  surfaceExpanded = next;
  if (nativeDrag) {
    // Keep the newest request. Applying it from endNativeDrag avoids a
    // permanently expanded flag when a menu opens during a gesture.
    pendingSurface = next;
    return;
  }
  pendingSurface = null;
  applySurfaceGeometry(next);
  if (!next && pendingWidgetSize) {
    const pending = pendingWidgetSize;
    pendingWidgetSize = null;
    setWidgetSize(pending);
  }
}
function setWidgetSize(size) {
  // The page reports its content geometry in one direction only. It must never
  // resize the native window while a native drag is in progress.
  if (!layoutConfigReady || !size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
  const width = Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.ceil(Number(size.requestedWidth) || Number(size.width))));
  const height = Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.ceil(Number(size.requestedHeight) || Number(size.height))));
  const key = width + 'x' + height;
  const ratio = Number.isFinite(size.anchorRatioX) && size.anchorRatioX >= 0 && size.anchorRatioX <= 1 ? Number(size.anchorRatioX) : widgetAnchorRatio;
  if (surfaceExpanded || nativeDrag) { pendingWidgetSize = { ...size, requestedWidth: width, requestedHeight: height, anchorRatioX: ratio }; return; }
  const sameRequest = key === lastWidgetSize && Math.abs(ratio - widgetAnchorRatio) < 0.0001;
  if (sameRequest && layoutReady) return;
  if (!sameRequest) {
    lastWidgetSize = key;
    layoutReady = false;
    resizeWidgetAroundAnchor(width, height, ratio);
  }
  // A duplicate renderer report must still confirm a native resize that may
  // have completed after the original setBounds call.
  confirmWidgetLayout();
  reportNativeWidgetSize(width, height);
  writeLayoutDiagnostic();
  visibility();
}
function cursorScreenPoint(fallback) {
  try {
    const point = screen.getCursorScreenPoint();
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) return point;
  } catch {}
  return fallback;
}
function startNativeDrag(point) {
  if (!window || window.isDestroyed() || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const cursor = cursorScreenPoint(point);
  nativeDrag = { x: cursor.x, y: cursor.y, frame: window.getBounds(), widgetAnchor: widgetAnchor ? { ...widgetAnchor } : widgetScreenAnchor(window.getBounds(), widgetAnchorRatio), moved: false };
  setInputEnabled(true, 'native-drag');
}
function moveNativeDrag(point) {
  if (!nativeDrag || !window || window.isDestroyed()) return;
  const cursor = cursorScreenPoint(point);
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return;
  const movement = nativeDragMovement({ x: nativeDrag.x, y: nativeDrag.y }, cursor, nativeDrag.moved, 3);
  nativeDrag.moved = movement.moved;
  if (!movement.shouldMove) return;
  if (!nativeDrag.notifiedMoved) {
    nativeDrag.notifiedMoved = true;
    try { window.webContents.send('whale-native-drag-moved'); } catch {}
  }
  const frame = nativeDrag.frame;
  window.setPosition(Math.round(frame.x + movement.dx), Math.round(frame.y + movement.dy));
}
function endNativeDrag() {
  if (!nativeDrag) return;
  const completed = nativeDrag.moved;
  const gesture = nativeDrag;
  nativeDrag = null;
  if (completed) {
    const frame = window.getBounds();
    widgetAnchor = { x: gesture.widgetAnchor.x + frame.x - gesture.frame.x, y: gesture.widgetAnchor.y + frame.y - gesture.frame.y };
    scheduleFrameSave();
  }
  writeLayoutDiagnostic();
  if (pendingSurface !== null) {
    const next = pendingSurface;
    pendingSurface = null;
    applySurfaceGeometry(next);
  }
  if (!surfaceExpanded && pendingWidgetSize) {
    const pending = pendingWidgetSize;
    pendingWidgetSize = null;
    setWidgetSize(pending);
  }
  updateNativeInputRouting();
  requestRendererLayout();
}
function writeLayoutDiagnostic() {
  if (!layoutTest || !lastLayoutDiagnostic || !window || window.isDestroyed()) return;
  try { save(path.join(dataDir, 'layout-diagnostic.json'), { ...lastLayoutDiagnostic, nativeFrame: window.getBounds(), at: new Date().toISOString() }); } catch {}
}
function handleDisplayChange() {
  if (!window || window.isDestroyed() || surfaceExpanded) return;
    lastWidgetSize = '';
    lastNativeWidgetSize = '';
    pendingWidgetSize = null;
  const fixed = clampFrame(window.getBounds());
  const current = window.getBounds();
  if (JSON.stringify(fixed) !== JSON.stringify(current)) window.setBounds(fixed);
  widgetAnchor = widgetScreenAnchor(fixed, widgetAnchorRatio);
  scheduleFrameSave();
}
function importLegacyFiles() {
  const marker = path.join(dataDir, 'legacy-files-imported.json');
  if (fs.existsSync(marker) || fixture || layoutTest) return;
  const candidates = [
    path.join(os.homedir(), '.codex', 'whale-widget'),
    path.join(os.homedir(), '.codex', 'whale-widget', 'profiles', 'web'),
  ];
  const names = ['api-settings.json', '.dshw-size.json', '.dshw-bubble.json', 'ui-state.json'];
  const copied = [];
  for (const name of names) {
    const target = path.join(dataDir, name);
    if (fs.existsSync(target)) continue;
    for (const sourceRoot of candidates) {
      const source = path.join(sourceRoot, name);
      try {
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        if (name === 'ui-state.json') storeValues(read(target, {}));
        copied.push(name);
        break;
      } catch {}
    }
  }
  try { save(marker, { version: 1, copied, at: new Date().toISOString() }); } catch {}
}

if (!lock) {
  app.quit();
} else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.whenReady().then(async () => {
    markStartup('appReady');
    if (layoutTest) {
      try { save(path.join(dataDir, 'runtime-environment.json'), { platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, appPackaged: app.isPackaged, appPath: app.getAppPath(), executablePath: process.execPath, at: new Date().toISOString() }); } catch {}
    }
    const { createDispatcher, UI_ORIGIN } = await import(pathToFileURL(path.join(root, 'runtime', 'dispatcher.mjs')));
    const { startBridge } = await import(pathToFileURL(path.join(root, 'runtime', 'bridge.mjs')));
    dispatcher = createDispatcher({
      dataDir,
      fetchImpl: (url, options) => net.fetch(url, options),
      openExternal: url => shell.openExternal(url),
      onShow: show,
      statusInfo: () => ({ standalone: true, hostAlive: false, visible: !!window?.isVisible(), rendering: null }),
      monitor: true,
      autoRefresh: true,
    });
    markStartup('dispatcherReady');
    importLegacyFiles();
    session.defaultSession.protocol.handle('whale', async request => {
      const url = new URL(request.url);
      if (url.host !== 'widget') return new Response('', { status: 403 });
      const result = await dispatcher.dispatch(url.pathname + url.search, {
        method: request.method,
        body: ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer()),
        headers: Object.fromEntries(request.headers),
      });
      return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers: result.headers });
    });
    const frame = initialFrame();
    const savedGeometry = readWindowState();
    widgetAnchorRatio = Number.isFinite(savedGeometry.widgetAnchorRatio) && savedGeometry.widgetAnchorRatio >= 0 && savedGeometry.widgetAnchorRatio <= 1 ? savedGeometry.widgetAnchorRatio : ROLE_ANCHOR_RATIO;
    widgetAnchor = widgetScreenAnchor(frame, widgetAnchorRatio);
    window = new BrowserWindow({
      ...frame,
      transparent: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      show: false,
      title: 'AI Balance Whale',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        additionalArguments: layoutTest ? ['--whale-render-test'] : [],
      },
    });
    nativeShareHost = createNativeShareHost({
      app, window, screen, platform: process.platform, fixture,
      onActive: () => updateNativeInputRouting(),
      onOpened: detail => {
        if (!layoutTest) return;
        try { save(path.join(dataDir, 'share-ui-diagnostic.json'), { platform: detail.platform, fileCount: detail.fileCount, fixture: !!detail.fixture, at: new Date().toISOString() }); } catch {}
      },
    });
    markStartup('windowCreated');
    window.setMenuBarVisibility(false);
    applyAlwaysOnTop();
    window.once('ready-to-show', () => markStartup('frameReady'));
    window.on('show', () => { invalidate(); sendCursor(true); });
    window.on('resize', () => { invalidate(); sendCursor(true); confirmWidgetLayout(); updateNativeInputRouting(); });
    window.on('move', scheduleFrameSave);
    window.on('moved', scheduleFrameSave);
    window.on('closed', () => { window = null; });
    window.webContents.on('console-message', (_event, ...args) => {
      if (!layoutTest) return;
      const detail = args[0];
      const level = typeof detail === 'object' ? detail.level : detail;
      if (!(level === 3 || level === 'error')) return;
      const raw = typeof detail === 'object' ? detail.message : args[1];
      const message = String(raw || 'renderer console error')
        .replace(/(authorization|bearer|cookie|token|auth\.json)\s*[:=]\s*[^\s,;]+/ig, '$1=<redacted>')
        .slice(0, 500);
      rendererErrors.push({ message, line: Number(args[2]) || null, source: String(args[3] || '').slice(0, 200) });
      while (rendererErrors.length > 20) rendererErrors.shift();
      try { save(path.join(dataDir, 'renderer-errors.json'), { errors: rendererErrors, at: new Date().toISOString() }); } catch {}
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      rendererReady = false;
      layoutConfigReady = false;
      layoutReady = false;
      hitRegions = [];
      lastNativeRootOffset = '';
      pendingSurface = null;
      pendingWidgetSize = null;
      setInputEnabled(false, 'renderer-gone');
      try { save(path.join(dataDir, 'renderer-gone.json'), { at: new Date().toISOString(), reason: details?.reason || 'unknown' }); } catch {}
      if (!quitting && !window.isDestroyed()) setTimeout(() => { if (!window.isDestroyed()) window.webContents.reload(); }, 500);
    });
    window.webContents.on('did-start-loading', () => {
      rendererReady = false;
      layoutConfigReady = false;
      layoutReady = false;
      hitRegions = [];
      lastNativeRootOffset = '';
      pendingSurface = null;
      pendingWidgetSize = null;
      if (surfaceExpanded) {
        surfaceExpanded = false;
        surfaceReason = 'navigation-start';
        const [width, height] = compactWidgetDimensions();
        resizeKeepingBottomRight(width, height);
      }
      setInputEnabled(false, 'navigation-start');
      setKeyboardFocus(false);
    });
    window.webContents.setWindowOpenHandler(({ url }) => { openWebLink(url).catch(() => {}); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(UI_ORIGIN + '/')) event.preventDefault(); });
    session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));

    ipcMain.on('whale-storage', event => { event.returnValue = event.sender === window?.webContents ? values() : {}; });
    ipcMain.on('whale-save-storage', (event, input) => { if (event.sender === window?.webContents) storeValues(input); });
    ipcMain.on('whale-user-gesture', event => { if (isMainFrame(event)) trustedGestureAt = Date.now(); });
    ipcMain.handle('whale-open-external', (event, url) => isMainFrame(event) ? openWebLink(url) : false);
    ipcMain.on('whale-quick-chat-gesture', event => { if (isMainFrame(event)) trustedQuickChatAt = Date.now(); });
    ipcMain.handle('whale-open-quick-chat', (event, config) => openQuickChat(event, config));
    ipcMain.handle('whale-save-chat-config', async (event, input) => {
      if (!isMainFrame(event)) return { ok: false, error: '不允许的本地操作来源' };
      const patch = QuickChatConfig.mergeStoredConfig(values(), input);
      if (!patch) return { ok: false, error: '快速聊天网址无效：仅支持 HTTPS，且不能包含用户名或密码' };
      const previous = values();
      storeValues(patch);
      try { await uiStore.flush(); return { ok: true, config: QuickChatConfig.storedConfig(values()) }; }
      catch {
        storeValues(previous);
        try { await uiStore.flush(); } catch {}
        return { ok: false, error: '快速聊天设置写入失败；原有设置未被替换' };
      }
    });
    ipcMain.handle('whale-share-files', (event, paths) => isMainFrame(event)
      ? nativeShareHost.share(paths)
      : { ok: false, code: 'invalid-source', message: '不允许的本地操作来源' });
    ipcMain.handle('whale-test-share-files', (event, paths) => layoutTest && isMainFrame(event)
      ? nativeShareHost.share(paths)
      : { ok: false, code: 'test-disabled', message: '仅测试构建允许此操作' });
    ipcMain.on('whale-external-drop-active', (event, active) => {
      if (!isMainFrame(event) || typeof active !== 'boolean') return;
      externalDropActive = active;
      updateNativeInputRouting();
    });
    ipcMain.on('whale-ready', event => {
      if (event.sender !== window?.webContents) return;
      markStartup('imageAndInputReady');
      rendererReady = true;
      // A reload can happen while the menu surface is expanded. Re-send the
      // current local root offset to the new DOM instead of relying on a stale
      // renderer cache.
      if (surfaceExpanded) {
        const [width, height] = compactWidgetDimensions();
        const bounds = window.getContentBounds();
        sendNativeRootOffset(Math.max(0, bounds.width - width), Math.max(0, bounds.height - height));
      } else sendNativeRootOffset(0, 0);
      updateNativeInputRouting();
      visibility();
      invalidate();
      sendCursor(true);
      writeInputRoutingDiagnostic();
      if (interactionTest && !interactionTestStarted) setTimeout(() => { runInteractionTest().catch(() => {}); }, 120);
    });
    ipcMain.on('whale-interactive', (event, enabled) => {
      if (event.sender !== window?.webContents || typeof enabled !== 'boolean') return;
      // Kept as a compatibility message for the shared UI. Standalone macOS
      // input is deliberately owned by updateNativeInputRouting(); accepting
      // renderer hover toggles here recreates the forwarding race.
      if (layoutTest) { inputRoutingReason = 'renderer-hover-ignored'; writeInputRoutingDiagnostic(); }
    });
    ipcMain.on('whale-keyboard-focus', (event, editing) => { if (event.sender === window?.webContents && typeof editing === 'boolean') setKeyboardFocus(editing); });
    ipcMain.on('whale-surface', (event, value) => {
      if (event.sender !== window?.webContents) return;
      if (typeof value === 'boolean') setSurface(value, value ? 'expanded-surface' : 'none');
      else if (value && typeof value === 'object') setSurface(value.expanded, value.reason);
    });
    ipcMain.on('whale-layout-ready', (event, size) => {
      if (event.sender !== window?.webContents) return;
      layoutConfigReady = true;
      if (size && typeof size === 'object') setWidgetSize(size);
      visibility();
    });
    ipcMain.on('whale-widget-size', (event, size) => { if (event.sender === window?.webContents) setWidgetSize(size); });
    ipcMain.on('whale-hit-region', (event, value) => {
      if (event.sender !== window?.webContents || !value || typeof value !== 'object') return;
      const input = Array.isArray(value.regions) ? value.regions : [value];
      const next = input.map(region => {
        if (!region || typeof region !== 'object') return null;
        const values = ['left', 'top', 'width', 'height'].map(key => Number(region[key]));
        if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0 || values[2] > 2000 || values[3] > 2000) return null;
        return { left: values[0], top: values[1], width: values[2], height: values[3] };
      }).filter(Boolean);
      if (!next.length) return;
      hitRegions = next;
      updateNativeInputRouting();
      writeInputRoutingDiagnostic();
    });
    ipcMain.on('whale-layout-diagnostic', (event, payload) => {
      if (!layoutTest || event.sender !== window?.webContents || !payload || typeof payload !== 'object') return;
      lastLayoutDiagnostic = payload;
      writeLayoutDiagnostic();
    });
    ipcMain.on('whale-drag-start', (event, point) => { if (event.sender === window?.webContents) startNativeDrag(point); });
    ipcMain.on('whale-drag-move', (event, point) => { if (event.sender === window?.webContents) moveNativeDrag(point); });
    ipcMain.on('whale-drag-end', event => { if (event.sender === window?.webContents) endNativeDrag(); });

    const iconPath = path.join(root, 'assets', 'DSniang1.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(icon);
    tray = new Tray(icon);
    if (process.platform === 'darwin' && typeof tray.setTemplateImage === 'function') tray.setTemplateImage(false);
    tray.setToolTip('AI Balance Whale');
    refreshTrayMenu();
    tray.on('double-click', toggle);
    globalShortcut.register(process.platform === 'darwin' ? 'Command+Option+W' : 'Control+Alt+W', toggle);
    screen.on('display-metrics-changed', handleDisplayChange);
    screen.on('display-removed', handleDisplayChange);
    try {
      bridge = await startBridge(dispatcher, { dataDir });
      markStartup("bridgeReady");
    } catch (error) {
      bridge = null;
      try { save(path.join(dataDir, "bridge-error.json"), { message: String(error?.message || error).slice(0, 350), at: new Date().toISOString() }); } catch {}
      markStartup("bridgeUnavailable");
    }
    await window.loadURL(UI_ORIGIN + '/widget.html');
    markStartup('pageLoaded');
    writeStartup();
    visibilityWatchdog = setInterval(visibility, 1000);
    if (visibilityWatchdog.unref) visibilityWatchdog.unref();
    inputRoutingWatchdog = setInterval(updateNativeInputRouting, 16);
    if (inputRoutingWatchdog.unref) inputRoutingWatchdog.unref();
    app.once('will-quit', () => {
      clearInterval(visibilityWatchdog);
      clearInterval(inputRoutingWatchdog);
      clearTimeout(frameSaveTimer);
      nativeShareHost?.close();
      globalShortcut.unregisterAll();
      screen.removeListener('display-metrics-changed', handleDisplayChange);
      screen.removeListener('display-removed', handleDisplayChange);
      tray?.destroy();
    });
  }).catch(error => {
    try { save(path.join(dataDir, 'desktop-error.json'), { message: String(error.message).slice(0, 350), at: new Date().toISOString() }); } catch {}
    app.exit(1);
  });
  app.on('window-all-closed', () => { if (!quitting) app.quit(); });
  app.on('before-quit', event => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    nativeShareHost?.close();
    try { if (window && !window.isDestroyed()) { window.setIgnoreMouseEvents(true); window.hide(); } } catch {}
    let finished = false;
    const finish = () => { if (finished) return; finished = true; app.exit(0); };
    const watchdog = setTimeout(finish, 6500);
    shutdownCompanion({
      readRenderer: () => window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed?.()
        ? window.webContents.executeJavaScript("Object.fromEntries(Object.keys(localStorage).filter(k => /^dshw[-v]/.test(k)).map(k => [k, localStorage.getItem(k)]))") : null,
      saveRenderer: storeValues,
      flushState: () => uiStore.flush(),
      closeBridge: () => bridge?.close(),
      closeDispatcher: () => dispatcher?.close(),
    }).catch(() => {}).finally(() => { clearTimeout(watchdog); finish(); });
  });
}
