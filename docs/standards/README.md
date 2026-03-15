# Spanory Standards

该目录沉淀长期可维护、可交接的工程规范。

## 文档索引

| 规范 | 用途 |
|------|------|
| [project-workflow.md](./project-workflow.md) | 团队工作流（闭环流程 + DoD + issue 管理 + 新 agent 上手） |
| [feature-design-spec.md](./feature-design-spec.md) | 功能设计模板 |
| [test-baseline-spec.md](./test-baseline-spec.md) | 测试基线与门禁 |
| [runtime-validation-matrix.md](./runtime-validation-matrix.md) | 发布前 runtime 验收矩阵（含 ClickHouse 排障） |
| [change-context-log.md](./change-context-log.md) | 变更背景记录台账 |
| [regression-cases.md](./regression-cases.md) | 缺陷回归台账 |

## 使用建议

- 新 agent 上手：先看 project-workflow.md
- 新需求：先看 feature-design-spec.md
- 开发执行：按 test-baseline-spec.md 跑门禁
- 发布前：按 runtime-validation-matrix.md 验收
