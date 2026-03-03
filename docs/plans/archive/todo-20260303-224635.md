# Spanory TODO：README 与二进制 Release 同步（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` 与 `todo.md`
- [x] 写入本阶段 `plan.md` 与 `todo.md`

验收：
- [x] `ls -1 docs/plans/archive | tail -n 6`
- [x] `rg -n "README 与二进制 Release 同步|Acceptance" plan.md todo.md`

## T2 英文 README 同步
- [x] 更新 Release 资产说明（四平台）
- [x] 更新下载示例版本占位符与 macOS 架构选择

验收：
- [x] `rg -n "darwin-arm64|darwin-x64|linux-x64|windows-x64|vX.Y.Z|uname -m" README.md`

## T3 中文 README 同步
- [x] 更新 Release 资产说明（四平台）
- [x] 更新下载示例版本占位符与 macOS 架构选择

验收：
- [x] `rg -n "darwin-arm64|darwin-x64|linux-x64|windows-x64|vX.Y.Z|uname -m" docs/README_zh.md`

## T4 收尾
- [ ] 提交改动

验收：
- [ ] `git status` clean（提交后）
