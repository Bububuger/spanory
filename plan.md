# Plan (2026-03-07) — 显式绑定 Release Environment

## 背景
本轮已经确认 npm 发布成功依赖正确的 repository secret。为避免后续再把 `NPM_TOKEN` 更新到 GitHub Environment 却不生效，需要让 release workflow 显式绑定固定 environment，使 secret 来源单一且可见。

## 目标
- 在 release workflow 中为 npm 发布 job 显式绑定 `release` environment
- 在中英文 README 中明确 `NPM_TOKEN` 的配置位置改为 `Environments > release`
- 不改变现有发布逻辑、scope、二进制构建与 runtime 行为

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- 工作流：`.github/workflows/release.yml`
- 文档：`README.md`、`docs/README_zh.md`

## 实施方案
1. 归档上一阶段 `plan.md/todo.md`，切到 environment 绑定阶段。
2. 为 `publish-npm` job 增加 `environment: release`。
3. 将 README 中 `NPM_TOKEN` 的配置路径统一改为 `Settings > Environments > release`。
4. 运行最小校验，确认 YAML 可解析且文案一致。

## 验收标准
1. `publish-npm` job 显式声明 `environment: release`。
2. README / 中文 README 对 `NPM_TOKEN` 的说明与 workflow 一致。
3. 相关文件通过最小校验。
