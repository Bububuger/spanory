# Spanory TypeScript 迁移契约（2026-03-04）

## 背景
目标是在保持当前行为一致的前提下，把核心代码从 JavaScript 迁移到 TypeScript，为后续桌面状态栏版本（Desktop menubar app）提供更稳定的类型边界与模块协作基础。

## 模块契约

### 1) Core 契约（`packages/core`）
- 输入：runtime 适配层产出的标准事件结构。
- 输出：可被 backend/otlp 消费的稳定类型定义。
- 关键契约：`SpanoryEvent` 字段、category 枚举、attributes 类型约束。

### 2) CLI 契约（`packages/cli`）
- 输入：hook payload、transcript 文件、规则文件、环境变量。
- 输出：
  - OTLP 请求（直接发送）
  - 本地 JSON 导出（export/hook/backfill）
  - report/alert 聚合结果
- 关键契约：命令参数与输出 JSON 结构保持稳定。

### 3) OTLP 契约（`packages/otlp-core`）
- 输入：标准 events + resource 元信息。
- 输出：OTLP payload（trace/span/attributes）
- 关键契约：trace/span id 生成策略、Langfuse 关键属性映射。

### 4) Plugin 契约（`packages/openclaw-plugin` / `packages/opencode-plugin`）
- 输入：runtime 事件流与环境配置。
- 输出：同一条 OTLP 链路、spool/retry/status 文件副作用。
- 关键契约：失败可恢复、状态文件语义、日志可诊断性。

## 行为不变（必须保持）
- 命令语义不变：`hook/export/backfill/report/alert/setup`。
- 运行时兼容不变：`claude-code/openclaw/codex/opencode`。
- 事件语义不变：turn/tool/mcp/agent_task/agent_command 分类与关键 attributes。
- BDD 场景结果不变：现有 Given/When/Then 断言保持通过。

## 允许变化（仅类型层）
- 允许把 JS 模块改为 TS 源文件（`.ts/.mts`），并调整构建脚本。
- 允许新增类型定义文件、类型守卫、显式错误类型。
- 允许在不改行为的前提下调整内部函数拆分与模块组织。

## 禁止变化（行为层）
- 禁止改变 CLI 用户可见输出字段和含义。
- 禁止改变默认开关行为（例如 hook 去重、导出目录策略）。
- 禁止无文档记录地新增/删除上报属性。
- 禁止引入与迁移目标无关的功能扩展。

## 分批迁移顺序（入口清单）
1. `packages/core` + `packages/otlp-core`（类型基础层，低外部副作用）
2. `packages/cli/src/runtime/shared` + 各 adapter（解析与事件归一化）
3. `packages/cli/src/index` + report/alert（命令与聚合层）
4. `packages/openclaw-plugin` / `packages/opencode-plugin`（runtime side-effect 层）
5. 脚本与文档联动（仅收尾）

## 每批次门禁
- 必须通过：
  - `npm run check`
  - `npm test`
  - `npm run test:bdd`
- 每批次结束前：更新迁移记录（变更点、风险点、回滚点）。

## 回滚策略
- 回滚单位：以“批次”为单位回滚，不做跨批次混合回退。
- 回滚触发条件：
  - 任一 BDD 失败且短期无法修复
  - 用户可见输出契约发生不兼容变化

## 一次性迁移命令草案
```bash
# 1) 基线
npm run check && npm test && npm run test:bdd

# 2) 迁移后再次验证
npm run check && npm test && npm run test:bdd

# 3) 如需构建产物
npm run build
```

