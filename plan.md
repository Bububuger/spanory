# Spanory Plan：纯 TS 收官（dist 运行形态）(2026-03-05)

## Goal
将仓库从“TS 源 + src JS 运行”切换为“TS 唯一源码 + dist JS 运行产物”，消除双真相源，保持现有行为与上报语义不变。

## Scope
- `packages/cli`
- `packages/core`
- `packages/otlp-core`
- `packages/backend-langfuse`
- `packages/openclaw-plugin`
- `packages/opencode-plugin`
- release/build 脚本与文档（仅与入口/产物路径相关的最小改动）

## Non-Goals
- 不改运行时语义、不改 OTLP 字段契约。
- 不做与入口切换无关的重构。

## Tasks
### T1 编译产物契约统一
- 各包 `tsconfig` 统一 `rootDir=src`、`outDir=dist`，并输出声明文件（可被其他包消费）。
- 保证 `build` 会先清理旧 `dist`，避免脏产物。

### T2 包入口切换到 dist
- 切换 `package.json` 中 `bin/main/exports` 到 `dist`。
- 修正内部 import 依赖，确保运行时只依赖 `dist` 编译结果。

### T3 插件入口与清单切换
- `openclaw-plugin` / `opencode-plugin` 入口与插件声明改为加载 `dist`。
- 保留最小兼容壳文件（若运行时要求固定入口）。

### T4 发布链路对齐
- `build:bundle`、二进制构建、release 打包改为读取 `dist` 入口。
- 修正 `build-binaries.sh` 与 `package-release-assets.sh` 的平台产物一致性。

### T5 验收与基线
- 分任务验收 + 全量门禁：`check/test/test:bdd/build:bin/package:release-assets`。
- 验证“同输入同输出”金标不变。

## Acceptance
1. 仓库运行入口不再指向 `src/*.js`（CLI + 各包 + 插件）。
2. 全量门禁通过：`npm run check && npm test && npm run test:bdd`。
3. 本地可完成二进制构建与 release 打包。
4. 金标测试与关键 BDD 回放结果保持一致。
