# Spanory

Spanory 是一个面向 AI Agent 的跨 runtime 可观测性工具：把 Claude Code / OpenClaw 的本地会话转成统一事件，再通过 OTLP HTTP 上报到 Langfuse 兼容端点。

## 我们在做什么

**一句话**：用统一数据模型，把不同 Agent runtime 的“会话行为”变成可检索、可回放、可告警的遥测数据。

Spanory 当前聚焦三件事：

- 统一：抽象 runtime 差异，输出统一 `SpanoryEvent`
- 兼容：走 OTel/OTLP，默认对齐 Langfuse ingestion
- 可操作：同时支持实时 Hook 上报和离线回放补数

### 当前状态

- 阶段：可运行 MVP
- 已支持 runtime：`claude-code`、`openclaw`
- 已支持模式：
  - Hook 实时上报（`SessionEnd` payload）
  - CLI 单次导出与批量回放（`export` / `backfill`）

## 适用场景

- 你在用多个 Agent runtime，希望统一看调用轨迹、Token、工具调用
- 你已经在用 Langfuse（或 OTLP endpoint），需要把本地会话接入
- 你要做成本/异常监控，需要可回放和告警能力

## 对比摘要（基于《Agent可观测性工具全景对比报告》，2026-03-01）

- 定位差异：Spanory 在报告中的定位是 `CLI-Native Agent Observability`，主打 Hook 即用与本地会话采集；Langfuse/Phoenix 更偏平台化（评估、可视化、生态）。
- Spanory 强项：Claude Code 原生 Hook、零代码侵入实时上报、离线补数（`backfill`）、本地 transcript 解析、CLI 报告与告警规则。
- 竞品强项：Langfuse/Phoenix 在框架覆盖、评估体系与社区成熟度更强；OpenLLMetry/OpenLit 在通用 OTel 基础设施集成上更成熟。
- 组合策略：将 Spanory 作为采集与补数层，将 Langfuse/Phoenix 作为分析与评估层，在低接入成本与平台能力之间取得平衡。

## 项目结构（架构速览）

- `packages/core`：统一 schema、parser 接口、映射契约
- `packages/langfuse`：Langfuse 兼容适配
- `packages/cli`：本地解析与导出 CLI（`spanory`）
- `scripts/hooks`：Hook 脚本（macOS/Linux/Windows）

统一抽象定义在 `@spanory/core`：

- `SpanoryEvent`：统一事件（`turn` / `agent_command` / `shell_command` / `mcp` / `agent_task` / `tool`）
- `RuntimeCapabilities`：runtime 能力矩阵元数据
- `HookPayload`：标准化 Hook 输入
- `RuntimeAdapter`：`resolveContextFromHook` + `collectEvents`

## 5 分钟快速开始（Claude Code）

### 1) 安装依赖与 CLI

```bash
npm install
npm install -g ./packages/cli
spanory --help
```

### 2) 配置 OTLP 环境变量（建议写到 `~/.env`）

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>"
```

可选（保留本地 JSON）

```bash
export SPANORY_HOOK_EXPORT_JSON_DIR="$HOME/.claude/state/spanory-json"
```

### 3) 绑定 Claude Code `SessionEnd` Hook

在 Claude Code Hook 配置里，把 `SessionEnd` command 设为：

```bash
spanory hook
```

### 4) 验证是否生效

查看 hook 日志：

```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

手动模拟 payload（排障）：

```bash
echo '{"hook_event_name":"SessionEnd","session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime claude-code hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## 用法速查

### 实时 Hook（极简入口）

```bash
spanory hook
spanory hook --runtime openclaw
```

### 单会话导出（export）

```bash
spanory runtime claude-code export \
  --project-id claude-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

仅导出本地 JSON（不上报）：

```bash
spanory runtime claude-code export \
  --project-id claude-workspace-test \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

### 历史补数（backfill）

先 dry run：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

正式上报：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

### OpenClaw 接入

默认会话目录：

```bash
~/.openclaw/projects/<project-id>/<session-id>.jsonl
```

可覆盖 runtime home：

```bash
export SPANORY_OPENCLOW_HOME="$HOME/.openclaw"
```

Hook 示例：

```bash
echo '{"session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime openclaw hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

### 聚合视图（report）

```bash
spanory report session --input-json /path/to/exported.json
spanory report mcp --input-json /path/to/exported-or-dir
spanory report command --input-json /path/to/exported-or-dir
spanory report agent --input-json /path/to/exported-or-dir
```

### 阈值告警（alert）

规则文件示例：

```json
{
  "rules": [
    {"id":"session-token-high","scope":"session","metric":"usage.total","op":"gt","threshold":10000},
    {"id":"mcp-spike","scope":"mcp","metric":"calls","op":"gte","threshold":50}
  ]
}
```

执行评估：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json
```

告警即失败（CI 常用）：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --fail-on-alert
```

Webhook 通知：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --webhook-url https://example.com/hook \
  --webhook-headers "Authorization=Bearer x-token"
```

## 如何贡献

完整规范见 `CONTRIBUTING.md`，这里给最短路径：

1. 从 `main` 拉分支，前缀用 `codex/` 或 `feat/`
2. 保持小而可评审的改动，避免顺手重构
3. 行为变化必须配套测试（项目已有单测 + BDD）
4. 提交前至少跑：

```bash
npm run check
npm test
```

如改动触及 CLI 对外契约（命令/参数/行为），还需要：

- 更新 `CHANGELOG.md`
- 更新 `README.md` 中对应命令说明

## AI 快速上手（Vibe Coding）

### 先读哪几个文件

- `README.md`：产品目标与命令入口
- `CONTRIBUTING.md`：贡献与验证要求
- `packages/core/src/index.ts`：统一 schema 契约
- `packages/cli/src/index.js`：CLI 命令面
- `packages/cli/src/runtime/*/adapter.js`：runtime 解析实现

### AI 贡献默认工作流

1. 先跑 `spanory --help` 和目标子命令 `--help`，确认真实参数
2. 只改与任务直接相关的文件，优先小 diff
3. 行为改动后，先跑最快相关检查，再补全测试矩阵
4. 结论前给出可复现验证命令和结果摘要

### 可直接复制给 AI 的任务模板

```text
你在 spanory 仓库里工作。请先阅读 README.md 与 CONTRIBUTING.md，
再基于现有 CLI 和 adapter 实现完成任务，不要虚构命令或参数。
约束：小步提交、避免无关重构、行为变化补测试。
完成后请执行 npm run check 和 npm test，并汇报关键输出。
```

## 质量门禁

合并前建议跑完整门禁：

```bash
npm run check
npm test
npm run test:bdd
npm run build:bin
```

CI 使用同一套门禁（`.github/workflows/ci.yml`）。

## 治理与路线图

- 变更记录：`CHANGELOG.md`
- 贡献规范：`CONTRIBUTING.md`
- Code owners：`.github/CODEOWNERS`
- 历史计划：`docs/plans/history/`
- 历史待办：`docs/todos/history/`

近期重点：

- Codex/OpenCode adapter（复用统一 normalize pipeline）
- Langfuse 命名与 timeline 对齐稳定化
