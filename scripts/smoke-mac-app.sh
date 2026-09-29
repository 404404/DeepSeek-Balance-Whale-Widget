#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist/AI Balance Whale.app}"
OUT="${2:-$ROOT/qa-output/mac-smoke}"
DMG="${3:-}"
ARCH="${ARCH:-arm64}"
[[ -d "$APP" ]] || { echo "App bundle missing: $APP" >&2; exit 1; }
APP="$(cd "$APP" && pwd -P)"
rm -rf "$OUT"
mkdir -p "$OUT"
PID=''
DATA=''
LOG=''
MOUNT=''
MOUNTED=0

diagnose() {
  local data="${1:-$DATA}" log="${2:-$LOG}"
  echo "--- packaged app stdout/stderr ($log) ---" >&2
  cat "$log" >&2 || true
  for name in desktop-error.json bridge-error.json renderer-gone.json startup-timings.json layout-diagnostic.json input-routing.json interaction-test.json renderer-errors.json runtime-environment.json; do
    if [[ -f "$data/$name" ]]; then
      echo "--- $data/$name ---" >&2
      cat "$data/$name" >&2 || true
    fi
  done
  echo "--- smoke data files ($data) ---" >&2
  find "$data" -maxdepth 2 -type f -not -name runtime.json -print >&2 || true
}
stop_case() {
  if [[ -n "$PID" ]]; then
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    PID=''
  fi
}
cleanup() {
  stop_case
  if [[ "$MOUNTED" == 1 ]]; then hdiutil detach "$MOUNT" -quiet || true; fi
  [[ -z "$MOUNT" ]] || rmdir "$MOUNT" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -n "$DMG" ]]; then
  [[ -f "$DMG" ]] || { echo "DMG missing: $DMG" >&2; exit 1; }
  MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/ai-whale-smoke-mount.XXXXXX")"
  hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$DMG" >/dev/null
  MOUNTED=1
  [[ -d "$MOUNT/AI Balance Whale.app" ]] || { echo 'Mounted DMG has no App bundle' >&2; exit 1; }
  [[ -L "$MOUNT/Applications" ]] || { echo 'Mounted DMG has no Applications shortcut' >&2; exit 1; }
  mkdir -p "$OUT/installed"
  ditto "$MOUNT/AI Balance Whale.app" "$OUT/installed/AI Balance Whale.app"
  hdiutil detach "$MOUNT" -quiet
  MOUNTED=0
  rmdir "$MOUNT" 2>/dev/null || true
  MOUNT=''
  diff -qr "$APP" "$OUT/installed/AI Balance Whale.app" || { echo 'App copied from DMG differs from the verified build bundle' >&2; exit 1; }
  APP="$(cd "$OUT/installed/AI Balance Whale.app" && pwd -P)"
  ARCH="$ARCH" VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}" bash scripts/verify-mac-app.sh "$APP"
  printf 'DMG copy verification passed; launching extracted bundle: %s\n' "$APP"
fi

