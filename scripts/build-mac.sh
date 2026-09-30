#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
BUNDLE_VERSION="${BUNDLE_VERSION:-${VERSION%%-*}}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
ARCH="${ARCH:-arm64}"
case "$ARCH" in x64|x86_64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo "unsupported macOS arch: $ARCH" >&2; exit 2 ;; esac
DIST="${OUTPUT_DIR:-$ROOT/dist}"
ICON="$ROOT/build/AI Balance Whale-$ARCH.icns"
PACKAGER_OUT="$DIST/.packager-darwin-$ARCH"
APP="$DIST/AI Balance Whale.app"
mkdir -p "$DIST" "$ROOT/build"
bash scripts/make-mac-icon.sh assets/DSniang1.png "$ICON"

# Keep architecture outputs isolated and never clear the caller's whole dist
# directory; this also allows x64 and arm64 jobs to share an artifact layout.
rm -rf "$PACKAGER_OUT"
npx electron-packager . "AI Balance Whale" \
  --platform=darwin \
  --arch="$ARCH" \
  --out="$PACKAGER_OUT" \
  --overwrite \
  --asar \
  --prune=true \
  --app-bundle-id=com.404404.deepseekbalancewhale \
  --app-version="$BUNDLE_VERSION" \
  --build-version="$BUILD_NUMBER" \
  --icon="$ICON" \
  --extend-info="$ROOT/desktop/mac-info.plist" \
  --ignore='^dist(/|$)|(^|/)(\.git|\.github|build|qa-output|tests|docs|scripts|skills)(/|$)|(^|/)(desktop/(follow-main\.cjs|WindowApi\.cs|WhaleLauncher\.cs|supervisor\.ps1)|assets/DSH2\.png|package-lock\.json)'

PACKAGED="$PACKAGER_OUT/AI Balance Whale-darwin-$ARCH/AI Balance Whale.app"
if [[ ! -d "$PACKAGED" ]]; then echo "electron-packager did not produce $PACKAGED" >&2; exit 1; fi
rm -rf "$APP"
mv "$PACKAGED" "$APP"
codesign --deep --force --verbose --sign - "$APP"
ARCH="$ARCH" VERSION="$VERSION" BUNDLE_VERSION="$BUNDLE_VERSION" BUILD_NUMBER="$BUILD_NUMBER" bash scripts/verify-mac-app.sh "$APP"
printf 'macOS target=%s host=%s Node=%s Electron=%s\n' "$ARCH" "$(uname -m)" "$(node --version)" "$(node -p "require('electron/package.json').version")"
du -sh "$APP" "$APP/Contents/Resources/app.asar"
