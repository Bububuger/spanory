# Todo (2026-03-14) — BUB-29 installOpencodePlugin 非 ENOENT 错误处理

- [x] 1. 复现现状：构造非 `ENOENT` 读取错误并确认当前命令错误被吞。
- [x] 2. Red：新增/调整测试，断言非 `ENOENT` 时安装命令应失败。
- [x] 3. Green：修改 `installOpencodePlugin` 错误处理逻辑，仅忽略 `ENOENT`。
- [x] 4. 回归：运行目标测试并确认 `ENOENT` 与非 `ENOENT` 分支都满足预期。
- [ ] 5. 更新 workpad、提交变更并准备 PR 元数据。
