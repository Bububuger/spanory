// @ts-nocheck
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const OPENCLAW_SPANORY_PLUGIN_ID = 'spanory-openclaw-plugin';

export function openclawRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.openclaw');
}

export function resolveOpenclawPluginDir(deps) {
  if (process.env.SPANORY_OPENCLAW_PLUGIN_DIR) {
    return process.env.SPANORY_OPENCLAW_PLUGIN_DIR;
  }
  const pkgCandidate = (process as any).pkg
    ? path.resolve(path.dirname(process.execPath), '..', 'openclaw-plugin')
    : undefined;
  const candidates = [
    deps.resolveInstalledPackageDir('@bububuger/spanory-openclaw-plugin'),
    pkgCandidate,
    path.resolve(deps.cliPackageDir, '..', 'openclaw-plugin'),
    path.resolve(deps.cliPackageDir, 'openclaw-plugin'),
    path.resolve(process.cwd(), 'packages/openclaw-plugin'),
  ].filter(Boolean);
  const hit = candidates.find((dir) => existsSync(path.join(dir, 'package.json')));
  return hit ?? candidates[0] ?? path.resolve(process.cwd(), 'packages/openclaw-plugin');
}

function resolveOpenclawConfigPath(runtimeHome) {
  return path.join(runtimeHome, 'openclaw.json');
}

function canonicalPath(input) {
  const resolved = path.resolve(String(input ?? ''));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readOpenclawPluginNameFromDir(dirPath) {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const name = String(parsed?.name ?? '').trim();
    return name || null;
  } catch {
    return null;
  }
}

function isSpanoryOpenclawPluginPath(candidatePath) {
  const text = String(candidatePath ?? '').trim();
  if (!text) return false;

  const normalized = text.replaceAll('\\', '/').toLowerCase();
  if (normalized.includes('spanory') && normalized.includes('openclaw-plugin')) {
    return true;
  }

  const canonical = canonicalPath(text);
  const pluginName = readOpenclawPluginNameFromDir(canonical);
  return pluginName === '@bububuger/spanory-openclaw-plugin' || pluginName === '@alipay/spanory-openclaw-plugin';
}

async function normalizeOpenclawPluginLoadPaths(runtimeHome, pluginDir, dryRun, backupIfExists) {
  const configPath = resolveOpenclawConfigPath(runtimeHome);
  let configRaw = '';
  try {
    configRaw = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { changed: false, configPath, backup: null };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(configRaw);
  } catch (error) {
    throw new Error(`failed to parse openclaw config ${configPath}: ${error?.message ?? String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parsed = {};
  }
  if (!parsed.plugins || typeof parsed.plugins !== 'object' || Array.isArray(parsed.plugins)) {
    parsed.plugins = {};
  }
  if (!parsed.plugins.load || typeof parsed.plugins.load !== 'object' || Array.isArray(parsed.plugins.load)) {
    parsed.plugins.load = {};
  }

  const target = path.resolve(pluginDir);
  const targetCanonical = canonicalPath(target);
  const currentPaths = Array.isArray(parsed.plugins.load.paths) ? parsed.plugins.load.paths : [];
  const nonSpanoryPaths = [];
  const seen = new Set();

  for (const item of currentPaths) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    if (isSpanoryOpenclawPluginPath(text)) continue;
    const key = canonicalPath(text);
    if (seen.has(key)) continue;
    seen.add(key);
    nonSpanoryPaths.push(text);
  }

  if (!seen.has(targetCanonical)) {
    nonSpanoryPaths.push(target);
  }
  parsed.plugins.load.paths = nonSpanoryPaths;

  const nextRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  if (nextRaw === configRaw) {
    return { changed: false, configPath, backup: null };
  }

  let backup = null;
  if (!dryRun) {
    backup = await backupIfExists(configPath);
    await writeFile(configPath, nextRaw, 'utf-8');
  }
  return { changed: true, configPath, backup };
}

export async function installOpenclawPlugin(runtimeHome, dryRun, deps) {
  const pluginDir = path.resolve(deps.resolveOpenclawPluginDir());
  const installResult = deps.runSystemCommand('openclaw', ['plugins', 'install', '-l', pluginDir], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: runtimeHome,
    },
  });
  if (installResult.code !== 0) {
    throw new Error(installResult.stderr || installResult.error || 'openclaw plugins install failed');
  }
  const enableResult = deps.runSystemCommand('openclaw', ['plugins', 'enable', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: runtimeHome,
    },
  });
  if (enableResult.code !== 0) {
    throw new Error(enableResult.stderr || enableResult.error || 'openclaw plugins enable failed');
  }
  const pathNormalizeResult = await normalizeOpenclawPluginLoadPaths(
    runtimeHome,
    pluginDir,
    dryRun,
    deps.backupIfExists,
  );
  return {
    pluginDir,
    installStdout: installResult.stdout.trim(),
    enableStdout: enableResult.stdout.trim(),
    pathNormalizeResult,
  };
}

function parsePluginEnabledFromInfoOutput(output) {
  if (!output) return undefined;
  const yes = /enabled\s*[:=]\s*(true|yes|1)/i.test(output);
  const no = /enabled\s*[:=]\s*(false|no|0)/i.test(output);
  if (yes) return true;
  if (no) return false;
  return undefined;
}

export async function runOpenclawPluginDoctor(runtimeHome, deps) {
  const checks = [];

  const info = deps.runSystemCommand('openclaw', ['plugins', 'info', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      ...(runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', runtimeHome) } : {}),
    },
  });
  checks.push({
    id: 'plugin_installed',
    ok: info.code === 0,
    detail: info.code === 0 ? 'openclaw plugins info succeeded' : info.stderr || info.error || 'plugin not installed',
  });

  const enabled = parsePluginEnabledFromInfoOutput(`${info.stdout}\n${info.stderr}`);
  checks.push({
    id: 'plugin_enabled',
    ok: enabled !== false,
    detail: enabled === undefined ? 'cannot infer enabled status from openclaw output' : `enabled=${enabled}`,
  });

  checks.push({
    id: 'otlp_endpoint',
    ok: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    detail: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? deps.maskEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
      : 'OTEL_EXPORTER_OTLP_ENDPOINT is unset',
  });

  const spoolDir = process.env.SPANORY_OPENCLAW_SPOOL_DIR
    ?? path.join(deps.resolveRuntimeStateRoot('openclaw', runtimeHome), 'spanory', 'spool');
  try {
    await stat(spoolDir);
    await access(spoolDir);
    checks.push({ id: 'spool_writable', ok: true, detail: spoolDir });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      checks.push({
        id: 'spool_writable',
        ok: true,
        detail: `spool dir not created yet: ${spoolDir}`,
      });
    } else {
      checks.push({ id: 'spool_writable', ok: false, detail: String(err) });
    }
  }

  const statusFile = path.join(deps.resolveRuntimeStateRoot('openclaw', runtimeHome), 'spanory', 'plugin-status.json');
  try {
    const raw = await readFile(statusFile, 'utf-8');
    checks.push({ id: 'last_send_status', ok: true, detail: raw.slice(0, 500) });
  } catch {}
  if (!checks.some((item) => item.id === 'last_send_status')) {
    checks.push({
      id: 'last_send_status',
      ok: true,
      detail: `status file not generated yet: ${statusFile}`,
    });
  }

  const ok = checks.every((item) => item.ok);
  return { ok, checks };
}
