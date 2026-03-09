# Spanory `agentic.*` 字段设计说明

> 适用版本：field-spec v1.0.0
> 更新：2026-03-09

---

## 为什么要有这个命名空间

OTel 的 `gen_ai.*` 标准解决了"模型调用"层的可观测性：token 消耗、模型名称、工具调用 ID。
Langfuse 的字段则是平台投影，把数据转成 Langfuse 自己的 trace / observation 对象。

两者都无法回答 Agent 行为层面的问题：

- 这一轮 Agent 到底**做了什么**？是在思考、执行命令、调用 MCP，还是在派发子 Agent？
- Agent **做完了吗**？任务完成率是多少？
- 这个 Agent **是谁发起的**？人工输入还是另一个 Agent 自动投递的？
- 这一轮 Agent **改动了多少**？光看 token 消耗判断不了产出量。

`agentic.*` 就是为了填这个空白——记录 Agent 行为维度，而非模型调用维度。

---

## 字段总览

共 **34 个字段**，分 10 个子组：

```
agentic.*
├── event.category          所有后续分析的分类基础
├── context.*               上下文快照 / 边界 / 归因事件
├── actor.*                 谁在做（角色识别）
├── turn.*                  一次对话轮次的完整上下文
│   └── diff.*              实际产出了什么变更
├── runtime.*               哪个 Agent 系统在运行
├── project.cwd             在哪个项目目录下运行
├── input.*                 输入来自哪里、结构化元数据
├── command.*               执行了什么系统命令
├── mcp.server.name         调用了哪个 MCP 服务
└── subagent.calls          派发了多少子 Agent
```

---

## 逐字段说明

### 一、事件分类

#### `agentic.event.category`

每条 span 的类型标签。枚举值：

| 值 | 含义 |
|---|---|
| `turn` | 一次完整的对话轮次（用户输入 → AI 回复） |
| `tool` | 普通工具调用（Read、Write、Glob 等） |
| `mcp` | MCP 协议工具调用 |
| `shell_command` | Bash / 系统命令执行 |
| `agent_command` | 斜杠命令（如 `/compact`） |
| `agent_task` | 子 Agent 任务派发（Task 工具） |
| `reasoning` | AI 内部思考块（extended thinking） |
| `context` | 上下文处理事件（snapshot / boundary / attribution） |

**为什么必要：** 这是所有后续聚合查询的基础维度。没有它，一条 span 里混着"AI 回复"和"执行 bash 命令"，失败率、延迟分布等指标都无从按类型拆分。

---

### 二、Context（上下文处理）

这些字段服务于 context 观测与后续 compact/restore 体系，全部走 `agentic.context.*` 命名空间，并作为 OTLP 属性投影到 span 上。

| 字段 | 含义 |
|---|---|
| `agentic.context.event_type` | context 事件类型：`context_snapshot` / `context_boundary` / `context_source_attribution` |
| `agentic.context.fill_ratio` | 当前上下文占窗口比例（0.0–1.0） |
| `agentic.context.estimated_total_tokens` | 当前上下文总 token 估算值 |
| `agentic.context.delta_tokens` | 相对上一个快照的 token 增量 |
| `agentic.context.composition` | 各来源 token 占用的 JSON 序列化映射 |
| `agentic.context.top_sources` | 当前 top-N 上下文来源的 JSON 序列化数组 |
| `agentic.context.boundary_kind` | 上下文边界类型：`compact_before` / `compact_after` / `restore` / `resume` |
| `agentic.context.compaction_ratio` | compact 前后压缩比例 |
| `agentic.context.source_kind` | 归因来源种类：如 `tool_output` / `claude_md` |
| `agentic.context.source_name` | 可读来源名称，如工具名、文件名或 skill 名 |
| `agentic.context.token_delta` | 该来源导致的 token 增量 |
| `agentic.context.pollution_score` | 该来源的上下文污染评分 |
| `agentic.context.score_version` | 评分算法版本，如 `pollution_score_v1` |

**为什么必要：**

- 这些字段补的是 `agentic.*` 现有体系里完全缺失的一层：不是“Agent 做了什么工具动作”，而是“这些动作如何把上下文填满了”。
- 它们让下游能回答：什么时候快到窗口上限、compact 前后缩了多少、哪一类来源最该被压缩或保留。
- 这些字段全部标为 `custom`，避免和 OTel semconv 草案字段混淆。

---

### 三、Actor（行为主体）

#### `agentic.actor.role`

这条事件的行为者角色。目前取值：`main`（主 Agent）、`unknown`（推断失败，通常是子链路）。

#### `agentic.actor.role_confidence`

系统对角色推断的置信度（0.0–1.0）。Agent 角色需要从上下文启发式推断，不是运行时直接暴露的。

