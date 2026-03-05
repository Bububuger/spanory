# Plan (2026-03-06) — docs 脏文件归并整理

## 背景
`docs/` 主目录结构基本清晰，但仍存在散落归档与归档目录混放，影响可维护性与检索效率。

## 目标
- 清理 `docs/` 根目录散落的历史归档文件。
- 统一归档语义：`plan` 只在 `docs/plans/archive`，`todo` 只在 `docs/todos/archive`。
- 不丢失历史内容，不做破坏性删除。

## 执行项
1. 迁移 `docs/plan.archive.*` -> `docs/plans/archive/plan-*.md`。
2. 迁移 `docs/todo.archive.*` -> `docs/todos/archive/todo-*.md`。
3. 迁移 `docs/plans/archive/todo-*.md` -> `docs/todos/archive/`，同名文件先比对：
   - 内容一致：删除来源重复项
   - 内容不一致：保留并加后缀，避免覆盖
4. 验证 `docs/` 根目录不再有上述散落归档文件，且 `docs/plans/archive` 不再含 `todo-*`。

## 验收标准
- `find docs -maxdepth 1 -type f | rg 'plan\.archive|todo\.archive'` 无结果。
- `find docs/plans/archive -type f | rg '/todo-'` 无结果。
- `find docs/todos/archive -type f | rg '/todo-'` 有结果且历史数量不减少。
