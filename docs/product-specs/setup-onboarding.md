---
type: file
summary: "Setup 一键接入流程：detect/apply/doctor 命令与各 runtime 配置效果"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [setup, onboarding, runtime, cli]
---

# Setup 一键接入

## 命令

```bash
spanory setup detect                                          # 检测已安装的 runtime
spanory setup apply --runtimes claude-code,codex,openclaw,opencode                      # 配置 hook/plugin
spanory setup doctor --runtimes claude-code,codex,openclaw,opencode                      # 健康检查
```

## 各 Runtime 配置效果

| Runtime | setup apply 做什么 | doctor 检查什么 |
|---------|-------------------|----------------|
| Claude Code | 写入 Stop + SessionEnd hook | hook 文件存在且格式正确 |
| Codex | 清理 notify 注入并启动 watch 守护进程 | watch 守护进程状态正常 |
| OpenClaw | 安装 plugin | plugin 可加载 |
| OpenCode | 安装 plugin loader | loader 可执行 |

## 前置条件

- Node.js 20+
- 对应 runtime 已安装
- Langfuse 环境变量已配置（`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`）
