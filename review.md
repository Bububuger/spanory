---
type: file
summary: "丞相代码审阅报告 — Spanory 观测层"
created: 2026-03-11T00:00:00+08:00
modified: 2026-03-11T00:00:00+08:00
tags: [review, spanory, code-quality, execution-status]
owner: 丞相
---

# Spanory 代码审阅报告

> 审阅日期: 2026-03-11
> 审阅范围: `spanory-all/spanory/` 全部六包
> 对照文档: `design/contract.md`, `design/spanory.md`, `design/execution.md`

---

## 一、总体架构评价

架构清晰，六包分治得当：

| 包 | 职责 | 行数(约) |
|----|------|----------|
| `@bububuger/core` | 类型定义、评分算法、token 估算 | ~400 |
| `@bububuger/spanory` (cli) | 主 CLI、运行时适配器、报告、告警 | ~83K (index.ts) + 1080 (normalize.ts) |
| `@bububuger/otlp-core` | OTEL span 编译与 HTTP 发送 | ~317 |
| `@bububuger/backend-langfuse` | Langfuse 后端映射 | ~44 |
| `@bububuger/spanory-openclaw-plugin` | OpenClaw 运行时插件 | ~825 |
| `@bububuger/spanory-opencode-plugin` | OpenCode 运行时插件 | ~590 |

事件流路径层次分明：

```
Runtime Transcript
  → Adapter (claude/codex/openclaw)
    → normalizeTranscriptMessages()
      → groupByTurns() → tool extraction → context classification
        → composeContextEvents()
          → context_snapshot / context_boundary / context_source_attribution
            → OTLP compileOtlpSpans()
              → sendOtlpHttp() / Langfuse backend
```

**设计亮点：**

- 稳定 ID 生成：SHA-256 哈希确保 trace/span ID 可重现
- 不可变状态：所有状态变更返回新对象
- 插件架构：运行时通过 hook 注册，实时创建事件
- Spool & Retry：失败发送入磁盘队列，指数退避重试
- 校准闭环：token 估算通过 EMA 自我修正

---

## 二、设计文档对齐检查

### P1 — `pollutionScoreV1` 契约对齐 ✅ 已完成

`packages/core/src/index.ts` 已重写为四因子公式：

```
score = 100 × clamp(0.50·deltaRatio + 0.30·shareRatio + 0.20·repeatRatio + unknownPenalty, 0, 1)
```

- `deltaRatio = clamp(tokenDelta / max(2000, 0.05 × windowLimit), 0, 1)`
- `shareRatio = clamp(sourceShare / 0.25, 0, 1)`
- `repeatRatio = clamp(repeatCountRecent / 3, 0, 1)`
- `unknownPenalty = sourceKind === 'unknown' ? 0.15 : 0`

与 `contract.md` 一致。测试文件 `test/pollution-score.test.mjs` 已更新。

**复核结论（2026-03-11）**：已完成。`normalize.ts` 仅从 `@bububuger/core` 导入 `pollutionScoreV1`，无本地副本。

### P2 — Token 估算三级方案 ✅ 已完成

`packages/core/src/index.ts` 已导出：

- `estimateTokens(value, hint?)` — 按内容类型分系数（json:2.5, cjk:1.8, code:3.0, markdown:3.5, plain:4.0）
- `CalibrationState` + `calibrate()` + `calibratedEstimate()` — EMA 校准闭环

测试文件 `test/estimation.test.mjs` 覆盖中文、JSON、代码三种内容类型。

**复核结论（2026-03-11）**：已完成。`composeContextEvents()` 已填充 `estimation_method` 与 `estimation_confidence`。

### P3 — Memory Extractor ⏳ 未实现

Relayloom 未建仓，此项依赖 Phase 1B + Phase 3。

### P4 — Ledger 增量写入 ⏳ 未实现

Ring buffer ledger、结构化提取器均未实现。Relayloom 包未创建。

### P5 — OTLP field-spec ⚠️ 需验证

`telemetry/field-spec.yaml` 已有 100+ 字段。需确认设计文档要求的 15 个 `agentic.context.*` 字段是否全部写入：

