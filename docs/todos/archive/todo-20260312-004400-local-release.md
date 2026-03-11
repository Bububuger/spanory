# TODO (2026-03-12) — 二进制版本跟随 release

- [x] T1 修复 CLI 版本来源（去硬编码）
  - 验收：`npm run --workspace @bububuger/spanory build && ./packages/cli/dist/index.js --version`
  - 结果：通过（输出 `0.1.1`）
- [x] T2 修复 release workflow 的 binary job 版本同步
  - 验收：检查 `.github/workflows/release.yml` 包含 tag 版本同步步骤
  - 结果：通过（`build-binaries` job 已新增 `Sync CLI Version With Tag`）
- [x] T3 本地二进制重建与验证
  - 验收：`npm run build:bin`，并验证可执行版本输出
  - 结果：通过（`./dist/spanory-macos-arm64 --version` 输出 `0.1.1`）
