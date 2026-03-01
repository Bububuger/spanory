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

## Matrix

| Runtime | turnDetection | toolCallAttribution | toolResultCorrelation | modelName | usageDetails | slashCommandExtraction | mcpServerExtraction |
|---|---:|---:|---:|---:|---:|---:|---:|
| `claude-code` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `openclaw` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Policy

- For any runtime, if a field is derivable from transcript/runtime context, adapter must emit it.
- If field is not derivable, keep ingestion non-breaking and mark explicit gap in parity docs.
