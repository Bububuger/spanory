import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('src/index.js');

describe('BDD openclaw plugin management', () => {
  it('doctor reports structured checks and non-zero exit when plugin prerequisites are missing', () => {
    const result = spawnSync(
      process.execPath,
      [entry, 'runtime', 'openclaw', 'plugin', 'doctor'],
      {
        encoding: 'utf-8',
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      },
    );

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.some((item) => item.id === 'plugin_installed')).toBe(true);
  });
});
