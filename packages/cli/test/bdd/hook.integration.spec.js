import { mkdtempSync, readFileSync, existsSync, mkdirSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('src/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
  SPANORY_OTLP_ENDPOINT: '',
  SPANORY_OTLP_HEADERS: '',
};

describe('BDD hook ingestion', () => {
  it('Given SessionEnd payload, When hook command runs, Then session json is exported', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectDir = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const fixture = path.resolve('test/fixtures/claude/projects/test-project/session-a.jsonl');
    const transcript = path.join(projectDir, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-hook-'));

    const payload = JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-a',
      transcript_path: transcript,
    });

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--export-json-dir', exportDir],
      { input: payload, env: { ...cleanEnv, HOME: fakeHome } },
    );

    const outFile = path.join(exportDir, 'session-a.json');
    expect(existsSync(outFile)).toBe(true);
    const data = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(data.context.sessionId).toBe('session-a');
  });

  it('Given malformed payload, When hook command runs, Then process fails', () => {
    expect(() => {
      execFileSync('node', [entry, 'runtime', 'claude-code', 'hook'], { input: '{not-json', env: cleanEnv });
    }).toThrowError();
  });

  it('Given a non-existing nested export directory, When hook command runs, Then directory is auto-created and json is written', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectDir = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const fixture = path.resolve('test/fixtures/claude/projects/test-project/session-a.jsonl');
    const transcript = path.join(projectDir, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = path.join(tmpdir(), `spanory-nested-${Date.now()}`, 'a', 'b', 'c');
    const outFile = path.join(exportDir, 'session-a.json');

    const payload = JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-a',
      transcript_path: transcript,
    });

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--export-json-dir', exportDir],
      { input: payload, env: { ...cleanEnv, HOME: fakeHome } },
    );

    expect(existsSync(outFile)).toBe(true);
  });

  it('Given same session payload twice, When hook command runs twice, Then second run is skipped as unchanged', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectDir = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const fixture = path.resolve('test/fixtures/claude/projects/test-project/session-a.jsonl');
    const transcript = path.join(projectDir, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-hook-'));
    const payload = JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-a',
      transcript_path: transcript,
    });
    const env = { ...cleanEnv, HOME: fakeHome };

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--export-json-dir', exportDir],
      { input: payload, env },
    );

    const second = execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--export-json-dir', exportDir],
      { input: payload, env, encoding: 'utf8' },
    );

    expect(second).toContain('skip=unchanged sessionId=session-a');
  });

  it('Given last-turn-only mode, When hook runs repeatedly, Then only new latest turn is exported', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectDir = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const fixture = path.resolve('test/fixtures/claude/projects/test-project/session-f.jsonl');
    const transcript = path.join(projectDir, 'session-f.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-hook-'));
    const payload = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'session-f',
      transcript_path: transcript,
    });
    const env = { ...cleanEnv, HOME: fakeHome };

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--last-turn-only', '--export-json-dir', exportDir],
      { input: payload, env },
    );

    const outFile = path.join(exportDir, 'session-f.json');
    const first = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(new Set(first.events.map((e) => e.turnId))).toEqual(new Set(['turn-2']));
    expect(first.events.filter((e) => e.category === 'turn')).toHaveLength(1);
    expect(first.events.find((e) => e.category === 'turn').input).toContain('第二轮问题');

    const second = execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--last-turn-only', '--export-json-dir', exportDir],
      { input: payload, env, encoding: 'utf8' },
    );
    expect(second).toContain('skip=unchanged-turn sessionId=session-f turnId=turn-2');

    appendFileSync(
      transcript,
      '\n'
      + '{"type":"user","timestamp":"2026-03-01T12:02:00.000Z","message":{"content":[{"type":"text","text":"第三轮问题"}]}}\n'
      + '{"type":"assistant","timestamp":"2026-03-01T12:02:01.000Z","message":{"id":"msg-f-3","model":"claude-opus-4-6","usage":{"input_tokens":6,"output_tokens":3,"total_tokens":9},"content":[{"type":"text","text":"第三轮回答"}]}}',
    );

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--last-turn-only', '--export-json-dir', exportDir],
      { input: payload, env },
    );

    const third = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(new Set(third.events.map((e) => e.turnId))).toEqual(new Set(['turn-3']));
    expect(third.events.filter((e) => e.category === 'turn')).toHaveLength(1);
    expect(third.events.find((e) => e.category === 'turn').input).toContain('第三轮问题');
  });
});
