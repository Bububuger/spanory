# Spanory 计划：完善 GitHub CI/CD 流程（2026-03-03）

## Goal
将当前仅有基础 CI 的状态升级为可持续交付流程：
1. CI：稳定执行质量门禁（check/test/bdd/build smoke），并增强可维护性（并发控制、权限最小化、任务分层）。
2. CD：在版本 tag 发布时自动构建跨平台二进制并创建 GitHub Release 上传产物。

## Scope
- In scope:
  - `.github/workflows/ci.yml`：重构为更完整的 CI job 结构。
  - `.github/workflows/release.yml`：新增发布流水线。
  - `README.md`：补充 CI/CD 说明。
  - `CONTRIBUTING.md`：补充发布流程入口（tag 驱动）。
- Out of scope:
  - npm publish（当前 package 私有）
  - 签名/公证（macOS notarization）
  - 自动版本号递增策略（保持手工管理）

## Design

### CI 工作流（ci.yml）
- 触发：`push`（main/codex/**/feat/**）+ `pull_request`
- 增强项：
  - `concurrency`：同分支新提交自动取消旧运行。
  - `permissions: contents: read`。
  - 任务拆分：
    - `quality-gates`：安装依赖、check、unit、bdd。
    - `binary-smoke`：构建 host 二进制并执行 `--help` smoke。
- Node：统一 `20`（与现有脚本兼容，减少矩阵噪音）。

### CD 工作流（release.yml）
- 触发：`push tags: v*` + `workflow_dispatch`
- `permissions: contents: write`
- Job 设计：
  - `verify`：先跑 check/test/bdd 作为发布前门禁。
  - `build-binaries`（matrix）：
    - `ubuntu-latest` -> `spanory-linux-x64`
    - `macos-14` -> `spanory-macos-arm64`
    - `windows-latest` -> `spanory-win-x64.exe`
  - 上传每个平台 artifact。
  - `publish-release`：收集 artifact 并创建/更新 GitHub Release，附二进制文件。

### 文档更新
- `README.md`：新增“CI/CD”小节，说明 CI 门禁与 tag 发布方式。
- `CONTRIBUTING.md`：新增发布步骤（创建 `vX.Y.Z` tag 并 push）。

## Acceptance
- `ci.yml` 和 `release.yml` 通过 YAML 基础解析。
- 本地质量门禁通过：
  - `npm run check`
  - `npm test`
  - `npm run test:bdd`
- `git diff` 中仅包含本次 CI/CD 相关变更。
