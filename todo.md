# Todo (2026-03-14) — BUB-25 alert 评估器逐规则重复聚合

- [x] 1. 建立复现：新增失败测试，证明逐规则重复聚合
- [x] 2. 实施修复：将聚合提升到 `evaluateRules` 外层并复用
- [x] 3. 验收任务 1：`npm test -- packages/cli/test/unit/alert.spec.ts`
- [x] 4. 验收任务 2：`npm run check`
- [x] 5. 更新 workpad、整理提交并推送
