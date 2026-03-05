# Spanory TODO：增加 Codex watcher 兜底实时上报（2026-03-04）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "Codex watcher|Acceptance" plan.md todo.md`

## T2 CLI 增加 codex watch
- [x] 抽取 hook 处理内核为可复用函数
- [x] 新增 `runtime codex watch`（支持 `--once`、`--poll-ms`、`--settle-ms`）
- [x] watcher 默认只处理启动后新增/更新，支持 `--include-existing`

验收：
- [x] `node packages/cli/src/index.js runtime codex watch --help`
- [x] `rg -n "command\('watch'\)|runCodexWatch|includeExisting" packages/cli/src/index.js`

## T3 测试补齐
- [x] 新增 BDD：`codex watch --once` 能处理更新会话
- [x] 运行目标测试

验收：
- [x] `npm run --workspace @spanory/cli test:bdd -- test/bdd/codex.watch.integration.spec.js`

## T4 文档同步
- [x] 更新 `README.md` watcher 用法
- [x] 更新 `docs/README_zh.md` watcher 用法

验收：
- [x] `rg -n "runtime codex watch|--once|include-existing|watcher" README.md docs/README_zh.md`

## T5 提交与推送
- [x] 提交
- [x] 推送

验收：
- [x] `git status --short`
