#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist/desktop-demo.app}"
EXPECTED_VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"
[[ -d "$APP" ]] || { echo "App bundle missing: $APP" >&2; exit 1; }
[[ -f "$APP/Contents/Resources/app.asar" ]] || { echo "app.asar missing" >&2; exit 1; }
BINARY="$APP/Contents/MacOS/desktop-demo"
[[ -x "$BINARY" ]] || { echo "main executable missing" >&2; exit 1; }
file "$BINARY" | grep -Eqi 'arm64|universal' || { echo "main executable is not arm64: $(file "$BINARY")" >&2; exit 1; }
PLIST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[[ "$PLIST_VERSION" == "$EXPECTED_VERSION" ]] || { echo "version mismatch: $PLIST_VERSION != $EXPECTED_VERSION" >&2; exit 1; }
ASAR_LIST="$(npx --no-install asar list "$APP/Contents/Resources/app.asar")"
for required in assets/DSniang1.png assets/whale-widget.js assets/desktop-demo-dragging.svg assets/desktop-demo-received.svg assets/desktop-demo-processing.svg assets/desktop-demo-complete.svg desktop/desktop-demo-main.cjs desktop/ui/widget.html desktop/ui/desktop-demo.css desktop/ui/desktop-demo-model.js desktop/ui/desktop-demo.js desktop/standalone-main.cjs desktop/standalone-interaction-model.cjs runtime/dispatcher.mjs lib/widget-host.mjs lib/desktop-demo-state-images.mjs; do
  grep -Fq "$required" <<<"$ASAR_LIST" || { echo "missing packaged resource: $required" >&2; exit 1; }
done
if grep -Fq 'desktop/follow-main.cjs' <<<"$ASAR_LIST"; then
  echo 'legacy follow-window host must not be packaged in desktop-demo for macOS' >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$APP"
printf 'verified App=%s version=%s arch=arm64\n' "$APP" "$PLIST_VERSION"
