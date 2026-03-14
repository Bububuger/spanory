import { execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
  SPANORY_OTLP_ENDPOINT: '',
  SPANORY_OTLP_HEADERS: '',
};

function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('node', [entry, ...args], { env: cleanEnv }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`alert command failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

describe('BDD alert command', () => {
  it('Given matching rules, When alert runs, Then alert rows are emitted', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'alert',
        '--input-json',
        'test/fixtures/exported/session-a.json',
        '--rules',
        'test/fixtures/alert-rules.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.alerts.length).toBeGreaterThan(0);
  });

  it('Given matching rules and fail-on-alert, When alert runs, Then process exits non-zero', () => {
    expect(() => {
      execFileSync(
        'node',
        [
          entry,
          'alert',
          '--input-json',
          'test/fixtures/exported/session-a.json',
          '--rules',
          'test/fixtures/alert-rules.json',
          '--fail-on-alert',
        ],
        { env: cleanEnv },
      );
    }).toThrowError();
  });

  it('Given extended session metrics rules, When alert runs, Then new metric alerts are emitted', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'alert',
        '--input-json',
        'test/fixtures/exported/session-a.json',
        '--rules',
        'test/fixtures/alert-rules-extended.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    const ids = new Set(data.alerts.map((alert) => alert.ruleId));
    expect(ids.has('cache-read-high')).toBe(true);
    expect(ids.has('cache-create-high')).toBe(true);
    expect(ids.has('cache-hit-high')).toBe(true);
    expect(ids.has('subagent-calls-high')).toBe(true);
    expect(ids.has('diff-char-max-high')).toBe(true);
  });

  it('Given context session metrics rules, When alert runs, Then context metric alerts are emitted', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'alert',
        '--input-json',
        'test/fixtures/exported/session-context.json',
        '--rules',
        'test/fixtures/alert-rules-context.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    const ids = new Set(data.alerts.map((alert) => alert.ruleId));
    expect(ids.has('context-fill-high')).toBe(true);
    expect(ids.has('context-delta-ratio-high')).toBe(true);
    expect(ids.has('context-compact-frequent')).toBe(true);
  });

  it('Given legacy invocation, When alert eval runs, Then it remains available', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'alert',
        'eval',
        '--input-json',
        'test/fixtures/exported/session-a.json',
        '--rules',
        'test/fixtures/alert-rules.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.alerts.length).toBeGreaterThan(0);
  });

  it('Given webhook option, When alert runs, Then stdout stays pure JSON and status goes to stderr', async () => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = 200;
        res.end('ok');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('failed to resolve webhook server address');
      const url = `http://127.0.0.1:${address.port}`;

      const { stdout, stderr } = await runCli([
        'alert',
        '--input-json',
        'test/fixtures/exported/session-a.json',
        '--rules',
        'test/fixtures/alert-rules.json',
        '--webhook-url',
        url,
      ]);

      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(stdout).not.toContain('webhook=sent');
      expect(stderr).toContain(`webhook=sent url=${url}`);
    } finally {
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    }
  });
});
