# Spanory 计划：macOS 二进制区分 ARM/Intel（2026-03-03）

## Goal
为 GitHub Release 增加 Intel Mac（darwin-x64）二进制，避免仅提供 ARM 包导致 Intel 用户无法直接使用。

## Scope
- In scope:
  - `.github/workflows/release.yml`：增加 `macos-x64` 构建项。
  - `packages/cli/package.json`：增加 `build:bin:macos-x64`。
  - `scripts/release/package-release-assets.sh`：增加 `darwin-x64` 打包与校验清单。
  - `README.md`、`docs/README_zh.md`：明确 macOS 架构选择。
  - `plan.md`、`todo.md`：记录本阶段执行。
- Out of scope:
  - 新增自动探测本机架构并自动下载脚本。
  - 包管理器发布（brew/scoop/apt）。

## Acceptance
- Release 构建产物新增：`spanory-macos-x64`。
- Release 附件新增：`spanory-<version>-darwin-x64.tar.gz`。
- `SHA256SUMS.txt` 包含 4 个平台压缩包（darwin-arm64、darwin-x64、linux-x64、windows-x64）。
- 中英文 README 均明确 M 芯片与 Intel 下载差异。
- 本地命令回归通过：`npm run check`。
