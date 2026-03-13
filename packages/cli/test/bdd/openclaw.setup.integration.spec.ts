import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD openclaw setup path normalization', () => {
  it('Given conflicting spanory plugin paths, When setup apply installs openclaw plugin, Then only one spanory path remains', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-setup-home-'));
    const openclawHome = path.join(fakeHome, '.openclaw');
    const openclawConfigPath = path.join(openclawHome, 'openclaw.json');
    const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-bin-'));
    const fakeOpenclawBin = path.join(fakeBinDir, 'openclaw');
    const targetPluginDir = path.resolve('../openclaw-plugin');

    mkdirSync(openclawHome, { recursive: true });
    writeFileSync(
      openclawConfigPath,
      `${JSON.stringify({
        plugins: {
          load: {
            paths: [
              '/tmp/legacy/spanory/packages/openclaw-plugin',
              targetPluginDir,
              '/tmp/other-plugin',
              '/tmp/other-plugin',
            ],
          },
        },
      }, null, 2)}\n`,
      'utf-8',
    );

    writeFileSync(
      fakeOpenclawBin,
      '#!/usr/bin/env bash\n'
        + 'set -euo pipefail\n'
        + 'if [[ "${1:-}" == "plugins" && "${2:-}" == "install" ]]; then exit 0; fi\n'
        + 'if [[ "${1:-}" == "plugins" && "${2:-}" == "enable" ]]; then exit 0; fi\n'
        + 'if [[ "${1:-}" == "plugins" && "${2:-}" == "info" ]]; then echo "enabled: true"; exit 0; fi\n'
        + 'if [[ "${1:-}" == "--version" ]]; then echo "0.0.0"; exit 0; fi\n'
        + 'exit 0\n',
      'utf-8',
    );
    chmodSync(fakeOpenclawBin, 0o755);

    const output = execFileSync(
      'node',
      [
        entry,
        'setup',
        'apply',
        '--runtimes',
        'openclaw',
        '--home',
        fakeHome,
        '--openclaw-runtime-home',
        openclawHome,
      ],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        },
      },
    );
    const report = JSON.parse(output);
    expect(report.ok).toBe(true);

    const nextConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'));
    const paths = Array.isArray(nextConfig?.plugins?.load?.paths) ? nextConfig.plugins.load.paths : [];
    const pluginPaths = paths.filter((item) => {
      const text = String(item ?? '').toLowerCase();
      return text.includes('openclaw-plugin');
    });

    expect(pluginPaths).toHaveLength(1);
    expect(pluginPaths[0]).toBe(targetPluginDir);
    expect(paths.filter((item) => item === '/tmp/other-plugin')).toHaveLength(1);
  });
});
