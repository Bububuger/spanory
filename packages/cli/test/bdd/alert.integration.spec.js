import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('src/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
  SPANORY_OTLP_ENDPOINT: '',
  SPANORY_OTLP_HEADERS: '',
};

describe('BDD alert eval command', () => {
  it('Given matching rules, When alert eval runs, Then alert rows are emitted', () => {
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

  it('Given matching rules and fail-on-alert, When alert eval runs, Then process exits non-zero', () => {
    expect(() => {
      execFileSync(
        'node',
        [
          entry,
          'alert',
          'eval',
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
});
