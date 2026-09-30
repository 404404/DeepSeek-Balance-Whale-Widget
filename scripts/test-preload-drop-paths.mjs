import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const preloadPath = fileURLToPath(new URL('../desktop/preload.cjs', import.meta.url));
const preloadSource = await fs.readFile(preloadPath, 'utf8');
const bridge = {};
const calls = [];
const ipcRenderer = {
  sendSync: channel => channel === 'whale-storage' ? {} : { scale: 1, standalone: true },
  send: () => {},
  on: () => {},
  invoke: async (channel, payload) => { calls.push({ channel, payload }); return { ok: true }; },
};
const electron = {
  contextBridge: { exposeInMainWorld: (name, value) => { bridge[name] = value; } },
  ipcRenderer,
  webUtils: {
    getPathForFile: file => {
      if (file?.throws) throw new Error('native path unavailable');
      return file?.nativePath;
    },
  },
};
const listeners = [];
vm.runInNewContext(preloadSource, {
  require: name => {
    if (name !== 'electron') throw new Error(`sandbox preload attempted unsupported require: ${name}`);
    return electron;
  },
  process: { argv: ['electron', preloadPath, '--whale-render-test'], env: {} },
  document: { addEventListener: (...args) => listeners.push(args) },
  window: { addEventListener: (...args) => listeners.push(args) },
  localStorage: { getItem: () => null, setItem: () => {} },
  Date, Promise, Array, Object, Element: class Element {},
}, { filename: preloadPath });

assert.ok(bridge.whaleDesktop, 'the production preload exposes the desktop bridge');
const files = [
  { nativePath: 'C:\\Users\\test\\first.txt' },
  { throws: true },
  { nativePath: 'C:\\Users\\test\\third.png' },
];
await bridge.whaleDesktop.chooseDroppedFileAction(files);
assert.equal(calls.at(-1).channel, 'whale-choose-drop-action');
assert.deepEqual(Array.from(calls.at(-1).payload),
  ['C:\\Users\\test\\first.txt', 'C:\\Users\\test\\third.png'],
  'the sandboxed production preload resolves native File paths independently and keeps valid files');

await bridge.whaleDesktop.chooseDroppedFileAction(undefined);
assert.equal(calls.at(-1).channel, 'whale-choose-drop-action');
assert.deepEqual(Array.from(calls.at(-1).payload), [], 'missing FileList is forwarded as an empty safe selection');

const tooMany = Array.from({ length: 25 }, (_, i) => ({ nativePath: `/tmp/file-${i}` }));
await bridge.whaleDesktop.chooseDroppedFileAction(tooMany);
assert.equal(calls.at(-1).payload.length, 21, 'preload bounds the file list before native validation applies the stricter share limit');
console.log('sandboxed production preload drop-path regression passed');
