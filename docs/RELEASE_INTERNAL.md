---
type: file
summary: "内部发布补充流程：内部包发布与安装验证"
created: 2026-03-14T00:00:00+00:00
modified: 2026-03-14T00:00:00+00:00
tags: [release, internal]
---

# 内部发布流程（Internal Only）

此文档仅用于维护者执行内部发布步骤。公开发布流程见 [RELEASE.md](./RELEASE.md)。

## 1. 前置检查

先完成公开发布流程中的质量门禁与打标步骤，参考 [RELEASE.md](./RELEASE.md)。

## 2. 内部包发布

```bash
bash scripts/publish-internal.sh
```

## 3. 内部安装验证

```bash
tnpm install -g @alipay/spanory@latest && spanory --version
```