| 字段 | 状态 |
|------|------|
| `agentic.context.event_type` | ✅ 已存在 |
| `agentic.context.fill_ratio` | ✅ 已存在 |
| `agentic.context.estimated_total_tokens` | ✅ 已存在 |
| `agentic.context.delta_tokens` | ✅ 已存在 |
| `agentic.context.estimation_method` | ✅ 已存在 |
| `agentic.context.estimation_confidence` | ✅ 已存在 |
| `agentic.context.boundary_kind` | ✅ 已存在 |
| `agentic.context.compaction_ratio` | ✅ 已存在 |
| `agentic.context.detection_method` | ✅ 已存在 |
| `agentic.context.source_kind` | ✅ 已存在 |
| `agentic.context.token_delta` | ✅ 已存在 |
| `agentic.context.pollution_score` | ✅ 已存在 |
| `agentic.context.source_share` | ✅ 已存在 |
| `agentic.context.repeat_count_recent` | ✅ 已存在 |
| `agentic.context.score_version` | ✅ 已存在 |

---

## 三、代码质量问题

### Critical

#### C1 — `packages/cli/src/index.ts` 83KB 巨文件

严重违反 800 行上限。单文件包含 capture、export、report、alert、issue、proxy 全部命令逻辑。

**建议拆分：**

```
packages/cli/src/
├── index.ts              # CLI 入口，仅注册 commands
├── commands/
│   ├── capture.ts        # capture 命令
│   ├── export.ts         # export 命令
│   ├── report.ts         # report 命令
│   ├── alert.ts          # alert 命令
│   ├── issue.ts          # issue 命令
│   └── proxy.ts          # proxy 命令
```

**影响：** 当前任何修改都需加载 83KB 上下文，合并冲突概率极高，不利于并行开发。

### High

#### H1 — `normalize.ts` 1080 行，超限

包含 turn 分组、工具提取、上下文分类、源归因、pollution score 计算等多重职责。

**建议拆分：**

```
packages/cli/src/runtime/shared/
├── normalize.ts          # 主入口 + turn 分组（~300行）
├── tool-extractor.ts     # 工具提取逻辑
├── context-events.ts     # composeContextEvents()
├── source-classifier.ts  # 源归因分类
├── mention-detector.ts   # mention_file 信号检测
```

#### H2 — `normalize.ts` 中可能存在 pollution score 重复实现

设计文档 (execution.md T0.1) 明确要求：

> `normalize.ts` 不再有独立的 pollution score 实现，直接调用 core

需确认当前是否已完成此项清理。若仍有本地 copy，会导致两处公式不一致。

### Medium

#### M1 — Codex projectId 碰撞风险

```typescript
// codex/adapter.ts
sha1(cwd).slice(0, 6)  // 6 hex chars = 16M 命名空间
```

对于单用户场景足够，但多项目环境下碰撞概率非零。建议扩展至 8-12 字符（64B-256B 空间）。

#### M2 — 插件层 retry/spool 逻辑重复

`openclaw-plugin` 和 `opencode-plugin` 各自实现：
- 指数退避重试
- 磁盘 spool 队列
- flush timer 管理

**建议：** 提取至 `packages/plugin-common` 或 `packages/core` 的 shared utilities。

#### M3 — `source_share` 和 `repeat_count_recent` 计算

设计文档 (execution.md T1A.4) 要求在 `composeContextEvents` 中：
- `source_share = sourceDelta[kind] / totalDelta`
- `repeat_count_recent`: 维护 sliding window（最近 5 turn）

复核结论（2026-03-11）：已实现。`composeContextEvents` 已输出 `source_share` 与 `repeat_count_recent` 并用于评分输入。

### Low

#### L1 — 运行时能力矩阵全量 true

`capabilities.ts` 中所有运行时的 7 项能力均为 `true`。若各运行时能力确实相同，此矩阵存在意义有限；若未来分化，当前"全 true"可能掩盖适配器的实际缺陷。

#### L2 — 测试覆盖盲区

20+ 测试文件覆盖面较广，但以下场景缺少覆盖：
- compact boundary detection（inferred 方式）
- 校准闭环端到端（多 turn session 中 EMA 收敛）
- 中文内容 token 估算精度验证（与 usage anchor 对比）

---

## 四、执行计划进度总览

