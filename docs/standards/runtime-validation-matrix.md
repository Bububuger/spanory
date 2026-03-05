# Spanory Runtime 验收矩阵（发布前强制）

## 目的
避免只覆盖部分 runtime，确保每次发布前都完成 `claude-code/codex/openclaw/opencode` 的可执行验收。

## 总体要求
- 发布前必须执行一次全量 runtime 验收。
- 所有 runtime 都要有“可上报证据”。
- 验收结论必须记录到当期 `todo.md`（命令 + 结果摘要）。

## Runtime 验收清单

### 1) 通用配置验证
```bash
spanory setup detect
spanory setup apply --runtimes claude-code,codex,openclaw,opencode --codex-mode notify
spanory setup doctor --runtimes claude-code,codex,openclaw,opencode
```

通过标准：
- `setup doctor` 返回 `ok: true`。
- 每个 runtime 的关键 check 为 `ok: true`。

### 2) CLI Export 型 runtime（claude-code/openclaw/codex）
```bash
spanory runtime claude-code export ...
spanory runtime openclaw export ...
spanory runtime codex export ...
```

通过标准：
- 命令成功退出（exit code 0）。
- 输出包含 `otlp=sent`（或明确记录本次为何跳过 endpoint）。
- 导出 JSON 文件存在且可解析。

### 3) Plugin 型 runtime（opencode）
说明：当前 `opencode` 无 `runtime opencode export` 子命令，验收走 plugin 路径。

```bash
spanory runtime opencode plugin install
spanory runtime opencode plugin doctor
cat ~/.config/opencode/state/spanory/plugin-status.json
tail -n 120 ~/.config/opencode/state/spanory/plugin.log
```

通过标准：
- `plugin doctor` 返回 `ok: true`。
- `plugin-status.json` 中 `endpointConfigured=true`。
- 日志中存在 `otlp_sent` 记录（必要时先触发一轮 opencode 会话再检查）。

## 一致性对比（重构/大改时）
- 至少选择 `claude/openclaw/codex` 各 1 个固定输入样本，比较重构前后导出 JSON。
- 允许的差异必须显式列出（例如：新增属性、稳定 id 策略调整）。
- 若存在 runtime 特有路径（如 opencode plugin），需补 status/log 证据。
