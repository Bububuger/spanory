import path from 'node:path';
import { readFile } from 'node:fs/promises';

function resolveUserHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

export function parseSimpleDotEnv(raw) {
  const out = {};
  for (const line of String(raw).split('\n')) {
    let s = line.trim();
    if (!s || s.startsWith('#')) continue;

    if (s.startsWith('export ')) {
      s = s.slice('export '.length).trim();
    }

    const idx = s.indexOf('=');
    if (idx <= 0) continue;

    const key = s.slice(0, idx).trim();
    if (!key) continue;

    let value = s.slice(idx + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));

    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx).trimEnd();
      }
    }

    out[key] = value;
  }
  return out;
}

export async function loadUserEnv() {
  const home = resolveUserHome();
  if (!home) return;

  const envPath = path.join(home, '.env');
  try {
    const raw = await readFile(envPath, 'utf-8');
    const parsed = parseSimpleDotEnv(raw);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // ignore missing ~/.env
  }
}

