'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

const MAX_SHARE_FILES = 20;
const MAX_PATH_LENGTH = 32760;

function failure(code, message) { return { ok: false, code, message }; }

async function validateDroppedPaths(input, { fsImpl = fs, pathImpl = path, maxFiles = MAX_SHARE_FILES } = {}) {
  if (!Array.isArray(input) || input.length === 0) return failure('no-files', '没有检测到可分享的本地文件');
  if (input.length > maxFiles) return failure('too-many-files', `一次最多分享 ${maxFiles} 个文件`);
  const files = [], seen = new Set();
  for (const candidate of input) {
    if (typeof candidate !== 'string' || !candidate || candidate.length > MAX_PATH_LENGTH || candidate.includes('\0') || !pathImpl.isAbsolute(candidate)) {
      return failure('invalid-path', '只能分享从文件管理器拖入的本地文件');
    }
    let resolved;
    try { resolved = await fsImpl.realpath(candidate); }
    catch { return failure('missing-file', '有文件已移动、删除或当前账户无法访问'); }
    if (seen.has(resolved)) continue;
    let stat;
    try { stat = await fsImpl.stat(resolved); }
    catch { return failure('missing-file', '有文件已移动、删除或当前账户无法访问'); }
    if (stat.isDirectory()) return failure('unsupported-directory', '暂不支持分享文件夹，请选择普通文件');
    if (!stat.isFile()) return failure('unsupported-file', '暂不支持此类虚拟或特殊文件');
    try { await fsImpl.access(resolved, constants.R_OK); }
    catch { return failure('access-denied', '当前账户没有读取其中一个文件的权限'); }
    seen.add(resolved);
    files.push({ path: resolved, name: pathImpl.basename(resolved), size: Number(stat.size) });
  }
  return files.length ? { ok: true, files } : failure('no-files', '没有检测到可分享的本地文件');
}

module.exports = { MAX_SHARE_FILES, validateDroppedPaths };
