import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

function readPackageJson(relativePath = 'package.json') {
  const file = path.join(packageRoot, relativePath);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

test('alipay-cli package exposes expected binary metadata', () => {
  const pkg = readPackageJson();
  assert.equal(pkg.name, '@alipay/spanory');
  assert.equal(pkg.bin?.spanory, 'dist/index.js');
  assert.equal(pkg.files.includes('dist'), true);
  assert.equal(pkg.files.includes('openclaw-plugin'), true);
});

test('alipay-cli references existing release prep assets', () => {
  assert.equal(existsSync(path.join(packageRoot, 'scripts', 'prepare-bin.sh')), true);
  assert.equal(existsSync(path.join(packageRoot, 'openclaw-plugin', 'package.json')), true);

  const embeddedPluginPkg = readPackageJson(path.join('openclaw-plugin', 'package.json'));
  assert.equal(embeddedPluginPkg.name, '@bububuger/spanory-openclaw-plugin');
});
