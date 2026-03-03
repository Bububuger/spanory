import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexProxyServer } from '../../src/runtime/codex/proxy.js';

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
});
