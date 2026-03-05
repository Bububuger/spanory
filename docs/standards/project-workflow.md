# Spanory 项目工作流（团队风格规范）

## 目的
统一 Spanory 的开发方式，确保任何 agent 都能按同一套流程交付，避免风格漂移与质量不一致。

## 一、开发流程（标准闭环）
1. 需求澄清
- 明确目标、非目标、影响范围。
- 判断是 `新功能`、`bug fix`、还是 `重构`。

2. 方案设计
- 按 [功能设计规范](./feature-design-spec.md) 补齐设计项。
- 对跨模块改动先写契约与风险，再写代码。

3. 实现开发
- 小步改动，优先可审阅 diff。
- 不做与当前任务无关的“顺手重构”。

4. 验证回归
- 先跑最小相关测试，再跑全量门禁。
- 所有 `存量功能` 和 `新增功能` 都必须维护“同输入同输出”金标测试，不限于重构任务。
- 每个 bug fix 必须沉淀为长期回归用例，并登记到回归台账。
- 发布前必须执行 [Runtime 验收矩阵](./runtime-validation-matrix.md)（覆盖 claude/codex/openclaw/opencode）。
- 必跑门禁：
```bash
npm run check
npm test
npm run test:bdd
```

5. 交付说明
- 输出变更摘要、文件清单、测试证据、风险与后续项。
- 同步更新必要文档（见第六章）。
- 对中大型改动补充 [变更背景记录台账](./change-context-log.md)（背景/决策/影响/验证/回滚）。

## 二、团队风格（必须遵守）
- 以事实和证据驱动：结论必须有代码或测试支撑。
- 以兼容性优先：不破坏已有 CLI 契约与上报语义。
- 以可维护性优先：命名清晰、边界明确、注释克制。
- 以可回滚为底线：高风险改动必须给回滚点。

## 三、编码与提交规范
- 分支：按仓库约定；提交保持单一目的。
- Commit：一句话说明“做了什么 + 为什么”。
- 评审重点：行为变化、风险、测试覆盖，而不是代码风格口水战。

## 四、测试策略规范
- 参考 [测试基线规范](./test-baseline-spec.md)。
- Unit：保证模块逻辑正确。
- BDD：保证用户可见行为不漂移。
- Integration：保证 side-effect（spool/retry/status）可恢复。

## 五、DoD（Definition of Done）
满足以下全部条件才算完成：
- 设计文档已更新（如涉及行为/契约变化）。
- 代码实现与需求一致，无无关改动。
- 测试与门禁通过（`check/test/test:bdd`）。
- 受影响功能的金标测试已新增/更新并通过。
- bug fix 已有可复现回归 case，并完成台账登记（如本次为缺陷修复）。
- Runtime 验收矩阵已执行并记录证据（尤其是 opencode plugin 路径）。
- 中大型改动已登记 [变更背景记录台账](./change-context-log.md)。
- 交付说明完整，能被下一位 agent 直接接手。

## 六、文档与测试更新清单

### A. 新功能（new feature）
必须检查并按需更新：
- 文档：
  - `README.md`（用户可见命令/行为变化）
  - `docs/standards/feature-design-spec.md` 对应设计记录
  - `docs/runtime-capability-matrix.md`（涉及 runtime 能力变化）
  - 相关阶段 `plan.md` / `todo.md`
- 测试：
  - 至少 1 个 unit（核心逻辑）
  - 至少 1 个 bdd（用户可见行为）
  - 至少 1 个金标 case（固定输入 + 预期输出）
  - 涉及 side-effect 时补 integration 场景

### B. 缺陷修复（bug fix）
必须检查并按需更新：
- 文档：
  - 缺陷原因与修复说明（可放阶段文档或变更记录）
  - `README.md`（若修复影响用户行为）
- 测试：
  - 必须新增/更新回归测试（先复现失败，再验证修复）
  - 覆盖最小复现路径与关键边界
  - 必须新增/更新金标 case（若缺陷涉及输出结构/语义）
  - 必须更新 [缺陷回归台账](./regression-cases.md) 记录 bug -> case 映射

### C. 重构（refactor）
必须检查并按需更新：
- 文档：
  - 若仅类型/内部重组，记录“行为不变”声明
  - 在 [变更背景记录台账](./change-context-log.md) 记录重构原因、范围、验证与回滚点
- 测试：
  - 依赖既有基线，确保 BDD 结果一致
  - 受影响模块必须补齐或更新金标 case，证明输出语义未漂移

### D. 架构/工程清理（cleanup）
必须检查并按需更新：
- 文档：
  - 在 [变更背景记录台账](./change-context-log.md) 记录“为何可删、影响边界、验证证据、回滚路径”
- 测试：
  - 至少跑一次全量门禁（`check/test/test:bdd`）
  - 若涉及构建链路，补跑对应 build/release 命令

## 七、给新 Agent 的上手脚手架
- 先读：
  - [Standards 入口](./README.md)
  - [功能设计规范](./feature-design-spec.md)
  - [测试基线规范](./test-baseline-spec.md)
  - [缺陷回归台账](./regression-cases.md)
  - [Agent 上手规范](./agent-onboarding.md)
- 再做：
  - 跑基线命令
  - 更新当期 `plan.md/todo.md`
  - 按本工作流执行
