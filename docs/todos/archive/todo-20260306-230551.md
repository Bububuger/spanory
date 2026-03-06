# TODO (2026-03-06) — 清理 node_modules 并重建

- [x] T1 归档当前计划文件并建立重建阶段 plan/todo
- [x] T2 清理仓库根 `node_modules/`
- [x] T3 执行干净安装（`npm ci`）
- [x] T4 执行全 workspace 构建并记录结果

## 验收记录
- [x] `node_modules/` 已重新安装
- [x] `npm run build` 通过
- [x] `packages/*/dist/` 已重新生成
