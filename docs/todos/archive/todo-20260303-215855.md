# Spanory TODO：CI/CD 完善（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 生成本阶段 `plan.md`
- [x] 生成本阶段 `todo.md`

验收：
- [x] `ls docs/plans/archive | tail -n 6`
- [x] `rg -n "CI/CD|release.yml|concurrency" plan.md todo.md`

## T2 改造 CI 工作流
- [x] 更新 `.github/workflows/ci.yml`
- [x] 增加并发控制与最小权限
- [x] 拆分质量门禁与二进制 smoke job

验收：
- [x] YAML 可解析
- [x] `npm run check`

## T3 新增 CD 发布工作流
- [x] 新增 `.github/workflows/release.yml`
- [x] 配置 tag 触发、verify 门禁、跨平台构建
- [x] 配置 release 发布与 artifact 附件

验收：
- [x] YAML 可解析
- [x] 关键字段检查：`on.push.tags`、`permissions.contents: write`、`strategy.matrix`

## T4 更新文档
- [x] 更新 `README.md` CI/CD 说明
- [x] 更新 `CONTRIBUTING.md` 发布入口

验收：
- [x] `rg -n "CI/CD|tag|release|vX.Y.Z|workflow" README.md CONTRIBUTING.md`

## T5 全量回归与提交
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
- [ ] 提交本次改动

验收：
- [ ] 所有命令退出码为 0
- [ ] `git status` clean（提交后）
