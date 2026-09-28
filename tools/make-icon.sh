#!/usr/bin/env bash
# Régénère tous les formats de l'icône XChess depuis public/favicon.svg.
# Usage : bash tools/make-icon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

WORKDIR="$(mktemp -d)"
trap 'rm -r "$WORKDIR"' EXIT

qlmanage -t -s 1024 -o "$WORKDIR" public/favicon.svg >/dev/null
SOURCE="$WORKDIR/favicon.svg.png"
sips -z 192 192 "$SOURCE" --out public/icon-192.png >/dev/null
sips -z 512 512 "$SOURCE" --out public/icon-512.png >/dev/null
sips -z 180 180 "$SOURCE" --out public/apple-touch-icon.png >/dev/null
magick "$SOURCE" -define icon:auto-resize=48,32,16 public/favicon.ico
bun run tauri icon public/favicon.svg --ios-color '#101b1b' --output "$WORKDIR/icons"
for name in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.png; do
  cp "$WORKDIR/icons/$name" "src-tauri/icons/$name"
done
cp "$WORKDIR/icons/ios/"*.png src-tauri/icons/ios/
# Le projet Xcode généré existe déjà sur cette machine : sa copie d'assets doit suivre la source.
if [[ -d src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset ]]; then
  cp "$WORKDIR/icons/ios/"*.png src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/
fi
