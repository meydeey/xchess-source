#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:---publish}"
if [[ "$mode" != '--check' && "$mode" != '--publish' ]]; then
  echo 'Usage: bun run release:all [--check|--publish]' >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Release blocked: commit all project changes first.' >&2
  exit 1
fi

release="$(git rev-parse --short=12 HEAD)"
mac_bundle='src-tauri/target/release/bundle/macos/XChess.app'
ios_bundle='src-tauri/gen/apple/build/theorie_iOS.xcarchive/Products/Applications/XChess.app'
echo "XChess release $release"

gh auth status >/dev/null
vercel whoami >/dev/null

devices=()
ipad_count=0
iphone_count=0
while IFS=$'\t' read -r kind udid; do
  [[ -n "$udid" ]] || continue
  if xcrun devicectl device info apps --device "$udid" --bundle-id com.meydeey.theorie 2>/dev/null | rg -q 'com\.meydeey\.theorie'; then
    devices+=("$udid")
    if [[ "$kind" == 'iPad' ]]; then ipad_count=$((ipad_count + 1)); fi
    if [[ "$kind" == 'iPhone' ]]; then iphone_count=$((iphone_count + 1)); fi
  fi
done < <(xcrun devicectl list devices --json-output - 2>/dev/null | jq -r '.result.devices[] | select(.hardwareProperties.reality == "physical" and .connectionProperties.pairingState == "paired") | select(.hardwareProperties.deviceType == "iPad" or .hardwareProperties.deviceType == "iPhone") | [.hardwareProperties.deviceType, .hardwareProperties.udid] | @tsv')
if (( ipad_count < 1 || iphone_count < 1 )); then
  echo 'Release blocked: an installed physical iPad and iPhone must both be available.' >&2
  exit 1
fi
echo "Physical iOS targets: $ipad_count iPad, $iphone_count iPhone"

bun test
bun run build
bun run app:build
codesign --force --deep --sign - --identifier com.meydeey.theorie "$mac_bundle"
codesign --verify --deep --strict "$mac_bundle"
bun run ios:build:device
codesign --verify --deep --strict "$ios_bundle"

python3 - "$ios_bundle/embedded.mobileprovision" "${devices[@]}" <<'PY'
import datetime, plistlib, subprocess, sys
profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', sys.argv[1]], stderr=subprocess.DEVNULL))
expiry = profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc)
if expiry <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit('Release blocked: iOS provisioning profile expired')
missing = set(sys.argv[2:]) - set(profile.get('ProvisionedDevices', []))
if missing:
    raise SystemExit('Release blocked: iOS provisioning profile excludes a target device')
print('iOS signing profile covers every target; expires', expiry.isoformat())
PY

vercel build --prod --scope toolsashys-projects-258fb7b7
if ! rg -q "$release" .vercel/output/static/index.html; then
  echo 'Release blocked: Vercel build has a different release identifier.' >&2
  exit 1
fi
if [[ "$mode" == '--check' ]]; then
  bun tools/publish-source.mjs "$release" --prepare
  echo "Release $release prepared. No app or public site was changed."
  exit 0
fi

for udid in "${devices[@]}"; do
  if ! xcrun devicectl device process launch --device "$udid" com.meydeey.theorie; then
    echo "Release blocked: unlock iOS device $udid before publishing." >&2
    exit 1
  fi
done
echo 'Physical iOS targets are unlocked and launchable.'

bun tools/publish-source.mjs "$release" --publish
backup_dir="$HOME/Library/Application Support/XChess/releases/$release-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
osascript -e 'tell application id "com.meydeey.theorie" to quit' >/dev/null 2>&1 || true
for _ in {1..20}; do
  if ! pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then break; fi
  sleep 1
done
if pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then
  echo 'Release blocked: XChess Mac is still running.' >&2
  exit 1
fi
if [[ -d /Applications/XChess.app ]]; then
  mv /Applications/XChess.app "$backup_dir/XChess.app"
fi
if ! ditto "$mac_bundle" /Applications/XChess.app; then
  if [[ -d "$backup_dir/XChess.app" && ! -e /Applications/XChess.app ]]; then mv "$backup_dir/XChess.app" /Applications/XChess.app; fi
  echo 'Mac installation failed; previous bundle is in the release backup.' >&2
  exit 1
fi
codesign --verify --deep --strict /Applications/XChess.app
open /Applications/XChess.app
sleep 3
if ! pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then
  echo 'Mac launch failed; previous bundle is in the release backup.' >&2
  exit 1
fi
echo 'Mac app installed and launched.'

for udid in "${devices[@]}"; do
  xcrun devicectl device install app --device "$udid" "$ios_bundle"
  xcrun devicectl device process launch --device "$udid" com.meydeey.theorie
done
echo 'Physical iOS apps installed and launched.'

deployment="$(vercel deploy --prebuilt --prod --scope toolsashys-projects-258fb7b7)"
echo "Vercel deployment: $deployment"
python3 - "$release" <<'PY'
import sys, urllib.request
release = sys.argv[1]
with urllib.request.urlopen('https://chess-theorie.vercel.app/', timeout=30) as response:
    page = response.read().decode('utf-8')
if release not in page or f'xchess-{release}' not in page:
    raise SystemExit('Web smoke test failed: release ID or public source tag missing')
print('Web production serves release', release)
PY

if [[ -d /Applications/Théorie.app ]]; then
  trash_dir="$HOME/.Trash/CHESS_THEORIE-builds"
  mkdir -p "$trash_dir"
  mv /Applications/Théorie.app "$trash_dir/Théorie-$(date +%Y%m%d-%H%M%S).app"
fi
echo "Release $release installed on Mac and physical iOS devices, and deployed on web."
echo "Mac rollback bundle: $backup_dir/XChess.app"
