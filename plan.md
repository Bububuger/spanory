# Plan (2026-03-12) — 本地发版与二进制验证

## 目标
在不推送远端的前提下完成一次本地新版本发布：版本号更新、二进制重建、本地验证通过、打本地 tag。

## 步骤
1. 提交当前待发布改动（版本机制修复 + 文档更新）。
2. bump CLI 版本到新 patch（0.1.17），生成 release commit。
3. 构建本地二进制并验证 `--version/--help`。
4. 本地创建 `v0.1.17` tag（不 push）。

## 验收
- `git log` 存在 release commit。
- `./dist/spanory-macos-arm64 --version` 为 `0.1.17`。
- 本地存在 tag `v0.1.17`。
- 没有执行任何 push。
