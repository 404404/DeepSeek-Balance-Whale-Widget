import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assetPath = fileURLToPath(new URL('../assets/whale-widget.js', import.meta.url));
const source = await fs.readFile(assetPath, 'utf8');
const marker = 'var BUBBLE_DEFAULT_ITEMS = ';
const start = source.indexOf(marker);
assert.notEqual(start, -1, 'upstream bubble default queue must be present in the packaged renderer');
const literalStart = start + marker.length;
const end = source.indexOf('];', literalStart);
assert.notEqual(end, -1, 'upstream bubble default queue must terminate as a complete array');
const defaults = JSON.parse(source.slice(literalStart, end + 1));

function collectRandomModules(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRandomModules(item, result);
  } else if (value && typeof value === 'object') {
    if (value.type === 'random') result.push(value);
    for (const child of Object.values(value)) collectRandomModules(child, result);
  }
  return result;
}

const choice = defaults.find(item => item.kind === 'choice');
assert.ok(choice, 'default queue must preserve the upstream weighted choice step');
assert.deepEqual(choice.options.map(option => option.w), [10, 1], 'random phrase and petpet choices keep upstream 10:1 weights');
const random = collectRandomModules(choice.options).find(module => Array.isArray(module.lines));
assert.ok(random, 'the weighted phrase choice must include its editable random module');
assert.equal(random.lines.length, 50, 'keep the complete upstream 48-line pool plus the two newer upstream additions');
assert.deepEqual(random.lines.slice(-2), [
  { t: 'token 来!', w: 3, size: 16, rgb: 'candy', color: '' },
  { t: '你知道吗，我们的宇宙是虚拟的，因为垃圾会自发的产生但不会自发的消失，这是内存泄露', w: 3, bold: true, size: 5, rgb: 'indigo', color: '', italic: false, ul: false, bgRgb: '', bg: '' },
], 'latest upstream phrases retain their individual weights and styles');

console.log('upstream random phrase defaults: 50 lines, source styles and 10:1 choice verified');
