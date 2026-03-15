---
type: file
summary: "技术债台账：无活跃债项、已清偿记录、登记规则"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-15T18:00:00+08:00
tags: [tech-debt, tracking, quality]
---

# 技术债追踪

> 更新: 2026-03-15

## 活跃技术债

| ID | 描述 | 严重度 | 来源 | 状态 |
|----|------|--------|------|------|
| — | 无活跃债项 | — | — | — |

## 已清偿

| ID | 描述 | 清偿日期 | 方式 |
|----|------|---------|------|
| TD-005 | 20 处 @ts-nocheck 覆盖全部业务文件 | 2026-03-15 | 逐文件移除 + 添加类型标注，新增 types.ts 共享接口，tsc strict 零错误 |
| TD-001 | cli/src/index.ts 单文件过大(83K) | 2026-03-15 | 拆分为 13 个模块（setup/plugin/codex/cli/report/alert 等） |
| TD-002 | openclaw-plugin 测试覆盖不足 | 2026-03-15 | 补充 3 个合约测试（assert 真断言） |
| TD-003 | opencode-plugin 测试覆盖不足 | 2026-03-15 | 补充 2+ 个合约测试（assert 真断言） |
| TD-004 | alipay-cli 缺少自动化测试 | 2026-03-15 | 补充包合约测试 |
| — | packages/langfuse 废弃包清理 | 2026-03-05 | 删除 |
| — | src/*.js 双真相源 | 2026-03-05 | 统一到 TS → dist |

## 登记规则

- 发现技术债时在此登记，分配 ID
- 标注严重度: CRITICAL / HIGH / MEDIUM / LOW
- 记录来源（哪次审阅/哪个文档发现的）
- 清偿后移至"已清偿"区域
