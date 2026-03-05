# Spanory 修复计划：OpenClaw turn 输入输出错配（2026-03-03 第三阶段）

## Goal
修复 OpenClaw plugin 实时上报中的 turn 切分策略，避免同一轮对话被拆成多个 turn，导致 input/output 错位、空输出 turn 过多的问题。

## Root Cause
- 当前 runtime 在每次 `llm_output` 触发时都直接创建并发送一个 turn。
- OpenClaw 在工具调用链中可能产生多次 `llm_output`（例如先工具调用、后最终回复），导致同一用户输入被拆成多个 turn：
  - 前一个 turn 只有输入/工具，无最终输出
  - 后一个 turn 才有输出，从而看起来 input/output 对不上。

## Scope
- In scope:
  - `packages/openclaw-plugin/src/index.js`
    - turn 生命周期改为“按一次用户输入聚合”，在最终文本出现或 session_end 时落盘
    - 调整 tool 归属：等待 turn 建立前的 tool 暂存到当前输入轮次
  - `packages/cli/test/unit/openclaw.plugin.runtime.spec.js`
    - 新增 “空 llm_output + tool + 最终 llm_output” 回归测试
- Out of scope:
  - 历史脏数据批量清洗（仅通过 replay 补齐）

## Tasks

### T1 新增失败用例（RED）
- 构造同一用户输入下两次 `llm_output`：第一次无 assistantTexts，第二次有最终文本。
- 断言只生成一个 turn，且该 turn 同时包含正确 input/output 与 tool 细节。

### T2 修改 runtime 聚合策略（GREEN）
- 在 `onLlmInput` 生成 pending turn 上下文。
- `onLlmOutput` 对空文本只更新上下文，不立即落 turn。
- 在获得最终文本或 `session_end` 时一次性生成 turn 并挂载 pending tools。

### T3 验证与真实回归
- 跑单测。
- 对指定 session 重新 replay 并抽查 turn/tool 对齐。

## Acceptance
- 相同用户输入不再拆成多个无意义 turn。
- turn 的 input/output 与 tool 明细在 Langfuse 中可对应。
