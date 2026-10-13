import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';

const [sourceRootArg, downloadedArg] = process.argv.slice(2);
if (!sourceRootArg || !downloadedArg) throw new Error('usage: verify-uploaded-release <verified-build-root> <download-directory>');
const sourceRoot = path.resolve(sourceRootArg), downloaded = path.resolve(downloadedArg);
const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
const expected = new Map(manifest.artifacts.map(item => [item.name, item.sha256]));
const records = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name === 'build-record.json') records.push(file);
  }
}
await walk(sourceRoot);
for (const file of records) {
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const item of record.artifacts || []) expected.set(item.name, item.sha256);
}
for (const name of ['manifest.json', 'SHA256SUMS']) expected.set(name, await hashFile(path.join(sourceRoot, name)));
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const actualFiles = await fs.readdir(downloaded, { withFileTypes: true });
const actualNames = actualFiles.filter(entry => entry.isFile()).map(entry => entry.name).sort();
const expectedNames = [...expected.keys()].sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error(`uploaded release asset names differ; expected=${expectedNames.join(',')} actual=${actualNames.join(',')}`);
for (const [name, digest] of expected) {
  const actualDigest = await hashFile(path.join(downloaded, name));
  if (actualDigest !== digest) throw new Error(`uploaded release asset hash mismatch: ${name}`);
}
process.stdout.write(JSON.stringify({ ok: true, assetCount: expected.size, manifest: manifest.version, sourceSha: manifest.sourceSha }, null, 2) + '\n');
