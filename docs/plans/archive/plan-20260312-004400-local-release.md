# Plan (2026-03-12) — 本地二进制版本跟随 release

## 目标
修复 Spanory 本地/发布二进制版本号与 release tag 不一致的问题，确保 `spanory --version`、OTLP 资源版本与发布 tag 语义一致。

## 范围
- `packages/cli/src/index.ts`
- `.github/workflows/release.yml`

## 实施步骤
1. 将 CLI 版本来源从硬编码改为读取包版本（并支持 `SPANORY_VERSION` 覆盖）。
2. 在 release 二进制构建 job 中，构建前按 tag 同步 workspace 版本。
3. 本地构建与回归验证 `--version` 输出。

## 风险与回滚
- 风险：workflow 改动可能影响非 tag 触发场景。
- 缓解：仅在 `refs/tags/v*` 场景同步版本，保持原有流程。
- 回滚：回退上述两个文件即可。

## 验收
- 本地 CLI `./packages/cli/dist/index.js --version` 输出来自 package version。
- tag 流水线中二进制构建前执行版本同步步骤。
- 本地二进制可运行并输出正确版本。
