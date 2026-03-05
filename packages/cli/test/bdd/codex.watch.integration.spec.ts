import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
};

describe('BDD codex watch fallback', () => {
  it('Given codex transcript update, When watch --once runs with include-existing, Then newest turn is exported', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-codex-watch-home-'));
    const sessionRoot = path.join(fakeHome, '.codex', 'sessions', '2026', '03', '03');
    mkdirSync(sessionRoot, { recursive: true });

    const fixture = path.resolve('test/fixtures/codex/sessions/session-a.jsonl');
    const transcript = path.join(sessionRoot, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-codex-watch-'));

    execFileSync(
      'node',
      [entry, 'runtime', 'codex', 'watch', '--include-existing', '--once', '--settle-ms', '0', '--export-json-dir', exportDir],
      { env: { ...cleanEnv, HOME: fakeHome } },
    );

    appendFileSync(
      transcript,
      '\n'
        + '{"timestamp":"2026-03-03T14:00:02.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-codex-3"}}\n'
        + '{"timestamp":"2026-03-03T14:00:02.030Z","type":"event_msg","payload":{"type":"user_message","message":"第三轮问题\\n"}}\n'
        + '{"timestamp":"2026-03-03T14:00:02.040Z","type":"turn_context","payload":{"turn_id":"turn-codex-3","cwd":"/Users/me/workspace/demo","model":"gpt-5.3-codex"}}\n'
        + '{"timestamp":"2026-03-03T14:00:02.120Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-codex-3","last_agent_message":"第三轮完成"}}\n',
      'utf-8',
    );

    const secondOutput = execFileSync(
      'node',
      [entry, 'runtime', 'codex', 'watch', '--include-existing', '--once', '--settle-ms', '0', '--export-json-dir', exportDir],
      { env: { ...cleanEnv, HOME: fakeHome } },
    ).toString('utf8');

    expect(secondOutput).toContain('runtime=codex');

    const outFile = path.join(exportDir, 'session-a.json');
    expect(existsSync(outFile)).toBe(true);
    const data = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(data.context.sessionId).toBe('session-a');
    expect(new Set(data.events.map((event) => event.turnId))).toEqual(new Set(['turn-codex-3']));
    const turn = data.events.find((event) => event.category === 'turn');
    expect(turn.output).toContain('第三轮完成');
  });
});
