#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

mkdir -p dist

TARGET="${1:-host}"

build_host() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)
      npm run --workspace @spanory/spanory build:bin:macos-arm64
      ;;
    Darwin-x86_64)
      npm run --workspace @spanory/spanory build:bin:macos-x64
      ;;
    Linux-x86_64)
      npm run --workspace @spanory/spanory build:bin:linux-x64
      ;;
    *)
      echo "Unsupported host platform for host build: $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac
}

build_all() {
  npm run --workspace @spanory/spanory build:bin:macos-arm64
  npm run --workspace @spanory/spanory build:bin:macos-x64
  npm run --workspace @spanory/spanory build:bin:linux-x64
  npm run --workspace @spanory/spanory build:bin:win-x64
}

if [[ "$TARGET" == "all" ]]; then
  build_all
else
  build_host
fi

echo "Binary build complete. Outputs:"
ls -1 dist/spanory* 2>/dev/null || true
