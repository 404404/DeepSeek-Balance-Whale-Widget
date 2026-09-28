#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist/desktop-demo.app}"
OUT="${2:-$ROOT/qa-output/desktop-demo-smoke}"
DATA="$OUT/data"
LOG="$OUT/demo-app.log"
PID=''
APP_BIN="$APP/Contents/MacOS/desktop-demo"

[[ -d "$APP" ]] || { echo "App bundle missing: $APP" >&2; exit 1; }
[[ -x "$APP_BIN" ]] || { echo "App executable missing: $APP_BIN" >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$DATA"
stop_app() {
  if [[ -n "$PID" ]]; then
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    PID=''
  fi
}
diagnose() {
  echo "--- packaged desktop-demo app stdout/stderr ---" >&2
  cat "$LOG" >&2 || true
  for name in desktop-error.json bridge-error.json renderer-gone.json startup-timings.json layout-diagnostic.json input-routing.json renderer-errors.json desktop-demo-smoke.json; do
    if [[ -f "$DATA/$name" ]]; then
      echo "--- $DATA/$name ---" >&2
      cat "$DATA/$name" >&2 || true
    fi
  done
  echo "--- Demo screenshots and data ---" >&2
  find "$DATA" -maxdepth 2 -type f -print >&2 || true
}
trap stop_app EXIT

ELECTRON_ENABLE_LOGGING=1 DESKTOP_DEMO_TEST=1 DESKTOP_DEMO_HOME="$DATA" "$APP_BIN" \
  --standalone --desktop-demo-smoke --enable-logging=stderr --desktop-demo-data="$DATA" >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 120); do
  if [[ -f "$DATA/desktop-demo-smoke.json" ]]; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then
    sleep 1
    [[ -f "$DATA/desktop-demo-smoke.json" ]] || { diagnose; echo 'packaged desktop-demo App exited before producing smoke evidence' >&2; exit 1; }
    break
  fi
  sleep 1
done
if [[ ! -f "$DATA/desktop-demo-smoke.json" ]]; then
  diagnose
  echo 'packaged desktop-demo smoke did not finish within 120 seconds' >&2
  exit 1
fi
[[ ! -f "$DATA/desktop-error.json" ]] || { diagnose; exit 1; }
[[ ! -f "$DATA/renderer-gone.json" ]] || { diagnose; exit 1; }
[[ ! -f "$DATA/renderer-errors.json" ]] || { diagnose; echo 'renderer script errors detected during desktop-demo smoke' >&2; exit 1; }
python3 - "$DATA/desktop-demo-smoke.json" "$DATA/input-routing.json" "$DATA/desktop-demo-screenshots" <<'PYTEST'
import json, os, sys
evidence = json.load(open(sys.argv[1], encoding='utf-8'))
routing = json.load(open(sys.argv[2], encoding='utf-8'))
screenshots_dir = sys.argv[3]
if evidence.get('version') != 'desktop-demo-smoke-1' or evidence.get('pass') is not True:
    raise SystemExit(f'packaged desktop-demo interaction failed: {evidence}')
if evidence.get('syntheticInputOnly') is not True:
    raise SystemExit(f'desktop-demo smoke must identify synthetic input: {evidence}')
for key in ('finderNativeDropValidated', 'physicalImeValidated', 'mousePassthroughValidated'):
    if evidence.get(key) is not False:
        raise SystemExit(f'desktop-demo smoke must not claim physical OS validation for {key}: {evidence}')
expected = {
    'demo-controller-loaded-in-packaged-renderer',
    'hover-controls-stack-vertically',
    'settings-dialog-hides-hover-controls',
    'message-button-and-chat-panel-geometry',
    'ime-composition-and-shift-enter-do-not-submit',
    'selected-model-and-local-chat-reply',
    'multiple-attachments-render-with-type-and-size',
    'attachment-only-chat-message',
    'file-drop-opens-choice-surface',
    'send-to-chat-queues-file-without-auto-send',
    'avatar-switches-during-drag-state',
    'persisted-custom-received-image-loads-in-avatar',
    'assistant-route-opens-a-task-card',
    'assistant-task-enters-waiting-state',
    'assistant-task-enters-processing-state',
    'assistant-task-completes-with-local-demo-result',
    'closing-task-restores-default-avatar-state',
    'drop-image-route-opens-state-assignment',
    'state-image-settings-shows-saved-preview',
    'state-image-persistence-does-not-save-source-path',
}
steps = {step.get('name'): step for step in evidence.get('steps', [])}
missing = sorted(expected - set(steps))
failed = [name for name in expected if not steps.get(name, {}).get('pass')]
if missing or failed:
    raise SystemExit(f'packaged desktop-demo assertions missing={missing} failed={failed}; evidence={evidence}')
if routing.get('mode') != 'native-screen-hit-region' or not routing.get('hitRegions'):
    raise SystemExit(f'packaged desktop-demo did not report native hit regions: {routing}')
if not any(float(region.get('width', 0) or 0) >= 250 and float(region.get('height', 0) or 0) >= 100 for region in routing['hitRegions']):
    raise SystemExit(f'chat surface is missing from native hit regions: {routing}')
shots = evidence.get('screenshots', [])
if len(shots) < 6:
    raise SystemExit(f'missing Demo screenshot evidence: {shots}')
for name in shots:
    file = os.path.join(screenshots_dir, name)
    if not os.path.isfile(file) or os.path.getsize(file) < 1024:
        raise SystemExit(f'missing or empty Demo screenshot: {file}')
print(f"packaged desktop-demo smoke passed: {len(expected)} interaction assertions, {len(shots)} screenshots; synthetic Electron/DOM input only")
PYTEST
stop_app
printf 'packaged macOS desktop-demo smoke passed\n'
