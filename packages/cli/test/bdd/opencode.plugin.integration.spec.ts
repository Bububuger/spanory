import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const OPENCODE_SPANORY_PLUGIN_ID = 'spanory-opencode-plugin';

function createFakePluginDir(prefix) {
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

function runInstall(runtimeHome, pluginDir) {
  return spawnSync(
    process.execPath,
    [entry, 'runtime', 'opencode', 'plugin', 'install', '--runtime-home', runtimeHome, '--plugin-dir', pluginDir],
    { encoding: 'utf-8' },
  );
}

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

  it('install fails when opencode.json cannot be read with non-ENOENT error', () => {
    const { root, pluginDir } = createFakePluginDir('spanory-opencode-install-non-enoent-');
    const runtimeHome = path.join(root, 'runtime');
    mkdirSync(path.join(runtimeHome, 'opencode.json'), { recursive: true });

    const result = runInstall(runtimeHome, pluginDir);

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}\n${result.stdout}`).toMatch(/EISDIR|directory/i);
  });

  it('install creates opencode.json when file is missing', () => {
    const { root, pluginDir } = createFakePluginDir('spanory-opencode-install-enoent-');
    const runtimeHome = path.join(root, 'runtime');

    const result = runInstall(runtimeHome, pluginDir);
    const configPath = path.join(runtimeHome, 'opencode.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const spoolDir = path.join(runtimeHome, 'state', 'spanory', 'spool');
    const pluginLogDir = path.join(runtimeHome, 'state', 'spanory');

    expect(result.status).toBe(0);
    expect(config.plugin).toContain(OPENCODE_SPANORY_PLUGIN_ID);
    expect(existsSync(spoolDir)).toBe(true);
    expect(existsSync(pluginLogDir)).toBe(true);
  });
});
