#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
CLI_DIST_SRC="$REPO_ROOT/packages/cli/dist"
CLI_DIST_DST="$PACKAGE_DIR/dist"
PLUGIN_DST="$PACKAGE_DIR/opencode-plugin"

# Build JS CLI distribution
echo "Building @bububuger/spanory dist ..."
npm run --workspace @bububuger/spanory build --prefix "$REPO_ROOT"

if [[ ! -d "$CLI_DIST_SRC" ]]; then
  echo "Error: missing CLI dist at $CLI_DIST_SRC" >&2
  exit 1
fi

rm -rf "$CLI_DIST_DST"
cp -r "$CLI_DIST_SRC" "$CLI_DIST_DST"
chmod +x "$CLI_DIST_DST/index.js"
echo "Synced CLI dist -> $CLI_DIST_DST"

# Sync opencode-plugin source (needed by opencode at runtime via file:// import)
rm -rf "$PLUGIN_DST"
cp -r "$REPO_ROOT/packages/opencode-plugin" "$PLUGIN_DST"
echo "Synced opencode-plugin"

echo "package payload ready:"
ls -lh "$CLI_DIST_DST"
