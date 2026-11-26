#!/usr/bin/env bash
# Régénère les icônes XChess depuis le cavalier ambré.
# Usage : bash tools/make-icon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

WORKDIR="$(mktemp -d)"
trap 'rm -r "$WORKDIR"' EXIT

SOURCE="public/art/brand-icon.png"
sips -z 192 192 "$SOURCE" --out public/icon-192.png >/dev/null
sips -z 512 512 "$SOURCE" --out public/icon-512.png >/dev/null
sips -z 180 180 "$SOURCE" --out public/apple-touch-icon.png >/dev/null
magick "$SOURCE" -define icon:auto-resize=48,32,16 public/favicon.ico
magick "$SOURCE" -resize 64x64 -strip "$WORKDIR/favicon-64.png"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,%s"/></svg>\n'   "$(base64 -i "$WORKDIR/favicon-64.png" | tr -d '\n')" > public/favicon.svg
bun run tauri icon "$SOURCE" --ios-color '#141416' --output "$WORKDIR/icons"
magick "$WORKDIR/icons/ios/AppIcon-512@2x.png" -background '#141416' -alpha remove -alpha off \
  PNG24:"$WORKDIR/ios-marketing.png"
mv "$WORKDIR/ios-marketing.png" "$WORKDIR/icons/ios/AppIcon-512@2x.png"
for name in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.png; do
  cp "$WORKDIR/icons/$name" "src-tauri/icons/$name"
done
cp "$WORKDIR/icons/ios/"*.png src-tauri/icons/ios/
# Le projet Xcode généré existe déjà sur cette machine : sa copie d'assets doit suivre la source.
if [[ -d src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset ]]; then
  cp "$WORKDIR/icons/ios/"*.png src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/
fi
