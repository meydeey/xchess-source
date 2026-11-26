#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

build_number="${1:-}"
if [[ ! "$build_number" =~ ^[1-9][0-9]*$ || $# -ne 1 ]]; then
  echo 'Usage: bun run ios:build:store <positive-build-number>' >&2
  exit 2
fi
if [[ -z "${APPLE_DEVELOPMENT_TEAM:-}" ]]; then
  echo 'Set APPLE_DEVELOPMENT_TEAM for an active Apple Developer Program team.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit the intended App Store source before creating the archive.' >&2
  exit 1
fi

release="$(git rev-parse --short=12 HEAD)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/xchess-ios-store.XXXXXX")"
git archive HEAD | tar -xf - -C "$build_dir"
printf '%s\n' "$release" > "$build_dir/RELEASE_ID"
echo "XChess $release: preparing the iOS App Store build in $build_dir"

cd "$build_dir"
bun install --frozen-lockfile --ignore-scripts
bun run tauri ios init --ci --skip-targets-install
project='src-tauri/gen/apple'
cp src-tauri/icons/ios/*.png "$project/Assets.xcassets/AppIcon.appiconset/"
cp src-tauri/PrivacyInfo.xcprivacy "$project/theorie_iOS/PrivacyInfo.xcprivacy"
xcodegen generate --spec "$project/project.yml" --project "$project"
store_config="$(printf '{"build":{"devUrl":null},"bundle":{"iOS":{"bundleVersion":"%s"}}}' "$build_number")"
VITE_XCHESS_STORE=1 bun run tauri ios build --target aarch64 --export-method app-store-connect \
  --config "$store_config" --ci

archive='src-tauri/gen/apple/build/theorie_iOS.xcarchive/Products/Applications/XChess.app'
ipa='src-tauri/gen/apple/build/arm64/XChess.ipa'
test "$(plutil -extract CFBundleVersion raw -o - "$archive/Info.plist")" = "$build_number"
codesign --verify --deep --strict "$archive"
test -s "$ipa"
unzip -q "$ipa" 'Payload/*' -d exported
exported_app='exported/Payload/XChess.app'
test "$(plutil -extract CFBundleVersion raw -o - "$exported_app/Info.plist")" = "$build_number"
plutil -lint "$exported_app/PrivacyInfo.xcprivacy" >/dev/null
codesign --verify --deep --strict "$exported_app"
printf 'App Store export: %s/%s\n' "$build_dir" "$ipa"
