import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DemoStateImages } from '../lib/demo-state-images.mjs';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, crc]);
}
function onePixelPng(color = [25, 85, 145, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const image = Buffer.from([0, ...color]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(image)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('state images are validated, copied into the Demo namespace, and survive source removal and restart', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-demo-images-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const rolesDirectory = path.join(temp, 'existing-user-roles');
  await fs.mkdir(rolesDirectory);
  const roleMarker = path.join(rolesDirectory, 'keep.json');
  await fs.writeFile(roleMarker, '{"role":"unchanged"}');
  const original = path.join(temp, '原始 图片.png');
  await fs.writeFile(original, onePixelPng());

  const service = new DemoStateImages({ dataDir: temp });
  await service.init();
  const imported = await service.importFile(original, 'received');
  assert.equal(imported.name, '原始 图片.png');
  assert.equal(imported.mime, 'image/png');
  assert.ok(imported.id);
  assert.equal(JSON.stringify(service.getMappings()).includes(original), false);

  const indexPath = path.join(temp, 'demo-quick-chat', 'state-images.json');
  const saved = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(saved.received.id, imported.id);
  assert.equal(JSON.stringify(saved).includes(original), false);
  const storedPath = path.join(temp, 'demo-quick-chat', 'images', `${imported.id}.png`);
  assert.deepEqual(await fs.readFile(storedPath), onePixelPng());
  await fs.rm(original);

  const restarted = new DemoStateImages({ dataDir: temp });
  const restored = await restarted.init();
  assert.deepEqual(restored.received, imported);
  const storedImage = await restarted.read('received');
  assert.equal(storedImage.mime, 'image/png');
  assert.deepEqual(storedImage.bytes, onePixelPng());
  assert.equal(await fs.readFile(roleMarker, 'utf8'), '{"role":"unchanged"}');
});

test('unsupported, mislabeled, directory, and corrupted state images are rejected with a built-in fallback record', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-demo-image-errors-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const service = new DemoStateImages({ dataDir: temp });
  await service.init();
  const directory = path.join(temp, 'a-directory');
  await fs.mkdir(directory);
  await assert.rejects(service.importFile(directory, 'dragging'), /普通图片文件/);
  await assert.rejects(service.importBuffer(onePixelPng(), 'notes.txt', 'dragging'), /只接受/);
  await assert.rejects(service.importBuffer(onePixelPng(), 'wrong.webp', 'dragging'), /格式与实际文件不一致|扩展名/);
  await assert.rejects(service.importBuffer(Buffer.from('not an image'), 'broken.png', 'dragging'));

  const imported = await service.importBuffer(onePixelPng(), 'work.png', 'processing');
  const savedFile = path.join(temp, 'demo-quick-chat', 'images', `${imported.id}.png`);
  await fs.writeFile(savedFile, Buffer.from('corrupt after import'));
  assert.equal(await service.read('processing'), null);
  assert.equal(service.getMappings().processing, undefined);
  assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'demo-quick-chat', 'state-images.json'), 'utf8')).processing, undefined);
});

test('state replacement and reset affect only the chosen state mapping', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-demo-image-reset-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const service = new DemoStateImages({ dataDir: temp });
  await service.init();
  const first = await service.importBuffer(onePixelPng([25, 85, 145, 255]), 'blue.png', 'received');
  await service.importBuffer(onePixelPng([180, 65, 70, 255]), 'red.png', 'processing');
  const second = await service.importBuffer(onePixelPng([25, 85, 145, 255]), 'replacement.png', 'received');
  assert.notEqual(first.id, second.id);
  await assert.rejects(fs.stat(path.join(temp, 'demo-quick-chat', 'images', `${first.id}.png`)), /ENOENT/);
  assert.equal(service.getMappings().processing.name, 'red.png');
  assert.equal(await service.reset('received'), true);
  assert.equal(service.getMappings().received, undefined);
  assert.equal(service.getMappings().processing.name, 'red.png');
});
