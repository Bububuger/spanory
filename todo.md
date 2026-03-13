# Todo (2026-03-14) — BUB-8 strict/noImplicitAny 恢复

- [x] 1. 归档旧版 `plan.md/todo.md` 并写入本轮计划文件（验收：归档文件存在且新计划已生成）
- [x] 2. 修改命中的 tsconfig，移除 `strict:false` 与 `noImplicitAny:false`（验收：`rg -n --glob '**/tsconfig*.json' '"strict"\\s*:\\s*false|"noImplicitAny"\\s*:\\s*false' .` 仅剩非本票范围或为 0）
- [x] 3. 运行 `npm run check`（验收：命令退出码 0）
- [ ] 4. 更新 workpad、提交推送、创建/更新 PR 并关联 Linear（验收：远端分支与 PR 就绪，workpad 全勾选）
# Todo (2026-03-14) — BUB-6 README 移除已废弃 `--codex-mode notify`

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] 更新 `README.md` 的 Codex setup / Quick Start，移除 `--codex-mode notify`
- [x] 更新 `docs/README_zh.md` 对应章节，改为 watch 守护进程描述
- [x] 运行针对性验证并记录结果
- [x] 复查变更范围后提交并推送
