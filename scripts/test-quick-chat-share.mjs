import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const chat = require(fileURLToPath(new URL('../desktop/quick-chat-config.cjs', import.meta.url)));
const share = require(fileURLToPath(new URL('../desktop/native-share.cjs', import.meta.url)));
const { createNativeShareHost } = require(fileURLToPath(new URL('../desktop/native-share-host.cjs', import.meta.url)));
const { chooseDropAction } = require(fileURLToPath(new URL('../desktop/drop-action.cjs', import.meta.url)));
const { createQuickChatWindowHost, parseWindowsDefaultBrowser } = require(fileURLToPath(new URL('../desktop/quick-chat-window.cjs', import.meta.url)));
const { UiStateStore } = require(fileURLToPath(new URL('../desktop/ui-state-store.cjs', import.meta.url)));

assert.deepEqual(chat.parseChatConfig(null), chat.DEFAULT_CHAT_CONFIG, 'fresh installs default to DeepSeek');
assert.equal(chat.parseChatConfig({ version: 1, provider: 'chatgpt' }).provider, 'chatgpt', 'legacy explicit choices survive schema upgrade');
assert.deepEqual(chat.storedConfig({ 'dshw-provider': 'deepseek', 'dshw-auth-status': 'connected' }), chat.DEFAULT_CHAT_CONFIG, 'legacy users receive a chat default without touching API/Auth settings');
assert.equal(chat.resolveChatConfig({ provider: 'chatgpt' }).url, 'https://chatgpt.com/');
assert.equal(chat.resolveChatConfig({ provider: 'grok' }).url, 'https://grok.com/');
assert.equal(chat.resolveChatConfig({ provider: 'deepseek' }).url, 'https://chat.deepseek.com/');
assert.equal(chat.resolveChatConfig({ provider: 'doubao' }).url, 'https://www.doubao.com/chat/');
assert.equal(chat.resolveChatConfig({ provider: 'yuanbao' }).url, 'https://yuanbao.tencent.com/chat/');
assert.equal(chat.resolveChatConfig({ provider: 'qwen' }).url, 'https://chat.qwen.ai/');

let config = chat.parseChatConfig({ provider: 'custom', customUrl: 'https://chat.example/path', customName: '私人服务' });
assert.equal(chat.resolveChatConfig(config).name, '私人服务');
config = chat.selectProvider(config, 'grok');
assert.equal(chat.resolveChatConfig(config).url, 'https://grok.com/');
config = chat.selectProvider(config, 'custom');
assert.equal(chat.resolveChatConfig(config).url, 'https://chat.example/path', 'preset switching retains the custom URL');
const mergedState = chat.mergeStoredConfig({ 'dshw-provider': 'deepseek', 'dshw-auth-status': 'connected', 'dshw-quick-chat': 'old' }, config);
assert.equal(chat.storedConfig(mergedState).customUrl, 'https://chat.example/path');
assert.equal(mergedState['dshw-provider'], 'deepseek');
assert.equal(mergedState['dshw-auth-status'], 'connected');
assert.equal(chat.mergeStoredConfig(mergedState, { provider: 'custom', customUrl: 'javascript:alert(1)' }), null, 'invalid changes cannot be persisted');

for (const unsafe of [
  'http://chat.example', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'custom://host/a',
  'https://user:pass@chat.example', 'https://chat.example\n.evil', 'https://',
]) assert.equal(chat.validateCustomUrl(unsafe), null, `unsafe URL accepted: ${unsafe}`);
assert.equal(chat.validateCustomUrl('https://chat.example').href, 'https://chat.example/');
assert.equal(chat.resolveChatConfig({ provider: 'custom', customUrl: '' }), null);
assert.equal(chat.resolveChatConfig({ provider: 'unknown' }).provider, 'deepseek', 'unknown provider values normalize to the safe default');

const chromeRegistry = '    ProgId    REG_SZ    ChromeHTML\r\n';
const chromeCommand = '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -- "%1"\r\n';
assert.deepEqual(parseWindowsDefaultBrowser(chromeRegistry, chromeCommand), {
  path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Chrome', source: 'windows-url-handler',
}, 'default Chrome profile resolution handles spaces in executable paths');
assert.equal(parseWindowsDefaultBrowser('ProgId REG_SZ FirefoxURL', chromeCommand), null, 'unsupported defaults do not claim Chrome profile reuse');

