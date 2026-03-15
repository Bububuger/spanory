# Spanory 接入指南

## 环境变量

```bash
export LANGFUSE_PUBLIC_KEY="YOUR_LANGFUSE_PUBLIC_KEY"
export LANGFUSE_SECRET_KEY="YOUR_LANGFUSE_SECRET_KEY"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://your-endpoint/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" | base64)"
export SPANORY_BACKEND=langfuse
```

## 一键接入

```bash
spanory install --runtimes claude-code,codex,openclaw,opencode
spanory doctor
```

## Agent 自动接入提示词

复制以下内容发给 Agent：

```
请帮我完成 spanory 的本地运行时接入。

1. 安装: npm install -g @bububuger/spanory (或 tnpm install -g @alipay/spanory)
2. 配置环境变量（LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, OTEL endpoint）
3. 执行: spanory install --runtimes claude-code,codex,openclaw,opencode
4. 重启运行时使配置生效
5. 验证: spanory doctor
6. 排查: spanory status && env | grep -E "OTEL|SPANORY|LANGFUSE"
```

## Symphony 编排（可选）

本仓库支持 [OpenAI Symphony](https://github.com/openai/symphony) 编排，配合 Linear issue 驱动开发。

前置条件：Linear personal token (`LINEAR_API_KEY`)、Codex CLI、Symphony Elixir runtime。

```bash
# 验证工作流配置
npm run symphony:validate

# 运行 Symphony
./scripts/symphony/run-symphony.sh /ABS/PATH/TO/spanory/WORKFLOW.md
```

Skills: commit / push / pull / land / linear / debug（位于 `.agents/skills/`）。
