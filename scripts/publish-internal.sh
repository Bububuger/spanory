#!/usr/bin/env bash
# 构建并发布 @alipay/spanory 到内网 registry
# 用法: bash scripts/publish-internal.sh
# 前置: 先打好 git tag，如 git tag v0.1.21 && git push origin v0.1.21
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Syncing version from git tag ..."
node "$REPO_ROOT/scripts/release/sync-version.mjs"

echo "==> Building @alipay/spanory ..."
npm run --workspace @alipay/spanory build --prefix "$REPO_ROOT"

echo "==> Publishing @alipay/spanory ..."
cd "$REPO_ROOT/packages/alipay-cli"
tnpm publish

echo "==> Done: @alipay/spanory@$(node -p "require('./package.json').version")"
