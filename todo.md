# Todo (2026-03-14) — BUB-19 backfill 逐会话错误隔离

- [x] 在 backfill 循环加入逐会话 try/catch 隔离
- [x] 对齐并输出可诊断错误日志（含 sessionId）
- [x] 新增 BDD：坏会话失败不影响后续好会话
- [x] 运行目标 BDD 验证
- [x] 运行 `npm run --workspace @bububuger/spanory check`