const launchedArgs = [];
const browserLaunch = createQuickChatWindowHost({
  platform: 'win32', BrowserWindowImpl: function FakeNativeWindow() {},
  detectBrowserImpl: async () => ({ path: 'C:\\Program Files\\Chrome\\chrome.exe', name: 'Chrome' }),
  spawnImpl: (exe, args, options) => {
    launchedArgs.push({ exe, args, options });
    const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
  },
});
const appModeResult = await browserLaunch.open('https://chat.example/path?a=1&b=2');
assert.equal(appModeResult.mode, 'browser-app');
assert.equal(appModeResult.cookieScope, 'default-browser-profile');
assert.deepEqual(launchedArgs[0].args, ['--app=https://chat.example/path?a=1&b=2', '--window-size=960,720', '--new-window'], 'browser app arguments preserve query characters without shell interpolation');
assert.equal(launchedArgs[0].options.shell, false);
assert.equal((await browserLaunch.open('javascript:alert(1)')).ok, false, 'mini-window host independently rejects unsafe schemes');

const macLaunches = [];
const macBrowserLaunch = createQuickChatWindowHost({
  platform: 'darwin', BrowserWindowImpl: function FakeNativeWindow() {},
  detectBrowserImpl: async () => ({ path: '/Applications/Google Chrome.app', name: 'Chrome' }),
  spawnImpl: (exe, args, options) => {
    macLaunches.push({ exe, args, options });
    const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
  },
});
const macAppModeResult = await macBrowserLaunch.open('https://chat.example/');
assert.equal(macAppModeResult.cookieScope, 'default-browser-profile');
assert.equal(macLaunches[0].exe, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'macOS invokes the selected browser bundle executable directly so app-mode arguments reach Chromium');
assert.deepEqual(macLaunches[0].args, ['--app=https://chat.example/', '--window-size=960,720', '--new-window']);
assert.equal(macLaunches[0].options.shell, false);

