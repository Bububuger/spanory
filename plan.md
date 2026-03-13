# Plan (2026-03-13) — OpenClaw 插件多路径冲突规避

## 目标
1. `spanory setup apply` 在 openclaw 插件模式下自动清理 `plugins.load.paths` 的 spanory 多路径冲突。
2. 安装后仅保留一个有效 spanory 插件路径，避免重复加载旧路径。

## 执行顺序
1. 在 `packages/cli/src/index.ts` 增加 openclaw 配置归一化函数。
2. 在 `installOpenclawPlugin` 前执行归一化并写回 `openclaw.json`（支持备份）。
3. 增加 BDD 覆盖：构造冲突路径，执行 setup apply 后断言只剩一个目标路径。
4. 运行最小测试与 BDD 全量回归。

## 验收标准
- `openclaw.json` 中 `plugins.load.paths` 不再包含多个 spanory 路径。
- `setup apply --runtimes openclaw` 后保留路径为当前插件目录。
- 相关 BDD 通过。
