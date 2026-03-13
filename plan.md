# Plan (2026-03-14) — BUB-28 pkg CVE 迁移

## 背景
- 工单要求移除 `packages/cli/package.json` 中 `pkg@5.8.1`（`GHSA-22r3-9w55-cj54`, `fixAvailable:false`）。
- 上游 `pkg` 已停止维护，优先迁移到 `@yao-pkg/pkg`。

## 目标
1. CLI 二进制打包流程继续可用（命令与产物路径不变）。
2. 依赖树中不再存在 `pkg@5.8.1`，且 `npm audit` 不再报该 GHSA。
3. 变更最小化，仅触及必要文件并保留可追溯验证证据。

## 执行顺序
1. 基线确认与兼容性评估
   - 确认 `@yao-pkg/pkg` 提供 `pkg` 命令，且 Node 版本基线与仓库 CI 一致。
   - 验收检查：`npm view @yao-pkg/pkg version bin engines --json` 输出满足预期。
2. 依赖替换与锁文件更新
   - 在 `packages/cli/package.json` 将 `pkg` 替换为 `@yao-pkg/pkg`。
   - 运行定向安装/更新锁文件，确保 lock 与 package 一致。
   - 验收检查：`rg -n "\bpkg\b|@yao-pkg/pkg" packages/cli/package.json package-lock.json`。
3. 功能与安全回归
   - 执行 CLI 构建与二进制打包关键路径验证。
   - 执行 `npm audit --workspace @bububuger/spanory --json` 确认 GHSA 消失。
   - 验收检查：构建命令成功、audit 不含 `GHSA-22r3-9w55-cj54`。
4. 交付整理
   - 更新 Workpad 全量勾选与验证记录。
   - 提交、推送、创建 PR 并挂载到 Linear issue。
   - 验收检查：PR checks 通过，issue 进入 `Human Review` 前满足完成门槛。
