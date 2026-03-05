# CI Dist 依赖缺失修复 TODO (2026-03-05)

- [x] T1 修改 `.github/workflows/ci.yml`：`Check` 后增加 `Build`
- [x] T1 验收：`rg -n "name: Build|run: npm run build" .github/workflows/ci.yml`
- [x] T2 修改 `.github/workflows/release.yml`：`Check` 后增加 `Build`
- [x] T2 验收：`rg -n "name: Build|run: npm run build" .github/workflows/release.yml`
- [x] T3 本地回归：`npm run check && npm run build && npm test`
- [ ] T4 提交推送并观察 CI
