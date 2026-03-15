function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function pickUsage(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const inputTokens = toNumber(r.input_tokens ?? r.prompt_tokens);
  const outputTokens = toNumber(r.output_tokens ?? r.completion_tokens);
  const totalTokens = toNumber(r.total_tokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
  const cacheReadInputTokens = toNumber(r.cache_read_input_tokens);
  const cacheCreationInputTokens = toNumber(r.cache_creation_input_tokens);

  const usage: Record<string, number> = {};
  if (inputTokens !== undefined) usage.input_tokens = inputTokens;
  if (outputTokens !== undefined) usage.output_tokens = outputTokens;
  if (totalTokens !== undefined) usage.total_tokens = totalTokens;
  if (cacheReadInputTokens !== undefined) usage.cache_read_input_tokens = cacheReadInputTokens;
  if (cacheCreationInputTokens !== undefined) usage.cache_creation_input_tokens = cacheCreationInputTokens;
  return Object.keys(usage).length ? usage : undefined;
}

export function addUsage(total: Record<string, number>, usage: Record<string, number> | undefined): void {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    total[key] = (total[key] ?? 0) + Number(value);
  }
}

export function usageAttributes(usage: Record<string, number> | undefined): Record<string, string | number> {
  if (!usage) return {};
  const attrs: Record<string, string | number> = {};
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

export function modelAttributes(model: string | undefined): Record<string, string> {
  if (!model) return {};
  return {
    'langfuse.observation.model.name': model,
    'gen_ai.request.model': model,
  };
}
