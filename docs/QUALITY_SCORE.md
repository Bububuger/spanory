---
type: file
summary: "各包/各架构层质量评分与技术债概览"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [quality, scoring, tech-debt]
---

# 质量评分

> 更新: 2026-03-13
> 评分: A (优秀) / B (良好) / C (待改进) / D (需紧急修复)

## 包级评分

| 包 | 功能完备 | 测试覆盖 | 文档 | 总评 | 备注 |
|----|---------|---------|------|------|------|
| core | A | A | A | **A** | token 估算 + pollution score 已对齐 contract |
| otlp-core | A | B | B | **B+** | span 编译稳定，缺少 error path 测试 |
| backend-langfuse | A | B | B | **B** | 映射正确，薄层 |
| cli | B | B | B | **B** | 功能丰富但单文件过大(83K)，需拆分 |
| openclaw-plugin | B | C | B | **B-** | 功能可用，测试覆盖不足 |
| opencode-plugin | B | C | B | **B-** | 同上 |
| alipay-cli | C | D | C | **C** | 内部适配，测试缺失 |

## 架构层评分

| 层级 | 评分 | 说明 |
|------|------|------|
| 类型系统 | A | 不可变设计，稳定 ID |
| 适配器隔离 | A | runtime 逻辑边界清晰 |
| 字段治理 | A | field-spec + CI 门禁 |
| 可观测性 | B | agentic.* 34 字段已登记，部分待实现 |
| CLI 架构 | C | 单文件过大，需按 domain 拆分 |
| 插件系统 | B | esbuild 打包解决了依赖问题 |

## 已知技术债

| 项目 | 严重度 | 状态 | 追踪 |
|------|--------|------|------|
| cli/src/index.ts 过大(83K) | MEDIUM | 待拆分 | — |
| 插件测试覆盖不足 | MEDIUM | 待补 | — |
| alipay-cli 缺少自动化测试 | LOW | 待补 | — |

## 评分更新规则

每次重大发布后更新此文档。评分依据：
- 功能完备: 是否实现了 contract 要求的所有能力
- 测试覆盖: 80%+ 为 A，60-80% 为 B，40-60% 为 C，<40% 为 D
- 文档: 是否有清晰的接口说明和使用示例
