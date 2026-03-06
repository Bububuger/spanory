# Plan (2026-03-06) — 统一 npm Scope 为 @bububuger

## 背景
当前 npm 发布卡在 `@bububuger/*` scope 权限上。用户已明确决定将整个对外 npm scope 统一改为 `@bububuger/*`，并要求保持 CLI、plugin、release workflow、README 与仓库内部 workspace 引用一致。

## 目标
- 将 CLI 与 plugin 包名从 `@bububuger/*` 统一迁移到 `@bububuger/*`
- 同步修正 build / publish / README / 文档中的 workspace 与安装命令
- 保持 CLI 命令名 `spanory`、二进制产物名、runtime 行为不变

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- 包定义：`packages/*/package.json`、根 `package.json`、`package-lock.json`
- 发布链路：`.github/workflows/release.yml`、`scripts/release/*`（如有必要）
- 文档：`README.md`、`docs/README_zh.md`、相关 standards / parity / changelog

## 实施方案
1. 归档当前阶段 `plan.md/todo.md`，建立 scope 迁移阶段计划。
2. 统一修改所有活跃包名与 workspace 引用到 `@bububuger/*`。
3. 修正 release workflow、README 与安装命令，确保 npm publish 与用户文档一致。
4. 重新生成 lockfile，并用最小命令验证 pack/build/test 链路。
5. 验收通过后提交；如需发布，再打新 tag。

## 验收标准
1. 业务文件中不再残留 `@bububuger/spanory`、`@bububuger/spanory-openclaw-plugin`、`@bububuger/spanory-opencode-plugin`。
2. `npm pack --workspace @bububuger/spanory --dry-run` 成功，并显示新包名。
3. `npm run check`、`npm test`、`npm run test:bdd` 通过。
