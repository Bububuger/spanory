#!/usr/bin/env bash
set -euo pipefail

VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "0.0.0")
echo "Bundling with version: $VERSION"

exec esbuild "$@" --define:process.env.SPANORY_VERSION="\"$VERSION\""
