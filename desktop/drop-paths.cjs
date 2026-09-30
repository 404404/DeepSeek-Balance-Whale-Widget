'use strict';

function extractDroppedFilePaths(files, getPathForFile, maxFiles = 21) {
  if (!files || typeof files[Symbol.iterator] !== 'function' || typeof getPathForFile !== 'function') return [];
  const paths = [];
  let index = 0;
  for (const file of files) {
    if (index++ >= maxFiles) break;
    try {
      const value = getPathForFile(file);
      if (typeof value === 'string' && value.trim()) paths.push(value);
    } catch {}
  }
  return paths;
}

module.exports = { extractDroppedFilePaths };
