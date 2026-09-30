import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';

const [rootArg, expectedSha, expectedVersion] = process.argv.slice(2);
if (!rootArg || !/^[0-9a-f]{40}$/i.test(expectedSha || '') || !expectedVersion) {
  throw new Error('usage: verify-release-set <download-root> <source-sha> <version>');
}
const root = path.resolve(rootArg);
const targets = ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64'];
const foundRecords = [];
async function walk(directory) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, item.name);
    if (item.isDirectory()) await walk(itemPath);
    else if (item.isFile() && item.name === 'build-record.json') foundRecords.push(itemPath);
  }
}
await walk(root);
if (foundRecords.length !== targets.length) throw new Error(`expected exactly ${targets.length} build records; found ${foundRecords.length}`);
const records = await Promise.all(foundRecords.map(async file => ({ file, value: JSON.parse(await fs.readFile(file, 'utf8')) })));
const seen = new Set();
const assets = [];
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
for (const { file, value: record } of records) {
  if (!targets.includes(record.target) || seen.has(record.target)) throw new Error(`duplicate or unknown target in ${file}: ${record.target}`);
  seen.add(record.target);
  if (record.sourceSha?.toLowerCase() !== expectedSha.toLowerCase() || record.appVersion !== expectedVersion) {
    throw new Error(`source/version mismatch for ${record.target}: sha=${record.sourceSha} version=${record.appVersion}`);
  }
  const arch = record.target.endsWith('arm64') ? 'arm64' : 'x64';
  if (record.targetArch !== arch || record.packagedRuntime?.arch !== arch || record.packagedRuntime?.packaged !== true) throw new Error(`packaged runtime architecture mismatch in ${record.target}`);
  const parent = path.dirname(file);
  const localArtifacts = [];
  for (const item of record.artifacts || []) {
    if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[0-9a-f]{64}$/.test(item.sha256 || '')) throw new Error(`malformed artifact record for ${record.target}`);
    const filePath = path.join(parent, item.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== item.bytes || await hashFile(filePath) !== item.sha256) throw new Error(`artifact bytes/hash do not match build record: ${filePath}`);
    localArtifacts.push({ ...item, path: filePath, target: record.target });
  }
  const requiredSuffixes = record.target.startsWith('windows-') ? ['-setup.exe', '-portable.zip'] : ['.dmg'];
  for (const suffix of requiredSuffixes) if (!localArtifacts.some(item => item.name.endsWith(suffix))) throw new Error(`${record.target} is missing required artifact ${suffix}`);
  if (record.target.startsWith('windows-')) {
    for (const item of localArtifacts.filter(item => item.name.endsWith('.exe') || item.name.endsWith('.zip'))) {
      if (!localArtifacts.some(sidecar => sidecar.name === `${item.name}.sha256`)) throw new Error(`missing SHA-256 sidecar for ${item.name}`);
    }
  } else if (!localArtifacts.some(item => item.name.endsWith('.dmg.sha256'))) throw new Error(`${record.target} is missing the DMG SHA-256 sidecar`);
  assets.push(...localArtifacts);
}
for (const target of targets) if (!seen.has(target)) throw new Error(`missing build target: ${target}`);
const publishable = assets.filter(item => !item.name.endsWith('.sha256'));
if (publishable.length !== 6) throw new Error(`expected six primary installation artifacts, got ${publishable.length}`);
const releaseRoot = path.resolve(rootArg);
const sums = publishable.map(item => `${item.sha256}  ${item.name}`).sort().join('\n') + '\n';
await fs.writeFile(path.join(releaseRoot, 'SHA256SUMS'), sums);
const manifest = {
  schemaVersion: 1,
  version: expectedVersion,
  sourceSha: expectedSha.toLowerCase(),
  targets: records.map(({ value }) => ({ target: value.target, runner: value.runner, packagedRuntime: value.packagedRuntime, appBundleBytes: value.appBundleBytes, appAsarBytes: value.appAsarBytes, macSigning: value.macSigning, osShareUi: value.osShareUi })).sort((a, b) => a.target.localeCompare(b.target)),
  artifacts: publishable.map(({ target, ...item }) => ({ target, name: item.name, bytes: item.bytes, sha256: item.sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
};
await fs.writeFile(path.join(releaseRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ok: true, targets: [...seen].sort(), primaryArtifactCount: publishable.length, manifest: path.join(releaseRoot, 'manifest.json') }, null, 2) + '\n');
