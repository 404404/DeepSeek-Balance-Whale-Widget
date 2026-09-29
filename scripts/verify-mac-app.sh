#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist/AI Balance Whale.app}"
RELEASE_VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"
EXPECTED_VERSION="${BUNDLE_VERSION:-${RELEASE_VERSION%%-*}}"
EXPECTED_BUILD="${BUILD_NUMBER:-1}"
EXPECTED_ARCH="${ARCH:-arm64}"
[[ -d "$APP" ]] || { echo "App bundle missing: $APP" >&2; exit 1; }
[[ -f "$APP/Contents/Resources/app.asar" ]] || { echo "app.asar missing" >&2; exit 1; }
BINARY="$APP/Contents/MacOS/AI Balance Whale"
[[ -x "$BINARY" ]] || { echo "main executable missing" >&2; exit 1; }
case "$EXPECTED_ARCH" in x64|x86_64) EXPECTED_ARCH=x86_64 ;; arm64|aarch64) EXPECTED_ARCH=arm64 ;; *) echo "unsupported expected arch: $EXPECTED_ARCH" >&2; exit 2 ;; esac
lipo "$BINARY" -verify_arch "$EXPECTED_ARCH" || { echo "main executable is not $EXPECTED_ARCH: $(file "$BINARY")" >&2; exit 1; }
FRAMEWORK="$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
[[ -f "$FRAMEWORK" ]] || { echo 'Electron Framework binary missing' >&2; exit 1; }
lipo "$FRAMEWORK" -verify_arch "$EXPECTED_ARCH" || { echo "Electron Framework is not $EXPECTED_ARCH: $(file "$FRAMEWORK")" >&2; exit 1; }
PLIST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[[ "$PLIST_VERSION" == "$EXPECTED_VERSION" ]] || { echo "version mismatch: $PLIST_VERSION != $EXPECTED_VERSION" >&2; exit 1; }
PLIST_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
[[ "$PLIST_BUILD" == "$EXPECTED_BUILD" ]] || { echo "bundle build mismatch: $PLIST_BUILD != $EXPECTED_BUILD" >&2; exit 1; }
ASAR_LIST="$(npx --no-install asar list "$APP/Contents/Resources/app.asar")"
for required in assets/DSniang1.png assets/whale-widget.js desktop/ui/widget.html desktop/standalone-main.cjs desktop/standalone-interaction-model.cjs runtime/dispatcher.mjs lib/widget-host.mjs; do
  grep -Fq "$required" <<<"$ASAR_LIST" || { echo "missing packaged resource: $required" >&2; exit 1; }
done
if grep -Fq 'desktop/follow-main.cjs' <<<"$ASAR_LIST"; then
  echo 'legacy follow-window host must not be packaged in the macOS App' >&2
  exit 1
fi
MINIMUM_OS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist" 2>/dev/null || true)"
[[ -n "$MINIMUM_OS" ]] || { echo 'minimum macOS version is not declared in Info.plist' >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP"
printf 'verified App=%s bundle-version=%s build=%s release-version=%s arch=%s minimum-macos=%s\n' "$APP" "$PLIST_VERSION" "$PLIST_BUILD" "$RELEASE_VERSION" "$EXPECTED_ARCH" "$MINIMUM_OS"
