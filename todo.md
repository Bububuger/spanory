# Reasoning 分离 TODO（Derived from plan.md）

- [x] T1 opencode plugin 归一化保留 reasoning 分块
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

- [x] T2 normalize 生成 reasoning 独立事件 + turn output 仅 final text
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/normalize.spec.js`

- [x] T3 补充单测覆盖 reasoning/output 分离语义
  - 验收：
    - `npm run --workspace @spanory/cli test -- test/unit/normalize.spec.js`
    - `npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

- [x] T4 全量单测回归
  - 验收：`npm run --workspace @spanory/cli test`
