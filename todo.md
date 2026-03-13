# Todo (2026-03-14) — BUB-28 pkg CVE 迁移

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] 基线确认：复现 `pkg` 漏洞信号并记录
- [x] 兼容性确认：验证 `@yao-pkg/pkg` 命令与 Node 基线
- [x] 替换 `packages/cli/package.json` 中 `pkg` 依赖
- [x] 更新 `package-lock.json` 并校验依赖映射
- [x] 运行 `npm run -w packages/cli build:bundle`
- [x] 运行 `npm run -w packages/cli build:bin:macos-arm64`
- [x] 运行 `npm audit --workspace @bububuger/spanory --json` 验证 GHSA 清除
- [x] 运行 `npm test --workspaces --if-present`
- [ ] 更新 Workpad、提交代码、推送并创建 PR
