# Spanory TODO：Release 二进制分发完善（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "Release 二进制分发完善|Acceptance" plan.md todo.md`

## T2 发布产物打包能力
- [x] 新增 `scripts/release/package-release-assets.sh`
- [x] 在 `release.yml` 中调用打包脚本并上传压缩包 + SHA256

验收：
- [x] `bash scripts/release/package-release-assets.sh v0.0.0`（使用已有 dist 样例文件时可运行）
- [x] `rg -n "package-release-assets|SHA256SUMS|tar.gz|zip" .github/workflows/release.yml scripts/release/package-release-assets.sh`

## T3 文档补齐下载路径
- [x] 更新 `README.md`（GitHub Releases 下载与解压使用）
- [x] 更新 `docs/README_zh.md`（同等信息）

验收：
- [x] `rg -n "GitHub Release|Releases|tar.gz|windows-x64.zip|SHA256" README.md docs/README_zh.md`

## T4 回归与提交
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
- [ ] 提交改动

验收：
- [x] 三个命令均 0 退出
- [ ] `git status` clean（提交后）
