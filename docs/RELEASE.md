---
type: file
summary: "发布流程全景：3通道(npm public/internal + GitHub Release)、4平台二进制、脚本清单"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [release, ci-cd, npm, binary]
---

# 发布流程

## 发布通道

| 通道 | 触发 | 产物 | 受众 |
|------|------|------|------|
| npm public | git tag `vX.Y.Z` → GHA | `@bububuger/spanory` | 外部用户 |
| npm internal | `scripts/publish-internal.sh` | `@alipay/spanory` | 内部用户 |
| GitHub Release | git tag → GHA | 4 平台二进制 + SHA256SUMS | 直接下载 |

## 发布步骤

### 1. 质量门禁（本地必过）

```bash
npm run check
npm run telemetry:check
npm test
npm run test:bdd
```

### 2. 版本打标

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 3. 自动流水线（.github/workflows/release.yml）

```
verify (check + telemetry + build + test + bdd)
  ├── build-binaries (4 平台矩阵, 并行)
  │     └── smoke test (--help)
  │           └── publish-release (GitHub Release + 二进制 + SHA256)
  └── publish-npm (@bububuger/spanory → npmjs.org)
```

### 4. 内部发布（手动）

```bash
bash scripts/publish-internal.sh
# 或手动: cd packages/alipay-cli && tnpm publish
```

### 5. 验证

```bash
npm install -g @bububuger/spanory@latest && spanory --version
tnpm install -g @alipay/spanory@latest && spanory --version
```

## 版本同步机制

- `scripts/release/sync-version.mjs` — 从 git tag 同步所有 package.json
- GHA 中 `npm version --no-git-tag-version` — 确保二进制版本与 tag 一致
- `npm run version:sync` — 本地快捷命令

## 二进制矩阵

| 平台 | 产物 | 构建环境 |
|------|------|---------|
| linux-x64 | `spanory-linux-x64` | ubuntu-latest |
| macOS-arm64 | `spanory-macos-arm64` | macos-14 |
| macOS-x64 | `spanory-macos-x64` | macos-14 |
| win-x64 | `spanory-win-x64.exe` | windows-latest |

## 发布脚本清单

| 脚本 | 用途 |
|------|------|
| `scripts/release/build-binaries.sh` | 本地二进制构建 |
| `scripts/release/build-binaries.ps1` | Windows 二进制构建 |
| `scripts/release/package-release-assets.sh` | 打包 + SHA256 |
| `scripts/release/bundle.sh` | esbuild 打包 |
| `scripts/release/sync-version.mjs` | 版本号同步 |
| `scripts/publish-internal.sh` | 内部 tnpm 发布 |

## 安装回归检查

发布前必须通过：

```bash
npm run --workspace @bububuger/spanory pack:test-install
```

## CHANGELOG 规范

遵循 [Keep a Changelog](https://keepachangelog.com/) 格式，详见 [CHANGELOG.md](../CHANGELOG.md)。
