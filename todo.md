# Spanory TODO：修复 Codex notify 路径 ~ 不展开问题（2026-03-04）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 8`
- [x] `rg -n "Codex notify 路径|Acceptance" plan.md todo.md`

## T2 CLI 修复绝对路径写入
- [x] 修改 `packages/cli/src/index.js`，notify 写入绝对脚本路径
- [x] 保持幂等更新行为不变

验收：
- [x] `node packages/cli/src/index.js setup apply --help`
- [x] `rg -n "notifyScriptRef|spanory-codex-notify\.sh" packages/cli/src/index.js`

## T3 测试更新
- [x] 更新 BDD：断言 notify 为 fakeHome 下绝对路径
- [x] 跑目标测试

验收：
- [x] `npm run --workspace @spanory/cli test -- test/bdd/setup.integration.spec.js`

## T4 文档同步
- [x] 更新 `README.md`
- [x] 更新 `docs/README_zh.md`

验收：
- [x] `rg -n "notify = \[|绝对路径|absolute path|~/.codex/bin" README.md docs/README_zh.md`

## T5 提交与推送
- [ ] 提交
- [ ] 推送

验收：
- [ ] `git status --short`
