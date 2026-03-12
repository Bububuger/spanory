# Plan (2026-03-12) — 增加 spanory upgrade 命令

## 目标
1. 为 spanory CLI 增加统一的 `upgrade` 命令。
2. 支持根据安装包来源执行升级（npm / tnpm），并提供 dry-run。
3. 输出明确的升级结果与失败信息。

## 执行顺序
1. 在 `packages/cli/src/index.ts` 增加升级命令与来源识别逻辑。
2. 补充单测覆盖 upgrade 核心路径。
3. 执行 unit/bdd 回归。

## 验收标准
- `spanory upgrade --dry-run` 能输出计划执行命令
- `spanory upgrade` 能调用包管理器并返回成功/失败状态
- 相关测试通过
