# Spanory MVP Hardening TODO

## Progress Rule
- 每完成一项必须执行对应验收命令并记录结果。
- 未通过则继续修复，直到通过再进入下一项。

## Tasks
- [x] T1 治理文件：`CHANGELOG.md`、`CONTRIBUTING.md`、`.github/CODEOWNERS`，并在 `README.md` 建立入口
- [x] T2 CLI 重构：Commander 命令树 + 精炼参数 + 完整 help（hook/export/backfill）
- [x] T3 二进制能力：可生成 `spanory` 可执行文件（不依赖 `node` 命令前缀）并文档化
- [x] T4 Langfuse 100% 兼容差距分析：输出 `docs/langfuse-parity.md` 并实现可补齐字段
- [x] T5 Usage/Token 抽取：从 Claude transcript 提取 token/usage 并上报
- [x] T6 单元测试：adapter/otlp 覆盖分类、时序、字段序列化和 parity 核心键
- [x] T7 BDD 集成测试：hook/replay/backfill 正常与异常流程
- [x] T8 CI：GitHub Actions 覆盖 check/test/二进制 smoke
- [ ] T9 终验与推送：全量验证、更新 todo 状态、提交并推送远端

## Verification Commands (Target)
- `npm run check`
- `npm test`
- `npm run test:bdd`
- `npm run build:bin && ./dist/spanory-macos-arm64 --help`
