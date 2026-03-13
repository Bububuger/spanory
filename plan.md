# Plan (2026-03-14) — BUB-8 strict/noImplicitAny 恢复

## 目标
1. 恢复受影响包对 `tsconfig.base.json` 的严格模式继承，移除本地覆盖的 `strict:false` 与 `noImplicitAny:false`。
2. 保持改动最小，仅变更工单范围内 tsconfig 文件。
3. 用快速检索与全仓 check 验证回归风险可控。

## 执行顺序
1. 确认受影响文件清单（复现命令）。
2. 修改各 tsconfig 删除禁用项，不改其它 `compilerOptions`。
3. 运行 targeted grep 验证覆盖已清除。
4. 运行 `npm run check` 验证类型与 lint。
5. 整理 workpad、提交、推送并创建 PR。

## 验收标准
- 目标文件不再显式声明 `strict:false` 或 `noImplicitAny:false`。
- `npm run check` 通过。
- Workpad 记录复现、同步、验证证据。
# Plan (2026-03-14) — BUB-6 README 移除已废弃 `--codex-mode notify`

## 目标
1. 修复 `README.md` 与 `docs/README_zh.md` 中仍指导使用 `--codex-mode notify` 的内容。
2. 将 Codex setup 描述统一为 watch 守护进程模式，避免 Quick Start 首次操作失败。
3. 确保文档与当前 CLI 实现一致（`setup apply` 无 `--codex-mode` 选项）。

## 执行顺序
1. 复核英文 README 的 Codex setup / Quick Start 段落并替换 notify 语义。
2. 同步修改中文 README 对应段落，保证中英文行为描述一致。
3. 运行针对性检索验证：文档中不再出现 `--codex-mode notify`，且 watch 流程可见。
4. 复查 diff，确保仅限本 ticket 目标范围。

## 验收标准
- `README.md` 与 `docs/README_zh.md` 不再出现 `--codex-mode notify` 的使用指引。
- 两份文档都明确 Codex setup 使用 watch 守护进程，且 `setup apply` 命令可直接执行。
- 文档描述与 `packages/cli/src/index.ts` 中 `setup apply` 选项保持一致。
