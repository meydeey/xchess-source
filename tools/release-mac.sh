#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:---check}"
if [[ "$mode" != '--check' && "$mode" != '--install' ]]; then
  echo 'Usage: bun run release:mac [--check|--install]' >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Mac release blocked: commit project changes first.' >&2
  exit 1
fi
release="$(git rev-parse --short=12 HEAD)"
bundle='src-tauri/target/release/bundle/macos/XChess.app'
bun test
bun run app:build
codesign --force --deep --sign - --identifier com.meydeey.theorie "$bundle"
codesign --verify --deep --strict "$bundle"
if [[ "$mode" == '--check' ]]; then
  echo "Mac candidate $release built and signed locally. No installed app changed."
  exit 0
fi
# Publish the matching GPL source before distributing the installed binary.
bun tools/publish-source.mjs "$release" --publish
backup_dir="$HOME/Library/Application Support/XChess/releases/$release-mac-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 -p "$backup_dir"
osascript -e 'tell application id "com.meydeey.theorie" to quit' >/dev/null 2>&1 || true
for _ in {1..20}; do
  if ! pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then break; fi
  sleep 1
done
if pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then
  echo 'Mac release blocked: close XChess so its data can be backed up.' >&2
  exit 1
fi
for folder in 'Application Support' WebKit; do
  source="$HOME/Library/$folder/com.meydeey.theorie"
  if [[ -d "$source" ]]; then
    ditto "$source" "$backup_dir/data/$folder/com.meydeey.theorie"
    diff -qr "$source" "$backup_dir/data/$folder/com.meydeey.theorie"
  fi
done
if [[ -d /Applications/XChess.app ]]; then
  ditto /Applications/XChess.app "$backup_dir/XChess.app"
fi
# ditto merges directories: move the old bundle first to exclude stale resources.
if [[ -d /Applications/XChess.app ]]; then
  mv /Applications/XChess.app "$backup_dir/installed-old.app"
fi
restore_app() {
  if [[ -d /Applications/XChess.app ]]; then
    mv /Applications/XChess.app "$backup_dir/failed-candidate.app"
  fi
  if [[ -d "$backup_dir/installed-old.app" ]]; then
    mv "$backup_dir/installed-old.app" /Applications/XChess.app
  fi
}
if ! ditto "$bundle" /Applications/XChess.app; then
  restore_app
  exit 1
fi
if ! codesign --verify --deep --strict /Applications/XChess.app; then
  restore_app
  exit 1
fi
open /Applications/XChess.app
sleep 3
if ! pgrep -f '/Applications/XChess.app/Contents/MacOS/theorie' >/dev/null; then
  restore_app
  echo "Mac launch failed. Previous application restored; data backup: $backup_dir" >&2
  exit 1
fi
python3 - "$backup_dir" "$release" <<'PY'
import datetime, json, pathlib, sys
path = pathlib.Path(sys.argv[1]) / 'delivery-receipt.json'
path.write_text(json.dumps({'release':sys.argv[2], 'platform':'mac', 'installed':'/Applications/XChess.app', 'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'signatureVerified':True, 'processLaunched':True, 'otherPlatformsDelivered':False}, indent=2))
PY
echo "Mac validation release $release installed. iOS and web unchanged."
echo "Rollback application and data: $backup_dir"
