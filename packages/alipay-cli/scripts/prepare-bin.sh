#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
CLI_DIST_SRC="$REPO_ROOT/packages/cli/dist"
CLI_DIST_DST="$PACKAGE_DIR/dist"
OPENCLAW_PLUGIN_SRC="$REPO_ROOT/packages/openclaw-plugin"
OPENCLAW_PLUGIN_DST="$PACKAGE_DIR/openclaw-plugin"
OPENCLAW_PLUGIN_DIST_SRC="$OPENCLAW_PLUGIN_SRC/dist"
OPENCODE_PLUGIN_SRC="$REPO_ROOT/packages/opencode-plugin"
OPENCODE_PLUGIN_DST="$PACKAGE_DIR/opencode-plugin"
OPENCODE_PLUGIN_DIST_SRC="$OPENCODE_PLUGIN_SRC/dist"

# Build JS CLI distribution
echo "Building @bububuger/spanory dist ..."
npm run --workspace @bububuger/spanory build --prefix "$REPO_ROOT"

# Build plugin dist artifacts
echo "Building plugin dist artifacts ..."
npm run --workspace @bububuger/spanory-openclaw-plugin build --prefix "$REPO_ROOT"
npm run --workspace @bububuger/spanory-opencode-plugin build --prefix "$REPO_ROOT"

if [[ ! -d "$CLI_DIST_SRC" ]]; then
  echo "Error: missing CLI dist at $CLI_DIST_SRC" >&2
  exit 1
fi

if [[ ! -d "$OPENCLAW_PLUGIN_DIST_SRC" ]]; then
  echo "Error: missing openclaw plugin dist at $OPENCLAW_PLUGIN_DIST_SRC" >&2
  exit 1
fi

if [[ ! -d "$OPENCODE_PLUGIN_DIST_SRC" ]]; then
  echo "Error: missing opencode plugin dist at $OPENCODE_PLUGIN_DIST_SRC" >&2
  exit 1
fi

rm -rf "$CLI_DIST_DST"
cp -r "$CLI_DIST_SRC" "$CLI_DIST_DST"
chmod +x "$CLI_DIST_DST/index.js"
echo "Synced CLI dist -> $CLI_DIST_DST"

# Sync openclaw-plugin payload (needed by openclaw plugins install -l)
rm -rf "$OPENCLAW_PLUGIN_DST"
mkdir -p "$OPENCLAW_PLUGIN_DST"
cp "$OPENCLAW_PLUGIN_SRC/package.json" "$OPENCLAW_PLUGIN_DST/package.json"
cp "$OPENCLAW_PLUGIN_SRC/openclaw.plugin.json" "$OPENCLAW_PLUGIN_DST/openclaw.plugin.json"
cp -r "$OPENCLAW_PLUGIN_DIST_SRC" "$OPENCLAW_PLUGIN_DST/dist"
echo "Synced openclaw-plugin dist payload"

# Sync opencode-plugin payload (needed by opencode at runtime via file:// import)
rm -rf "$OPENCODE_PLUGIN_DST"
mkdir -p "$OPENCODE_PLUGIN_DST"
cp "$OPENCODE_PLUGIN_SRC/package.json" "$OPENCODE_PLUGIN_DST/package.json"
cp -r "$OPENCODE_PLUGIN_DIST_SRC" "$OPENCODE_PLUGIN_DST/dist"
echo "Synced opencode-plugin dist payload"

echo "package payload ready:"
ls -lh "$CLI_DIST_DST"
