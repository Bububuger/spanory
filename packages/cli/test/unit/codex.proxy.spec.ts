import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createCodexProxyServer } from '../../src/runtime/codex/proxy.ts';

async function startUpstreamServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    server,
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('codex proxy runtime', () => {
  it('forwards request and captures full payload with strong redaction', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-proxy-'));
    const spoolDir = path.join(tempRoot, 'spool');

    const upstream = await startUpstreamServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(body || '{}');
        res.setHeader('content-type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          echoed: parsed,
          api_key: 'server-secret',
        }));
      });
    });

    const proxy = createCodexProxyServer({
      upstreamBaseUrl: upstream.url,
      spoolDir,
      logger: { info: () => {}, warn: () => {} },
    });
    await proxy.start({ host: '127.0.0.1', port: 0 });

    try {
      const response = await fetch(`${proxy.url()}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-secret',
          'content-type': 'application/json',
          cookie: 'session=abcd',
        },
        body: JSON.stringify({
          model: 'gpt-5.3-codex',
          token: 'input-secret',
          nested: { password: 'pw-1', keep: 'ok' },
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);

      const files = (await readdir(spoolDir)).filter((name) => name.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);
      const record = JSON.parse(await readFile(path.join(spoolDir, files[0]), 'utf8'));

      expect(record.metadata.capture_mode).toBe('full_redacted');
      expect(record.request.headers.authorization).toBe('[REDACTED]');
      expect(record.request.headers.cookie).toBe('[REDACTED]');
      expect(record.request.body.token).toBe('[REDACTED]');
      expect(record.request.body.nested.password).toBe('[REDACTED]');
      expect(record.request.body.nested.keep).toBe('ok');
      expect(record.response.body.api_key).toBe('[REDACTED]');
    } finally {
      await proxy.stop();
      await upstream.close();
    }
  });

  it('does not block forwarding when capture spool write fails', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-proxy-'));
    const badSpoolPath = path.join(tempRoot, 'not-a-dir');
    await writeFile(badSpoolPath, 'x');

    const upstream = await startUpstreamServer((req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });

    const proxy = createCodexProxyServer({
      upstreamBaseUrl: upstream.url,
      spoolDir: badSpoolPath,
      logger: { info: () => {}, warn: () => {} },
    });
    await proxy.start({ host: '127.0.0.1', port: 0 });

    try {
      const response = await fetch(`${proxy.url()}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    } finally {
      await proxy.stop();
      await upstream.close();
    }
  });

  it('uses bounded byte-length probes for large truncation payloads', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-proxy-'));
    const spoolDir = path.join(tempRoot, 'spool');

    const upstream = await startUpstreamServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });

    const originalByteLength = Buffer.byteLength.bind(Buffer);
    let byteLengthCalls = 0;
    const byteLengthSpy = vi
      .spyOn(Buffer, 'byteLength')
      .mockImplementation((value, encoding) => {
        byteLengthCalls += 1;
        return originalByteLength(value, encoding);
      });

    const proxy = createCodexProxyServer({
      upstreamBaseUrl: upstream.url,
      spoolDir,
      maxBodyBytes: 16,
      logger: { info: () => {}, warn: () => {} },
    });
    await proxy.start({ host: '127.0.0.1', port: 0 });

    try {
      const largeText = 'a'.repeat(131072);
      const response = await fetch(`${proxy.url()}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: largeText,
      });

      expect(response.status).toBe(200);

      const files = (await readdir(spoolDir)).filter((name) => name.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);
      const record = JSON.parse(await readFile(path.join(spoolDir, files[0]), 'utf8'));
      const captured = String(record.request.body);
      const suffix = '...[truncated]';
      const prefix = captured.slice(0, -suffix.length);

      expect(captured.endsWith(suffix)).toBe(true);
      expect(originalByteLength(prefix, 'utf8')).toBeLessThanOrEqual(16);
      expect(byteLengthCalls).toBeLessThan(1024);
    } finally {
      byteLengthSpy.mockRestore();
      await proxy.stop();
      await upstream.close();
    }
  });

  it('truncates multibyte utf8 text by byte limit', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-proxy-'));
    const spoolDir = path.join(tempRoot, 'spool');

    const upstream = await startUpstreamServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });

    const proxy = createCodexProxyServer({
      upstreamBaseUrl: upstream.url,
      spoolDir,
      maxBodyBytes: 10,
      logger: { info: () => {}, warn: () => {} },
    });
    await proxy.start({ host: '127.0.0.1', port: 0 });

    try {
      const multibyteText = '你'.repeat(5000);
      const response = await fetch(`${proxy.url()}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: multibyteText,
      });

      expect(response.status).toBe(200);

      const files = (await readdir(spoolDir)).filter((name) => name.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);
      const record = JSON.parse(await readFile(path.join(spoolDir, files[0]), 'utf8'));
      const captured = String(record.request.body);
      const suffix = '...[truncated]';
      const prefix = captured.slice(0, -suffix.length);

      expect(captured.endsWith(suffix)).toBe(true);
      expect(Buffer.byteLength(prefix, 'utf8')).toBeLessThanOrEqual(10);
      expect(Buffer.byteLength(`${prefix}你`, 'utf8')).toBeGreaterThan(10);
    } finally {
      await proxy.stop();
      await upstream.close();
    }
  });
});
