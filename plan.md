# Spanory 计划：Release 二进制分发完善（2026-03-03）

## Goal
让用户无需 clone 源码即可使用 CLI：在 GitHub Release 提供可直接下载的跨平台二进制包，并在项目文档中给出明确下载与安装路径。

## Scope
- In scope:
  - `.github/workflows/release.yml`：Release 流程新增产物打包与上传。
  - `scripts/release/package-release-assets.sh`：统一打包/校验脚本。
  - `README.md`：新增 GitHub Release 二进制下载说明。
  - `docs/README_zh.md`：同步中文下载说明。
  - `plan.md` / `todo.md`：本阶段计划与执行记录。
- Out of scope:
  - Homebrew/Scoop/Apt 包管理器发布。
  - 自动安装脚本远程执行器（curl|bash）。

## Acceptance
- GitHub Release 附件包含：
  - `spanory-<version>-darwin-arm64.tar.gz`
  - `spanory-<version>-linux-x64.tar.gz`
  - `spanory-<version>-windows-x64.zip`
  - `SHA256SUMS.txt`
- README（中英文）提供“无需 clone 的下载使用路径”。
- 本地回归通过：`npm run check`、`npm test`、`npm run test:bdd`。
