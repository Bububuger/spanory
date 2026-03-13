import path from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD opencode plugin management', () => {
  it('doctor reports structured checks and non-zero exit when plugin prerequisites are missing', () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'spanory-opencode-doctor-'));
    try {
      const result = spawnSync(
        process.execPath,
        [entry, 'runtime', 'opencode', 'plugin', 'doctor'],
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: homeDir, PATH: '/usr/bin:/bin' },
        },
      );

      expect(result.status).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(false);
      expect(Array.isArray(report.checks)).toBe(true);
      expect(report.checks.some((item) => item.id === 'plugin_installed')).toBe(true);

      const spoolDir = path.join(homeDir, '.spanory', 'opencode', 'spool');
      const pluginLog = path.join(homeDir, '.spanory', 'opencode', 'plugin.log');
      expect(existsSync(spoolDir)).toBe(false);
      expect(existsSync(pluginLog)).toBe(false);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
