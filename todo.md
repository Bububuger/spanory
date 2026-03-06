# TODO (2026-03-07) — 显式绑定 Release Environment

- [x] T1 归档当前计划文件并建立本阶段 plan/todo
- [x] T2 为 `publish-npm` job 绑定 `release` environment
- [x] T3 更新 README / 中文 README 中的 `NPM_TOKEN` 配置路径
- [x] T4 运行最小校验并记录结果
- [ ] T5 提交改动

## 验收记录
- [x] 已归档上一阶段 `plan.md` / `todo.md`
- [x] `.github/workflows/release.yml` 已声明 `environment: release`
- [x] README / 中文 README 已改为 `Settings > Environments > release`
- [x] YAML / 文案最小校验通过
- [x] `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release.yml'); puts 'release.yml: ok'"` 通过
- [x] `rg -n "environment: release|Environments > release|release environment" .github/workflows/release.yml README.md docs/README_zh.md` 命中预期
