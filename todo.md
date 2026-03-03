# Spanory TODO：macOS 二进制区分 ARM/Intel（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "macOS 二进制区分 ARM/Intel|Acceptance" plan.md todo.md`

## T2 构建与打包链路补齐 Intel Mac
- [x] `packages/cli/package.json` 新增 `build:bin:macos-x64`
- [x] `release.yml` 增加 `macos-x64` matrix
- [x] 打包脚本新增 `darwin-x64.tar.gz` 与 checksum

验收：
- [x] `rg -n "macos-x64|darwin-x64|spanory-macos-x64" packages/cli/package.json .github/workflows/release.yml scripts/release/package-release-assets.sh`

## T3 文档同步
- [x] 更新 `README.md`（macOS 架构下载说明）
- [x] 更新 `docs/README_zh.md`（同等说明）

验收：
- [x] `rg -n "darwin-arm64|darwin-x64|Apple Silicon|Intel" README.md docs/README_zh.md`

## T4 回归与提交
- [x] `npm run check`
- [ ] 提交改动

验收：
- [x] 命令 0 退出
- [ ] `git status` clean（提交后）
