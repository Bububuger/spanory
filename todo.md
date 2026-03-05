# TODO (2026-03-06) — name 前缀精简

- [x] T1 修改 name 生成逻辑，移除 `Spanory` 前缀
- [x] T2 更新断言与 golden 快照
- [x] T3 运行回归测试并记录结果

## 验收记录
- [x] 关键模板已调整：`Spanory <runtime> - Turn` -> `<runtime> - Turn`
- [x] `npm run --workspace @spanory/spanory test:golden:update` 通过
- [x] `npm run --workspace @spanory/spanory test` 通过（14 files / 66 tests）
