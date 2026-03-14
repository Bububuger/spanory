import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD setup command', () => {
  it('Given fake home with stale codex notify setup, When setup apply+teardown runs for claude+codex, Then watch mode is idempotent and codex notify config is restored', async () => {
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

    const codexConfig = path.join(fakeHome, '.codex', 'config.toml');
    const codexScript = path.join(fakeHome, '.codex', 'bin', 'spanory-codex-notify.sh');
    const notifyBackupPath = path.join(fakeHome, '.codex', 'spanory-notify.backup.json');
    const escapedScriptPath = codexScript
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"');
    mkdirSync(path.dirname(codexScript), { recursive: true });
    mkdirSync(path.dirname(codexConfig), { recursive: true });
    writeFileSync(codexScript, '#!/usr/bin/env bash\necho stale\n', 'utf-8');
    chmodSync(codexScript, 0o755);
    writeFileSync(codexConfig, `notify = ["${escapedScriptPath}"]\n`, 'utf-8');

    const first = execFileSync(
      'node',
      baseArgs,
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const firstReport = JSON.parse(first);
    expect(firstReport.ok).toBe(true);

    const claudeSettings = path.join(fakeHome, '.claude', 'settings.json');

    expect(existsSync(claudeSettings)).toBe(true);
    expect(existsSync(codexConfig)).toBe(true);
    expect(existsSync(codexScript)).toBe(false);
    expect(existsSync(notifyBackupPath)).toBe(true);

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
    expect(notifyMatches).toHaveLength(0);
    expect(codexConfigRaw).not.toContain('spanory-codex-notify.sh');

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
    expect(doctorReport.checks.some((check) => check.id === 'codex_watch_mode' && check.ok)).toBe(true);
    expect(doctorReport.checks.some((check) => check.id === 'codex_notify_script_absent' && check.ok)).toBe(true);

    const teardown = execFileSync(
      'node',
      [
        entry,
        'setup',
        'teardown',
        '--runtimes',
        'codex',
        '--home',
        fakeHome,
      ],
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const teardownReport = JSON.parse(teardown);
    expect(teardownReport.ok).toBe(true);
    const codexTeardown = teardownReport.results.find((result) => result.runtime === 'codex');
    expect(codexTeardown.notifyRestore.restored).toBe(true);
    expect(codexTeardown.notifyRestore.changed).toBe(true);
    expect(codexTeardown.notifyRestore.notifyLineCount).toBe(1);
    expect(codexTeardown.notifyRestore.detail).toContain('restored 1 notify line');
    expect(existsSync(notifyBackupPath)).toBe(false);

    const restoredConfigRaw = readFileSync(codexConfig, 'utf-8');
    const restoredNotifyMatches = restoredConfigRaw.match(/^notify\s*=.*$/gm) ?? [];
    expect(restoredNotifyMatches).toHaveLength(1);
    expect(restoredNotifyMatches[0]).toBe(`notify = ["${escapedScriptPath}"]`);

    const teardownAgain = execFileSync(
      'node',
      [
        entry,
        'setup',
        'teardown',
        '--runtimes',
        'codex',
        '--home',
        fakeHome,
      ],
      { encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    );
    const teardownAgainReport = JSON.parse(teardownAgain);
    expect(teardownAgainReport.ok).toBe(true);
    const codexTeardownAgain = teardownAgainReport.results.find((result) => result.runtime === 'codex');
    expect(codexTeardownAgain.notifyRestore.restored).toBe(false);
    expect(codexTeardownAgain.notifyRestore.detail).toContain('no notify backup found');
  });
});
