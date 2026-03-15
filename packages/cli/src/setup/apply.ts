
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function setupHomeRoot(homeOption: string | undefined): string {
  if (homeOption) return path.resolve(homeOption);
  return process.env.HOME || '';
}

export function parseSetupRuntimes(csv: string | undefined, defaultSetupRuntimes: string[]): string[] {
  const selected = (csv ?? defaultSetupRuntimes.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set(defaultSetupRuntimes);
  for (const runtimeName of selected) {
    if (!allowed.has(runtimeName)) {
      throw new Error(`unsupported runtime in --runtimes: ${runtimeName}`);
    }
  }
  return selected;
}

export function isSpanoryHookCommand(command: unknown): boolean {
  const text = String(command ?? '');
  return /\bspanory\b/.test(text) && /\bhook\b/.test(text);
}

function ensureClaudeHookEvent(settings: Record<string, any>, eventName: string, command: string): void {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks[eventName]) || settings.hooks[eventName].length === 0) {
    settings.hooks[eventName] = [{ hooks: [] }];
  }
  if (!settings.hooks[eventName][0] || typeof settings.hooks[eventName][0] !== 'object') {
    settings.hooks[eventName][0] = { hooks: [] };
  }
  if (!Array.isArray(settings.hooks[eventName][0].hooks)) {
    settings.hooks[eventName][0].hooks = [];
  }

  const hooks = settings.hooks[eventName][0].hooks.filter(
    (hook: any) => !(hook && typeof hook === 'object' && isSpanoryHookCommand(hook.command)),
  );
  hooks.unshift({ type: 'command', command });
  settings.hooks[eventName][0].hooks = hooks;
}

async function applyClaudeSetup({ homeRoot, spanoryBin, dryRun, backupIfExists }: { homeRoot: string; spanoryBin: string; dryRun: boolean; backupIfExists: (path: string) => Promise<string | null> }) {
  const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw new Error(`failed to parse Claude settings: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  const before = JSON.stringify(settings);
  const hookCommand = `${spanoryBin} hook --last-turn-only`;
  ensureClaudeHookEvent(settings, 'Stop', hookCommand);
  ensureClaudeHookEvent(settings, 'SessionEnd', hookCommand);
  const after = JSON.stringify(settings);
  const changed = before !== after;

  let backup: string | null = null;
  if (changed && !dryRun) {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    backup = await backupIfExists(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  return {
    runtime: 'claude-code',
    ok: true,
    changed,
    dryRun,
    settingsPath,
    backup,
  };
}

async function applyCodexWatchSetup({ homeRoot, dryRun }: { homeRoot: string; dryRun: boolean }) {
  let changed = false;

  const legacyScript = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
  if (existsSync(legacyScript) && !dryRun) {
    await rm(legacyScript, { force: true });
    changed = true;
  }

  const configPath = path.join(homeRoot, '.codex', 'config.toml');
  const notifyBackupPath = path.join(homeRoot, '.codex', 'spanory-notify.backup.json');
  let notifyBackup: Record<string, any> | null = null;
  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8');
    const notifyLines = content
      .split('\n')
      .filter((line) => /^\s*notify\s*=/.test(line))
      .map((line) => line.trimEnd());
    const cleaned = content
      .split('\n')
      .filter((line) => !/^\s*notify\s*=/.test(line))
      .join('\n');
    if (cleaned !== content && !dryRun) {
      await mkdir(path.dirname(notifyBackupPath), { recursive: true });
      await writeFile(notifyBackupPath, `${JSON.stringify({ notifyLines }, null, 2)}\n`, 'utf-8');
      await writeFile(configPath, cleaned, 'utf-8');
      changed = true;
    }
    if (cleaned !== content) {
      notifyBackup = {
        saved: !dryRun,
        dryRun,
        backupPath: notifyBackupPath,
        notifyLineCount: notifyLines.length,
      };
    }
  }

  return { runtime: 'codex', ok: true, changed, dryRun, mode: 'watch', notifyBackup };
}

export async function runSetupApply(options: Record<string, any>, deps: Record<string, any>) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes, deps.defaultSetupRuntimes);
  const spanoryBin = options.spanoryBin ?? 'spanory';
  const dryRun = Boolean(options.dryRun);
  const results: Record<string, any>[] = [];

  if (selected.includes('claude-code')) {
    try {
      const result = await applyClaudeSetup({ homeRoot, spanoryBin, dryRun, backupIfExists: deps.backupIfExists });
      results.push(result);
    } catch (error: unknown) {
      results.push({
        runtime: 'claude-code',
        ok: false,
        error: String((error as Error)?.message ?? error),
      });
    }
  }

  if (selected.includes('codex')) {
    try {
      const result: Record<string, any> = await applyCodexWatchSetup({ homeRoot, dryRun });
      if (!dryRun) {
        const watch = await deps.startCodexWatch(spanoryBin);
        result.watch = watch;
      }
      results.push(result);
    } catch (error: unknown) {
      results.push({ runtime: 'codex', ok: false, error: String((error as Error)?.message ?? error) });
    }
  }

  if (selected.includes('openclaw')) {
    if (!deps.commandExists('openclaw')) {
      results.push({
        runtime: 'openclaw',
        ok: true,
        skipped: true,
        detail: 'openclaw command not found in PATH',
      });
    } else {
      const runtimeHome = deps.openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome);
      try {
        if (!dryRun) {
          await deps.installOpenclawPlugin(runtimeHome, dryRun, {
            resolveOpenclawPluginDir: () => options.openclawPluginDir ?? deps.resolveOpenclawPluginDir(),
            runSystemCommand: deps.runSystemCommand,
            backupIfExists: deps.backupIfExists,
          });
        }
        const doctor = await deps.runOpenclawPluginDoctor(runtimeHome, {
          runSystemCommand: deps.runSystemCommand,
          resolveRuntimeHome: deps.resolveRuntimeHome,
          resolveRuntimeStateRoot: deps.resolveRuntimeStateRoot,
          maskEndpoint: deps.maskEndpoint,
        });
        results.push({
          runtime: 'openclaw',
          ok: doctor.ok,
          dryRun,
          doctor,
        });
      } catch (error: unknown) {
        results.push({
          runtime: 'openclaw',
          ok: false,
          error: String((error as Error)?.message ?? error),
        });
      }
    }
  }

  if (selected.includes('opencode')) {
    const runtimeHome = deps.opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome);
    try {
      if (!dryRun) {
        await deps.installOpencodePlugin(runtimeHome, options.opencodePluginDir, {
          resolveRuntimeHome: deps.resolveRuntimeHome,
          resolveOpencodePluginDir: deps.resolveOpencodePluginDir,
          resolveOpencodePluginStateRoot: deps.resolveOpencodePluginStateRoot,
        });
      }
      const doctor = await deps.runOpencodePluginDoctor(runtimeHome, {
        resolveRuntimeHome: deps.resolveRuntimeHome,
        resolveOpencodePluginStateRoot: deps.resolveOpencodePluginStateRoot,
        maskEndpoint: deps.maskEndpoint,
        resolveSpanoryEnvPath: deps.resolveSpanoryEnvPath,
      });
      results.push({
        runtime: 'opencode',
        ok: doctor.ok,
        dryRun,
        doctor,
      });
    } catch (error: unknown) {
      results.push({
        runtime: 'opencode',
        ok: false,
        error: String((error as Error)?.message ?? error),
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    results,
  };
}
