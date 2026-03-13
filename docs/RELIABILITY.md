---
type: file
summary: "可靠性要求：spool/幂等/向后兼容、故障模式与应对"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [reliability, fault-tolerance, spool]
---

# 可靠性

## 可靠性要求

| 维度 | 要求 | 现状 |
|------|------|------|
| Hook 上报 | 不影响宿主 runtime 正常退出 | ✅ spool & async |
| 数据不丢 | hook 失败时本地 spool，后续 backfill | ✅ 已实现 |
| 幂等性 | 重复上报不产生重复 trace | ✅ deterministic ID |
| 向后兼容 | hook/export/backfill 工作流不破坏已有用户 | ✅ 持续保证 |
| 安装回归 | npm global install 自包含可用 | ✅ pack:test-install |

## 故障模式与应对

| 故障 | 影响 | 应对 |
|------|------|------|
| Langfuse 不可达 | 数据暂缓 | spool 到本地，retry with backoff |
| Hook 超时 | 宿主等待 | async fire-and-forget，不阻塞 |
| Transcript 格式变化 | 解析失败 | adapter 内处理，降级为 unknown category |
| Token 估算偏差 | 指标失真 | EMA 校准闭环自修正 |

## 验收矩阵

详见 [docs/standards/runtime-validation-matrix.md](./standards/runtime-validation-matrix.md)。

发布前每个 runtime 必须通过对应验收项。

## 监控

- Langfuse dashboard: trace 完整性、span 覆盖率
- ClickHouse 查询模板: 见 [agent-onboarding.md](./standards/agent-onboarding.md)
