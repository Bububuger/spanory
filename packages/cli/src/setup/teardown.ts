
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { removeSpanoryOpenclawPluginLoadPaths } from '../plugin/openclaw.js';
import {
  resolveOpencodePluginInstallDir,
  uninstallOpencodePlugin,
} from '../plugin/opencode.js';
import { isSpanoryHookCommand, parseSetupRuntimes, setupHomeRoot } from './apply.js';

function removeClaudeHooks(settings: Record<string, any>): void {
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  for (const eventName of Object.keys(settings.hooks)) {
    const groups = settings.hooks[eventName];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.filter(
        (hook: any) => !(hook && typeof hook === 'object' && isSpanoryHookCommand(hook.command)),
      );
    }
    settings.hooks[eventName] = groups.filter(
      (group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0,
    );
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

async function teardownClaudeSetup({ homeRoot, dryRun, backupIfExists }: { homeRoot: string; dryRun: boolean; backupIfExists: (p: string) => Promise<string | null> }) {
  const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw new Error(`failed to parse Claude settings: ${(error as Error)?.message ?? String(error)}`);
    return { runtime: 'claude-code', ok: true, changed: false, dryRun, settingsPath, backup: null };
  }
  const before = JSON.stringify(settings);
  removeClaudeHooks(settings);
  const after = JSON.stringify(settings);
  const changed = before !== after;
  let backup: string | null = null;
  if (changed && !dryRun) {
    backup = await backupIfExists(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }
  return { runtime: 'claude-code', ok: true, changed, dryRun, settingsPath, backup };
}

async function teardownCodexSetup({ homeRoot, dryRun, stopCodexWatch }: { homeRoot: string; dryRun: boolean; stopCodexWatch: () => Promise<unknown> }) {
  let watchStopped = null;
  if (!dryRun) watchStopped = await stopCodexWatch();
  const notifyBackupPath = path.join(homeRoot, '.codex', 'spanory-notify.backup.json');
  const configPath = path.join(homeRoot, '.codex', 'config.toml');
  let notifyRestore: Record<string, any> = {
    restored: false,
    changed: false,
    dryRun,
    backupPath: notifyBackupPath,
    configPath,
    detail: 'no notify backup found; nothing to restore',
  };
  try {
    const backupRaw = await readFile(notifyBackupPath, 'utf-8');
    const parsed = JSON.parse(backupRaw);
    const notifyLines = Array.isArray(parsed?.notifyLines)
      ? parsed.notifyLines
        .filter((line: any) => typeof line === 'string')
        .map((line: string) => line.trimEnd())
        .filter(Boolean)
      : [];
    if (notifyLines.length > 0) {
      let current = '';
      try {
        current = await readFile(configPath, 'utf-8');
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
      const cleaned = current
        .split('\n')
        .filter((line) => !/^\s*notify\s*=/.test(line))
        .join('\n');
      let restored = cleaned;
      if (restored && !restored.endsWith('\n')) restored += '\n';
      restored += notifyLines.join('\n');
      if (!restored.endsWith('\n')) restored += '\n';
      const changed = restored !== current;
      if (!dryRun) {
        await mkdir(path.dirname(configPath), { recursive: true });
        if (changed) await writeFile(configPath, restored, 'utf-8');
        await rm(notifyBackupPath, { force: true });
      }
      notifyRestore = {
        restored: true,
        changed,
        dryRun,
        backupPath: notifyBackupPath,
        configPath,
        notifyLineCount: notifyLines.length,
        detail: changed
          ? dryRun
            ? `would restore ${notifyLines.length} notify line(s) from setup backup`
            : `restored ${notifyLines.length} notify line(s) from setup backup`
          : dryRun
            ? 'notify lines already match setup backup; no config changes in dry-run'
            : 'notify lines already match setup backup; backup cleaned',
      };
    } else {
      if (!dryRun) {
        await rm(notifyBackupPath, { force: true });
      }
      notifyRestore = {
        ...notifyRestore,
        detail: dryRun
          ? 'notify backup is empty; no changes in dry-run'
          : 'notify backup is empty; backup cleaned without config changes',
      };
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      notifyRestore = {
        ...notifyRestore,
        detail: 'no notify backup found; this teardown cannot restore notify from older apply runs',
      };
    } else {
      throw new Error(`failed to restore codex notify config: ${(error as Error)?.message ?? String(error)}`);
    }
  }
  return { runtime: 'codex', ok: true, dryRun, watchStopped, notifyRestore };
}

async function teardownOpenclawSetup({ homeRoot, openclawRuntimeHome, dryRun, deps }: { homeRoot: string; openclawRuntimeHome?: string; dryRun: boolean; deps: Record<string, any> }) {
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
  const pathCleanupResult = await removeSpanoryOpenclawPluginLoadPaths(
    deps.resolveRuntimeHome('openclaw', runtimeHome),
    deps.backupIfExists,
  );
  return { runtime: 'openclaw', ok: true, changed: true, dryRun, pathCleanupResult };
}

async function teardownOpencodeSetup({ homeRoot, opencodeRuntimeHome, dryRun, deps }: { homeRoot: string; opencodeRuntimeHome?: string; dryRun: boolean; deps: Record<string, any> }) {
  const runtimeHome = deps.opencodeRuntimeHomeForSetup(homeRoot, opencodeRuntimeHome);
  const pluginDir = resolveOpencodePluginInstallDir(runtimeHome, deps.resolveRuntimeHome);
  const loaderFile = deps.opencodePluginLoaderPath(runtimeHome, deps.resolveRuntimeHome);
  const packageFile = path.join(pluginDir, 'package.json');
  let present = false;
  try {
    await stat(loaderFile);
    present = true;
  } catch {
    // not present
  }

  let packagePresent = false;
  try {
    await stat(packageFile);
    packagePresent = true;
  } catch {
    // not present
  }

  let unregistered = false;
  if (!dryRun) {
    const uninstallResult = await uninstallOpencodePlugin(runtimeHome, { resolveRuntimeHome: deps.resolveRuntimeHome });
    unregistered = uninstallResult.unregistered;
    try {
      await rmdir(pluginDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT' && (error as NodeJS.ErrnoException)?.code !== 'ENOTEMPTY') throw error;
    }
  }

  return {
    runtime: 'opencode',
    ok: true,
    changed: present || packagePresent || unregistered,
    dryRun,
    loaderFile,
    unregistered,
  };
}

export async function runSetupTeardown(options: Record<string, any>, deps: Record<string, any>) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes, deps.defaultSetupRuntimes);
  const dryRun = Boolean(options.dryRun);
  const results: Record<string, any>[] = [];
  if (selected.includes('claude-code')) {
    try { results.push(await teardownClaudeSetup({ homeRoot, dryRun, backupIfExists: deps.backupIfExists })); }
    catch (error: unknown) { results.push({ runtime: 'claude-code', ok: false, error: String((error as Error)?.message ?? error) }); }
  }
  if (selected.includes('codex')) {
    try { results.push(await teardownCodexSetup({ homeRoot, dryRun, stopCodexWatch: deps.stopCodexWatch })); }
    catch (error: unknown) { results.push({ runtime: 'codex', ok: false, error: String((error as Error)?.message ?? error) }); }
  }
  if (selected.includes('openclaw')) {
    try {
      results.push(await teardownOpenclawSetup({
        homeRoot,
        openclawRuntimeHome: options.openclawRuntimeHome,
        dryRun,
        deps,
      }));
    } catch (error: unknown) {
      results.push({ runtime: 'openclaw', ok: false, error: String((error as Error)?.message ?? error) });
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
    } catch (error: unknown) {
      results.push({ runtime: 'opencode', ok: false, error: String((error as Error)?.message ?? error) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
