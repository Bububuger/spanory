---
type: file
summary: "技术债台账：活跃债项(4)、已清偿记录、登记规则"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [tech-debt, tracking, quality]
---

# 技术债追踪

> 更新: 2026-03-13

## 活跃技术债

| ID | 描述 | 严重度 | 来源 | 状态 |
|----|------|--------|------|------|
| TD-001 | cli/src/index.ts 单文件过大(83K)，需按 domain 拆分 | MEDIUM | review.md | 待处理 |
| TD-002 | openclaw-plugin 测试覆盖不足 | MEDIUM | QUALITY_SCORE | 待处理 |
| TD-003 | opencode-plugin 测试覆盖不足 | MEDIUM | QUALITY_SCORE | 待处理 |
| TD-004 | alipay-cli 缺少自动化测试 | LOW | QUALITY_SCORE | 待处理 |

## 已清偿

| ID | 描述 | 清偿日期 | 方式 |
|----|------|---------|------|
| — | packages/langfuse 废弃包清理 | 2026-03-05 | 删除 |
| — | src/*.js 双真相源 | 2026-03-05 | 统一到 TS → dist |

## 登记规则

- 发现技术债时在此登记，分配 ID
- 标注严重度: CRITICAL / HIGH / MEDIUM / LOW
- 记录来源（哪次审阅/哪个文档发现的）
- 清偿后移至"已清偿"区域
