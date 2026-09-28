#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
MAC_ARCH="${MAC_ARCH:-arm64}"
case "$MAC_ARCH" in arm64|x64) ;; *) echo "unsupported macOS architecture: $MAC_ARCH" >&2; exit 1 ;; esac
DIST="$ROOT/dist"
ICON="$ROOT/build/desktop-demo.icns"
rm -rf "$DIST" "$ROOT/build"
mkdir -p "$DIST" "$ROOT/build"
bash scripts/make-mac-icon.sh assets/DSniang1.png "$ICON"

npx electron-packager . "desktop-demo" \
  --platform=darwin \
  --arch="$MAC_ARCH" \
  --out="$DIST" \
  --overwrite \
  --asar \
  --prune=true \
  --app-bundle-id=com.404404.desktopdemo \
  --app-version="$VERSION" \
  --build-version="$BUILD_NUMBER" \
  --icon="$ICON" \
  --ignore='^dist(/|$)|(^|/)(\.git|\.github|build|qa-output|tests|docs|scripts|skills)(/|$)|(^|/)(desktop/(follow-main\.cjs|WindowApi\.cs|WhaleLauncher\.cs|supervisor\.ps1)|assets/DSH2\.png|package-lock\.json)'

PACKAGED="$DIST/desktop-demo-darwin-$MAC_ARCH/desktop-demo.app"
if [[ ! -d "$PACKAGED" ]]; then
  echo "electron-packager did not produce $PACKAGED" >&2
  exit 1
fi
mv "$PACKAGED" "$DIST/desktop-demo.app"
rmdir "$DIST/desktop-demo-darwin-$MAC_ARCH" 2>/dev/null || true
codesign --deep --force --verbose --sign - "$DIST/desktop-demo.app"
VERSION="$VERSION" BUILD_NUMBER="$BUILD_NUMBER" MAC_ARCH="$MAC_ARCH" bash scripts/verify-mac-app.sh "$DIST/desktop-demo.app"
# Electron's native runtime is the dominant payload; report the split so CI and
# release notes distinguish unavoidable runtime size from app resources.
du -sh "$DIST/desktop-demo.app" "$DIST/desktop-demo.app/Contents/Resources/app.asar"
