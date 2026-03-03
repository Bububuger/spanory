# Spanory TODO：修复 Codex notify 脚本仅支持参数 payload 问题（2026-03-04）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "stdin|payload 为空|Acceptance" plan.md todo.md`

## T2 修复脚本模板
- [x] 更新 `packages/cli/src/index.js` 的 Codex notify 脚本模板
- [x] 保持现有 `--last-turn-only` 与日志路径不变

验收：
- [x] `rg -n "! -t 0|skip=empty-payload|runtime codex hook" packages/cli/src/index.js`

## T3 测试更新与回归
- [x] 更新 BDD 断言脚本包含 stdin fallback
- [x] 运行目标测试

验收：
- [x] `npm run --workspace @spanory/cli test -- test/bdd/setup.integration.spec.js`

## T4 提交与推送
- [ ] 提交
- [ ] 推送

验收：
- [ ] `git status --short`
