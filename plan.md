# Plan (2026-03-13) — GitHub Actions Node 24 兼容切换

## 目标
1. 消除 Node 20 deprecation 警告风险。
2. 在 GitHub Actions 中显式启用 JS actions 的 Node 24 运行时。

## 执行顺序
1. 更新 `ci.yml` 全局环境变量。
2. 更新 `release.yml` 全局环境变量。
3. 检查 workflow 语法与 diff。

## 验收标准
- `.github/workflows/ci.yml` 与 `release.yml` 都包含 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`。
- 推送后新 workflow 不再出现 Node 20 deprecation 警告。
