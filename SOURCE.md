# XChess source

This repository is the public source snapshot for a specific XChess release. The release tag matches the build identifier shown in Settings on Mac, iPad, iPhone and web.

The application is built with Bun, Vite, JavaScript, Rust and Tauri 2. `RELEASE_ID` preserves the original build identifier when this snapshot is built from its separate Git repository. On macOS, install Bun, Rust and the Tauri prerequisites, then run `bun install --frozen-lockfile`, `bun run fetch:stockfish` and `bun run app:build`. The web build uses `bun install --frozen-lockfile` and `bun run build`. An iOS build also requires Xcode and an Apple signing profile.

The `third_party/` directory contains the source archives for the GPL components bundled with XChess. Their origins and SHA-256 checksums are listed in `THIRD_PARTY_SOURCES.md`. The application data under `catalog/` and `public/` is included so the web build can reproduce the distributed catalog and puzzle packs.

The release snapshot omits private development notes, machine configuration and Git history. For the exact release, use the tag linked from Settings.
