'use strict';

const { app } = require('electron');

// Packaged desktop apps launch standalone on both supported OS families.
// Developer/supervisor invocations remain Codex-following unless explicitly
// started with --standalone, preserving the existing Windows follow scripts.
if (process.platform === 'darwin' || (process.platform === 'win32' && app.isPackaged)) {
  require('./standalone-main.cjs');
} else if (process.argv.includes('--standalone') || process.env.WHALE_DESKTOP_MODE === 'standalone') {
  require('./standalone-main.cjs');
} else {
  require('./follow-main.cjs');
}
