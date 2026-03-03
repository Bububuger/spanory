# Spanory

### 跨运行时 AI Agent 可观测性工具包

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green.svg)](https://nodejs.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-OTLP-blueviolet.svg)](https://opentelemetry.io/)

[English](../README.md) | 中文

---

## 简介

Spanory 是一个跨运行时的 AI Agent 可观测性工具包，将 Claude Code、OpenClaw、OpenCode 等 AI 编程 Agent 的会话数据解析为统一事件模型，通过 OpenTelemetry 协议上报到 Langfuse 等后端。

支持实时 Hook 上报（零 cron）和离线补数（backfill），内置聚合报表和规则告警。

## Claude Code 接入（Hook 实时上报）

### 1) 安装 `spanory` 命令

```bash
npm install -g packages/cli
spanory --help
```

### 2) 配置 OTLP 环境变量（建议放到 `~/.env`）

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' '<LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>' | base64)"
```

`OTEL_EXPORTER_OTLP_HEADERS` 采用 `k=v` 格式（多个 header 用逗号分隔）。  
Langfuse OTLP 认证应使用 `Authorization=Basic <base64(public_key:secret_key)>`。

可选（保留本地 JSON 结果）：

```bash
export SPANORY_HOOK_EXPORT_JSON_DIR="$HOME/.claude/state/spanory-json"
```

### 3) 在 Claude Code 中绑定 Hook（极简）

在 Claude Code 的 Hook 配置中，将 `SessionEnd` 和/或 `Stop` 的 command 设置为：

```bash
spanory hook
```

> **推荐：** 同时绑定 `Stop` 事件。`Stop` 在每次 assistant turn 结束时触发，可实现近实时上报，无需等到会话结束。

说明：
- `spanory hook` 会从 `stdin` 读取 Claude hook payload（自动识别 `SessionEnd` / `Stop`）。
- 可通过 `--runtime` 切换 runtime（默认 `claude-code`）：
  - `spanory hook --runtime claude-code`
  - `spanory hook --runtime openclaw`
- CLI 会自动读取 `~/.env`（若变量未在当前进程定义）。
- 默认导出目录：`~/.claude/state/spanory-json`（可用 `SPANORY_HOOK_EXPORT_JSON_DIR` 覆盖）。

### 4) 验证 Hook 是否生效

查看 hook 日志：

```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

手动模拟一次 hook payload（排障用）：

```bash
echo '{"hook_event_name":"SessionEnd","session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime claude-code hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## CLI 离线回跑（历史补数）

### 回跑单个 session

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

### 批量回跑（backfill）

先预览将处理哪些 session（不发送）：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

正式回跑并上报：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

按指定 session 列表回跑：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --session-ids "session-a,session-b,session-c" \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## OpenClaw 接入（Plugin 主链路，零 cron）

### 1) 安装 Spanory OpenClaw Plugin（推荐）

```bash
spanory runtime openclaw plugin install
spanory runtime openclaw plugin enable
spanory runtime openclaw plugin doctor
```

可选参数：

- `--plugin-dir`：覆盖插件目录（默认 `packages/openclaw-plugin`）
- `--runtime-home`：覆盖 OpenClaw home

### 2) 配置 OTLP 环境变量

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' '<LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>' | base64)"
```

插件可靠性相关（可选）：

```bash
export SPANORY_OPENCLAW_SPOOL_DIR="$HOME/.openclaw/state/spanory/spool"
export SPANORY_OPENCLAW_RETRY_MAX="6"
```

### 3) Plugin 运行状态检查

```bash
spanory runtime openclaw plugin doctor
```

`doctor` 会检查：
- 插件安装状态
- 启用状态
- OTLP endpoint 配置
- spool 可写
- 最近发送状态文件

## OpenCode 接入（Plugin 主链路）

### 1) 安装 Spanory OpenCode Plugin

```bash
spanory runtime opencode plugin install
spanory runtime opencode plugin doctor
```

可选参数：

- `--plugin-dir`：覆盖插件目录（默认 `packages/opencode-plugin`）
- `--runtime-home`：覆盖 OpenCode home（默认 `~/.config/opencode`）

说明：

- `install` 会写入 loader 文件到 `~/.config/opencode/plugin/spanory-opencode-plugin.js`。
- OpenCode 会自动加载该目录下插件文件。

### 2) 配置 OTLP 环境变量

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' '<LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>' | base64)"
```

插件可靠性相关（可选）：

```bash
export SPANORY_OPENCODE_SPOOL_DIR="$HOME/.config/opencode/state/spanory/spool"
export SPANORY_OPENCODE_RETRY_MAX="6"
```

### 3) Plugin 运行状态检查

```bash
spanory runtime opencode plugin doctor
```

## OpenClaw 补数链路（export/backfill）

OpenClaw transcript 默认支持两种目录：

- `~/.openclaw/projects/<project-id>/<session-id>.jsonl`
- `~/.openclaw/agents/<agent-id>/sessions/<session-id>.jsonl`

可覆盖 OpenClaw runtime home：

```bash
export SPANORY_OPENCLOW_HOME="$HOME/.openclaw"
```

实时 hook（补数/排障场景）：

```bash
echo '{"session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime openclaw hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

离线导出：

```bash
spanory runtime openclaw export \
  --project-id openclaw-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

批量回跑：

```bash
spanory runtime openclaw backfill \
  --project-id main \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

## 推荐使用方式

- 日常使用：OpenClaw 使用 plugin 自动实时上报（零 cron）。
- 日常使用：OpenCode 使用 plugin 自动实时上报。
- Claude Code 使用 `spanory hook` 实时上报。
- 缺失补数：使用 `export` 或 `backfill` 离线回跑。
- 先 `--dry-run`，确认范围后再正式发送。

## Report 视图（CLI）

基于 `export` 产出的 JSON（单文件或目录）做聚合视图：

```bash
spanory report session --input-json /path/to/exported.json
spanory report mcp --input-json /path/to/exported-or-dir
spanory report command --input-json /path/to/exported-or-dir
spanory report agent --input-json /path/to/exported-or-dir
spanory report cache --input-json /path/to/exported-or-dir
spanory report tool --input-json /path/to/exported-or-dir
spanory report turn-diff --input-json /path/to/exported-or-dir
```

输出为 JSON，便于后续接入你自己的可视化或任务系统。

核心输出字段：
- `cache-summary`: `inputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `cacheHitRate`
- `tool-summary`: `category`, `tool`, `calls`, `sessions`
- `turn-diff-summary`: `turnId`, `charDelta`, `lineDelta`, `similarity`, `changed`

## Alert 规则评估（CLI）

规则文件格式（JSON）：

```json
{
  "rules": [
    {"id":"session-token-high","scope":"session","metric":"usage.total","op":"gt","threshold":10000},
    {"id":"mcp-spike","scope":"mcp","metric":"calls","op":"gte","threshold":50}
  ]
}
```

执行规则评估：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json
```

`scope=session` 可用指标：
- `cache.read`
- `cache.creation`
- `cache.hit_rate`
- `subagent.calls`
- `diff.char_delta.max`

有告警时返回非零退出码（用于 CI/自动化）：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --fail-on-alert
```

可选 webhook 通知：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --webhook-url https://example.com/hook \
  --webhook-headers "Authorization=Bearer x-token"
```

## 安装与构建

命令行安装：

```bash
npm install -g ./packages/cli
spanory --help
```

## 常见排查

### 1) `npm link` 后找不到 `commander`

```bash
cd /path/to/spanory
npm install
npm link -w packages/cli
spanory --help
```

### 2) Hook 上报返回 401

先确认环境变量已生效：

```bash
echo "$OTEL_EXPORTER_OTLP_ENDPOINT"
echo "$OTEL_EXPORTER_OTLP_HEADERS"
```

再确认认证格式为 Basic（不是 Bearer）：

`Authorization=Basic <base64(public_key:secret_key)>`

最后用本地导出验证解析是否正常：

```bash
spanory runtime claude-code export \
  --project-id <PROJECT_ID> \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

### 3) Hook 已触发但没有数据

- 确认 Hook command 是 `spanory hook`
- 推荐同时绑定 `Stop` 和 `SessionEnd`
- 查看本地日志：

```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

构建独立可执行文件：

```bash
npm run build:bin
./dist/spanory-macos-arm64 --help
```

构建全平台：

```bash
bash scripts/release/build-binaries.sh all
```

## 开发

```bash
npm install
npm run check
npm test
npm run test:bdd
npm run build:bin
```

## 许可证

[MIT](../LICENSE)