**为什么必要：** 多 Agent 编排场景下，一条 trace 里存在多个 Agent 协作。没有角色标注，无法区分"主 Agent 发的命令"和"子 Agent 在执行"。置信度字段让离线数据清洗有据可依——低置信度数据单独处理，不污染主指标。

---

### 四、Turn（对话轮次）

#### `agentic.turn.id`

本次对话轮次的唯一标识。作用域：`all`（所有 span 都带）。

**为什么必要：** 一次对话轮次可能触发 5–20 条子 span（思考、工具调用、shell 执行……）。没有 turn ID，这些 span 在 trace 视图里是孤立的，无法聚合成"第 N 轮的全链路"。

> **与 Langfuse 的关系：** `agentic.turn.id` 和 `langfuse.trace.id` 是同一个值的双写。前者走 OTel 属性（供 ClickHouse 等后端 SQL 过滤），后者是 Langfuse 原生结构字段（控制 UI 层级展示）。如果只打 Langfuse 后端，此字段存在冗余，可标注 `redundant_when: langfuse-only`。

#### `agentic.turn.completed`

本轮是否正常结束（boolean）。目前仅 codex runtime 有完整的轮次结束信号。

**为什么必要：** 区分"正常结束"和"中途被中断/报错"，直接对应任务完成率这个核心指标。

#### `agentic.turn.input.hash`

本轮输入内容的 SHA-256 哈希（前 16 位）。

#### `agentic.turn.input.prev_hash`

上一轮输入的哈希。

**为什么必要：** 不存储原始对话内容（隐私合规），但需要判断"两条 span 的输入是否相同"，用于去重、幂等检测，以及识别 Agent 是否在循环重复相同输入。

---

### 五、Turn Diff（变更追踪）

四个字段合在一起，衡量"这个 Agent 实际产出了多少变更"：

| 字段                             | 含义                         |
| ------------------------------ | -------------------------- |
| `agentic.turn.diff.changed`    | 本轮与上轮相比是否有变化（boolean）      |
| `agentic.turn.diff.char_delta` | 字符净增减量                     |
| `agentic.turn.diff.line_delta` | 行数净增减量                     |
| `agentic.turn.diff.similarity` | Jaccard token 相似度（0.0–1.0） |

**计算对象：** 这里比较的**不是文件变更**，而是**相邻两轮用户输入文本**之间的差异（char/line delta 是字符串长度差，similarity 是 Jaccard token 相似度）。

**为什么必要：** 检测 Agent 是否在对同一个输入反复处理。典型场景是 Agent 陷入循环——自动化系统一直发相同或高度相似的消息。`similarity` 接近 1.0 且 `char_delta` ≈ 0，就是这个异常信号。文件层面的代码变更量目前不在此字段覆盖范围内。

---

### 六、Runtime（运行时）

#### `agentic.runtime.name`

当前 Agent 运行时名称：`claude-code` / `codex` / `openclaw` / `opencode`。作用域：`all`。

#### `agentic.runtime.version`

运行时版本号。

**为什么必要：** 同时支持多个 Agent Runtime，同一个功能在不同 Runtime 下行为、性能可能有差异。没有这个字段，无法做 A/B 对比分析。

---

### 七、Project（工程上下文）

#### `agentic.project.cwd`

Agent 当前工作目录。仅在 codex runtime 的 `session_meta.cwd` 存在时发出。

**为什么必要：** 同一套代码在不同项目目录下运行，行为和风险完全不同。这个字段让"某个项目的工具调用失败率"可查，也是后续项目级 quota 管理的基础。

