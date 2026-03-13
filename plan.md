# Plan (2026-03-14) — BUB-29 installOpencodePlugin 非 ENOENT 错误处理

## 目标
1. 复现并确认当前 `installOpencodePlugin` 在非 `ENOENT` 文件系统错误下仍返回成功。
2. 通过测试锁定期望行为：仅 `ENOENT` 允许降级创建配置，其它错误必须上抛。
3. 以最小改动修复实现并保持既有 CLI/配置行为稳定。
4. 完成针对性验证并更新工单工作台证据。

## 执行顺序
1. 准备可重复复现场景并记录失败信号（非 `ENOENT` 被吞）。
2. 先写失败测试（Red）：覆盖 `opencode.json` 读取非 `ENOENT` 时应失败。
3. 实现修复（Green）：在 `catch` 中仅处理 `ENOENT`，其余错误重新抛出。
4. 回归验证：运行目标测试，确认无回归并记录输出。

## 验收标准
- 非 `ENOENT` 错误（如 `EISDIR`/`EACCES`/`ENOSPC`）不再被静默吞掉，安装命令返回失败。
- `ENOENT` 路径保持原行为：创建最小 `opencode.json` 并完成安装。
- 新增自动化测试覆盖上述分支，并在本地通过。
