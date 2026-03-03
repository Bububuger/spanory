# Spanory 计划：支持 npm/npx 分发（2026-03-03）

## Goal
让用户无需 clone 源码即可通过 npm/npx 使用 Spanory CLI，并把发布动作纳入现有 GitHub Release 流水线。

## Scope
- In scope:
  - `packages/cli/package.json`：开启可发布配置（移除 private，补充 publish 元信息）。
  - `.github/workflows/release.yml`：新增 npm publish job（基于 tag，使用 `NPM_TOKEN`）。
  - `README.md` / `docs/README_zh.md`：补充 npm/npx 安装方式与发布前置条件。
  - `plan.md` / `todo.md`：本阶段计划与执行记录。
- Out of scope:
  - Homebrew Tap 仓库落地（需要独立仓库）。
  - npm 包名变更（先沿用当前包名）。

## Acceptance
- CLI 包不再是 private，具备 npm 发布所需字段。
- release workflow 在 tag 触发时可执行 npm publish（当 `NPM_TOKEN` 存在）。
- README（中英文）新增 npm/npx 使用方式和 `NPM_TOKEN` 配置提示。
- 本地检查命令通过：`npm run check`。
