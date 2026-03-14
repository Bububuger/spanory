import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export function resolveUserHome(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

export function resolveSpanoryHome(): string {
  if (process.env.SPANORY_HOME) return process.env.SPANORY_HOME;
  const home = resolveUserHome();
  return home ? path.join(home, '.spanory') : '';
}

export function resolveSpanoryEnvPath(): string {
  const root = resolveSpanoryHome();
  return root ? path.join(root, '.env') : '';
}

export function resolveLegacyUserEnvPath(): string {
  const home = resolveUserHome();
  return home ? path.join(home, '.env') : '';
}

export function parseSimpleDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
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
  const spanoryHome = resolveSpanoryHome();
  const envPath = resolveSpanoryEnvPath();
  const legacyEnvPath = resolveLegacyUserEnvPath();
  if (!spanoryHome || !envPath) return;

  try {
    await mkdir(spanoryHome, { recursive: true });
    await writeFile(envPath, '', { flag: 'a' });
  } catch {
    // best effort only
  }

  const candidates = [envPath, legacyEnvPath].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf-8');
      const parsed = parseSimpleDotEnv(raw);
      if (Object.keys(parsed).length === 0) continue;
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
      return;
    } catch {
      // try next candidate
    }
  }
}
