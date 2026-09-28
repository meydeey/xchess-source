#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Tauri's iOS export moves the IPA into arm64 and fails if one is already there.
# Keep the previous signed bundle in the macOS Trash for recovery.
previous='src-tauri/gen/apple/build/arm64/XChess.ipa'
if [[ -f "$previous" ]]; then
  trash_dir="$HOME/.Trash/CHESS_THEORIE-builds"
  mkdir -p "$trash_dir"
  mv "$previous" "$trash_dir/XChess-device-$(date +%Y%m%d-%H%M%S)-$$.ipa"
fi

# The device build must bundle the web assets: a plain --debug build uses devUrl
# and opens a Vite server that the iPad cannot reach. tao 0.35.3 also crashes
# when the scene delegate is built in release mode (tao issue #1244).
bun run tauri ios build --target aarch64 --debug --config '{"build":{"devUrl":null}}' --ci
