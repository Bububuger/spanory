// @ts-nocheck
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isSpanoryHookCommand, parseSetupRuntimes, setupHomeRoot } from './apply.js';

function removeClaudeHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  for (const eventName of Object.keys(settings.hooks)) {
    const groups = settings.hooks[eventName];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.filter(
        (hook) => !(hook && typeof hook === 'object' && isSpanoryHookCommand(hook.command)),
      );
    }
    settings.hooks[eventName] = groups.filter(
      (group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0,
    );
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

async function teardownClaudeSetup({ homeRoot, dryRun, backupIfExists }) {
  const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`failed to parse Claude settings: ${error.message ?? String(error)}`);
    return { runtime: 'claude-code', ok: true, changed: false, dryRun, settingsPath, backup: null };
  }
  const before = JSON.stringify(settings);
  removeClaudeHooks(settings);
  const after = JSON.stringify(settings);
  const changed = before !== after;
  let backup = null;
  if (changed && !dryRun) {
    backup = await backupIfExists(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }
  return { runtime: 'claude-code', ok: true, changed, dryRun, settingsPath, backup };
}

async function teardownCodexSetup({ dryRun, stopCodexWatch }) {
  let watchStopped = null;
  if (!dryRun) watchStopped = await stopCodexWatch();
  return { runtime: 'codex', ok: true, dryRun, watchStopped };
}

async function teardownOpenclawSetup({ homeRoot, openclawRuntimeHome, dryRun, deps }) {
  if (!deps.commandExists('openclaw')) {
    return { runtime: 'openclaw', ok: true, skipped: true, detail: 'openclaw command not found in PATH' };
  }
  const runtimeHome = deps.openclawRuntimeHomeForSetup(homeRoot, openclawRuntimeHome);
  if (dryRun) return { runtime: 'openclaw', ok: true, changed: true, dryRun };
  const result = deps.runSystemCommand('openclaw', ['plugins', 'uninstall', deps.openclawPluginId], {
    env: {
      ...process.env,
      ...(runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', runtimeHome) } : {}),
    },
  });
  if (result.code !== 0) throw new Error(result.stderr || result.error || 'openclaw plugins uninstall failed');
  return { runtime: 'openclaw', ok: true, changed: true, dryRun };
}

async function teardownOpencodeSetup({ homeRoot, opencodeRuntimeHome, dryRun, deps }) {
  const runtimeHome = deps.opencodeRuntimeHomeForSetup(homeRoot, opencodeRuntimeHome);
  const loaderFile = deps.opencodePluginLoaderPath(runtimeHome, deps.resolveRuntimeHome);
  let present = false;
  try { await stat(loaderFile); present = true; } catch { /* not present */ }
  if (present && !dryRun) await rm(loaderFile, { force: true });

  let unregistered = false;
  if (!dryRun) {
    const opencodeConfigPath = path.join(deps.resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
    try {
      const raw = await readFile(opencodeConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      if (Array.isArray(config.plugin) && config.plugin.includes(deps.opencodePluginId)) {
        config.plugin = config.plugin.filter((p) => p !== deps.opencodePluginId);
        await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        unregistered = true;
      }
    } catch {
      // no config to clean
    }
  }

  return { runtime: 'opencode', ok: true, changed: present || unregistered, dryRun, loaderFile, unregistered };
}

export async function runSetupTeardown(options, deps) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes, deps.defaultSetupRuntimes);
  const dryRun = Boolean(options.dryRun);
  const results = [];
  if (selected.includes('claude-code')) {
    try { results.push(await teardownClaudeSetup({ homeRoot, dryRun, backupIfExists: deps.backupIfExists })); }
    catch (error) { results.push({ runtime: 'claude-code', ok: false, error: String(error?.message ?? error) }); }
  }
  if (selected.includes('codex')) {
    try { results.push(await teardownCodexSetup({ dryRun, stopCodexWatch: deps.stopCodexWatch })); }
    catch (error) { results.push({ runtime: 'codex', ok: false, error: String(error?.message ?? error) }); }
  }
  if (selected.includes('openclaw')) {
    try {
      results.push(await teardownOpenclawSetup({
        homeRoot,
        openclawRuntimeHome: options.openclawRuntimeHome,
        dryRun,
        deps,
      }));
    } catch (error) {
      results.push({ runtime: 'openclaw', ok: false, error: String(error?.message ?? error) });
    }
  }
  if (selected.includes('opencode')) {
    try {
      results.push(await teardownOpencodeSetup({
        homeRoot,
        opencodeRuntimeHome: options.opencodeRuntimeHome,
        dryRun,
        deps,
      }));
    } catch (error) {
      results.push({ runtime: 'opencode', ok: false, error: String(error?.message ?? error) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
