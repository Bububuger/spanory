const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE = /(authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|password|secret)/i;

type RedactBodyOptions = {
  extraSensitiveKeyPattern?: RegExp;
};

function matchesSensitiveKey(key: unknown, extraSensitiveKeyPattern?: RegExp): boolean {
  const normalized = String(key ?? '');
  if (SENSITIVE_KEY_RE.test(normalized)) return true;
  if (!extraSensitiveKeyPattern) return false;
  extraSensitiveKeyPattern.lastIndex = 0;
  return extraSensitiveKeyPattern.test(normalized);
}

function truncateText(text: unknown, maxBytes: number): string {
  const raw = String(text ?? '');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return raw;
  if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
  let low = 0;
  let high = raw.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(raw.slice(0, mid), 'utf8') <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${raw.slice(0, Math.max(0, low))}...[truncated]`;
}

function redactBody(value: unknown, maxBytes: number, options: RedactBodyOptions = {}) {
  const { extraSensitiveKeyPattern } = options;

  function walk(current: unknown, keyHint = ''): unknown {
    if (current === null || current === undefined) return current;
    if (typeof current === 'string') {
      if (matchesSensitiveKey(keyHint, extraSensitiveKeyPattern)) return REDACTED;
      return truncateText(current, maxBytes);
    }
    if (typeof current === 'number' || typeof current === 'boolean') {
      if (matchesSensitiveKey(keyHint, extraSensitiveKeyPattern)) return REDACTED;
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => walk(item, keyHint));
    }
    if (typeof current === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(current)) {
        if (matchesSensitiveKey(key, extraSensitiveKeyPattern)) {
          out[key] = REDACTED;
        } else {
          out[key] = walk(val, key);
        }
      }
      return out;
    }
    return truncateText(String(current), maxBytes);
  }

  const redacted = walk(value);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return redacted;
  const serialized = JSON.stringify(redacted);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return redacted;
  return {
    __truncated__: true,
    preview: truncateText(serialized, maxBytes),
  };
}

function redactSecretText(value: unknown): string {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\bsk-ant-[a-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/\b(?:ghp|ghs)_[A-Za-z0-9_]{8,}\b/g, REDACTED)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)
    .replace(/\b(sk|pk)_[a-z0-9_-]{8,}\b/gi, REDACTED);
}

export { REDACTED, SENSITIVE_KEY_RE, redactBody, redactSecretText, truncateText };
