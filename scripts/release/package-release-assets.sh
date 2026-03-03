#!/usr/bin/env bash
set -euo pipefail

VERSION_TAG="${1:-}"
DIST_DIR="${2:-dist}"
OUT_DIR="${3:-$DIST_DIR/release}"

if [[ -z "$VERSION_TAG" ]]; then
  echo "Usage: $0 <version-tag> [dist-dir] [out-dir]" >&2
  echo "Example: $0 v0.2.0" >&2
  exit 1
fi

VERSION="${VERSION_TAG#v}"

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

copy_binary() {
  local src="$1"
  local target_name="$2"

  if [[ ! -f "$src" ]]; then
    echo "Missing binary: $src" >&2
    exit 1
  fi

  cp "$src" "$target_name"
}

package_unix() {
  local input_file="$1"
  local platform="$2"
  local stage_dir="$TMP_DIR/$platform"
  local archive_name="spanory-${VERSION}-${platform}.tar.gz"

  mkdir -p "$stage_dir"
  copy_binary "$DIST_DIR/$input_file" "$stage_dir/spanory"
  chmod +x "$stage_dir/spanory"
  tar -C "$stage_dir" -czf "$OUT_DIR/$archive_name" spanory
}

package_windows() {
  local input_file="$1"
  local platform="$2"
  local stage_dir="$TMP_DIR/$platform"
  local archive_name="spanory-${VERSION}-${platform}.zip"

  mkdir -p "$stage_dir"
  copy_binary "$DIST_DIR/$input_file" "$stage_dir/spanory.exe"
  (cd "$stage_dir" && zip -q "$OUT_DIR/$archive_name" spanory.exe)
}

package_unix "spanory-linux-x64" "linux-x64"
package_unix "spanory-macos-arm64" "darwin-arm64"
package_unix "spanory-macos-x64" "darwin-x64"
package_windows "spanory-win-x64.exe" "windows-x64"

(
  cd "$OUT_DIR"
  files=(
    "spanory-${VERSION}-darwin-arm64.tar.gz"
    "spanory-${VERSION}-darwin-x64.tar.gz"
    "spanory-${VERSION}-linux-x64.tar.gz"
    "spanory-${VERSION}-windows-x64.zip"
  )

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${files[@]}" > SHA256SUMS.txt
  else
    shasum -a 256 "${files[@]}" > SHA256SUMS.txt
  fi
)

echo "Release assets ready in $OUT_DIR"
ls -1 "$OUT_DIR"
