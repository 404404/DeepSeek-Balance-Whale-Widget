import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const model = require(fileURLToPath(new URL('../desktop/standalone-interaction-model.cjs', import.meta.url)));
const area = { x: 0, y: 0, width: 1440, height: 900 };
assert.equal(model.targetWidgetSize(0.6), 150);
assert.equal(model.targetWidgetSize(1.0), 250);
assert.equal(model.targetWidgetSize(1.6), 400);
assert.equal(model.targetWidgetSize(2.5), 625);
const frame = { x: 1000, y: 500, width: 375, height: 375 };
const shrunk = model.resizeKeepingBottomRight(frame, 150, 150, area);
assert.deepEqual(shrunk, { x: 1225, y: 725, width: 150, height: 150 });
const grown = model.resizeKeepingBottomRight(shrunk, 625, 625, area);
assert.deepEqual(grown, { x: 750, y: 250, width: 625, height: 625 });
const roleAnchorRatio = 0.70275;
let anchored = { x: 900, y: 350, width: 375, height: 375 };
const stableAnchor = { x: anchored.x + anchored.width * roleAnchorRatio, y: anchored.y + anchored.height };
for (const size of [150, 625, 250, 375]) {
  anchored = model.resizeKeepingWidgetAnchor(anchored, size, size, area, roleAnchorRatio, stableAnchor);
  assert.ok(Math.abs(anchored.x + anchored.width * roleAnchorRatio - stableAnchor.x) <= 1, `role X anchor drift at ${size}`);
  assert.ok(Math.abs(anchored.y + anchored.height - stableAnchor.y) <= 1, `role bottom drift at ${size}`);
}
for (let i = 0; i < 20; i += 1) {
  const down = model.resizeKeepingWidgetAnchor(anchored, 150, 150, area, roleAnchorRatio, stableAnchor);
  const up = model.resizeKeepingWidgetAnchor(down, 625, 625, area, roleAnchorRatio, stableAnchor);
  assert.deepEqual(up, model.resizeKeepingWidgetAnchor(anchored, 625, 625, area, roleAnchorRatio, stableAnchor), 'scale roundtrip accumulated drift');
  anchored = model.resizeKeepingWidgetAnchor(up, 375, 375, area, roleAnchorRatio, stableAnchor);
}
const compactFrame = { x: 1000, y: 500, width: 250, height: 250 };
const expandedFrame = model.resizeKeepingBottomRight(compactFrame, 760, 700, area);
const rootOffset = model.surfaceRootOffset(expandedFrame, 250, 250, { right: compactFrame.x + compactFrame.width, bottom: compactFrame.y + compactFrame.height });
assert.deepEqual(rootOffset, { left: 510, top: 450 });
assert.equal(expandedFrame.x + rootOffset.left, compactFrame.x);
assert.equal(expandedFrame.y + rootOffset.top, compactFrame.y);
const clampedSurface = model.resizeKeepingBottomRight({ x: 375, y: 400, width: 250, height: 250 }, 760, 700, { x: 0, y: 0, width: 800, height: 800 });
const clampedOffset = model.surfaceRootOffset(clampedSurface, 250, 250, { right: 625, bottom: 650 });
assert.deepEqual(clampedOffset, { left: 375, top: 400 });
assert.equal(clampedSurface.x + clampedOffset.left + 250, 625);
assert.equal(clampedSurface.y + clampedOffset.top + 250, 650);
const roleScreenAnchor = { x: compactFrame.x + compactFrame.width * roleAnchorRatio, y: compactFrame.y + compactFrame.height };
const anchoredSurfaceOffset = model.surfaceRootOffset(expandedFrame, 250, 250, roleScreenAnchor, roleAnchorRatio);
assert.ok(Math.abs(expandedFrame.x + anchoredSurfaceOffset.left + 250 * roleAnchorRatio - roleScreenAnchor.x) <= 1);
assert.ok(Math.abs(expandedFrame.y + anchoredSurfaceOffset.top + 250 - roleScreenAnchor.y) <= 1);
assert.equal(model.screenMoved({ x: 100, y: 200 }, { x: 102, y: 201 }), false);
assert.equal(model.screenMoved({ x: 100, y: 200 }, { x: 104, y: 201 }), true);
assert.deepEqual(model.nativeDragMovement({ x: 100, y: 200 }, { x: 102, y: 201 }), { dx: 2, dy: 1, moved: false, shouldMove: false });
assert.deepEqual(model.nativeDragMovement({ x: 100, y: 200 }, { x: 104, y: 201 }), { dx: 4, dy: 1, moved: true, shouldMove: true });
assert.deepEqual(model.nativeDragMovement({ x: 100, y: 200 }, { x: 101, y: 201 }, true), { dx: 1, dy: 1, moved: true, shouldMove: true });
let cursor = { x: 1150, y: 830 };
assert.equal(model.cursorInRegions(cursor, { x: 1000, y: 500 }, [{ left: 100, top: 300, width: 200, height: 200 }]), true);
assert.equal(model.cursorInRegions({ x: 1001, y: 501 }, { x: 1000, y: 500 }, [{ left: 100, top: 300, width: 200, height: 200 }]), false);
assert.equal(model.expandedSurfaceFromState({ menuButtonVisible: true }), false);
assert.equal(model.expandedSurfaceFromState({ menuOpen: true }), true);
let point = { x: 0, y: 0 };
for (let i = 0; i < 50; i += 1) {
  point = { x: point.x + 2, y: point.y };
  assert.equal(model.screenMoved({ x: 0, y: 0 }, point), i >= 1);
}
console.log('macOS interaction model regression passed');
