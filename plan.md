# Plan (2026-03-14) — BUB-10 OpenClaw 环境变量拼写修复

## 目标
1. 删除错误环境变量 `SPANORY_OPENCLOW_HOME` 的公开/运行时入口。
2. OpenClaw 相关实现仅使用 `SPANORY_OPENCLAW_HOME`（及现有默认路径）。
3. 文档示例与代码行为保持一致，避免用户混淆。

## 执行顺序
1. 先补充单测（RED）：验证仅设置 `SPANORY_OPENCLOW_HOME` 时不会影响 OpenClaw 路径解析。
2. 修改实现（GREEN）：统一替换 `SPANORY_OPENCLOW_HOME` 为正确变量使用链。
3. 更新文档示例，移除错误拼写。
4. 运行目标测试与静态检索，确认无残留。

## 验收标准
- 仓库业务代码中不再出现 `SPANORY_OPENCLOW_HOME`。
- `openclaw adapter` 与 `openclaw plugin runtime` 的新增回归测试通过。
- `docs/README_zh.md` 使用 `SPANORY_OPENCLAW_HOME`。
