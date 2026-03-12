import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD upgrade command', () => {
  it('Given npm user agent, When upgrade --dry-run, Then outputs npm global upgrade command', () => {
    const output = execFileSync(
      'node',
      [entry, 'upgrade', '--dry-run'],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          npm_config_user_agent: 'npm/10.9.0 node/v20.19.0 darwin arm64',
        },
      },
    );
    const report = JSON.parse(output);
    expect(report.dryRun).toBe(true);
    expect(report.manager).toBe('npm');
    expect(report.command).toBe('npm');
    expect(report.args).toEqual(['install', '-g', '@bububuger/spanory@latest']);
  });

  it('Given tnpm user agent, When upgrade --dry-run, Then outputs tnpm global upgrade command', () => {
    const output = execFileSync(
      'node',
      [entry, 'upgrade', '--dry-run'],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          npm_config_user_agent: 'tnpm/9.1.0 node/v20.19.0 darwin arm64',
        },
      },
    );
    const report = JSON.parse(output);
    expect(report.dryRun).toBe(true);
    expect(report.manager).toBe('tnpm');
    expect(report.command).toBe('tnpm');
    expect(report.args).toEqual(['install', '-g', '@bububuger/spanory@latest']);
  });
});
