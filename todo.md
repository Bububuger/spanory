# Todo (2026-03-14) — BUB-15 去除 5 包 `test:noop`

- [x] 归档上一阶段 `plan.md/todo.md`

- [x] 1. 复现并记录 5 包 `test:noop` 现状
  - 验收：`rg -n "test:noop" packages/{backend-langfuse,otlp-core,openclaw-plugin,opencode-plugin,alipay-cli}/package.json`

- [x] 2. 为 `otlp-core` 增加 golden 测试并替换测试脚本
  - 验收：`npm -w packages/otlp-core test`

- [x] 3. 为 `backend-langfuse` 增加最小行为断言并替换测试脚本
  - 验收：`npm -w packages/backend-langfuse test`

- [x] 4. 为 `openclaw-plugin` 增加合约级冒烟测试并替换测试脚本
  - 验收：`npm -w packages/openclaw-plugin test`

- [x] 5. 为 `opencode-plugin` 增加合约级冒烟测试并替换测试脚本
  - 验收：`npm -w packages/opencode-plugin test`

- [x] 6. 为 `alipay-cli` 增加包级断言测试并替换测试脚本
  - 验收：`npm -w packages/alipay-cli test`

- [x] 7. 执行全目标包回归验证并整理提交
  - 验收：
    - `npm -w packages/otlp-core test`
    - `npm -w packages/backend-langfuse test`
    - `npm -w packages/openclaw-plugin test`
    - `npm -w packages/opencode-plugin test`
    - `npm -w packages/alipay-cli test`
