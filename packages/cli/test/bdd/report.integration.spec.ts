import { execFileSync } from 'node:child_process';
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

describe('BDD report command', () => {
  it('Given exported json, When report session runs, Then returns session-summary rows', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'report',
        'session',
        '--input-json',
        'test/fixtures/exported/session-a.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.view).toBe('session-summary');
    expect(data.rows[0].sessionId).toBe('session-a');
  });

  it('Given exported json, When report mcp runs, Then includes mcp summary rows', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'report',
        'mcp',
        '--input-json',
        'test/fixtures/exported/session-a.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.view).toBe('mcp-summary');
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('Given exported json, When report cache runs, Then returns cache summary rows', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'report',
        'cache',
        '--input-json',
        'test/fixtures/exported/session-a.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.view).toBe('cache-summary');
    expect(data.rows[0].sessionId).toBe('session-a');
  });

  it('Given exported json, When report tool runs, Then returns tool summary rows', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'report',
        'tool',
        '--input-json',
        'test/fixtures/exported/session-a.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.view).toBe('tool-summary');
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('Given exported json, When report turn-diff runs, Then returns turn diff rows', () => {
    const out = execFileSync(
      'node',
      [
        entry,
        'report',
        'turn-diff',
        '--input-json',
        'test/fixtures/exported/session-a.json',
      ],
      { env: cleanEnv },
    ).toString('utf8');

    const data = JSON.parse(out);
    expect(data.view).toBe('turn-diff-summary');
    expect(data.rows.length).toBeGreaterThan(0);
  });
});
