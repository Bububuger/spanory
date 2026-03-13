# Plan (2026-03-13) — BUB-16 覆盖率度量与阈值门禁

## 目标
1. 为 CLI 测试引入 Vitest v8 覆盖率采集能力。
2. 配置覆盖率阈值：行覆盖率不低于 70%。
3. 在 CI/Release 验证阶段新增覆盖率门禁，避免仅 test-pass。

## 执行顺序
1. 归档旧版 `plan.md`/`todo.md` 并生成本阶段计划。
2. 在 `packages/cli` 增加 coverage provider 依赖与 Vitest coverage 配置（70% line）。
3. 在工作流中加入 Coverage Gate（执行 `--coverage`）。
4. 运行定向验证并记录结果。

## 验收标准
- `packages/cli` 可执行 `vitest --coverage` 且不再缺失 `@vitest/coverage-v8`。
- 覆盖率阈值存在且行覆盖率阈值为 70%。
- CI 与 Release verify 阶段包含覆盖率门禁步骤。
