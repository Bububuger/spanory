# Plan (2026-03-13) — 修复 npm 全局安装失败（私有依赖泄漏）

## 目标
1. 保证用户执行 `npm i -g @bububuger/spanory` 后可直接运行 `spanory`。
2. 消除发布包对私有 workspace 包（`@bububuger/core`、相对路径 workspace dist）的运行时依赖。

## 执行顺序
1. 调整 CLI build 产物为自包含可运行入口（bundle）。
2. 修正 `packages/cli/package.json` 依赖与发布内容。
3. 增加安装回归测试（pack + 临时安装验证）。
4. 执行 unit/bdd 与安装验证。

## 验收标准
- `npm pack` 产物在临时目录安装后，`spanory -v` 正常。
- `spanory -h` 能展示命令列表。
- 现有 `test:bdd` 全通过。
