# OpenCode Plugin 接入 TODO（Derived from plan.md）

- [x] T0 校准 OpenCode plugin 事件/SDK 契约，并补 fixture
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js -t "contract"`

- [x] T1 完成 `packages/opencode-plugin` runtime（hook + normalize + send）
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

- [x] T2 完成 spool/retry/status（失败落盘、恢复补发）
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js -t "spool"`

- [x] T3 新增 `spanory runtime opencode plugin install|uninstall|doctor`
  - 验收：`npm run --workspace @spanory/cli test:bdd -- test/bdd/opencode.plugin.integration.spec.js`

- [x] T4 补齐测试矩阵并做 openclaw 回归
  - 验收：
    - `npm run --workspace @spanory/cli test`
    - `npm run --workspace @spanory/cli test:bdd`

- [x] T5 更新 README / capability / parity 文档
  - 验收：`npm run --workspace @spanory/cli check`

- [x] T6 运行质量门并记录结果
  - 验收：
    - `npm run check`
    - `npm test`
