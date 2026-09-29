'use strict';

function finite(value) { return Number.isFinite(Number(value)); }

function targetWidgetSize(scale, { base = 250, min = 122, max = 625 } = {}) {
  const value = Number(scale);
  const raw = finite(value) && value >= 0.6 && value <= 2.5 ? base * value : base * 1.5;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function widgetSizeApplied(requested, actual, area, min = 122, tolerance = 2) {
  if (!requested || !actual || !area || ![requested.width, requested.height, actual.width, actual.height, area.width, area.height].every(finite)) return false;
  const expectedWidth = Math.min(Math.max(min, Number(requested.width)), Math.max(min, Number(area.width)));
  const expectedHeight = Math.min(Math.max(min, Number(requested.height)), Math.max(min, Number(area.height)));
  return Math.abs(expectedWidth - Number(actual.width)) <= tolerance && Math.abs(expectedHeight - Number(actual.height)) <= tolerance;
}

function clampFrameToArea(frame, area, min = 122) {
  const width = Math.min(Math.max(min, Math.round(Number(frame.width))), Math.max(min, area.width));
  const height = Math.min(Math.max(min, Math.round(Number(frame.height))), Math.max(min, area.height));
  return {
    x: Math.max(area.x, Math.min(Math.round(Number(frame.x)), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(Number(frame.y)), area.y + area.height - height)),
    width,
    height,
  };
}

function resizeKeepingBottomRight(frame, width, height, area, min = 122) {
  return clampFrameToArea({
    x: Number(frame.x) + Number(frame.width) - Number(width),
    y: Number(frame.y) + Number(frame.height) - Number(height),
    width, height,
  }, area, min);
}

function widgetScreenAnchor(frame, roleAnchorRatio = 0.70275) {
  return {
    x: Number(frame.x) + Number(frame.width) * roleAnchorRatio,
    y: Number(frame.y) + Number(frame.height),
  };
}

function resizeKeepingWidgetAnchor(frame, width, height, area, roleAnchorRatio = 0.70275, anchor = widgetScreenAnchor(frame, roleAnchorRatio), min = 122) {
  if (!anchor || !finite(anchor.x) || !finite(anchor.y) || !finite(roleAnchorRatio) || roleAnchorRatio < 0 || roleAnchorRatio > 1) return clampFrameToArea({ ...frame, width, height }, area, min);
  return clampFrameToArea({
    x: Number(anchor.x) - Number(width) * roleAnchorRatio,
    y: Number(anchor.y) - Number(height),
    width,
    height,
  }, area, min);
}

function screenMoved(start, current, threshold = 3) {
  if (!start || !current || ![start.x, start.y, current.x, current.y].every(finite)) return false;
  const dx = Number(current.x) - Number(start.x);
  const dy = Number(current.y) - Number(start.y);
  return dx * dx + dy * dy >= threshold * threshold;
}

// The renderer may report many small moves while a native drag is being
// captured. Do not move the BrowserWindow until the gesture has crossed the
// click threshold; once crossed, the gesture remains a drag.
function nativeDragMovement(start, current, moved = false, threshold = 3) {
  const dx = finite(start?.x) && finite(current?.x) ? Number(current.x) - Number(start.x) : 0;
  const dy = finite(start?.y) && finite(current?.y) ? Number(current.y) - Number(start.y) : 0;
  const nextMoved = !!moved || screenMoved(start, current, threshold);
  return { dx, dy, moved: nextMoved, shouldMove: nextMoved };
}

function cursorInRegions(cursor, contentBounds, regions) {
  if (!cursor || !contentBounds || !Array.isArray(regions)) return false;
  if (![cursor.x, cursor.y, contentBounds.x, contentBounds.y].every(finite)) return false;
  return regions.some(region => region &&
    cursor.x >= contentBounds.x + Number(region.left) &&
    cursor.x <= contentBounds.x + Number(region.left) + Number(region.width) &&
    cursor.y >= contentBounds.y + Number(region.top) &&
    cursor.y <= contentBounds.y + Number(region.top) + Number(region.height));
}

function expandedSurfaceFromState(state = {}) {
  return !!(state.menuOpen || state.dialogOpen || state.editorOpen || state.maskOpen || state.listOpen);
}

function surfaceRootOffset(frame, compactWidth, compactHeight, screenAnchor = null, roleAnchorRatio = 0.70275) {
  const frameWidth = Math.round(Number(frame?.width) || 0);
  const frameHeight = Math.round(Number(frame?.height) || 0);
  const compactW = Math.round(Number(compactWidth) || 0);
  const compactH = Math.round(Number(compactHeight) || 0);
  const hasRoleAnchor = finite(screenAnchor?.x) && finite(screenAnchor?.y);
  const ratio = hasRoleAnchor ? roleAnchorRatio : 1;
  const desiredX = hasRoleAnchor ? Number(screenAnchor.x) : finite(screenAnchor?.right) ? Number(screenAnchor.right) : Number(frame?.x || 0) + frameWidth;
  const desiredBottom = hasRoleAnchor ? Number(screenAnchor.y) : finite(screenAnchor?.bottom) ? Number(screenAnchor.bottom) : Number(frame?.y || 0) + frameHeight;
  return {
    left: Math.max(0, Math.min(Math.max(0, frameWidth - compactW), Math.round(desiredX - Number(frame?.x || 0) - compactW * ratio))),
    top: Math.max(0, Math.min(Math.max(0, frameHeight - compactH), Math.round(desiredBottom - Number(frame?.y || 0) - compactH))),
  };
}

module.exports = {
  targetWidgetSize,
  widgetSizeApplied,
  clampFrameToArea,
  resizeKeepingBottomRight,
  widgetScreenAnchor,
  resizeKeepingWidgetAnchor,
  screenMoved,
  nativeDragMovement,
  cursorInRegions,
  expandedSurfaceFromState,
  surfaceRootOffset,
};
