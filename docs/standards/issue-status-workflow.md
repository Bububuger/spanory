# Issue Status Workflow

用于约束“巡检 issue -> 处理 issue -> 交付 PR”的状态管理，保证自动化可追踪、可交接。

## 1. 状态机

- `open`：新发现，未分诊。
- `triaged`：已确认范围与优先级，待执行。
- `in_progress`：已进入实现。
- `blocked`：被外部条件阻塞（网络/权限/依赖/决策）。
- `ready_for_review`：代码与验证完成，等待 PR 评审。
- `done`：PR 已合并，任务完成。
- `closed`：确认无需处理（重复、无效、过期）。

推荐流转：
`open -> triaged -> in_progress -> ready_for_review -> done`

若受阻：`* -> blocked -> triaged`

## 2. Tracker 位置与格式

- 文件：`docs/issues/tracker.json`
- 顶层字段：
  - `version`：当前固定为 `1`
  - `updatedAt`：ISO 时间
  - `issues[]`：issue 条目

每个 issue 最小字段：
- `id`：唯一标识（建议 `AUTO-YYYYMMDD-xxx` 或 GitHub issue 编号）
- `title`：问题标题
- `status`：状态机枚举值
- `source`：来源（`github` / `local` / `automation`）
- `updatedAt`：最近状态更新时间

建议字段：
- `owner`、`priority`、`link`、`nextAction`、`notes[]`

## 3. 运行命令

```bash
# 汇总状态
node scripts/issues/status-report.mjs summary

# 更新指定 issue 状态（可附带 note）
node scripts/issues/status-report.mjs set <id> <status> [note]
```

## 4. 巡检节奏（自动化）

1. 拉取 issue（可用时）：`gh issue list --state open`。
2. 对每个 issue 执行一次状态推进：
   - 新项写入 `open`
   - 已确认项推进到 `triaged/in_progress`
   - 环境受限项标记 `blocked` 并写明 `nextAction`
3. 每次运行至少推进 1 个 issue，或明确记录阻塞原因。
4. 交付前将对应 issue 置为 `ready_for_review`（PR 待合并）或 `done`（已合并）。

## 5. 与 plan/todo 的关系

- `plan.md` / `todo.md` 管理“当前阶段任务”。
- `docs/issues/tracker.json` 管理“跨阶段 issue 生命周期”。

两者并行维护，避免出现“todo 完成但 issue 状态未知”。
