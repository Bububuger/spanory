# TODO (2026-03-06) — docs 归并

- [x] T1 归档当前计划文件并建立本阶段 plan/todo
- [x] T2 迁移 docs 根目录散落的 plan/todo archive 文件
- [x] T3 归并 docs/plans/archive 中混放的 todo 文件到 docs/todos/archive
- [x] T4 结构验收与结果记录

## 验收记录
- [x] `find docs -maxdepth 1 -type f | rg 'plan\.archive|todo\.archive'` 无结果
- [x] `find docs/plans/archive -type f | rg '/todo-'` 无结果
- [x] `find docs/todos/archive -type f | rg '/todo-'` 结果正常（45 个）
