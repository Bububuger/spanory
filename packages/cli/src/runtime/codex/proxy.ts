// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE = /(authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|password|secret)/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key ?? ''));
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null) return '';
  return String(value);
}

function redactHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lowerKey = String(key).toLowerCase();
    out[lowerKey] = isSensitiveKey(lowerKey) ? REDACTED : normalizeHeaderValue(value);
  }
  return out;
}

function truncateText(text, maxBytes) {
  const raw = String(text ?? '');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return raw;
  if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
  let end = raw.length;
  while (end > 0 && Buffer.byteLength(raw.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return `${raw.slice(0, Math.max(0, end))}...[truncated]`;
}

function redactBody(value, maxBytes) {
  function walk(current, keyHint = '') {
    if (current === null || current === undefined) return current;
    if (typeof current === 'string') {
      if (isSensitiveKey(keyHint)) return REDACTED;
      return truncateText(current, maxBytes);
    }
    if (typeof current === 'number' || typeof current === 'boolean') {
      if (isSensitiveKey(keyHint)) return REDACTED;
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => walk(item, keyHint));
    }
    if (typeof current === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(current)) {
        if (isSensitiveKey(key)) {
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

function parseBodyFromBuffer(buffer, contentType, maxBytes) {
  if (!buffer || buffer.length === 0) return '';
  const text = buffer.toString('utf8');
  if (String(contentType ?? '').toLowerCase().includes('application/json')) {
    try {
      return redactBody(JSON.parse(text), maxBytes);
    } catch {
      return truncateText(text, maxBytes);
    }
  }
  return truncateText(text, maxBytes);
}

async function readRequestBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function writeCaptureRecord(spoolDir, record, logger) {
  try {
    await mkdir(spoolDir, { recursive: true });
    const filename = `${Date.now()}-${randomUUID()}.json`;
    const file = path.join(spoolDir, filename);
    await writeFile(file, JSON.stringify(record, null, 2), 'utf8');
  } catch (error) {
    logger?.warn?.(`[spanory-codex-proxy] capture write failed: ${String(error)}`);
  }
}

function correlationKeyFromRequest(req, seq) {
  const headers = req.headers ?? {};
  const threadId = headers['x-codex-thread-id'] ?? headers['x-thread-id'] ?? headers['x-session-id'] ?? '';
  const turnId = headers['x-codex-turn-id'] ?? headers['x-turn-id'] ?? '';
  if (threadId || turnId) return `${threadId || 'na'}:${turnId || 'na'}:${seq}`;
  return `unknown:unknown:${seq}`;
}

export function createCodexProxyServer(options) {
  const upstreamBaseUrl = options?.upstreamBaseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com';
  const spoolDir = options?.spoolDir ?? process.env.SPANORY_CODEX_PROXY_SPOOL_DIR ?? path.join(process.cwd(), '.spanory', 'codex-proxy-spool');
  const maxBodyBytes = Number(options?.maxBodyBytes ?? process.env.SPANORY_CODEX_CAPTURE_MAX_BYTES ?? 131072);
  const logger = options?.logger ?? console;
  const upstream = new URL(upstreamBaseUrl);
  let seq = 0;

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    seq += 1;
    const requestBodyBuffer = await readRequestBuffer(req);
    const correlationKey = correlationKeyFromRequest(req, seq);
    const method = req.method ?? 'GET';
    const targetUrl = new URL(req.url ?? '/', upstream);
    const requestHeaders = { ...req.headers };
    delete requestHeaders.host;
    delete requestHeaders['content-length'];

    try {
      const upstreamResponse = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : requestBodyBuffer,
      });

      const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
      const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries());

      const record = {
        timestamp: new Date().toISOString(),
        metadata: {
          capture_mode: 'full_redacted',
          correlation_key: correlationKey,
          latency_ms: Date.now() - startedAt,
        },
        request: {
          method,
          url: req.url ?? '/',
          headers: redactHeaders(req.headers),
          body: parseBodyFromBuffer(requestBodyBuffer, req.headers['content-type'], maxBodyBytes),
        },
        response: {
          status: upstreamResponse.status,
          headers: redactHeaders(responseHeaders),
          body: parseBodyFromBuffer(responseBuffer, upstreamResponse.headers.get('content-type'), maxBodyBytes),
        },
      };
      await writeCaptureRecord(spoolDir, record, logger);

      for (const [key, value] of Object.entries(responseHeaders)) {
        if (value !== undefined) res.setHeader(key, value);
      }
      res.statusCode = upstreamResponse.status;
      res.end(responseBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'upstream_request_failed', message }));

      await writeCaptureRecord(spoolDir, {
        timestamp: new Date().toISOString(),
        metadata: {
          capture_mode: 'full_redacted',
          correlation_key: correlationKey,
          latency_ms: Date.now() - startedAt,
        },
        request: {
          method,
          url: req.url ?? '/',
          headers: redactHeaders(req.headers),
          body: parseBodyFromBuffer(requestBodyBuffer, req.headers['content-type'], maxBodyBytes),
        },
        response: {
          status: 502,
          error: message,
        },
      }, logger);
    }
  });

  return {
    async start({ host = '127.0.0.1', port = 8787 } = {}) {
      await new Promise((resolve) => server.listen(port, host, resolve));
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
    url() {
      const address = server.address();
      if (!address || typeof address === 'string') return '';
      return `http://${address.address}:${address.port}`;
    },
    server,
  };
}