run_case() {
  local label="$1" scale="$2" legacy="$3"
  DATA="$OUT/data-$label"
  LOG="$OUT/$label.log"
  mkdir -p "$DATA"
  printf '{"scale":%s,"sound":true,"vol":0.9,"soundSet":"duck","bubbleOn":true}\n' "$scale" > "$DATA/.dshw-size.json"
  if [[ "$legacy" == 1 ]]; then
    printf '{"version":1,"frame":{"x":100,"y":100,"width":248,"height":274}}\n' > "$DATA/window-state.json"
  fi
  mkdir -p "$DATA/codex-home"
  ELECTRON_ENABLE_LOGGING=1 CODEX_HOME="$DATA/codex-home" WHALE_HOME="$DATA" "$APP/Contents/MacOS/AI Balance Whale" \
    --whale-render-test --whale-interaction-test --whale-test-hang-size-config --enable-logging=stderr --whale-data="$DATA" >"$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 1 90); do
    if [[ -f "$DATA/startup-timings.json" && -f "$DATA/layout-diagnostic.json" && -f "$DATA/input-routing.json" && -f "$DATA/interaction-test.json" ]]; then break; fi
    if ! kill -0 "$PID" 2>/dev/null; then diagnose; exit 1; fi
    sleep 1
  done
  if [[ ! -f "$DATA/startup-timings.json" || ! -f "$DATA/layout-diagnostic.json" || ! -f "$DATA/input-routing.json" || ! -f "$DATA/interaction-test.json" ]]; then
    diagnose
    echo "packaged renderer did not produce startup/layout evidence for $label" >&2
    exit 1
  fi
  [[ ! -f "$DATA/desktop-error.json" ]] || { diagnose; exit 1; }
  [[ ! -f "$DATA/renderer-gone.json" ]] || { diagnose; exit 1; }
  [[ ! -f "$DATA/renderer-errors.json" ]] || { diagnose; echo "renderer script errors detected" >&2; exit 1; }
python3 - "$DATA/startup-timings.json" "$DATA/layout-diagnostic.json" "$DATA/input-routing.json" "$DATA/interaction-test.json" "$scale" "$legacy" "$DATA/runtime-environment.json" "$ARCH" "$APP/Contents/MacOS/AI Balance Whale" <<'PYTEST'
import json, math, sys
startup = json.load(open(sys.argv[1], encoding='utf-8'))
diag = json.load(open(sys.argv[2], encoding='utf-8'))
routing = json.load(open(sys.argv[3], encoding='utf-8'))
interaction = json.load(open(sys.argv[4], encoding='utf-8'))
scale = float(sys.argv[5])
legacy = sys.argv[6] == '1'
runtime = json.load(open(sys.argv[7], encoding='utf-8'))
target_arch = sys.argv[8]
expected_executable = sys.argv[9]
if runtime.get('arch') != target_arch:
    raise SystemExit(f'packaged runtime architecture {runtime.get("arch")} does not match native target {target_arch}: {runtime}')
if runtime.get('appPackaged') is not True:
    raise SystemExit(f'smoke did not launch the packaged App: {runtime}')
if runtime.get('executablePath') != expected_executable:
    raise SystemExit('smoke executable path is not the expected extracted/installed bundle: expected=' + expected_executable + ' actual=' + str(runtime.get('executablePath')))
if interaction.get('pass') is not True:
    raise SystemExit(f'packaged interaction regression failed: {interaction}')
if interaction.get('osPointerValidated') is not False:
    raise SystemExit(f'interaction evidence must not claim OS pointer validation: {interaction}')
if routing.get('mode') != 'native-screen-hit-region':
    raise SystemExit(f'unexpected input routing mode: {routing}')
if routing.get('sizeConfigFetchBlocked') is not True:
    raise SystemExit(f'smoke did not hold the asynchronous size-config response pending: {routing}')
if not isinstance(routing.get('hitRegions'), list) or not routing['hitRegions']:
    raise SystemExit(f'missing native hit regions: {routing}')
if not any(
    isinstance(region, dict)
    and float(region.get('width', 0) or 0) >= 50
    and float(region.get('height', 0) or 0) >= 50
    for region in routing['hitRegions']
):
    raise SystemExit(f'role hit region missing; menu-only routing would pass: {routing}')
phases = startup.get('phases', {})
for key in ('appReady','dispatcherReady','windowCreated','pageLoaded','imageAndInputReady','interactive'):
    if key not in phases:
        raise SystemExit(f'missing startup phase: {key}; diagnostic={diag}')
root = diag.get('root') or {}
image = diag.get('image') or {}
viewport = diag.get('viewport') or {}
html = diag.get('html') or {}
native = diag.get('nativeFrame') or {}
def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)
def required(obj, key):
    value = obj.get(key)
    if not finite(value): raise SystemExit(f'missing/non-finite {key}: {obj}')
    return float(value)
expected = max(122.0, min(625.0, 250.0 * scale))
rw, rh = required(root, 'width'), required(root, 'height')
if abs(rw - expected) > 3 or abs(rh - expected) > 3:
    raise SystemExit(f'root geometry {rw}x{rh} does not match scale {scale} expected {expected}')
if root.get('display') == 'none' or root.get('visibility') == 'hidden' or float(root.get('opacity', 0)) <= 0:
    raise SystemExit(f'root is not visible: {root}')
for key in ('width','height'):
    if required(image, key) <= 0: raise SystemExit(f'image has no visible geometry: {image}')
if image.get('complete') is not True or int(image.get('naturalWidth') or 0) <= 0 or int(image.get('naturalHeight') or 0) <= 0:
    raise SystemExit(f'image did not load: {image}')
rl, rt = required(root, 'left'), required(root, 'top')
ir, it = required(image, 'left'), required(image, 'top')
if ir < rl - 2 or it < rt - 2 or ir + required(image, 'width') > rl + rw + 2 or it + required(image, 'height') > rt + rh + 2:
    raise SystemExit(f'image escaped root: root={root} image={image}')
document_width = required(html, 'width') if required(html, 'width') > 0 else required(viewport, 'width')
document_height = required(html, 'height') if required(html, 'height') > 0 else required(viewport, 'height')
if document_width < rw - 2 or document_height < rh - 2:
    raise SystemExit(f'root is outside document viewport: html={html} viewport={viewport} root={root}')
if required(viewport, 'scrollWidth') > required(viewport, 'width') + 2 or required(viewport, 'scrollHeight') > required(viewport, 'height') + 2:
    raise SystemExit(f'outer document overflowed: viewport={viewport}')
nw, nh = required(native, 'width'), required(native, 'height')
if abs(nw - expected) > 3 or abs(nh - expected) > 3:
    raise SystemExit(f'native frame {nw}x{nh} does not match DOM {rw}x{rh}')
if legacy and (nw < 300 or nh < 300):
    raise SystemExit(f'legacy 248x274 frame was not migrated: native={native}')
print(f'{sys.argv[5]} packaged layout and interaction passed: arch={runtime["arch"]}, root={rw:.0f}x{rh:.0f}, image={required(image,"width"):.0f}x{required(image,"height"):.0f}, native={nw:.0f}x{nh:.0f}')
PYTEST
  stop_case
}

# The first case reproduces the old 248x274 saved frame. The remaining cases
# prove that the actual packaged App follows the persisted scale without using
# the page viewport as a 122px fixed point.
run_case legacy-248x274 1.5 1
run_case min-0.6 0.6 0
run_case default-1.5 1.5 0
run_case max-2.5 2.5 0
printf 'packaged Electron standalone layout smoke passed (4 isolated launches)\n'
