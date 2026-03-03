# Spanory 使用问题排查与修复清单

## 问题汇总

### 1. npm link 后依赖找不到

**报错:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander' imported from
/Users/travis/Documents/TeamFile/claude-workspace/spanory/packages/cli/src/index.js
```

**原因:**
全局链接指向源码 `src/index.js`，但 `node_modules` 依赖未正确安装到全局路径。

**临时解决:**
```bash
cd /path/to/spanory
npm install
npm link -w packages/cli
```

**建议修复:**
- [ ] 添加 `prepublishOnly` 脚本确保构建后再发布
- [ ] 或修改 CLI 入口指向打包后的 `dist/cli.js`

---

### 2. Hook 无法读取 ~/.env 环境变量

**报错:**
```
[spanory] OTLP HTTP 401
```
（实际是因为环境变量未加载，使用了默认/空值）

**原因:**
`packages/cli/src/index.js` 直接从 `process.env` 读取环境变量，不会自动加载 `~/.env` 文件。

**临时解决:**
修改 Claude Code 的 hook 命令：
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'set -a && source ~/.env && spanory hook'"
          }
        ]
      }
    ]
  }
}
```

**建议修复:**
- [ ] 在 CLI 入口添加 dotenv 支持：
  ```js
  import { config } from 'dotenv';
  config({ path: process.env.HOME + '/.env' });
  ```
- [ ] 或在 README 中明确说明需要通过 shell 加载环境变量

---

### 3. OTLP 认证格式错误

**报错:**
```
[spanory] OTLP HTTP 401
```

**原因:**
README 中文档写的是 `Bearer <PUBLIC_KEY>:<SECRET_KEY>`，但 Langfuse OTLP 端点实际需要 **Basic Auth** 格式：
```
Authorization: Basic base64(public_key:secret_key)
```

**临时解决:**
```bash
CREDS=$(echo -n "<PUBLIC_KEY>:<SECRET_KEY>" | base64)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $CREDS"
```

**建议修复:**
- [ ] 更新 README.md 中的认证格式说明
- [ ] 更新 docs/README_zh.md 同步修改
- [ ] 可考虑在 CLI 中添加 `spanory doctor` 检查认证配置

---

## 文件修改清单

### README.md

**当前内容 (L62-64):**
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <PUBLIC_KEY>:<SECRET_KEY>"
```

**应修改为:**
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
# Langfuse OTLP requires Basic Auth: base64(public_key:secret_key)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n '<PUBLIC_KEY>:<SECRET_KEY>' | base64)"
```

### docs/README_zh.md

同上，需同步修改 L31-32、L148-149、L194-195。

### packages/cli/src/index.js

**建议添加 dotenv 支持 (文件开头):**
```js
#!/usr/bin/env node
import { config } from 'dotenv';
config({ path: `${process.env.HOME}/.env` });

// ... existing imports
```

**或者至少添加环境变量检查提示:**
```js
function checkOtelConfig() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.error('[spanory] Warning: OTEL_EXPORTER_OTLP_ENDPOINT is not set');
  }
  if (!process.env.OTEL_EXPORTER_OTLP_HEADERS) {
    console.error('[spanory] Warning: OTEL_EXPORTER_OTLP_HEADERS is not set');
  }
}
```

---

## 正确配置示例

### ~/.env
```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel/v1/traces"
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <BASE64_ENCODED_CREDS>"
```

### Claude Code settings.json
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'set -a && source ~/.env && spanory hook'"
          }
        ]
      }
    ]
  }
}
```

---

## 优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | OTLP 认证格式文档错误 | 用户无法正常上报 |
| P1 | 环境变量未自动加载 | Hook 场景配置复杂 |
| P2 | npm link 依赖问题 | 开发者安装体验差 |
