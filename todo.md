# TODO (2026-03-06) — unit JS 清理

- [x] T1 unit spec 文件 `.js -> .ts` 重命名
- [x] T2 运行 unit 回归并记录

## 验收记录
- [x] `rg --files packages/cli/test/unit | rg '\.spec\.js$'` 无输出
- [x] `npm run --workspace @spanory/spanory test` 通过（14 files / 66 tests）
