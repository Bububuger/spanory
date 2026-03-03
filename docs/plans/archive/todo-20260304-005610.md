# Spanory TODO：修复 OpenCode 插件不触发上报并默认每轮触发（2026-03-04）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "OpenCode 插件不触发|Acceptance" plan.md todo.md`

## T2 插件触发逻辑修复
- [x] 默认 turn 模式触发（兼容 `turn/message/response` 完成类事件）
- [x] 扩展终态事件识别（兼容 `session.completed/session.end/...`）
- [x] 记录观测到的 session，并在 `onGatewayStop` 兜底 flush
- [x] 增加参数 `SPANORY_OPENCODE_FLUSH_MODE`（`turn`/`session`）

验收：
- [x] `rg -n "session\.idle|session\.deleted|session\.completed|onGatewayStop" packages/opencode-plugin/src/index.js`

## T3 测试补齐
- [x] 新增单测覆盖 `session.completed` 触发
- [x] 新增单测覆盖默认 turn 触发
- [x] 新增单测覆盖 `session` 模式参数行为
- [x] 运行 opencode runtime 单测

验收：
- [x] `npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

## T4 文档同步
- [x] 更新 `README.md`（补充 OpenCode flush 模式参数）
- [x] 更新 `docs/README_zh.md`（补充 OpenCode flush 模式参数）

验收：
- [x] `rg -n \"SPANORY_OPENCODE_FLUSH_MODE|turn|session\" README.md docs/README_zh.md`

## T5 提交与推送
- [x] 提交
- [x] 推送

验收：
- [x] `git status --short`
