// @ts-nocheck
import { existsSync } from 'node:fs';
import { access, mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const OPENCODE_SPANORY_PLUGIN_ID = 'spanory-opencode-plugin';

export function opencodeRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.config', 'opencode');
}

export function resolveOpencodePluginDir(deps) {
  if (process.env.SPANORY_OPENCODE_PLUGIN_DIR) {
    return process.env.SPANORY_OPENCODE_PLUGIN_DIR;
  }
  const pkgCandidate = (process as any).pkg
    ? path.resolve(path.dirname(process.execPath), '..', 'opencode-plugin')
    : undefined;
  const candidates = [
    deps.resolveInstalledPackageDir('@bububuger/spanory-opencode-plugin'),
    pkgCandidate,
    path.resolve(deps.cliPackageDir, '..', 'opencode-plugin'),
    path.resolve(deps.cliPackageDir, 'opencode-plugin'),
    path.resolve(process.cwd(), 'packages/opencode-plugin'),
  ].filter(Boolean);
  const hit = candidates.find((dir) => existsSync(path.join(dir, 'package.json')));
  return hit ?? candidates[0] ?? path.resolve(process.cwd(), 'packages/opencode-plugin');
}

export async function resolveOpencodePluginEntry(pluginDir) {
  const explicitEntry = process.env.SPANORY_OPENCODE_PLUGIN_ENTRY;
  if (explicitEntry) {
    await stat(explicitEntry);
    return explicitEntry;
  }

  const pluginEntry = path.join(pluginDir, 'dist', 'index.js');
  await stat(pluginEntry);
  return pluginEntry;
}

export function resolveOpencodePluginInstallDir(runtimeHome, resolveRuntimeHome) {
  return path.join(resolveRuntimeHome('opencode', runtimeHome), 'plugin');
}

export function opencodePluginLoaderPath(runtimeHome, resolveRuntimeHome) {
  return path.join(resolveOpencodePluginInstallDir(runtimeHome, resolveRuntimeHome), `${OPENCODE_SPANORY_PLUGIN_ID}.js`);
}

function resolveOpencodePluginSpoolDir(runtimeHome, resolveOpencodePluginStateRoot) {
  return process.env.SPANORY_OPENCODE_SPOOL_DIR ?? path.join(resolveOpencodePluginStateRoot(runtimeHome), 'spool');
}

function resolveOpencodePluginLogFile(runtimeHome, resolveOpencodePluginStateRoot) {
  return path.join(resolveOpencodePluginStateRoot(runtimeHome), 'plugin.log');
}

async function ensureOpencodePluginRuntimeDirs(runtimeHome, resolveOpencodePluginStateRoot) {
  const spoolDir = resolveOpencodePluginSpoolDir(runtimeHome, resolveOpencodePluginStateRoot);
  const logFile = resolveOpencodePluginLogFile(runtimeHome, resolveOpencodePluginStateRoot);
  await mkdir(spoolDir, { recursive: true });
  await mkdir(path.dirname(logFile), { recursive: true });
  return { spoolDir, logFile };
}

export async function installOpencodePlugin(runtimeHome, pluginDirOverride, deps) {
  const pluginDir = path.resolve(pluginDirOverride ?? deps.resolveOpencodePluginDir());
  let pluginEntry;
  try {
    pluginEntry = await resolveOpencodePluginEntry(pluginDir);
  } catch {
    throw new Error(
      `opencode plugin entry not found at ${path.join(pluginDir, 'dist', 'index.js')}. `
      + 'build plugin first: npm run --workspace @bububuger/spanory-opencode-plugin build',
    );
  }

  const installDir = resolveOpencodePluginInstallDir(runtimeHome, deps.resolveRuntimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome, deps.resolveRuntimeHome);
  await mkdir(installDir, { recursive: true });

  const importUrl = pathToFileURL(pluginEntry).href;
  const loader = `import plugin from ${JSON.stringify(importUrl)};\n`
    + 'export const SpanoryOpencodePlugin = plugin;\n'
    + 'export default SpanoryOpencodePlugin;\n';
  await writeFile(path.join(installDir, 'package.json'), '{"type":"module"}\n', 'utf-8');
  await writeFile(loaderFile, loader, 'utf-8');

  const opencodeConfigPath = path.join(deps.resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  const runtimeDirs = await ensureOpencodePluginRuntimeDirs(runtimeHome, deps.resolveOpencodePluginStateRoot);
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    if (!plugins.includes(OPENCODE_SPANORY_PLUGIN_ID)) {
      config.plugin = [...plugins, OPENCODE_SPANORY_PLUGIN_ID];
      await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      await writeFile(opencodeConfigPath, JSON.stringify({ plugin: [OPENCODE_SPANORY_PLUGIN_ID] }, null, 2) + '\n', 'utf-8');
      return { loaderFile, runtimeDirs };
    }
    throw err;
  }

  return { loaderFile, runtimeDirs };
}

