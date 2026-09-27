import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIA_POLICY, validateImage } from './media-validation.mjs';

const STATES = new Set(['default', 'dragging', 'received', 'processing', 'complete']);
const EXTENSION_MIME = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'],
]);
const MAX_BYTES = MEDIA_POLICY.roleBytes;
const safeName = value => path.basename(String(value || '未命名图片')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || '未命名图片';

export class DesktopDemoStateImages {
  constructor({ dataDir, validate = validateImage, maxBytes = MAX_BYTES } = {}) {
    if (!dataDir || typeof dataDir !== 'string') throw new TypeError('dataDir is required');
    this.directory = path.join(path.resolve(dataDir), 'desktop-demo-quick-chat');
    this.imageDirectory = path.join(this.directory, 'images');
    this.indexPath = path.join(this.directory, 'state-images.json');
    this.validate = validate;
    this.maxBytes = maxBytes;
    this.mappings = {};
    this.ready = false;
  }

  async init() {
    await fs.mkdir(this.imageDirectory, { recursive: true });
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(this.indexPath, 'utf8')); } catch {}
    const mappings = {};
    for (const [state, item] of Object.entries(saved || {})) {
      if (!STATES.has(state) || !item || !/^[0-9a-f-]{36}$/.test(item.id || '') || !EXTENSION_MIME.has(item.extension)) continue;
      const mime = EXTENSION_MIME.get(item.extension);
      if (item.mime !== mime) continue;
      const record = { id: item.id, name: safeName(item.name), extension: item.extension, mime, size: Math.max(0, Number(item.size) || 0) };
      try {
        const bytes = await fs.readFile(this.fileFor(record));
        const verified = this.validate(bytes, { maxBytes: this.maxBytes, mime });
        if (verified.mime !== mime) continue;
        mappings[state] = record;
      } catch {}
    }
    this.mappings = mappings;
    this.ready = true;
    if (Object.keys(mappings).length !== Object.keys(saved || {}).length) await this.persist();
    return this.getMappings();
  }

  fileFor(record) { return path.join(this.imageDirectory, `${record.id}.${record.extension}`); }

  async persist() {
    const temp = `${this.indexPath}.${process.pid}.tmp`;
    const values = Object.fromEntries(Object.entries(this.mappings).map(([state, item]) => [state, { ...item }]));
    await fs.writeFile(temp, JSON.stringify(values, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.indexPath);
  }

  getMappings() {
    return Object.fromEntries(Object.entries(this.mappings).map(([state, item]) => [state, { id: item.id, name: item.name, mime: item.mime, size: item.size }]));
  }

  assertReady() { if (!this.ready) throw new Error('交互状态图片服务尚未启动'); }

  async importFile(filePath, state) {
    this.assertReady();
    if (!STATES.has(state)) throw new Error('无效的人偶交互状态');
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('请选择普通图片文件，目录和链接暂不支持');
    if (stat.size < 1 || stat.size > this.maxBytes) throw new Error('图片为空或超过 20 MiB');
    const bytes = await fs.readFile(filePath);
    return this.importBuffer(bytes, path.basename(filePath), state);
  }

  async importBuffer(bytes, name, state) {
    this.assertReady();
    if (!STATES.has(state)) throw new Error('无效的人偶交互状态');
    const filename = safeName(name);
    const inputExtension = path.extname(filename).slice(1).toLowerCase();
    const expectedMime = EXTENSION_MIME.get(inputExtension);
    if (!expectedMime || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > this.maxBytes) {
      throw new Error('只接受不超过 20 MiB 的 PNG、JPEG 或 WebP 图片');
    }
    const verified = this.validate(bytes, { maxBytes: this.maxBytes, mime: expectedMime });
    if (verified.mime !== expectedMime) throw new Error('图片扩展名与文件内容不一致');
    const id = randomUUID();
    const extension = verified.extension;
    const record = { id, name: filename, extension, mime: verified.mime, size: bytes.length, width: verified.width, height: verified.height };
    const destination = this.fileFor(record);
    const temp = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, destination);
    const previous = this.mappings[state];
    this.mappings[state] = record;
    try { await this.persist(); }
    catch (error) {
      if (previous) this.mappings[state] = previous;
      else delete this.mappings[state];
      await fs.rm(destination, { force: true }).catch(() => {});
      throw error;
    }
    if (previous && !Object.values(this.mappings).some(item => item.id === previous.id)) await fs.rm(this.fileFor(previous), { force: true }).catch(() => {});
    return this.getMappings()[state];
  }

  async reset(state) {
    this.assertReady();
    if (!STATES.has(state)) return false;
    const previous = this.mappings[state];
    if (!previous) return true;
    delete this.mappings[state];
    await this.persist();
    if (!Object.values(this.mappings).some(item => item.id === previous.id)) await fs.rm(this.fileFor(previous), { force: true }).catch(() => {});
    return true;
  }

  async read(state) {
    this.assertReady();
    if (!STATES.has(state)) return null;
    const record = this.mappings[state];
    if (!record) return null;
    try {
      const bytes = await fs.readFile(this.fileFor(record));
      this.validate(bytes, { maxBytes: this.maxBytes, mime: record.mime });
      return { bytes, mime: record.mime, name: record.name };
    } catch {
      delete this.mappings[state];
      await this.persist().catch(() => {});
      return null;
    }
  }
}
