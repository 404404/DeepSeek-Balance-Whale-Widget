'use strict';

// Keep the legacy Codex-following host available to the upstream plugin path.
// desktop-demo package builds use desktop/desktop-demo-main.cjs directly.
if (process.platform === 'darwin') {
  require('./standalone-main.cjs');
} else if (process.argv.includes('--standalone') || process.env.DESKTOP_DEMO_MODE === 'standalone') {
  require('./standalone-main.cjs');
} else {
  require('./follow-main.cjs');
}
