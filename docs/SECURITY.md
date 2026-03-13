---
type: file
summary: "安全策略：数据安全、秘钥管理、CI/CD 安全、边界验证"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [security, secrets, ci-cd]
---

# 安全策略

## 数据安全

| 维度 | 策略 |
|------|------|
| Transcript 内容 | 本地处理，仅上报结构化 span，不上报原文 |
| API Key | 环境变量注入，不硬编码 |
| Hook 脚本 | 不传递敏感参数，通过环境变量读取配置 |
| 二进制分发 | GitHub Release 附带 SHA256SUMS |

## 秘钥管理

| 秘钥 | 用途 | 存储 |
|------|------|------|
| `LANGFUSE_PUBLIC_KEY` | Langfuse 上报 | 用户环境变量 |
| `LANGFUSE_SECRET_KEY` | Langfuse 上报 | 用户环境变量 |
| `NPM_TOKEN` | npm 发布 | GitHub Secrets |

## CI/CD 安全

- release.yml 使用 `environment: release` 保护发布秘钥
- 发布需 tag 触发，不接受 branch push
- 二进制 smoke test 防止恶意注入

## 边界验证

- OTLP payload: 结构化 schema 验证后发送
- Hook input: 解析前验证 JSON 格式
- CLI input: 参数校验 + 路径规范化
