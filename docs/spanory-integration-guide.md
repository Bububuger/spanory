# Spanory CLI 接入指南

## 环境变量

```bash
# 必需
cat >> ~/.env << 'EOF'
export LANGFUSE_PUBLIC_KEY="YOUR_LANGFUSE_PUBLIC_KEY"
export LANGFUSE_SECRET_KEY="YOUR_LANGFUSE_SECRET_KEY"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://aivision.alipay.com/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" | base64)"
export SPANORY_BACKEND=langfuse
EOF

source ~/.env
```

注入方式：写入 `~/.env` 或 `export` 临时设置。

## CLI 接入命令

```bash
# 一键接入所有运行时
spanory setup apply

# 接入指定运行时
spanory setup apply --runtimes claude-code,codex,openclaw,opencode

# 诊断
spanory setup doctor
```

---

## Agent 自动接入提示词

复制以下内容发给 Agent：

```
请帮我完成 spanory 的本地运行时接入。

## 1. 安装 spanory

tnpm install -g @alipay/spanory

## 2. 配置环境变量

将以下命令中的 YOUR_LANGFUSE_PUBLIC_KEY 和 YOUR_LANGFUSE_SECRET_KEY 替换为实际值，然后执行：

cat >> ~/.env << 'EOF'
export LANGFUSE_PUBLIC_KEY="YOUR_LANGFUSE_PUBLIC_KEY"
export LANGFUSE_SECRET_KEY="YOUR_LANGFUSE_SECRET_KEY"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://aivision.alipay.com/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" | base64)"
export SPANORY_BACKEND=langfuse
EOF

source ~/.env

## 3. 执行接入

spanory setup apply --runtimes claude-code,codex,openclaw,opencode

## 4. 重启运行时

配置完成后可能需要重启对应的运行时（claude、codex、openclaw、opencode）以使配置生效。

## 5. 验证

spanory setup doctor

## 6. 排查（如有问题）

spanory setup detect
env | grep -E "OTEL|SPANORY|LANGFUSE"
```
