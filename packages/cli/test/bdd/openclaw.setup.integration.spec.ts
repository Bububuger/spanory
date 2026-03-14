import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD openclaw setup path normalization', () => {
  function prepareFakeOpenclawEnvironment() {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-setup-home-'));
    const openclawHome = path.join(fakeHome, '.openclaw');
    const openclawConfigPath = path.join(openclawHome, 'openclaw.json');
    const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-bin-'));
    const fakeOpenclawBin = path.join(fakeBinDir, 'openclaw');
    const commandLogPath = path.join(fakeHome, 'openclaw-commands.log');
    const targetPluginDir = path.resolve('../openclaw-plugin');

    mkdirSync(openclawHome, { recursive: true });
    writeFileSync(
      openclawConfigPath,
      `${JSON.stringify(
        {
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
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );

    writeFileSync(
      fakeOpenclawBin,
      '#!/usr/bin/env bash\n' +
        'set -euo pipefail\n' +
        'printf "%s\\n" "$*" >> "${SPANORY_TEST_OPENCLAW_LOG}"\n' +
        'if [[ "${1:-}" == "plugins" && "${2:-}" == "info" ]]; then echo "enabled: true"; exit 0; fi\n' +
        'if [[ "${1:-}" == "--version" ]]; then echo "0.0.0"; exit 0; fi\n' +
        'exit 0\n',
      'utf-8',
    );
    chmodSync(fakeOpenclawBin, 0o755);

    return {
      fakeHome,
      openclawHome,
      openclawConfigPath,
      fakeBinDir,
      commandLogPath,
      targetPluginDir,
    };
  }

  function assertNormalizedConfigAndOpenclawCalls(openclawConfigPath, commandLogPath, targetPluginDir) {
    const nextConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'));
    const paths = Array.isArray(nextConfig?.plugins?.load?.paths) ? nextConfig.plugins.load.paths : [];
    expect(paths.filter((item) => item === targetPluginDir)).toHaveLength(1);
    expect(paths).not.toContain('/tmp/legacy/spanory/packages/openclaw-plugin');
    expect(paths.filter((item) => item === '/tmp/other-plugin')).toHaveLength(1);

    const openclawCalls = readFileSync(commandLogPath, 'utf-8');
    expect(openclawCalls).toContain('plugins install -l');
    expect(openclawCalls).toContain('plugins enable spanory-openclaw-plugin');
  }

  it('Given conflicting spanory plugin paths, When setup apply installs openclaw plugin, Then only one spanory path remains', () => {
    const { fakeHome, openclawHome, openclawConfigPath, fakeBinDir, commandLogPath, targetPluginDir } =
      prepareFakeOpenclawEnvironment();

    const output = execFileSync(
      'node',
      [entry, 'setup', 'apply', '--runtimes', 'openclaw', '--home', fakeHome, '--openclaw-runtime-home', openclawHome],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          SPANORY_TEST_OPENCLAW_LOG: commandLogPath,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        },
      },
    );
    const report = JSON.parse(output);
    expect(report.ok).toBe(true);
    assertNormalizedConfigAndOpenclawCalls(openclawConfigPath, commandLogPath, targetPluginDir);
  });

  it('Given conflicting spanory plugin paths, When runtime openclaw plugin install runs, Then it normalizes paths and enables plugin', () => {
    const { fakeHome, openclawHome, openclawConfigPath, fakeBinDir, commandLogPath, targetPluginDir } =
      prepareFakeOpenclawEnvironment();

    const result = execFileSync(
      'node',
      [entry, 'runtime', 'openclaw', 'plugin', 'install', '--runtime-home', openclawHome],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          SPANORY_TEST_OPENCLAW_LOG: commandLogPath,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        },
      },
    );

    expect(result).toBeTypeOf('string');
    assertNormalizedConfigAndOpenclawCalls(openclawConfigPath, commandLogPath, targetPluginDir);
  });

  it('Given spanory plugin paths in openclaw config, When setup teardown runs, Then it removes spanory paths but keeps non-spanory paths unchanged', () => {
    const { fakeHome, openclawHome, openclawConfigPath, fakeBinDir, commandLogPath, targetPluginDir } =
      prepareFakeOpenclawEnvironment();

    const output = execFileSync(
      'node',
      [
        entry,
        'setup',
        'teardown',
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
          SPANORY_TEST_OPENCLAW_LOG: commandLogPath,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        },
      },
    );
    const report = JSON.parse(output);
    expect(report.ok).toBe(true);

    const nextConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'));
    const paths = Array.isArray(nextConfig?.plugins?.load?.paths) ? nextConfig.plugins.load.paths : [];
    expect(paths).not.toContain('/tmp/legacy/spanory/packages/openclaw-plugin');
    expect(paths).not.toContain(targetPluginDir);
    expect(paths.filter((item) => item === '/tmp/other-plugin')).toHaveLength(2);

    const openclawCalls = readFileSync(commandLogPath, 'utf-8');
    expect(openclawCalls).toContain('plugins uninstall spanory-openclaw-plugin');
  });
});
