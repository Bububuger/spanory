# Plan (2026-03-14) — BUB-12 `index.ts` god file 拆分

## 目标
1. 将 `packages/cli/src/index.ts` 中 setup / plugin / codex watch / command registration 逻辑拆分到独立模块。
2. 保持 CLI 行为兼容，不改变现有命令输入输出语义。
3. 通过最小相关检查与 BDD，形成可回归验证证据。

## 约束与策略
- 小步迁移：先迁函数，再接线，最后删旧代码。
- 保持现有实现语义，不引入新行为。
- 每个阶段完成后立刻执行对应 acceptance check。

## 执行顺序
1. 归档旧版 `plan.md/todo.md`，生成本阶段计划与待办。
2. 拆分 plugin 逻辑到 `src/plugin/openclaw.ts` 与 `src/plugin/opencode.ts`。
3. 拆分 codex watch 逻辑到 `src/codex/watch.ts`。
4. 拆分 setup 编排到 `src/setup/apply.ts`、`src/setup/detect.ts`、`src/setup/teardown.ts`。
5. 拆分命令注册到 `src/cli/commands.ts`，并在 `src/index.ts` 完成依赖注入接线。
6. 运行 `packages/cli` 检查与目标 BDD，修复后提交。

## 验收标准
- `index.ts` 不再包含 setup/plugin/watch/commands 主要实现。
- 新文件路径存在且被实际调用：
  - `src/setup/apply.ts`
  - `src/setup/teardown.ts`
  - `src/setup/detect.ts`
  - `src/plugin/openclaw.ts`
  - `src/plugin/opencode.ts`
  - `src/codex/watch.ts`
  - `src/cli/commands.ts`
- `npm run -w packages/cli check` 通过。
- 目标 BDD 通过：setup/openclaw/opencode/codex watch。
