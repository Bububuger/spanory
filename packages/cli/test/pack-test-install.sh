#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spanory-pack-install.XXXXXX")"
PACK_DIR="$TMP_DIR/pack"
PREFIX_DIR="$TMP_DIR/prefix"
mkdir -p "$PACK_DIR" "$PREFIX_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"
npm run build >/dev/null
TARBALL_NAME="$(npm pack --silent --pack-destination "$PACK_DIR" | tail -n 1)"
TARBALL_PATH="$PACK_DIR/$TARBALL_NAME"

npm install -g --prefix "$PREFIX_DIR" "$TARBALL_PATH" --registry=https://registry.npmjs.org --omit=dev >/dev/null

"$PREFIX_DIR/bin/spanory" -v >/dev/null
"$PREFIX_DIR/bin/spanory" -h >/dev/null

echo "ok tarball=$TARBALL_NAME"
