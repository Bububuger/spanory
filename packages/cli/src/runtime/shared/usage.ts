// @ts-nocheck

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function pickUsage(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const inputTokens = toNumber(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = toNumber(raw.output_tokens ?? raw.completion_tokens);
  const totalTokens = toNumber(raw.total_tokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
  const cacheReadInputTokens = toNumber(raw.cache_read_input_tokens);
  const cacheCreationInputTokens = toNumber(raw.cache_creation_input_tokens);

  const usage = {};
  if (inputTokens !== undefined) usage.input_tokens = inputTokens;
  if (outputTokens !== undefined) usage.output_tokens = outputTokens;
  if (totalTokens !== undefined) usage.total_tokens = totalTokens;
  if (cacheReadInputTokens !== undefined) usage.cache_read_input_tokens = cacheReadInputTokens;
  if (cacheCreationInputTokens !== undefined) usage.cache_creation_input_tokens = cacheCreationInputTokens;
  return Object.keys(usage).length ? usage : undefined;
}

export function addUsage(total, usage) {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    total[key] = (total[key] ?? 0) + Number(value);
  }
}

export function usageAttributes(usage) {
  if (!usage) return {};
  const attrs = {};
  if (usage.input_tokens !== undefined) {
    attrs['gen_ai.usage.input_tokens'] = usage.input_tokens;
    attrs['gen_ai.usage.prompt_tokens'] = usage.input_tokens;
  }
  if (usage.output_tokens !== undefined) {
    attrs['gen_ai.usage.output_tokens'] = usage.output_tokens;
    attrs['gen_ai.usage.completion_tokens'] = usage.output_tokens;
  }
  if (usage.total_tokens !== undefined) {
    attrs['gen_ai.usage.total_tokens'] = usage.total_tokens;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    attrs['gen_ai.usage.cache_read.input_tokens'] = usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    attrs['gen_ai.usage.cache_creation.input_tokens'] = usage.cache_creation_input_tokens;
  }
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const denominator = (usage.input_tokens ?? 0) + cacheRead;
  const cacheHitRate = denominator > 0 ? cacheRead / denominator : 0;
  attrs['gen_ai.usage.details.cache_hit_rate'] = Number(cacheHitRate.toFixed(6));
  return attrs;
}

export function modelAttributes(model) {
  if (!model) return {};
  return {
    'langfuse.observation.model.name': model,
    'gen_ai.request.model': model,
  };
}
