import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD setup command', () => {
  it('Given fake home, When setup apply runs for claude+codex twice, Then config is idempotent and doctor passes', async () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-setup-home-'));
    const spanoryBin = '/tmp/spanory-bin';

    const baseArgs = [
      entry,
      'setup',
      'apply',
      '--runtimes',
      'claude-code,codex',
      '--home',
      fakeHome,
      '--spanory-bin',
      spanoryBin,
    ];

    const first = execFileSync(
      'node',
      baseArgs,
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const firstReport = JSON.parse(first);
    expect(firstReport.ok).toBe(true);

    const claudeSettings = path.join(fakeHome, '.claude', 'settings.json');
    const codexConfig = path.join(fakeHome, '.codex', 'config.toml');
    const codexScript = path.join(fakeHome, '.codex', 'bin', 'spanory-codex-notify.sh');

    expect(existsSync(claudeSettings)).toBe(true);
    expect(existsSync(codexConfig)).toBe(true);
    expect(existsSync(codexScript)).toBe(true);

    const second = execFileSync(
      'node',
      baseArgs,
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const secondReport = JSON.parse(second);
    expect(secondReport.ok).toBe(true);

    const settings = JSON.parse(readFileSync(claudeSettings, 'utf-8'));
    const stopHooks = settings.hooks.Stop[0].hooks.filter((item) => String(item.command).includes('hook --last-turn-only'));
    const endHooks = settings.hooks.SessionEnd[0].hooks.filter((item) => String(item.command).includes('hook --last-turn-only'));
    expect(stopHooks).toHaveLength(1);
    expect(endHooks).toHaveLength(1);
    expect(stopHooks[0].command).toBe(`${spanoryBin} hook --last-turn-only`);
    expect(endHooks[0].command).toBe(`${spanoryBin} hook --last-turn-only`);

    const codexConfigRaw = readFileSync(codexConfig, 'utf-8');
    const notifyMatches = codexConfigRaw.match(/^notify\s*=.*$/gm) ?? [];
    expect(notifyMatches).toHaveLength(1);
    const escapedScriptPath = codexScript
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"');
    expect(notifyMatches[0]).toBe(`notify = ["${escapedScriptPath}"]`);

    const codexScriptRaw = readFileSync(codexScript, 'utf-8');
    expect(codexScriptRaw).toContain('runtime codex hook');
    expect(codexScriptRaw).toContain('--last-turn-only');
    expect(codexScriptRaw).toContain('--force');
    expect(codexScriptRaw).toContain('sleep 2');
    expect(codexScriptRaw).toContain('payload_file="$(mktemp');
    expect(codexScriptRaw).toContain('[[ ! -t 0 ]]');
    expect(codexScriptRaw).toContain('read -r -t 0 payload');
    expect(codexScriptRaw).toContain('skip=empty-payload');
    const mode = statSync(codexScript).mode;
    expect((mode & 0o111) > 0).toBe(true);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'bash',
        [codexScript],
        { env: { ...process.env, HOME: fakeHome }, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('codex notify script blocked on stdin'));
      }, 1500);

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`codex notify script exited with code ${code}`));
      });
    });

    const notifyLog = path.join(fakeHome, '.spanory', 'logs', 'codex-notify.log');
    const notifyLogRaw = readFileSync(notifyLog, 'utf-8');
    expect(notifyLogRaw).toContain('skip=empty-payload source=codex-notify');

    const doctor = execFileSync(
      'node',
      [
        entry,
        'setup',
        'doctor',
        '--runtimes',
        'claude-code,codex',
        '--home',
        fakeHome,
      ],
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const doctorReport = JSON.parse(doctor);
    expect(doctorReport.ok).toBe(true);
    expect(doctorReport.checks.some((check) => check.id === 'claude_hook_stop' && check.ok)).toBe(true);
    expect(doctorReport.checks.some((check) => check.id === 'codex_notify_script' && check.ok)).toBe(true);
  });
});
