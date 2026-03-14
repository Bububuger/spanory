import path from 'node:path';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

function createFakeOpencodePluginEntry(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const pluginDir = path.join(root, 'plugin');
  const pluginEntry = path.join(pluginDir, 'index.js');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    pluginEntry,
    'export default function plugin() { return { name: "fake-spanory-opencode-plugin" }; }\n',
    'utf-8',
  );
  return { root, pluginEntry };
}

describe('BDD opencode setup apply', () => {
  it('Given OTLP endpoint is unset, When setup apply installs opencode plugin, Then apply stays successful and endpoint check remains visible', () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'spanory-opencode-setup-home-'));
    const runtimeHome = path.join(homeDir, '.opencode');
    mkdirSync(runtimeHome, { recursive: true });
    writeFileSync(path.join(runtimeHome, 'opencode.json'), JSON.stringify({ plugin: [] }, null, 2) + '\n', 'utf-8');

    const { root, pluginEntry } = createFakeOpencodePluginEntry('spanory-opencode-plugin-entry-');
    try {
      const env = {
        ...process.env,
        HOME: homeDir,
        SPANORY_OPENCODE_PLUGIN_ENTRY: pluginEntry,
      };
      delete env.OTEL_EXPORTER_OTLP_ENDPOINT;

      const result = spawnSync(
        process.execPath,
        [entry, 'setup', 'apply', '--runtimes', 'opencode', '--home', homeDir, '--opencode-runtime-home', runtimeHome],
        { encoding: 'utf-8', env },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(true);

      const runtimeResult = report.results.find((item) => item.runtime === 'opencode');
      expect(runtimeResult.ok).toBe(true);
      const endpointCheck = runtimeResult.doctor.checks.find((item) => item.id === 'otlp_endpoint');
      expect(endpointCheck.ok).toBe(false);
      expect(endpointCheck.detail).toContain('OTEL_EXPORTER_OTLP_ENDPOINT is unset');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('Given OTLP endpoint is configured and opencode.json is missing, When setup apply installs opencode plugin, Then runtime dirs are created and doctor passes spool/log checks', () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'spanory-opencode-setup-home-'));
    const runtimeHome = path.join(homeDir, '.opencode');
    mkdirSync(runtimeHome, { recursive: true });

    const { root, pluginEntry } = createFakeOpencodePluginEntry('spanory-opencode-plugin-entry-');
    try {
      const env = {
        ...process.env,
        HOME: homeDir,
        SPANORY_OPENCODE_PLUGIN_ENTRY: pluginEntry,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      };

      const result = spawnSync(
        process.execPath,
        [entry, 'setup', 'apply', '--runtimes', 'opencode', '--home', homeDir, '--opencode-runtime-home', runtimeHome],
        { encoding: 'utf-8', env },
      );

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(true);

      const runtimeResult = report.results.find((item) => item.runtime === 'opencode');
      expect(runtimeResult.ok).toBe(true);
      const spoolCheck = runtimeResult.doctor.checks.find((item) => item.id === 'spool_writable');
      expect(spoolCheck.ok).toBe(true);
      const logCheck = runtimeResult.doctor.checks.find((item) => item.id === 'opencode_plugin_log');
      expect(logCheck.ok).toBe(true);

      const opencodeConfigPath = path.join(runtimeHome, 'opencode.json');
      const createdConfig = JSON.parse(readFileSync(opencodeConfigPath, 'utf-8'));
      expect(createdConfig.plugin).toContain('spanory-opencode-plugin');

      const stateRoot = path.join(runtimeHome, 'state', 'spanory');
      expect(existsSync(path.join(stateRoot, 'spool'))).toBe(true);
      expect(existsSync(stateRoot)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('Given opencode plugin files exist, When setup teardown runs, Then package.json and empty plugin directory are removed', () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'spanory-opencode-teardown-home-'));
    const runtimeHome = path.join(homeDir, '.opencode');
    const pluginDir = path.join(runtimeHome, 'plugin');
    const loaderFile = path.join(pluginDir, 'spanory-opencode-plugin.js');
    const packageJson = path.join(pluginDir, 'package.json');
    const configPath = path.join(runtimeHome, 'opencode.json');

    try {
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(loaderFile, 'export default {}\n', 'utf-8');
      writeFileSync(packageJson, '{"type":"module"}\n', 'utf-8');
      writeFileSync(
        configPath,
        JSON.stringify({ plugin: ['spanory-opencode-plugin', 'other-plugin'] }, null, 2) + '\n',
        'utf-8',
      );

      const result = spawnSync(
        process.execPath,
        [
          entry,
          'setup',
          'teardown',
          '--runtimes',
          'opencode',
          '--home',
          homeDir,
          '--opencode-runtime-home',
          runtimeHome,
        ],
        { encoding: 'utf-8' },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(existsSync(loaderFile)).toBe(false);
      expect(existsSync(packageJson)).toBe(false);
      expect(existsSync(pluginDir)).toBe(false);
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.plugin).toEqual(['other-plugin']);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
