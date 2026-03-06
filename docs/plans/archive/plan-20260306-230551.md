# Plan (2026-03-06) — 清理 node_modules 并重建

## 背景
仓库内本地产物已清理完成，下一步需要把依赖目录也做一次干净重置，确认从空依赖状态可以重新安装并构建成功。

## 目标
- 删除仓库根 `node_modules/`
- 基于锁文件重新安装依赖
- 重新执行全 workspace 构建，恢复各 package `dist/`

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- 本地环境：`node_modules/` 与构建输出目录

## 验收标准
1. `node_modules/` 被清理后重新安装成功。
2. `npm run build` 成功。
3. `packages/*/dist/` 重新生成。
