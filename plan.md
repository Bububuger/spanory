# Spanory 计划：README 与二进制 Release 同步（2026-03-03）

## Goal
让 README 与当前发布能力保持一致，明确区分 macOS ARM/Intel 下载包，避免用户按文档操作失败。

## Scope
- In scope:
  - `README.md`：下载示例、资产清单、验签与架构选择说明更新。
  - `docs/README_zh.md`：同步中文说明。
  - `plan.md` / `todo.md`：记录本阶段执行。
- Out of scope:
  - 变更发布流水线逻辑。
  - 变更 CLI 功能。

## Acceptance
- 中英文 README 均包含四类 Release 资产说明：`darwin-arm64`、`darwin-x64`、`linux-x64`、`windows-x64`。
- 下载示例不再固定过期版本号，改为版本占位符。
- 中英文 README 均包含 macOS 架构判断指引。
