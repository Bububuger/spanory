# Plan (2026-03-13) — Codex 默认 watch + 隐藏 notify

## 目标
1. Codex setup 默认模式改为 watch，不再对外暴露 notify 配置路径。
2. setup apply 在 watch 模式下自动清理旧的 spanory notify 注入与脚本。
3. 保持 codex 上报链路可用（watch/hook），并避免旧 notify 造成误判。

## 执行顺序
1. 修改 `packages/cli/src/index.ts`：codex setup 模式默认 watch，apply/doctor/detect 逻辑切到 watch 基线。
2. 增加 codex notify 清理逻辑（仅清理 spanory 注入项与脚本）。
3. 更新 `packages/cli/test/bdd/setup.integration.spec.ts` 断言（watch 默认、notify 被移除）。
4. 跑 `@bububuger/spanory` BDD 回归验证。

## 验收标准
- `spanory setup apply` 默认执行后，`~/.codex/config.toml` 不含 spanory notify 注入。
- 旧 `~/.codex/bin/spanory-codex-notify.sh` 被清理。
- setup doctor 对 codex 给出 watch 模式通过结果。
- 相关 BDD 通过。
