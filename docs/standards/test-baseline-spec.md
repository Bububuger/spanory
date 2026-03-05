# Spanory 测试基线与门禁规范

## 目标
为所有实现与重构提供统一测试基线，确保行为一致性可证明。

## 测试分层责任

### Unit
- 目标：验证单模块逻辑正确性。
- 范围：adapter、normalize、otlp 编译、report/alert 纯逻辑。
- 要求：覆盖关键边界（空输入、异常字段、默认值）。

### BDD
- 目标：验证用户可见行为与链路一致性。
- 范围：`hook/export/backfill/report/alert/setup/watch/plugin`。
- 要求：Given/When/Then 标题表达清楚，包含正向与负向场景。

### Integration
- 目标：验证跨组件协作与副作用一致性。
- 范围：plugin spool/retry/status、hook 去重、runtime 上报链路。
- 要求：覆盖关键时序与错误恢复路径。

## 测试基线命令（强制）
```bash
npm run check
npm test
npm run test:bdd
```

## 门禁规则
- PR/合并前，三条命令必须全通过。
- 任一失败即阻断，不允许“先合并后修”。
- 如需临时豁免，必须在变更说明中记录原因与补测计划。
- 任意任务类型（新功能/bug fix/重构）都必须评估并维护金标测试，不得只在重构时执行。
- 发布验证必须同时执行 [Runtime 验收矩阵](./runtime-validation-matrix.md)，不可只验证部分 runtime。

## 回归流程
1. 先跑最小相关测试（提升反馈速度）。
2. 再跑全量基线命令。
3. 记录结果摘要：文件数、用例数、失败数。

## 金标测试（Same Input, Same Output）
- 目标：锁定关键输出结构，防止实现变更导致语义漂移（适用于存量与新增功能）。
- 当前范围：`packages/cli/test/fixtures/golden/otlp`（OTLP 编译链路）
- 当前范围：`packages/cli/test/fixtures/golden/codex`（Codex transcript -> canonical events 链路）
- 规则：
  - `*.input.json` 为固定输入。
  - `*.expected.json` 为金标输出。
  - 单测必须逐案例深比较，任何字段漂移都视为回归风险。
  - 当功能行为变化影响输出语义时，必须在同一提交中更新对应金标。
- 刷新流程（仅在确认是“有意变更”时）：
```bash
npm run --workspace @spanory/cli test:golden:update
```
- 刷新后必须同时提交：
  - 变更原因（为什么输出应变化）
  - 金标 diff 评审结论
  - 相关行为文档更新（如涉及用户可见语义）

## 缺陷回归沉淀（强制）
- 每个 bug fix 必须至少新增一个可复现回归 case（unit/bdd/integration/golden 至少一种，按影响面选择）。
- 若 bug 涉及输出结构、属性语义或协议映射，必须追加或更新金标 case。
- 每次缺陷修复都要更新 [缺陷回归台账](./regression-cases.md)，记录：
  - 缺陷标识（issue/session/commit）
  - 根因摘要
  - 对应测试文件与 case 名称
  - 首次引入日期

## 失败处理规范
- Unit 失败：先定位模块契约是否破坏。
- BDD 失败：优先判断是否行为变更；若是，需更新功能设计文档并重新评审。
- Integration 失败：优先排查时序、重试、状态文件副作用。

## 覆盖矩阵维护
- 每新增模块/能力，必须补“模块 -> 测试”映射。
- 覆盖缺口要有优先级（P0/P1/P2）与计划日期。
- 规范文档更新与代码变更同批提交。

## Runtime 特殊说明（避免漏测）
- `claude-code/openclaw/codex`：可用 `runtime ... export` 做 CLI 直连上报验收。
- `opencode`：当前走 plugin 链路，无 `runtime opencode export` 命令；必须用 `plugin doctor + status/log` 验证上报证据。
