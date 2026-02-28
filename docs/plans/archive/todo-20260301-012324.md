# Spanory Hook Export Dir Resilience TODO (2026-03-01)

## Progress Rule
- 每完成一项必须执行对应验收命令并记录结果。
- 不通过就继续修复，直到通过再进入下一项。

## Tasks
- [x] T1 CLI 健壮性：导出 JSON 前自动创建目录
- [x] T2 回归测试：hook 在不存在导出目录时仍成功
- [x] T3 终验：check/test/bdd 全通过并更新状态

## Verification Commands
- `npm run check`
- `npm test`
- `npm run test:bdd`
