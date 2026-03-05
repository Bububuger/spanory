import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
  SPANORY_OTLP_ENDPOINT: '',
  SPANORY_OTLP_HEADERS: '',
};

describe('BDD openclaw replay export', () => {
  it('Given a valid openclaw transcript, When export command runs, Then JSON payload is produced with spans', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-replay-'));
    const outFile = path.join(outDir, 'session-a.json');
    const transcript = path.resolve('test/fixtures/openclaw/projects/test-project/session-a.jsonl');

    execFileSync(
      'node',
      [
        entry,
        'runtime',
        'openclaw',
        'export',
        '--project-id',
        'test-project',
        '--session-id',
        'session-a',
        '--transcript-path',
        transcript,
        '--export-json',
        outFile,
      ],
      { env: cleanEnv },
    );

    const data = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.payload.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0);
    expect(data.events.some((e) => e.category === 'tool')).toBe(true);
  });
});
