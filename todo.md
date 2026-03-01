<<<<<<< HEAD
# Spanory Runtime Version and Model Key TODO (2026-03-01)

- [x] T1 新增失败用例：runtime version + gen_ai.request.model
- [x] T2 实现字段补齐：adapter 提取并上报 runtime/version 与通用模型键
- [x] T3 更新 parity 文档
- [x] T4 验收：`npm run --workspace @spanory/cli test -- test/unit/adapter.spec.js`
- [x] T5 验收：`npm test`
=======
# Spanory 阶段 TODO（Langfuse 优先）

- [x] T0 归档旧 plan/todo 并创建新阶段计划
- [x] T1 核心抽象补齐（BackendAdapter + canonical 编译上下文）
- [x] T2 抽离 OTLP Core（packages/otlp-core）
- [x] T3 实现 Langfuse BackendAdapter 并接入 CLI 内部流水线
- [x] T4 实现 OpenClaw Plugin 主链路（零 cron + spool/retry）
- [x] T5 新增 OpenClaw 插件管理命令与 doctor
- [x] T6 本地回归与 Langfuse ClickHouse 对账
- [x] T7 文档更新（README/parity/capability/roadmap）
- [x] T8 执行质量门并收尾
>>>>>>> codex/openclaw-runtime-langfuse-parity
