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
