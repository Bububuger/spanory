# TODO (2026-03-06) — 遥测字段标准化与 OTel 门禁

- [x] T1 建立 telemetry YAML 规范（field-spec / runtime-mapping / platform-profiles / otel lock）
- [x] T2 实现字段工具链脚本（extract/sync/diff/validate/report）并接入 npm scripts
- [x] T3 接入 CI telemetry gate，并更新工作流与标准文档
- [x] T4 修改 OTLP 资源字段为 `deployment.environment.name`，修正相关文档
- [x] T5 补齐/更新测试与金标样本（含脚本单测与 OTLP 回归）
- [x] T6 运行全量门禁并记录结果

## 验收记录
- [x] `npm run telemetry:extract`（53 fields）
- [x] `npm run telemetry:diff`（added=0, removed=0, deprecated=0）
- [x] `npm run telemetry:validate-mapping`（errors=0, warnings=5）
- [x] `npm run telemetry:report`（产出 md/json 报告）
- [x] `npm run telemetry:check`（pass=true）
- [x] `npm run check`（all workspace tsc passed）
- [x] `npm run build`（all workspace build passed）
- [x] `npm test`（15 files, 69 tests passed）
- [x] `npm run test:bdd`（14 files, 29 tests passed）
