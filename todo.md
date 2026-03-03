# Spanory TODO：一键 setup 四 runtime + README Agent 自安装提示（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "一键 setup 四 runtime|Acceptance" plan.md todo.md`

## T2 CLI 增加 setup detect/apply/doctor
- [x] 在 `packages/cli/src/index.js` 增加 setup 命令组
- [x] 实现 Claude/Codex 幂等配置写入
- [x] 复用 OpenClaw/OpenCode plugin install/doctor

验收：
- [x] `node packages/cli/src/index.js setup --help`
- [x] `node packages/cli/src/index.js setup apply --help`
- [x] `node packages/cli/src/index.js setup doctor --help`

## T3 测试覆盖
- [x] 新增 setup BDD 用例（至少覆盖 claude+codex 幂等）
- [x] 通过测试

验收：
- [x] `npm run --workspace @spanory/cli test -- test/bdd/setup.integration.spec.js`

## T4 文档更新
- [x] 更新 `README.md` 增加 Agent 自安装提示
- [x] 更新 `docs/README_zh.md` 同步说明

验收：
- [x] `rg -n "setup apply|setup doctor|copy to your agent|复制给 Agent" README.md docs/README_zh.md`

## T5 全量回归与提交
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
- [x] 提交并推送

验收：
- [x] 三个命令均 0 退出
- [x] `git status` clean（提交后）
