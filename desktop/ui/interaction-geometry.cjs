(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaleInteractionGeometry = api;
})(typeof window === 'object' ? window : globalThis, function createGeometry() {
  function finite(value) { return Number.isFinite(Number(value)); }

  function shouldFlipForPosition(currentFlip, pointX, area, flipAt, hysteresis = null) {
    if (!area || ![pointX, area.x, area.width, flipAt].every(finite) || Number(area.width) <= 0) return !!currentFlip;
    const margin = hysteresis == null
      ? Math.min(Number(area.width) * 0.1, Math.max(24, Number(area.width) * 0.04))
      : Math.max(0, Number(hysteresis));
    const localX = Number(pointX) - Number(area.x);
    const threshold = Math.max(0, Math.min(Number(area.width), Number(flipAt)));
    return currentFlip ? localX < threshold + margin : localX < threshold - margin;
  }

  function visibleArtCenterX(unflippedAnchorX, compactWidth, flipped, normalCenterRatio = 0.70275) {
    if (![unflippedAnchorX, compactWidth, normalCenterRatio].every(finite) || Number(compactWidth) <= 0) return Number(unflippedAnchorX);
    const mirroredCenterRatio = 1 - Number(normalCenterRatio);
    const offset = Number(compactWidth) * (Number(normalCenterRatio) - mirroredCenterRatio);
    return Number(unflippedAnchorX) - (flipped ? offset : 0);
  }

  function flipThreshold(config, area, compactWidth = 0) {
    if (!area || !Number.isFinite(Number(area.width)) || Number(area.width) <= 0) return null;
    const width = Number(area.width);
    if (config?.mode !== 'px') {
      const ratio = Number(config?.ratio?.F);
      return Number.isFinite(ratio) ? width * Math.max(0, Math.min(100, ratio)) / 100 : width / 2;
    }
    const pixel = Number(config?.px?.F);
    if (!Number.isFinite(pixel) || pixel < 0) return width / 2;
    const oldCompactDefault = Number.isFinite(Number(compactWidth)) && Number(compactWidth) > 0 &&
      Math.abs(pixel - Math.round(Number(compactWidth) / 2)) <= 2 &&
      Number(config?.px?.L) === 80 && Number(config?.px?.R) === 80;
    return oldCompactDefault ? width / 2 : Math.max(0, Math.min(width, pixel));
  }

  return Object.freeze({ shouldFlipForPosition, visibleArtCenterX, flipThreshold });
});
