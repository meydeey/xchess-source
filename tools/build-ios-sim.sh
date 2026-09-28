#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Tauri 2 moves the archived app into arm64-sim and fails if a prior app occupies
# that path. Preserve the old bundle in the macOS Trash before rebuilding.
previous='src-tauri/gen/apple/build/arm64-sim/XChess.app'
if [[ -d "$previous" ]]; then
  trash_dir="$HOME/.Trash/CHESS_THEORIE-builds"
  mkdir -p "$trash_dir"
  mv "$previous" "$trash_dir/XChess-sim-$(date +%Y%m%d-%H%M%S)-$$.app"
fi

bun run tauri ios build --target aarch64-sim --debug --no-sign --ci