let fakeChatWindow;
class FakeChatWindow extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.visible = false; this.destroyed = false; this.url = '';
    this.webContents = {
      session: { setPermissionRequestHandler: handler => { this.permissionHandler = handler; } },
      setWindowOpenHandler: handler => { this.openHandler = handler; },
      on: () => {}, getURL: () => this.url,
    };
    fakeChatWindow = this;
  }
  async loadURL(url) { this.url = url; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  show() { this.visible = true; }
  focus() { this.focused = true; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}
const appSessionWindow = createQuickChatWindowHost({ platform: 'linux', BrowserWindowImpl: FakeChatWindow, detectBrowserImpl: async () => null });
const miniResult = await appSessionWindow.open('https://chat.example/first');
assert.equal(miniResult.mode, 'app-window');
assert.equal(miniResult.cookieScope, 'app-persistent-session');
assert.equal(fakeChatWindow.options.webPreferences.partition, 'persist:whale-quick-chat');
assert.equal(fakeChatWindow.openHandler({ url: 'javascript:alert(1)' }).action, 'deny');
assert.equal(fakeChatWindow.openHandler({ url: 'https://login.example/' }).action, 'allow');
await appSessionWindow.open('https://chat.example/second');
assert.equal(fakeChatWindow.url, 'https://chat.example/second', 'subsequent quick-chat actions reuse the same in-app window');
appSessionWindow.close();

const stateFile = path.join(os.tmpdir(), `whale-chat-state-${process.pid}.json`);
try {
  const initialStore = new UiStateStore(stateFile);
  const firstSaved = chat.mergeStoredConfig(initialStore.get(), { provider: 'custom', customUrl: 'https://chat.example/restart', customName: '重启保留' });
  initialStore.set({ ...firstSaved, 'dshw-provider': 'deepseek', 'dshw-auth-status': 'connected' });
  await initialStore.flush();
  const restartedStore = new UiStateStore(stateFile);
  assert.deepEqual(chat.storedConfig(restartedStore.get()), chat.parseChatConfig({ provider: 'custom', customUrl: 'https://chat.example/restart', customName: '重启保留' }), 'custom chat settings survive a new store instance');
  const secondSaved = chat.mergeStoredConfig(restartedStore.get(), chat.selectProvider(chat.storedConfig(restartedStore.get()), 'grok'));
  restartedStore.set(secondSaved);
  await restartedStore.flush();
  const secondRestart = new UiStateStore(stateFile);
  assert.equal(chat.storedConfig(secondRestart.get()).provider, 'grok');
  assert.equal(secondRestart.get()['dshw-provider'], 'deepseek', 'chat persistence must preserve quota provider and auth settings');
  assert.equal(secondRestart.get()['dshw-auth-status'], 'connected');
} finally { await fs.rm(stateFile, { force: true }); }

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-share-'));
try {
  const first = path.join(temp, '中文 空格 [A].txt');
  const second = path.join(temp, 'emoji-🫧.png');
  const empty = path.join(temp, 'empty-file.txt');
  const large = path.join(temp, 'large-sparse-file.bin');
  const folder = path.join(temp, 'folder');
  await fs.writeFile(first, 'fixture');
  await fs.writeFile(second, Buffer.from([0]));
  await fs.writeFile(empty, '');
  await fs.writeFile(large, 'x');
  await fs.truncate(large, 32 * 1024 * 1024);
  await fs.mkdir(folder);
  const checked = await share.validateDroppedPaths([first, second]);
  const canonicalPaths = [await fs.realpath(first), await fs.realpath(second)];
  let selectedDropAction = null, quickChatOpens = 0, shareCalls = 0, promptCalls = 0;
  const promptDrop = async context => { promptCalls += 1; assert.equal(context.canShare, true); assert.equal(context.fileCount, 2); return selectedDropAction; };
  selectedDropAction = 'quick-chat';
  const quickDropResult = await chooseDropAction([first, second], {
    prompt: promptDrop,
    share: paths => { shareCalls += 1; return { ok: true, status: 'opened', files: paths }; },
    openQuickChat: () => { quickChatOpens += 1; return { ok: true, status: 'opened-chat' }; },
  });
  assert.equal(quickDropResult.status, 'opened-chat');
  assert.equal(quickChatOpens, 1);
  assert.equal(shareCalls, 0, 'choosing chat does not invoke the OS share sheet or upload files');
  selectedDropAction = 'share';
  const shareDropResult = await chooseDropAction([first, second], {
    prompt: promptDrop,
    share: paths => { shareCalls += 1; return { ok: true, status: 'opened', files: paths }; },
    openQuickChat: () => { quickChatOpens += 1; return { ok: true, status: 'opened-chat' }; },
  });
  assert.equal(shareDropResult.status, 'opened');
  assert.deepEqual(shareDropResult.files, canonicalPaths);
  assert.equal(shareCalls, 1, 'one chooser action calls the native share path once');
  const promptCountBeforeEmpty = promptCalls;
  const emptyDrop = await chooseDropAction([], {
    prompt: async context => { promptCalls += 1; assert.deepEqual(context, { fileCount: 0, canShare: false }); return 'quick-chat'; },
    share: () => { throw new Error('must not share empty paths'); },
    openQuickChat: () => { quickChatOpens += 1; return { ok: true, status: 'opened-chat' }; },
  });
  assert.equal(emptyDrop.status, 'opened-chat', 'when path extraction yields nothing, the chooser still offers quick chat');
  assert.equal(promptCalls, promptCountBeforeEmpty + 1);
  const cancelledDrop = await chooseDropAction([first], {
    prompt: async () => 'cancel', share: () => { throw new Error('cancel must not share'); }, openQuickChat: () => { throw new Error('cancel must not open chat'); },
  });
  assert.equal(cancelledDrop.status, 'cancelled');
  const invalidDrop = await chooseDropAction([folder], {
    prompt: () => { throw new Error('unsupported directories must not prompt'); }, share: () => {}, openQuickChat: () => {},
  });
  assert.equal(invalidDrop.code, 'unsupported-directory');
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.files.map(file => file.path), canonicalPaths, 'validated paths are canonicalized for the current platform');
  assert.equal((await share.validateDroppedPaths([folder])).code, 'unsupported-directory');
  assert.equal((await share.validateDroppedPaths([path.join(temp, 'missing.txt')])).code, 'missing-file');
  assert.equal((await share.validateDroppedPaths([])).code, 'no-files');
  assert.equal((await share.validateDroppedPaths(Array(share.MAX_SHARE_FILES + 1).fill(first))).code, 'too-many-files');
  assert.deepEqual((await share.validateDroppedPaths([first, first])).files.map(file => file.path), [canonicalPaths[0]], 'duplicate paths are shared once after canonicalization');
  assert.equal((await share.validateDroppedPaths([empty])).files[0].size, 0, 'zero-byte files remain valid');
  assert.equal((await share.validateDroppedPaths([large])).files[0].size, 32 * 1024 * 1024, 'large sparse files are metadata-checked without reading contents');
  assert.equal((await share.validateDroppedPaths(['https://example.com/file'])).code, 'invalid-path', 'URLs and non-absolute values are not file paths');
  assert.equal((await fs.readFile(first, 'utf8')), 'fixture', 'share validation must not modify source files');
  const macEvents = [];
  let macPopup = null, fakeMenu;
  class FakeShareMenu {
    constructor(options) { this.options = options; fakeMenu = this; }
    popup(options) { macPopup = options; }
    closePopup() {}
  }
  const macHost = createNativeShareHost({
    app: { isPackaged: false }, window: { getBounds: () => ({ x: 100, y: 200, width: 300, height: 300 }) },
    screen: { getCursorScreenPoint: () => ({ x: 125, y: 240 }) }, platform: 'darwin', ShareMenuImpl: FakeShareMenu,
    onActive: active => macEvents.push(['active', active]), onOpened: info => macEvents.push(['opened', info.fileCount]),
  });
  const macResult = await macHost.share([first, second]);
  assert.equal(macResult.status, 'opened');
  assert.deepEqual(fakeMenu.options.filePaths, canonicalPaths);
  assert.deepEqual({ x: macPopup.x, y: macPopup.y }, { x: 25, y: 40 });
  assert.deepEqual(macEvents, [['active', true], ['opened', 2]]);
  macPopup.callback();
  assert.equal(macHost.active, false);
  macHost.close();

  const helper = path.join(temp, 'whale-share.exe');
  await fs.writeFile(helper, 'test-helper-placeholder');
  let child;
  let resolveSpawned;
  const spawned = new Promise(resolve => { resolveSpawned = resolve; });
  const windowsEvents = [];
  let windowsOpened = 0;
  const windowsHost = createNativeShareHost({
    app: { isPackaged: false }, window: { getNativeWindowHandle: () => Buffer.from([0x34, 0x12, 0, 0, 0, 0, 0, 0]) },
    screen: {}, platform: 'win32', windowsHelperPath: helper,
    onActive: active => windowsEvents.push(['active', active]),
    onOpened: () => { windowsOpened += 1; },
    spawnImpl: (file, args, options) => {
      assert.equal(file, helper);
      assert.equal(options.shell, false);
      assert.equal(args[0], '1234');
      assert.deepEqual(args.slice(1), canonicalPaths, 'Unicode/space paths remain separate argv values');
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0); return true; };
      resolveSpawned(child);
      return child;
    },
  });
  const pendingShare = windowsHost.share([first, second]);
  child = await Promise.race([spawned, new Promise((_, reject) => setTimeout(() => reject(new Error('Windows share host did not start')), 2000))]);
  child.stdout.emit('data', Buffer.from('{"status":"open'));
  child.stdout.emit('data', Buffer.from('ed"}\n'));
  child.stdout.emit('data', Buffer.from('{"status":"info"}\n'));
  const windowsResult = await pendingShare;
  assert.equal(windowsResult.status, 'opened');
  assert.equal(windowsOpened, 1, 'each complete helper status line is processed once');
  assert.equal(windowsHost.active, true, 'native helper remains alive while the share UI is active');
  assert.equal((await windowsHost.share([first])).code, 'share-busy', 'overlapping share sheets are rejected');
  child.exitCode = 0;
  child.emit('exit', 0);
  assert.equal(windowsHost.active, false);
  windowsHost.close();
  assert.deepEqual(windowsEvents, [['active', true], ['active', false]]);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

console.log('quick chat validation and native share input contract passed');
