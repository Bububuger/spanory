# Plan (2026-03-14) — BUB-15 去除 5 包 `test:noop`

## 目标
1. 将 `backend-langfuse`、`otlp-core`、`openclaw-plugin`、`opencode-plugin`、`alipay-cli` 的 `test` 从零断言 `console.log(...:test:noop)` 升级为可验证行为。
2. 在 `otlp-core` 引入 golden 测试夹具，稳定断言 OTLP 编译输出。
3. 为 plugin 包补齐合约级冒烟测试，至少覆盖导出契约与最小注册/调用路径。

## 执行顺序
1. 复现并记录当前 `test:noop` 信号，确认 5 包脚本与测试资产现状。
2. 迁移 `otlp-core` golden 测试（含 fixture + runner），将 `test` 脚本切换到真实断言。
3. 为 `backend-langfuse` 增加最小行为断言测试，并切换 `test` 脚本。
4. 为 `openclaw-plugin`、`opencode-plugin` 增加合约级冒烟测试，并切换 `test` 脚本。
5. 为 `alipay-cli` 增加包级完整性断言测试并切换 `test` 脚本；随后执行分包验收。

## 验收标准
- 5 个目标包 `package.json` 的 `test` 不再是 `console.log(...:test:noop)`。
- `otlp-core` 的 golden 测试可稳定通过，且对 fixture 输入输出做等值断言。
- `openclaw-plugin`、`opencode-plugin` 各至少有 1 个合约级冒烟测试并含明确断言。
- `backend-langfuse`、`alipay-cli` 至少各有 1 个实际断言测试。
- 下列命令全部通过：
  - `npm -w packages/otlp-core test`
  - `npm -w packages/backend-langfuse test`
  - `npm -w packages/openclaw-plugin test`
  - `npm -w packages/opencode-plugin test`
  - `npm -w packages/alipay-cli test`
