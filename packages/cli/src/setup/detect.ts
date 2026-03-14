// @ts-nocheck
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isSpanoryHookCommand, parseSetupRuntimes, setupHomeRoot } from './apply.js';

export async function runSetupDetect(options, deps) {
  const homeRoot = setupHomeRoot(options.home);
  const report = {
    homeRoot,
    runtimes: [],
  };

  const claudeSettingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let claudeHooks = { stop: false, sessionEnd: false };
  try {
    const parsed = JSON.parse(await readFile(claudeSettingsPath, 'utf-8'));
    const hooks = parsed?.hooks ?? {};
    const stopHooks = hooks?.Stop?.[0]?.hooks ?? [];
    const endHooks = hooks?.SessionEnd?.[0]?.hooks ?? [];
    claudeHooks = {
      stop: Array.isArray(stopHooks) && stopHooks.some((h) => isSpanoryHookCommand(h?.command)),
      sessionEnd: Array.isArray(endHooks) && endHooks.some((h) => isSpanoryHookCommand(h?.command)),
    };
  } catch {
    // keep defaults
  }
  report.runtimes.push({
    runtime: 'claude-code',
    available: deps.commandExists('claude'),
    configured: claudeHooks.stop && claudeHooks.sessionEnd,
    details: {
      settingsPath: claudeSettingsPath,
      stopHookConfigured: claudeHooks.stop,
      sessionEndHookConfigured: claudeHooks.sessionEnd,
    },
  });

  report.runtimes.push({
    runtime: 'codex',
    available: deps.commandExists('codex'),
    configured: deps.isCodexWatchRunning(),
    details: { mode: 'watch', watchRunning: deps.isCodexWatchRunning() },
  });

  report.runtimes.push({
    runtime: 'openclaw',
    available: deps.commandExists('openclaw'),
    configured: undefined,
    details: {
      runtimeHome: deps.openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome),
    },
  });
  report.runtimes.push({
    runtime: 'opencode',
    available: deps.commandExists('opencode'),
    configured: undefined,
    details: {
      runtimeHome: deps.opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome),
    },
  });

  return report;
}

export async function runSetupDoctor(options, deps) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes, deps.defaultSetupRuntimes);
  const checks = [];

  if (selected.includes('claude-code')) {
    const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
    let stopHookConfigured = false;
    let sessionEndHookConfigured = false;
    try {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf-8'));
      const stopHooks = parsed?.hooks?.Stop?.[0]?.hooks ?? [];
      const endHooks = parsed?.hooks?.SessionEnd?.[0]?.hooks ?? [];
      stopHookConfigured = Array.isArray(stopHooks) && stopHooks.some((h) => isSpanoryHookCommand(h?.command));
      sessionEndHookConfigured = Array.isArray(endHooks) && endHooks.some((h) => isSpanoryHookCommand(h?.command));
    } catch {
      // keep defaults
    }
    checks.push({
      id: 'claude_hook_stop',
      runtime: 'claude-code',
      ok: stopHookConfigured,
      detail: settingsPath,
    });
    checks.push({
      id: 'claude_hook_session_end',
      runtime: 'claude-code',
      ok: sessionEndHookConfigured,
      detail: settingsPath,
    });
  }

  if (selected.includes('codex')) {
    checks.push({
      id: 'codex_watch_mode',
      runtime: 'codex',
      ok: true,
      detail: 'codex is configured for watch mode',
    });

    const legacyScript = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
    const legacyAbsent = !existsSync(legacyScript);
    checks.push({
      id: 'codex_notify_script_absent',
      runtime: 'codex',
      ok: legacyAbsent,
      detail: legacyAbsent ? 'legacy notify script absent' : `legacy notify script still exists: ${legacyScript}`,
    });

    const watchRunning = deps.isCodexWatchRunning();
    checks.push({
      id: 'codex_watch_running',
      runtime: 'codex',
      ok: watchRunning,
      running: watchRunning,
      detail: watchRunning ? deps.codexWatchPidFile() : 'codex watch process not running (non-blocking)',
    });
  }

  if (selected.includes('openclaw')) {
    const openclawHome = deps.openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome);
    if (deps.commandExists('openclaw')) {
      const report = await deps.runOpenclawPluginDoctor(openclawHome, {
        runSystemCommand: deps.runSystemCommand,
        resolveRuntimeHome: deps.resolveRuntimeHome,
        resolveRuntimeStateRoot: deps.resolveRuntimeStateRoot,
        maskEndpoint: deps.maskEndpoint,
      });
      for (const check of report.checks) {
        checks.push({
          ...check,
          runtime: 'openclaw',
        });
      }
    } else {
      checks.push({
        id: 'openclaw_binary',
        runtime: 'openclaw',
        ok: false,
        detail: 'openclaw command not found in PATH',
      });
    }
  }

  if (selected.includes('opencode')) {
    const opencodeHome = deps.opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome);
    const report = await deps.runOpencodePluginDoctor(opencodeHome, {
      resolveRuntimeHome: deps.resolveRuntimeHome,
      resolveOpencodePluginStateRoot: deps.resolveOpencodePluginStateRoot,
      maskEndpoint: deps.maskEndpoint,
      resolveSpanoryEnvPath: deps.resolveSpanoryEnvPath,
    });
    for (const check of report.checks) {
      checks.push({
        ...check,
        runtime: 'opencode',
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}
