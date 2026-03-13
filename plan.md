# Plan (2026-03-14) — BUB-21 doctor 只读化（移除目录写副作用）

## 目标
1. `runtime openclaw plugin doctor` 与 `runtime opencode plugin doctor` 不再创建 `spool/log` 目录。
2. 目录创建职责迁移到 `install/apply` 路径，保持安装后运行能力。
3. 补充测试，防止 doctor 写副作用回归。

## 执行顺序
1. 先写失败测试：验证两类 doctor 执行后不会落盘创建目录。
2. 修改 CLI 实现：doctor 改为只读 `stat/access` 检查；将目录创建移动到 `installOpenclawPlugin` / `installOpencodePlugin`。
3. 运行目标 BDD 与单测回归，确认红绿闭环。
4. 更新 Linear workpad、提交并准备 PR。

## 验收标准
- doctor 不创建目录且仍输出结构化检查结果。
- apply/install 后所需目录可创建，行为不回退。
- 新增/更新测试通过。
