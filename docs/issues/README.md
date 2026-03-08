# Issue 状态管理

用于自动化巡检场景，将 `todo.md` 的未完成项同步为可持久化 issue 状态。

## 状态流转
- `open`: 新发现、未开始
- `in_progress`: 处理中
- `blocked`: 被外部依赖阻塞
- `done`: 已完成（默认不可回退）

## 命令
```bash
# 从 todo.md 同步未完成项
spanory issue sync

# 查看全部 issue
spanory issue list

# 只看进行中 issue
spanory issue list --status in_progress

# 更新状态
spanory issue set-status --id T2 --status in_progress --note "开始处理"
```

## 存储
- 默认状态文件：`docs/issues/state.json`
- 默认输入清单：`todo.md`
