# Plan (2026-03-14) — BUB-33 命令层级收敛与重复入口治理

## 目标
1. 将最常用插件维护操作提升到顶级命令：`spanory install|doctor|uninstall`。
2. 统一 `setup apply --runtimes openclaw` 与 `runtime openclaw plugin install` 的安装行为，避免实现分叉。
3. 保持兼容：现有 `runtime <runtime> plugin ...` 入口继续可用。

## 执行顺序
1. 复现当前 CLI 层级深度与重复入口差异，固定修复目标。
2. 在 `packages/cli/src/index.ts` 抽取共享安装/诊断/卸载执行器，并挂载顶级命令。
3. 调整 `setup apply` 复用同一 openclaw 安装执行器，消除行为偏差。
4. 增加/更新 `packages/cli/test/unit` 测试覆盖顶级命令与 setup/runtime 行为一致性。
5. 运行最小必要测试验证并完成提交。

## 验收标准
- `spanory install --runtime openclaw|opencode`、`spanory doctor --runtime openclaw|opencode`、`spanory uninstall --runtime openclaw|opencode` 可直接执行。
- `setup apply --runtimes openclaw` 与 `runtime openclaw plugin install` 走同一实现路径（行为无分叉）。
- 保持现有 runtime 子命令兼容，相关测试通过。
