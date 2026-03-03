# Runtime Capability Matrix

Capability matrix records which runtime can provide which normalized telemetry capability.

## Capability Definitions

- `turnDetection`: reliably split transcript into user-initiated turns
- `toolCallAttribution`: emit per-tool-call observations with stable call id
- `toolResultCorrelation`: bind tool_result to matching tool_use
- `modelName`: emit `langfuse.observation.model.name` when present
- `usageDetails`: emit token usage details (`gen_ai.usage.*`, `langfuse.observation.usage_details`)
- `slashCommandExtraction`: map slash command input into `agent_command`/`mcp` observations
- `mcpServerExtraction`: emit `agentic.mcp.server.name` where derivable
- `realtimeDelivery`: runtime has realtime ingestion path
- `deliveryDurability`: runtime has local spool/retry durability for realtime path

## Matrix

| Runtime | turnDetection | toolCallAttribution | toolResultCorrelation | modelName | usageDetails | slashCommandExtraction | mcpServerExtraction | realtimeDelivery | deliveryDurability |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `claude-code` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (hook) | ⚠️ (hook-state dedupe only) |
| `openclaw` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (plugin + hook) | ✅ (plugin spool/retry) |
| `opencode` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ (command events 未覆盖) | ✅ | ✅ (plugin) | ✅ (plugin spool/retry) |

## Policy

- For any runtime, if a field is derivable from transcript/runtime context, adapter must emit it.
- If field is not derivable, keep ingestion non-breaking and mark explicit gap in parity docs.
- Current phase backend target is only `langfuse` (`langsmith` deferred).
