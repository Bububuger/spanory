# Spanory TODO：支持 npm/npx 分发（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "支持 npm/npx 分发|Acceptance" plan.md todo.md`

## T2 CLI 包可发布化
- [x] `packages/cli/package.json` 去掉 `private: true`
- [x] 补充 npm 发布元信息（files/publishConfig/repository）

验收：
- [x] `cat packages/cli/package.json | rg -n "private|publishConfig|files|repository"`

## T3 Release 流程增加 npm publish
- [x] `release.yml` 增加 npm publish job
- [x] job 仅在 tag + `NPM_TOKEN` 存在时执行

验收：
- [x] `rg -n "publish-npm|npm publish|NPM_TOKEN|registry-url" .github/workflows/release.yml`

## T4 文档同步
- [x] README 新增 npm/npx 安装方式
- [x] 中文 README 同步新增 npm/npx 安装方式

验收：
- [x] `rg -n "npx @spanory/cli|npm i -g @spanory/cli|NPM_TOKEN|brew" README.md docs/README_zh.md`

## T5 回归与提交
- [x] `npm run check`
- [ ] 提交改动

验收：
- [x] 命令 0 退出
- [ ] `git status` clean（提交后）
