# Spanory

### 跨运行时 AI Agent 可观测性工具包

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green.svg)](https://nodejs.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-OTLP-blueviolet.svg)](https://opentelemetry.io/)

[English](../README.md) | 中文

---

## 简介

Spanory 是一个跨运行时的 AI Agent 可观测性工具包，将 Claude Code、Codex、OpenClaw、OpenCode 等 AI 编程 Agent 的会话数据解析为统一事件模型，通过 OpenTelemetry 协议上报到 Langfuse 等后端。

支持实时 Hook 上报（零 cron）和离线补数（backfill），内置聚合报表和规则告警。

## 推荐：一键 setup（四 runtime）

优先使用内置 setup 命令完成本地接入（默认 Codex 走 notify，非代理模式）：

```bash
spanory setup detect
spanory setup apply --runtimes claude-code,codex,openclaw,opencode --codex-mode notify
spanory setup doctor --runtimes claude-code,codex,openclaw,opencode
```

`setup apply` 会自动执行：
- Claude Code：写入/更新 `Stop` + `SessionEnd` 的 `spanory hook --last-turn-only`
- Codex：写入 `~/.codex/bin/spanory-codex-notify.sh`，并将 `~/.codex/config.toml` 的 `notify` 更新为绝对路径（如 `notify = ["/Users/<you>/.codex/bin/spanory-codex-notify.sh"]`）

注意：Codex 的 `notify` 建议必须写绝对路径；部分执行路径下 `~` 不会自动展开。
- OpenClaw：安装并启用 Spanory plugin（当 PATH 中可用 `openclaw`）
- OpenCode：安装 plugin loader 到 `~/.config/opencode/plugin`

只看变更不落盘：

```bash
spanory setup apply \
  --runtimes claude-code,codex,openclaw,opencode \
  --codex-mode notify \
  --dry-run
```

## 复制给 Agent 执行（让 Agent 自己安装）

把下面这段原样发给你的 Agent：

```text
请在当前仓库完成 Spanory 本机安装与四 runtime 接入。
要求：
- Codex 使用 notify 模式，不启用 proxy 劫持。
- 接入 claude-code,codex,openclaw,opencode 四个 runtime。
- 执行后输出 detect/apply/doctor 的 JSON 结果，并给出最终通过/失败总结。

执行步骤：
1) npm install
2) npm install -g ./packages/cli
3) spanory setup detect
4) spanory setup apply --runtimes claude-code,codex,openclaw,opencode --codex-mode notify
5) spanory setup doctor --runtimes claude-code,codex,openclaw,opencode

如果有失败项，请附上可直接执行的排查命令。
```

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

# 触发模式：默认按每轮完成事件实时 flush（推荐）
export SPANORY_OPENCODE_FLUSH_MODE="turn"

# 可选：仅在会话终态事件 flush
# export SPANORY_OPENCODE_FLUSH_MODE="session"
```

### 3) Plugin 运行状态检查

```bash
spanory runtime opencode plugin doctor
```

## Codex 接入（解析主链路 + 代理劫持）

### 1) 会话解析（export/backfill）

Codex transcript 默认目录：

- `~/.codex/sessions/YYYY/MM/DD/<session-id>.jsonl`

导出单个会话：

```bash
spanory runtime codex export \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

批量回跑：

```bash
spanory runtime codex backfill \
  --since 2026-03-01T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

### 2) notify 增量导出（turn 级）

```bash
echo '{"event":"agent-turn-complete","thread_id":"<SESSION_ID>","turn_id":"<TURN_ID>","cwd":"<PROJECT_CWD>"}' | \
spanory runtime codex hook --last-turn-only
```

说明：

- `thread_id` 作为 `sessionId`
- `turn_id` 用于精确筛选增量 turn
- `cwd` 用于派生默认 `projectId`（`basename + short_hash`）

### 3) 代理劫持采集（full_redacted）

启动本地 OpenAI-compatible 代理：

```bash
spanory runtime codex proxy \
  --listen 127.0.0.1:8787 \
  --upstream https://api.openai.com
```

将 Codex 模型流量导向代理：

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787"
```

采集内容为全量 request/response，落盘前进行强脱敏（如 `authorization/cookie/api_key/token/password`）。

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
- Codex 使用 session 解析链路 + `hook --last-turn-only` 做近实时增量；需要模型包体深度时启用 `runtime codex proxy`。
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

### 方式 A：从 GitHub Releases 下载二进制（无需 clone）

Release 页面： [https://github.com/Bububuger/spanory/releases](https://github.com/Bububuger/spanory/releases)

每个 Release 会包含：

- `spanory-<version>-darwin-arm64.tar.gz`（macOS Apple Silicon）
- `spanory-<version>-darwin-x64.tar.gz`（macOS Intel）
- `spanory-<version>-linux-x64.tar.gz`（Linux x64）
- `spanory-<version>-windows-x64.zip`（Windows x64）
- `SHA256SUMS.txt`

macOS / Linux：

```bash
TAG=vX.Y.Z # 替换为目标版本 tag
# macOS 架构：arm64 => darwin-arm64，x86_64 => darwin-x64
# Linux（当前支持）：x86_64 => linux-x64
OS_ARCH=darwin-arm64
# macOS 快速判断架构：uname -m
curl -fL -o spanory.tar.gz \
  "https://github.com/Bububuger/spanory/releases/download/${TAG}/spanory-${TAG#v}-${OS_ARCH}.tar.gz"
tar -xzf spanory.tar.gz
chmod +x spanory
sudo mv spanory /usr/local/bin/spanory
spanory --help
```

Windows（PowerShell）：

```powershell
$Tag = "vX.Y.Z" # 替换为目标版本 tag
Invoke-WebRequest -Uri "https://github.com/Bububuger/spanory/releases/download/$Tag/spanory-$($Tag.TrimStart('v'))-windows-x64.zip" -OutFile "spanory.zip"
Expand-Archive -Path "spanory.zip" -DestinationPath ".\\spanory-bin" -Force
.\\spanory-bin\\spanory.exe --help
```

可选：校验下载完整性

```bash
curl -fL -o SHA256SUMS.txt \
  "https://github.com/Bububuger/spanory/releases/download/${TAG}/SHA256SUMS.txt"
shasum -a 256 -c SHA256SUMS.txt
```

### 方式 B：通过 npm / npx 使用

```bash
# 直接运行（无需全局安装）
npx @spanory/cli@latest --help

# 全局安装
npm i -g @spanory/cli
spanory --help
```

维护者发布提示：GitHub Actions 自动发布 npm 需要配置 `NPM_TOKEN`（路径：`Settings > Secrets and variables > Actions`）。

### 方式 C：从源码安装 CLI

```bash
cd spanory
npm install
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

按版本打包 Release 附件（`tar.gz/zip + SHA256SUMS`）：

```bash
npm run package:release-assets -- vX.Y.Z
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
