import path from 'node:path';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const OPENCODE_SPANORY_PLUGIN_ID = 'spanory-opencode-plugin';

describe('BDD opencode plugin uninstall', () => {
  it('removes loader file and opencode.json registration', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spanory-opencode-uninstall-'));
    const runtimeHome = path.join(root, 'runtime');
    const loaderFile = path.join(runtimeHome, 'plugin', `${OPENCODE_SPANORY_PLUGIN_ID}.js`);
    const configPath = path.join(runtimeHome, 'opencode.json');

    try {
      mkdirSync(path.dirname(loaderFile), { recursive: true });
      writeFileSync(loaderFile, 'export default {}\n', 'utf-8');
      writeFileSync(
        configPath,
        JSON.stringify({ plugin: [OPENCODE_SPANORY_PLUGIN_ID, 'other-plugin'] }, null, 2) + '\n',
        'utf-8',
      );

      const result = spawnSync(
        process.execPath,
        [entry, 'runtime', 'opencode', 'plugin', 'uninstall', '--runtime-home', runtimeHome],
        { encoding: 'utf-8' },
      );

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(existsSync(loaderFile)).toBe(false);
      expect(readFileSync(configPath, 'utf-8')).toContain('"other-plugin"');
      expect(config.plugin).not.toContain(OPENCODE_SPANORY_PLUGIN_ID);
      expect(config.plugin).toContain('other-plugin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
