import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const OPENCODE_SPANORY_PLUGIN_ID = 'spanory-opencode-plugin';

function createFakeOpencodePluginDir(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const pluginDir = path.join(root, 'opencode-plugin');
  mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
  writeFileSync(path.join(pluginDir, 'package.json'), '{"name":"fake-opencode-plugin","type":"module"}\n', 'utf-8');
  writeFileSync(
    path.join(pluginDir, 'dist', 'index.js'),
    'export default function plugin() { return { name: "fake-opencode-plugin" }; }\n',
    'utf-8',
  );
  return { root, pluginDir };
}

function createFakeOpenclawEnvironment() {
  const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-setup-openclaw-home-'));
  const openclawHome = path.join(fakeHome, '.openclaw');
  mkdirSync(openclawHome, { recursive: true });

  const pluginRoot = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-plugin-'));
  const pluginDir = path.join(pluginRoot, 'custom-openclaw-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    path.join(pluginDir, 'package.json'),
    '{"name":"@bububuger/spanory-openclaw-plugin","version":"0.0.0"}\n',
    'utf-8',
  );

  const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'spanory-openclaw-bin-'));
  const fakeOpenclawBin = path.join(fakeBinDir, 'openclaw');
  const commandLogPath = path.join(fakeHome, 'openclaw-commands.log');
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
    fakeBinDir,
    commandLogPath,
    pluginRoot,
    pluginDir,
  };
}

describe('BDD setup apply plugin directory forwarding', () => {
  it('Given setup apply openclaw with custom plugin dir, When command runs, Then install forwards custom dir', () => {
    const { fakeHome, openclawHome, fakeBinDir, commandLogPath, pluginRoot, pluginDir } =
      createFakeOpenclawEnvironment();

    try {
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
          '--openclaw-plugin-dir',
          pluginDir,
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

      const openclawCalls = readFileSync(commandLogPath, 'utf-8');
      expect(openclawCalls).toContain(`plugins install -l ${pluginDir}`);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(fakeBinDir, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it('Given setup apply opencode with custom plugin dir, When command runs, Then loader imports custom plugin entry', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-setup-opencode-home-'));
    const runtimeHome = path.join(fakeHome, '.config', 'opencode-custom');
    const { root, pluginDir } = createFakeOpencodePluginDir('spanory-setup-opencode-plugin-');

    try {
      const output = execFileSync(
        'node',
        [
          entry,
          'setup',
          'apply',
          '--runtimes',
          'opencode',
          '--home',
          fakeHome,
          '--opencode-runtime-home',
          runtimeHome,
          '--opencode-plugin-dir',
          pluginDir,
        ],
        {
          encoding: 'utf-8',
          env: {
            ...process.env,
            HOME: fakeHome,
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
          },
        },
      );

      const report = JSON.parse(output);
      expect(report.ok).toBe(true);

      const loaderFile = path.join(runtimeHome, 'plugin', `${OPENCODE_SPANORY_PLUGIN_ID}.js`);
      const loaderRaw = readFileSync(loaderFile, 'utf-8');
      const expectedImport = pathToFileURL(path.join(pluginDir, 'dist', 'index.js')).href;
      expect(loaderRaw).toContain(expectedImport);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
