import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';

const [target, outputFile, runtimeFile, appDir, ...artifacts] = process.argv.slice(2);
const validTargets = new Set(['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64']);
if (!validTargets.has(target) || !outputFile || !runtimeFile || !appDir || artifacts.length < 1) {
  throw new Error('usage: write-build-record <target> <output.json> <runtime.json> <app-dir> <artifact...>');
}
const sourceSha = process.env.SOURCE_SHA || '';
const version = process.env.APP_VERSION || '';
if (!/^[0-9a-f]{40}$/i.test(sourceSha)) throw new Error('SOURCE_SHA must be a full commit SHA');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`invalid app version: ${version}`);
const targetArch = target.endsWith('arm64') ? 'arm64' : 'x64';
const platform = target.startsWith('windows-') ? 'win32' : 'darwin';
const runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
if (runtime.platform !== platform || runtime.arch !== targetArch || runtime.appPackaged !== true) {
  throw new Error(`packaged runtime mismatch: ${JSON.stringify({ target, runtime })}`);
}
async function sumTree(folder) {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const current = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await sumTree(current);
    else if (entry.isFile()) total += (await fs.stat(current)).size;
  }
  return total;
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const outputs = [];
for (const raw of artifacts) {
  const file = path.resolve(raw);
  const bytes = (await fs.stat(file)).size;
  const digest = await hashFile(file);
  outputs.push({ name: path.basename(file), bytes, sha256: digest });
}
const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
const record = {
  schemaVersion: 1,
  target,
  appVersion: version,
  sourceSha: sourceSha.toLowerCase(),
  platform,
  targetArch,
  runner: { os: process.env.RUNNER_OS || process.platform, architecture: process.env.RUNNER_ARCH || process.arch, node: process.version, electron: packageJson.devDependencies.electron },
  packagedRuntime: { arch: runtime.arch, electron: runtime.electron, node: runtime.node, executable: path.basename(runtime.executablePath || runtime.appPath), executablePath: runtime.executablePath || null, appPath: runtime.appPath, packaged: runtime.appPackaged },
  appBundleBytes: await sumTree(appDir),
  appAsarBytes: (await fs.stat(path.join(appDir, platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar'))).size,
  macSigning: platform === 'darwin' ? { kind: 'ad-hoc', notarized: false } : null,
  osShareUi: 'not-verified-by-headless-smoke',
  artifacts: outputs,
  createdAt: new Date().toISOString(),
};
await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(record, null, 2) + '\n');
process.stdout.write(JSON.stringify(record, null, 2) + '\n');
