#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

build_number="${1:-}"
if [[ ! "$build_number" =~ ^[1-9][0-9]*$ || $# -ne 1 ]]; then
  echo 'Usage: bun run macos:build:store <positive-build-number>' >&2
  exit 2
fi
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" || -z "${APPLE_INSTALLER_SIGNING_IDENTITY:-}" ]]; then
  echo 'Set the Apple Distribution and Mac Installer Distribution signing identities.' >&2
  exit 1
fi
if [[ "${APPLE_MAC_PROFILE:-}" != /* || ! -f "$APPLE_MAC_PROFILE" ]]; then
  echo 'Set APPLE_MAC_PROFILE to the absolute path of the Mac App Store Connect profile.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit the intended App Store source before creating the package.' >&2
  exit 1
fi

release="$(git rev-parse --short=12 HEAD)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/xchess-macos-store.XXXXXX")"
git archive HEAD | tar -xf - -C "$build_dir"
printf '%s\n' "$release" > "$build_dir/RELEASE_ID"
echo "XChess $release: preparing the Mac App Store package in $build_dir"

cd "$build_dir"
export CARGO_TARGET_DIR="$build_dir/src-tauri/target"
security cms -D -i "$APPLE_MAC_PROFILE" > profile.plist
python3 - <<'PY'
import datetime
import plistlib

with open("profile.plist", "rb") as file:
    profile = plistlib.load(file)
if profile["ExpirationDate"] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit("The Mac App Store Connect provisioning profile has expired.")
claims = profile["Entitlements"]
identifier = claims.get("com.apple.application-identifier", "")
team = claims.get("com.apple.developer.team-identifier")
development = claims.get("get-task-allow") or claims.get("com.apple.security.get-task-allow")
if not identifier.endswith(".com.meydeey.theorie") or not team or development or profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
    raise SystemExit("Use a distribution profile for the XChess bundle identifier.")
with open("app-entitlements.plist", "wb") as file:
    plistlib.dump({
        "com.apple.application-identifier": identifier,
        "com.apple.developer.team-identifier": team,
        "com.apple.security.app-sandbox": True,
        "com.apple.security.files.user-selected.read-write": True,
        "com.apple.security.network.client": True,
    }, file)
PY

bun install --frozen-lockfile --ignore-scripts
# Stockfish's SIMD instructions require the WebKit generation shipped with macOS 13.3.
store_config="$(printf '{"build":{"devUrl":null},"app":{"security":{"capabilities":["default"]}},"bundle":{"externalBin":[],"macOS":{"minimumSystemVersion":"13.3","bundleVersion":"%s"}}}' "$build_number")"
VITE_XCHESS_STORE=1 VITE_XCHESS_ENGINE=wasm bun run tauri build --bundles app --target aarch64-apple-darwin --no-sign --config "$store_config"
app='src-tauri/target/aarch64-apple-darwin/release/bundle/macos/XChess.app'
test "$(plutil -extract CFBundleVersion raw -o - "$app/Contents/Info.plist")" = "$build_number"
cmp src-tauri/PrivacyInfo.xcprivacy "$app/Contents/Resources/PrivacyInfo.xcprivacy"
test ! -e "$app/Contents/MacOS/stockfish"
cp "$APPLE_MAC_PROFILE" "$app/Contents/embedded.provisionprofile"
codesign --force --sign "$APPLE_SIGNING_IDENTITY" --entitlements app-entitlements.plist "$app"
codesign --verify --deep --strict "$app"
xcrun productbuild --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" --component "$app" /Applications XChess.pkg
pkgutil --check-signature XChess.pkg >/dev/null
printf 'Mac App Store package: %s/XChess.pkg\n' "$build_dir"
