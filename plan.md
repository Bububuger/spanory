# Plan (2026-03-14) — BUB-27 teardown 清理 codex config.toml 改动

## 目标
1. `setup apply --runtimes codex` 删除的 `~/.codex/config.toml` 中 `notify` 配置可在 `setup teardown --runtimes codex` 恢复。
2. 修复保持幂等：未发生 apply 改动时 teardown 不应写入无关配置。
3. 为该行为补充自动化测试，防止回归。

## 执行顺序
1. 在 `packages/cli/src/index.ts` 为 codex apply 增加 `notify` 备份写入逻辑（写到 `~/.codex/spanory-notify.backup.json`）。
2. 在 `teardownCodexSetup` 读取备份并恢复 `config.toml` 的 `notify` 行，恢复后清理备份。
3. 扩展 `packages/cli/test/bdd/setup.integration.spec.ts`，覆盖 apply 后 teardown 恢复 notify 的端到端场景。
4. 运行最小 BDD 验证并确认通过。

## 验收标准
- apply 之后 `config.toml` 的 `notify` 行被移除。
- teardown 之后 `config.toml` 恢复到 apply 前的 `notify` 值（若有备份）。
- 新增/更新 BDD 用例通过。
