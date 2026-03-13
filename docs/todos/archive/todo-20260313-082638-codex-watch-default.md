# Todo (2026-03-13) — Symphony Bootstrap Hardening

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] 新增 `scripts/symphony/validate-workflow.mjs`
- [x] 新增 `scripts/symphony/run-symphony.sh`
- [x] 更新 `package.json` scripts
- [x] 按 `odysseus0/symphony` skill 完成 preflight（含 `mise` 安装）
- [x] 安装 `.agents/skills`（commit/push/pull/land/linear/debug）
- [x] 从 `symphony/elixir/WORKFLOW.md` 复制并仅改 `project_slug` + `hooks.after_create`
- [x] 自动创建 Linear 必需状态（Rework/Human Review/Merging）
- [x] 自动创建 Linear 项目 `spanory`（slug: `b2f9becf3a3c`）
- [x] 运行 `npm run symphony:validate` 验收通过

## Todo (2026-03-13) — service.version 跟随新版本

- [x] 插件版本解析优先 `spanory -v`
- [x] openclaw/opencode 插件 OTLP resource 显式写入 `serviceVersion`
- [x] 构建 `@bububuger/spanory-openclaw-plugin` 与 `@bububuger/spanory-opencode-plugin`
- [x] 执行 `npm run --workspace @bububuger/spanory test:bdd` 回归通过
