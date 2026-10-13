#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist/desktop-demo.app}"
VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"
ARCH="${ARCH:-arm64}"
case "$ARCH" in x64|x86_64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo "unsupported macOS arch: $ARCH" >&2; exit 2 ;; esac
OUTPUT="${2:-$ROOT/dist/desktop-demo-macos-${VERSION}-${ARCH}.dmg}"
[[ -d "$APP" ]] || { echo "App bundle missing: $APP" >&2; exit 1; }
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/desktop-demo-dmg.XXXXXX")"
MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/desktop-demo-mount.XXXXXX")"
ATTACHED=0
cleanup() {
  if [[ "$ATTACHED" == 1 ]]; then hdiutil detach "$MOUNT" -quiet || true; fi
  rm -rf "$STAGE" "$MOUNT"
}
trap cleanup EXIT
cp -R "$APP" "$STAGE/desktop-demo.app"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
CREATED=0
for attempt in 1 2 3; do
  if hdiutil create -volname "desktop-demo ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$OUTPUT" >/dev/null 2>"$MOUNT/create-error"; then
    CREATED=1
    break
  fi
  rm -f "$OUTPUT"
  if [[ "$attempt" -lt 3 ]]; then sleep "$attempt"; fi
done
if [[ "$CREATED" != 1 ]]; then
  cat "$MOUNT/create-error" >&2 || true
  hdiutil info >&2 || true
  exit 1
fi
for _ in 1 2 3 4 5; do
  if hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$OUTPUT" >/dev/null 2>"$MOUNT/attach-error"; then
    ATTACHED=1
    break
  fi
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  sleep 1
done
if [[ "$ATTACHED" != 1 ]]; then
  cat "$MOUNT/attach-error" >&2 || true
  exit 1
fi
[[ -d "$MOUNT/desktop-demo.app" ]] || { echo 'DMG missing App' >&2; exit 1; }
[[ -L "$MOUNT/Applications" ]] || { echo 'DMG missing Applications shortcut' >&2; exit 1; }
ARCH="$ARCH" VERSION="$VERSION" bash scripts/verify-mac-app.sh "$MOUNT/desktop-demo.app"
hdiutil detach "$MOUNT" -quiet
ATTACHED=0
shasum -a 256 "$OUTPUT" | tee "${OUTPUT}.sha256"
printf 'created %s\n' "$OUTPUT"
