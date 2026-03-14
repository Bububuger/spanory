import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
});
