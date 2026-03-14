#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const version = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim().replace(/^v/, '');

const workspaceTargets = execSync('git ls-files "packages/**/package.json"', {
  cwd: root,
  encoding: 'utf-8',
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .sort();

const targets = ['package.json', ...workspaceTargets];

for (const rel of targets) {
  const file = join(root, rel);
  const pkg = JSON.parse(readFileSync(file, 'utf-8'));
  const prev = pkg.version;
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${rel}: ${prev} → ${version}`);
}
