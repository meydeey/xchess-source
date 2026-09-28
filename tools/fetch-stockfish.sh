#!/usr/bin/env bash
# Downloads official Stockfish 19 (macOS universal), installs tools/bin/stockfish for the build tools,
# and the Apple Silicon slice as the Tauri sidecar src-tauri/binaries/stockfish-aarch64-apple-darwin.
# Both outputs are git-ignored. Idempotent.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sf.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
if [ ! -x "$ROOT/tools/bin/stockfish" ]; then
  curl -sfL "$URL" -o "$TMP/sf.tgz"
  tar xzf "$TMP/sf.tgz" -C "$TMP"
  mkdir -p "$ROOT/tools/bin"
  cp "$TMP/stockfish/stockfish-macos-universal" "$ROOT/tools/bin/stockfish"
  chmod +x "$ROOT/tools/bin/stockfish"
fi
mkdir -p "$ROOT/src-tauri/binaries"
lipo -thin arm64 "$ROOT/tools/bin/stockfish" -output "$ROOT/src-tauri/binaries/stockfish-aarch64-apple-darwin"
chmod +x "$ROOT/src-tauri/binaries/stockfish-aarch64-apple-darwin"
printf 'uci\nquit\n' | "$ROOT/tools/bin/stockfish" | grep '^id name'