| Phase | 任务 | 状态 | 说明 |
|-------|------|------|------|
| **Phase 0** | T0.1 重写 pollutionScoreV1 | ✅ 完成 | 四因子公式已对齐 contract.md |
| | T0.2 扩展 ContextSnapshotCanonical 类型 | ✅ 完成 | 新增 estimationMethod/estimationConfidence |
| | T0.3 ContextBoundaryCanonical.detectionMethod | ✅ 完成 | 新增 detectionMethod 字段 |
| **Phase 1A** | T1A.1 内容类型 token 估算 | ✅ 完成 | 5 种内容类型系数 |
| | T1A.2 校准闭环 | ✅ 完成 | CalibrationState + EMA |
| | T1A.3 填充 estimation_method/confidence | ✅ 完成 | composeContextEvents 第514-515行已输出 |
| | T1A.4 source_share + repeat_count_recent | ✅ 完成 | 第628-629行已输出并参与评分输入 |
| **Phase 1B** | T1B.1-T1B.5 Relayloom | ⏳ 未开始 | Relayloom 未建仓 |
| **Phase 1C** | T1C.1 OTLP field-spec | ✅ 完成 | field-spec.yaml 已包含 15 个 agentic.context.* 字段 |
| **Phase 2** | T2.1-T2.2 集成验证 | ⏳ 未开始 | 依赖 1A + 1B |
| **Phase 3** | T3.1-T3.6 Memory Extractor | ⏳ 未开始 | 依赖 1B |

**总计 20 任务：10 项完成，0 项待验证，10 项未开始（阻塞于 Relayloom 建仓）。**

---

## 五、优先行动建议

| 优先级 | 行动 | 理由 |
|--------|------|------|
| 1 | 验证 normalize.ts pollution score 是否已改为调用 core | 防止公式分叉 |
| 2 | 验证 composeContextEvents 中 estimation_method/confidence 填充 | Phase 1A 收尾 |
| 3 | 验证 field-spec.yaml 中 15 个 agentic.context.* 字段 | Phase 1C 收尾 |
| 4 | 拆分 index.ts (83KB) 为按命令分文件 | 消除开发瓶颈 |
| 5 | 启动 Relayloom 建仓 (Phase 1B) | 解锁 Phase 2/3 |
| 6 | 拆分 normalize.ts 为职责单一模块 | 降低维护成本 |
| 7 | 提取插件共享层 (retry/spool) | 减少重复代码 |

---

## codex 复核与修复结论

复核时间：2026-03-11

### 一、复核结论总览

1. `review.md` 中多个“待验证”项，当前代码已完成，属“文档状态滞后”而非实现缺失。
2. 唯一属实且可低风险立即修复的问题为：Codex `projectId` 哈希位数过短（6 位）。
3. 结构性问题（`index.ts`/`normalize.ts` 超大文件）属实，但不宜在本轮与功能修复混做。

### 二、逐项结论

1. `pollutionScoreV1` 来源一致性：已完成  
   - `normalize.ts` 已从 `@bububuger/core` 导入 `pollutionScoreV1`，无本地副本。
2. `estimation_method` / `estimation_confidence`：已完成  
   - `context_snapshot` 已稳定输出两字段。
3. `source_share` / `repeat_count_recent`：已完成  
   - `context_source_attribution` 已输出并参与评分输入。
4. `agentic.context.*` 15 字段 field-spec：已完成  
   - `telemetry/field-spec.yaml` 已包含审阅清单要求字段。
5. Codex projectId 哈希位数（碰撞风险）：已修复  
   - 从 `sha1(...).slice(0, 6)` 提升为 `slice(0, 10)`。
6. 中文估算精度验证：已补强  
   - 新增 CJK 校准后误差不超过 15% 的测试用例。

### 三、实际修复清单

1. `packages/cli/src/runtime/codex/adapter.ts`
   - `deriveProjectIdFromCwd` 哈希后缀由 6 位改为 10 位。
2. `packages/cli/test/unit/codex.adapter.spec.ts`
   - 同步 projectId 格式断言：`^demo-[a-f0-9]{10}$`。
3. `packages/core/test/estimation.test.mjs`
   - 新增 CJK 估算校准精度测试（误差阈值 15%）。

### 四、验收结果

1. `npm run --workspace @bububuger/core test`：通过
2. `npm run --workspace @bububuger/spanory test`：通过
3. `npm run --workspace @bububuger/spanory test:bdd`：通过
4. `npm run telemetry:check`：通过