export async function uninstallOpencodePlugin(runtimeHome, deps) {
  const installDir = resolveOpencodePluginInstallDir(runtimeHome, deps.resolveRuntimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome, deps.resolveRuntimeHome);
  const packageFile = path.join(installDir, 'package.json');

  await rm(loaderFile, { force: true });
  await rm(packageFile, { force: true });
  try {
    await rmdir(installDir);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
  }

  let unregistered = false;
  const opencodeConfigPath = path.join(deps.resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.plugin) && config.plugin.includes(OPENCODE_SPANORY_PLUGIN_ID)) {
      config.plugin = config.plugin.filter((pluginId) => pluginId !== OPENCODE_SPANORY_PLUGIN_ID);
      await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      unregistered = true;
    }
  } catch {
    // ignore opencode.json cleanup failures
  }

  return { loaderFile, unregistered };
}

const NON_BLOCKING_PLUGIN_DOCTOR_CHECK_IDS = new Set(['otlp_endpoint', 'last_send_endpoint_configured']);

export async function runOpencodePluginDoctor(runtimeHome, deps) {
  const checks = [];

  const loaderFile = opencodePluginLoaderPath(runtimeHome, deps.resolveRuntimeHome);
  try {
    await stat(loaderFile);
    checks.push({ id: 'plugin_installed', ok: true, detail: loaderFile });
  } catch {
    checks.push({ id: 'plugin_installed', ok: false, detail: `plugin loader missing: ${loaderFile}` });
  }

  try {
    const loaderUrl = pathToFileURL(loaderFile).href;
    const mod = await import(loaderUrl);
    const hasDefault = typeof mod.default === 'function' || typeof mod.SpanoryOpencodePlugin === 'function';
    checks.push({
      id: 'plugin_loadable',
      ok: hasDefault,
      detail: hasDefault ? 'plugin module loaded and exports a register function' : 'plugin module loaded but missing default export function',
    });
  } catch (err) {
    checks.push({
      id: 'plugin_loadable',
      ok: false,
      detail: `plugin import failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const opencodeConfigPath = path.join(deps.resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    const registered = plugins.includes(OPENCODE_SPANORY_PLUGIN_ID);
    checks.push({
      id: 'plugin_registered',
      ok: registered,
      detail: registered ? opencodeConfigPath : `${OPENCODE_SPANORY_PLUGIN_ID} not in plugin array of ${opencodeConfigPath}`,
    });
  } catch {
    checks.push({ id: 'plugin_registered', ok: false, detail: `cannot read ${opencodeConfigPath}` });
  }

  checks.push({
    id: 'otlp_endpoint',
    ok: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    detail: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? deps.maskEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
      : 'OTEL_EXPORTER_OTLP_ENDPOINT is unset',
  });

  const spoolDir = process.env.SPANORY_OPENCODE_SPOOL_DIR
    ?? path.join(deps.resolveOpencodePluginStateRoot(runtimeHome), 'spool');
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

  const statusFile = path.join(deps.resolveOpencodePluginStateRoot(runtimeHome), 'plugin-status.json');
  const logFile = path.join(deps.resolveOpencodePluginStateRoot(runtimeHome), 'plugin.log');
  try {
    await stat(logFile);
    await access(logFile);
    checks.push({ id: 'opencode_plugin_log', ok: true, detail: logFile });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      checks.push({
        id: 'opencode_plugin_log',
        ok: true,
        detail: `plugin log not generated yet: ${logFile}`,
      });
    } else {
      checks.push({ id: 'opencode_plugin_log', ok: false, detail: String(err) });
    }
  }
  try {
    const raw = await readFile(statusFile, 'utf-8');
    checks.push({ id: 'last_send_status', ok: true, detail: raw.slice(0, 500) });
    try {
      const parsed = JSON.parse(raw);
      const endpointConfigured = parsed?.endpointConfigured;
      if (endpointConfigured === false) {
        checks.push({
          id: 'last_send_endpoint_configured',
          ok: false,
          detail: `last send skipped or failed to resolve OTLP endpoint in opencode process; check ${deps.resolveSpanoryEnvPath()} and restart opencode`,
        });
      } else if (endpointConfigured === true) {
        checks.push({
          id: 'last_send_endpoint_configured',
          ok: true,
          detail: 'last send had OTLP endpoint configured in opencode process',
        });
      }
    } catch {
      // ignore malformed status file
    }
  } catch {
    checks.push({
      id: 'last_send_status',
      ok: true,
      detail: `status file not generated yet: ${statusFile}`,
    });
  }

  const ok = checks.every((item) => item.ok || NON_BLOCKING_PLUGIN_DOCTOR_CHECK_IDS.has(item.id));
  return { ok, checks };
}
