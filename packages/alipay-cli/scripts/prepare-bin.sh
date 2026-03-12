#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
BIN_DIR="$PACKAGE_DIR/bin"
PLUGIN_DST="$PACKAGE_DIR/opencode-plugin"

# Copy platform binaries (only those that exist)
for binary in spanory-macos-arm64 spanory-macos-x64 spanory-linux-x64; do
  src="$DIST_DIR/$binary"
  if [[ -f "$src" ]]; then
    cp "$src" "$BIN_DIR/$binary"
    chmod +x "$BIN_DIR/$binary"
    xattr -d com.apple.quarantine "$BIN_DIR/$binary" 2>/dev/null || true
    echo "Copied $binary"
  else
    echo "Warning: $src not found, skipping" >&2
  fi
done

chmod +x "$BIN_DIR/spanory"

# Sync opencode-plugin source (needed by opencode at runtime via file:// import)
rm -rf "$PLUGIN_DST"
cp -r "$REPO_ROOT/packages/opencode-plugin" "$PLUGIN_DST"
echo "Synced opencode-plugin"

echo "bin/ ready:"
ls -lh "$BIN_DIR"
