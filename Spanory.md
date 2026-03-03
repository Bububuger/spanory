—— 我的首个 Vibecoding 作品
## 
缘起

Claude 自去年中旬横空出世，席卷 AI 编程领域。我入局虽晚，却因 OpenClaw 的出现窥见门径——原来 AI Agent 还可以这样玩。遂一头扎进这个领域，一发不可收拾。

## 为何造轮子

**痛点有三：**

1. **Langfuse 接入不爽** — 上报内容与接入方式均有不尽人意之处
2. **观测手段缺失** — OpenClaw 在 TUI 中展示工具调用信息模糊，执行过程如雾里看花
3. **手痒难耐** — 纯粹想写个项目练练手，顺便验证 Vibecoding 的生产力

## 项目简介

**Spanory** 是一套跨运行时的 AI Agent 可观测性工具链（Cross-runtime observability toolkit for AI agent systems）。

### 核心能力

| 能力 | 说明 |
|------|------|
| 统一解析 | 支持 Claude Code、OpenClaw、OpenCode 等 Agent 会话日志 |
| 标准输出 | 转换为 OpenTelemetry (OTLP) 格式，对接 Langfuse 等后端 |
| 双模上报 | Hook 实时上报 + CLI 离线回填 |
| 报表告警 | 内置聚合视图（session、MCP、tool、cache、turn-diff）与规则告警 |

### 与 Langfuse 原版对比

| 维度 | Langfuse 原版 | Spanory |
|------|---------------|---------|
| **命名空间** | 属性堆砌在 `langfuse` 域下，不够规范 | 新建 `agentic` 一级命名空间，符合 OTel 语义约定 |
| **元信息** | 缺失 runtime 类型和版本 | 完整记录（如 `claude code 1.2.63`） |
| **拓扑结构** | 自创 Claude Response 节点，非真实调用，时间戳乱序导致拓扑错乱 | 严格遵循调用链，拓扑清晰 |
| **客户端命令** | 无 | 上报 `/new`、`/compact` 等用户命令 |
| **工具调用** | 无 turn 级别拓扑 | OpenClaw 支持 turn 下 tool 调用拓扑 |
| **接入方式** | 需编写复杂脚本 | 一条 CLI 命令搞定 |

### 架构概览

```
RuntimeAdapter → Canonical Events → BackendAdapter → OTLP Core → OTLP HTTP
```

**统一事件模型（SpanoryEvent）：**

`turn` · `agent_command` · `shell_command` · `mcp` · `agent_task` · `tool`

### 快速开始

```bash
# 安装
npm install -g packages/cli
spanory --help

# 配置 OTLP 端点
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <PUBLIC_KEY>:<SECRET_KEY>"

# Claude Code 实时 Hook
spanory hook
```

**项目地址：** [GitHub - Bububuger/spanory](https://github.com/Bububuger/spanory)

**开发模式：** 100% Agentic — 代码几乎全由 AI 协作完成

![[Pasted image 20260303102701.png]]

## 支持状态

| Runtime     | 状态               |
|-------------|-------------------|
| Claude Code | ✅ 已支持           |
| OpenClaw    | ✅ 已支持           |
| OpenCode    | 🔶 待验收（已开发完成） |
| Codex       | 🚧 进行中          |

## 效果展示

### Claude Code

**Langfuse 原版：**

![[Pasted image 20260303104824.png]]

**Spanory 版本：**

![[Pasted image 20260303104739.png]]

### OpenClaw

**Cron 模式：**

![[Pasted image 20260303104922.png]]

**User 模式：**

![[Pasted image 20260303104953.png]]

## 里程碑

- **v0.1.0** — 完成 Claude Code、OpenClaw 适配器
- **v0.2.0** — 新增 OpenCode 插件，完善告警系统
- **Roadmap** — Codex 适配器、LangSmith 后端、本地 UI

## 致谢

本项目参考了以下优秀开源项目：

- [langfuse/langfuse](https://github.com/langfuse/langfuse) — 开源 LLM 可观测性平台
- [matt1398/claude-devtools](https://github.com/matt1398/claude-devtools) — Claude Code 开发工具集
- [loocor/codmate](https://github.com/loocor/codmate) — Codex 辅助工具
- [weiesky/cc-viewer](https://github.com/weiesky/cc-viewer) — Claude Code 会话查看器（感谢 AI 摸鱼群 @水映天辙）
- [MCKRUZ/openclaw-langfuse](https://github.com/MCKRUZ/openclaw-langfuse) — OpenClaw Langfuse 集成
