# Spanory TODO：need_fix 修复（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls docs/plans/archive | tail -n 6`
- [x] `rg -n "need_fix|README|Basic Auth|env" plan.md todo.md`

## T2 修复 env 加载能力
- [x] 新增 `packages/cli/src/env.js`
- [x] 支持 `export KEY=...` 与 `HOME/USERPROFILE`
- [x] `index.js` 改为复用新模块

验收：
- [x] env 单测通过
- [x] `npm run check`

## T3 文档修复与可走通增强
- [x] 更新 `README.md` 认证示例为 Basic Auth
- [x] 更新 `docs/README_zh.md` 对应示例
- [x] 增加排查建议（401/env/hook）

验收：
- [x] `rg -n "Authorization=Basic|排查|Troubleshooting" README.md docs/README_zh.md`

## T4 全量回归与提交
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
- [ ] 提交改动

验收：
- [x] 命令全部 0 退出
- [ ] `git status` clean（提交后）