> **⚠️ 已知安全问题（[issue #2](https://github.com/Bububuger/spanory/issues/2)）：** 当前上报的是原始路径（如 `/Users/javis/Documents/workspace/project/spanory`），会将用户名和本地目录结构发送至遥测后端，存在隐私泄露风险。
>
> **计划修复：** 改为 `basename(cwd) + sha1(fullPath)[:8]` 格式（如 `spanory-3f9a1c2b`），与 `projectId` 的脱敏方式保持一致。既保留跨 session 关联能力，又不暴露任何路径信息。

---

### 八、Input（输入上下文）

三个字段从输入文本的嵌入式元数据块中结构化提取：

| 字段 | 含义 |
|---|---|
| `agentic.input.sender` | 输入来源方：`user` / `agent` / `system` |
| `agentic.input.message_id` | 上游 runtime 附带的消息唯一 ID |
| `agentic.input.metadata` | 输入附带的结构化元数据（JSON 序列化） |

**为什么必要：** 自动化流水线中，Agent 的输入往往不是人工键入的，而是由另一个 Agent 或系统自动投递。`sender` 区分"人驱动"和"机器驱动"的轮次——不能把自动生成的任务和人工指令混在同一个成功率指标里。

---

### 九、Command（命令执行）

#### `agentic.command.name` / `agentic.command.args`

**注意：这两个字段目前仅针对斜杠命令（`agent_command` 类）**，如 `/compact`、`/review`。

| 场景 | category | `agentic.command.*` 是否填充 |
|---|---|---|
| 用户输入 `/compact foo` | `agent_command` | 有：`name=compact`，`args=foo` |
| Agent 调用 Bash 执行 shell | `shell_command` | **无**，shell 命令走 `process.command_line` |

Bash 执行的完整命令字符串（含管道、`&&` 等）原样存入 `process.command_line` 和 span `input`，不做任何拆分。

> **已知缺口（[issue #3](https://github.com/Bububuger/spanory/issues/3)）：** shell 命令缺乏结构化解析，无法按首命令分组统计，也无法统计管道深度。
>
> **计划新增字段：**
>
> | 字段 | 含义 | 示例 |
> |---|---|---|
> | `agentic.command.name` | 首段第一个 token（主命令名） | `find` |
> | `agentic.command.args` | 首段剩余参数 | `. -name "*.ts"` |
> | `agentic.command.pipe_count` | 管道段数（`\|` 分隔） | `2` |
> | `agentic.command.raw` | 完整原始命令串（`process.command_line` 的别名） | `find . \| xargs grep TODO \| wc -l` |
>
> `&&`、`;`、`||` 链内部不做深度拆解，提取主命令名已足够满足分组和审计需求。

---

### 十、MCP 与子 Agent

#### `agentic.mcp.server.name`

本次 MCP 调用连接的 server 名称（从工具名 `mcp__<server>__<tool>` 解析第二段）。

**为什么必要：** Agent 可能同时连接多个 MCP server，没有这个字段，所有 MCP 调用归为一类，无法分析"哪个 server 响应延迟更高"或"哪个 server 调用失败率异常"。

**关于 tool 名称：** 不单独新增 `agentic.mcp.tool.name`。`gen_ai.tool.name` 已存储完整的 `mcp__<server>__<tool>` 字符串，查询时按 `__` 拆取第三段即可，无需冗余字段。

#### `agentic.subagent.calls`

本轮次中发起的子 Agent 调用次数（Task 工具调用计数）。

**为什么必要：** 直接反映 Agent 的编排深度。一个轮次调用 10 个子 Agent 还是 0 个，对成本和延迟是量级差异。有了这个计数，才能识别"编排爆炸"——某个任务意外触发了过多子 Agent 派发。

> **已知缺口（[issue #1](https://github.com/Bububuger/spanory/issues/1)）：** 当前只能在父 turn 侧记录"派了几个子 Agent"，父子 session 之间没有显式链路。子 session 的 transcript 有 `isSidechain: true` 和 `agentId`，但不包含父 session ID，无法反向关联。
>
> **计划新增字段（子 session 侧）：**
>
> | 字段 | 含义 |
> |---|---|
> | `agentic.agent_id` | 当前 session 自身的 agentId（现只用于 role 推断，未写出） |
> | `agentic.parent.session_id` | 派生本 session 的父 session ID |
> | `agentic.parent.turn_id` | 父 session 中触发派发的 turn ID |
> | `agentic.parent.tool_call_id` | 父 turn 中 Task 工具调用的 call ID |
>
> 短期通过时间窗口对齐做 best-effort 推断；长期依赖 claude-code / openclaw 在子 session 的 `session_meta` 里写入父上下文（见 [anthropics/claude-code#32175](https://github.com/anthropics/claude-code/issues/32175)）。

---

## 与 Langfuse 原生字段的重叠分析

> 结论：**3 处存在重叠**，其余 18 个字段均为 Langfuse 原生模型无法覆盖的增量信息。

| agentic 字段 | Langfuse 原生等价 | 重叠程度 | 备注 |
|---|---|---|---|
| `agentic.turn.id` | `langfuse.trace.id` | 完全重叠 | 同一个值双写，目的不同（OTel 属性 vs Langfuse 结构字段）。仅打 Langfuse 时可省略 |
| `agentic.event.category` | `langfuse.observation.type` | 部分重叠 | category（7种）→ type（4种）是有损映射，`shell_command` 和 `mcp` 在 Langfuse 里都变成 `tool`；细分查询必须依赖 category |
| `agentic.runtime.name` | Langfuse trace metadata（自由字段） | 弱重叠 | 可手动写入 metadata，但不是 Langfuse 的结构化字段，无法在 UI 层直接过滤 |

---

## 一句话总结

`gen_ai.*` 记录"模型花了多少钱"，`agentic.*` 记录"Agent 做了什么事、做完没有、做了多大"。

两者是互补关系，不是替代关系：前者是成本账，后者是价值账。
