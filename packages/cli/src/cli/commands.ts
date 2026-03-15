import path from 'node:path';

import { Command, Option } from 'commander';

function runtimeDisplayName(runtimeName: string) {
  if (runtimeName === 'codex') return 'Codex';
  if (runtimeName === 'openclaw') return 'OpenClaw';
  if (runtimeName === 'opencode') return 'OpenCode';
  return 'Claude Code';
}

function runtimeDescription(runtimeName: string) {
  return `${runtimeDisplayName(runtimeName)} transcript runtime`;
}

function createReportInputJsonOption() {
  return new Option(
    '--input-json <path>',
    'Path to exported JSON file or directory of JSON files (fallback: SPANORY_INPUT_JSON)',
  )
    .env('SPANORY_INPUT_JSON')
    .makeOptionMandatory(true);
}

function registerRuntimeCommands(runtimeRoot: Command, runtimeName: string, deps: Record<string, any>) {
  const runtimeCmd = runtimeRoot.command(runtimeName).description(runtimeDescription(runtimeName));
  const displayName = runtimeDisplayName(runtimeName);
  const hasTranscriptAdapter = Boolean(deps.runtimeAdapters[runtimeName]);

  if (hasTranscriptAdapter) {
    const exportCmd = runtimeCmd.command('export').description(`Export one ${displayName} session as OTLP spans`);

    if (runtimeName !== 'codex') {
      exportCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      exportCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }

    exportCmd
      .requiredOption('--session-id <id>', `${displayName} session id (jsonl filename without extension)`)
      .option(
        '--transcript-path <path>',
        'Override transcript path instead of <runtime-home>/projects/<project>/<session>.jsonl',
      )
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json <path>', 'Write parsed events and OTLP payload to a local JSON file')
      .addHelpText(
        'after',
        '\nExamples:\n' +
          `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234\n` +
          `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234 --endpoint http://localhost:3000/api/public/otel/v1/traces\n`,
      )
      .action(async (options: Record<string, any>) => {
        const adapter = deps.getRuntimeAdapter(runtimeName);
        const context = {
          projectId: options.projectId ?? 'codex',
          sessionId: options.sessionId,
          ...(options.transcriptPath ? { transcriptPath: options.transcriptPath } : {}),
          ...(options.runtimeHome ? { runtimeHome: options.runtimeHome } : {}),
        };
        const events = await adapter.collectEvents(context);
        await deps.emitSession({
          runtimeName: adapter.runtimeName,
          context,
          events,
          endpoint: deps.resolveEndpoint(options.endpoint),
          headers: deps.resolveHeaders(options.headers),
          exportJsonPath: options.exportJson,
        });
      });

    runtimeCmd
      .command('hook')
      .description(`Read ${displayName} hook payload from stdin and export the matched session`)
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n' +
          `  echo "{...}" | spanory runtime ${runtimeName} hook\n` +
          `  cat payload.json | spanory runtime ${runtimeName} hook --export-json-dir ${deps.resolveRuntimeExportDir(runtimeName)}\n`,
      )
      .action(async (options: Record<string, any>) =>
        deps.runHookMode({
          runtimeName,
          runtimeHome: options.runtimeHome,
          endpoint: options.endpoint,
          headers: options.headers,
          lastTurnOnly: options.lastTurnOnly,
          force: options.force,
          exportJsonDir: options.exportJsonDir,
        }),
      );

    const backfillCmd = runtimeCmd
      .command('backfill')
      .description(`Batch export historical ${displayName} sessions for one project`);
    if (runtimeName !== 'codex') {
      backfillCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      backfillCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }
    backfillCmd
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--session-ids <csv>', 'Comma-separated session ids; if set, since/until/limit are ignored')
      .option('--since <iso>', 'Only include sessions with transcript file mtime >= this ISO timestamp')
      .option('--until <iso>', 'Only include sessions with transcript file mtime <= this ISO timestamp')
      .option('--limit <n>', 'Max number of sessions when auto-selecting by mtime', '50')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json-dir <dir>', 'Write one <sessionId>.json file per session into this directory')
      .option('--dry-run', 'Print selected sessions without sending OTLP', false)
      .addHelpText(
        'after',
        '\nExamples:\n' +
          `  spanory runtime ${runtimeName} backfill --project-id my-project --since 2026-02-27T00:00:00Z --limit 20\n` +
          `  spanory runtime ${runtimeName} backfill --project-id my-project --session-ids a,b,c --dry-run\n`,
      )
      .action(async (options: Record<string, any>) => {
        const adapter = deps.getRuntimeAdapter(runtimeName);
        const endpoint = deps.resolveEndpoint(options.endpoint);
        const headers = deps.resolveHeaders(options.headers);

        const candidates = await deps.listCandidateSessions(runtimeName, options.projectId ?? 'codex', options);
        if (!candidates.length) {
          console.log('backfill=empty selected=0');
          return;
        }

        console.log(`backfill=selected count=${candidates.length}`);
        let exportedCount = 0;
        let skippedCount = 0;

        for (const candidate of candidates) {
          const context = {
            projectId: options.projectId ?? 'codex',
            sessionId: candidate.sessionId,
            ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
            ...(options.runtimeHome ? { runtimeHome: options.runtimeHome } : {}),
          };
          if (options.dryRun) {
            console.log(`dry-run sessionId=${candidate.sessionId}`);
            continue;
          }

          try {
            const events = await adapter.collectEvents(context);
            const exportJsonPath = options.exportJsonDir
              ? path.join(options.exportJsonDir, `${candidate.sessionId}.json`)
              : undefined;
            await deps.emitSession({
              runtimeName: adapter.runtimeName,
              context,
              events,
              endpoint,
              headers,
              exportJsonPath,
            });
            exportedCount += 1;
          } catch (error: unknown) {
            skippedCount += 1;
            const message = (error as Error)?.message
              ? String((error as Error).message).replace(/\s+/g, ' ')
              : 'unknown-error';
            console.log(`backfill=error sessionId=${candidate.sessionId} error=${message}`);
          }
        }

        if (!options.dryRun) {
          console.log(`backfill=done selected=${candidates.length} exported=${exportedCount} skipped=${skippedCount}`);
        }
      });
  }

  if (runtimeName === 'codex') {
    runtimeCmd
      .command('watch')
      .description('Poll Codex session transcripts and export newly updated sessions (notify fallback)')
      .option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--poll-ms <n>', `Polling interval in milliseconds (default: ${deps.codexWatchDefaultPollMs})`)
      .option('--settle-ms <n>', `Minimum file age before parsing (default: ${deps.codexWatchDefaultSettleMs})`)
      .option('--include-existing', 'Also process existing sessions on startup', false)
      .option('--once', 'Run one scan cycle and exit', false)
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json-dir <dir>', 'Write one <sessionId>.json file per exported session into this directory')
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n' +
          '  spanory runtime codex watch\n' +
          '  spanory runtime codex watch --include-existing --once --settle-ms 0\n',
      )
      .action(async (options: Record<string, any>) => {
        await deps.runCodexWatch(options);
      });

    runtimeCmd
      .command('proxy')
      .description('Run OpenAI-compatible proxy capture for Codex traffic with full redaction')
      .option('--listen <host:port>', 'Listen address (default: 127.0.0.1:8787)', '127.0.0.1:8787')
      .option('--upstream <url>', 'Upstream OpenAI-compatible base URL')
      .option('--spool-dir <path>', 'Capture spool directory')
      .option('--max-body-bytes <n>', 'Maximum bytes to keep per redacted body', '131072')
      .action(async (options: Record<string, any>) => {
        const { host, port } = deps.parseListenAddress(options.listen);
        if (!Number.isFinite(port) || port <= 0) {
          throw new Error(`invalid --listen port: ${options.listen}`);
        }
        const proxy = deps.createCodexProxyServer({
          upstreamBaseUrl: options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL,
          spoolDir:
            options.spoolDir ??
            process.env.SPANORY_CODEX_PROXY_SPOOL_DIR ??
            path.join(deps.resolveRuntimeStateRoot('codex'), 'spanory', 'proxy-spool'),
          maxBodyBytes: Number(options.maxBodyBytes),
          logger: console,
        });
        await proxy.start({ host, port });
        console.log(
          `proxy=listening url=${proxy.url()} upstream=${options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'}`,
        );
        await new Promise<void>((resolve) => {
          const stop = async () => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            await proxy.stop();
            resolve();
          };
          process.on('SIGINT', stop);
          process.on('SIGTERM', stop);
        });
      });
  }

  if (runtimeName === 'openclaw') {
    const plugin = runtimeCmd.command('plugin').description('Manage Spanory OpenClaw plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenClaw plugin using openclaw plugins install -l')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/openclaw-plugin)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options: Record<string, any>) => {
        const runtimeHome = deps.resolveRuntimeHome('openclaw', options.runtimeHome);
        const result = await deps.installOpenclawPlugin(runtimeHome, false, {
          resolveOpenclawPluginDir: () => options.pluginDir ?? deps.resolveOpenclawPluginDir(),
          runSystemCommand: deps.runSystemCommand,
          backupIfExists: deps.backupIfExists,
        });
        if (result.installStdout) console.log(result.installStdout);
        if (result.enableStdout) console.log(result.enableStdout);
      });

    plugin
      .command('enable')
      .description('Enable Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options: Record<string, any>) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'enable', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome
              ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) }
              : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins enable failed');
        }
      });

    plugin
      .command('disable')
      .description('Disable Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options: Record<string, any>) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'disable', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome
              ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) }
              : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins disable failed');
        }
      });

    plugin
      .command('uninstall')
      .description('Uninstall Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options: Record<string, any>) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'uninstall', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome
              ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) }
              : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins uninstall failed');
        }
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options: Record<string, any>) => {
        const report = await deps.runOpenclawPluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }

  if (runtimeName === 'opencode') {
    const plugin = runtimeCmd.command('plugin').description('Manage Spanory OpenCode plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenCode plugin loader into ~/.config/opencode/plugin')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/opencode-plugin)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options: Record<string, any>) => {
        const result = await deps.installOpencodePlugin(options.runtimeHome, options.pluginDir);
        console.log(`installed=${result.loaderFile}`);
      });

    plugin
      .command('uninstall')
      .description('Remove Spanory OpenCode plugin loader')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options: Record<string, any>) => {
        const result = await deps.uninstallOpencodePlugin(options.runtimeHome);
        const loaderFile = result.loaderFile ?? deps.opencodePluginLoaderPath(options.runtimeHome);
        console.log(`removed=${loaderFile}`);
        if (result.unregistered) {
          console.log(`unregistered=${deps.opencodePluginId}`);
        }
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenCode plugin')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options: Record<string, any>) => {
        const report = await deps.runOpencodePluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }
}

export function createProgram(deps: Record<string, any>) {
  const program = new Command();
  program
    .name('spanory')
    .description('Cross-runtime observability CLI for agent sessions')
    .showHelpAfterError()
    .showSuggestionAfterError(true)
    .version(deps.cliVersion, '-V, --version');

  const runtime = program.command('runtime').description('Runtime-specific parsers and exporters');
  for (const runtimeName of ['claude-code', 'codex', 'openclaw', 'opencode']) {
    registerRuntimeCommands(runtime, runtimeName, deps);
  }

  const report = program.command('report').description('Aggregate exported session JSON into infra-level views');

  report
    .command('session')
    .description('Session-level summary view')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'session-summary', rows: deps.summarizeSessions(sessions) }, null, 2));
    });

  report
    .command('mcp')
    .description('MCP server aggregation view')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'mcp-summary', rows: deps.summarizeMcp(sessions) }, null, 2));
    });

  report
    .command('command')
    .description('Agent command aggregation view')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'command-summary', rows: deps.summarizeCommands(sessions) }, null, 2));
    });

  report
    .command('agent')
    .description('Agent activity summary per session')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'agent-summary', rows: deps.summarizeAgents(sessions) }, null, 2));
    });

  report
    .command('cache')
    .description('Cache usage summary per session')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'cache-summary', rows: deps.summarizeCache(sessions) }, null, 2));
    });

  report
    .command('tool')
    .description('Tool usage aggregation view')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'tool-summary', rows: deps.summarizeTools(sessions) }, null, 2));
    });

  report
    .command('context')
    .description('Context observability summary per session')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'context-summary', rows: deps.summarizeContext(sessions) }, null, 2));
    });

  report
    .command('turn-diff')
    .description('Turn input diff summary view')
    .addOption(createReportInputJsonOption())
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'turn-diff-summary', rows: deps.summarizeTurnDiff(sessions) }, null, 2));
    });

  const alert = program.command('alert').description('Evaluate alert rules against exported telemetry data');

  alert
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .requiredOption('--rules <path>', 'Path to alert rules JSON file')
    .option('--webhook-url <url>', 'Optional webhook URL to post alert payload')
    .option('--webhook-headers <kv>', 'Webhook headers, comma-separated k=v')
    .option('--fail-on-alert', 'Exit with non-zero code when alert count > 0', false)
    .addHelpText(
      'after',
      '\nRule file format:\n' +
        '  {\n' +
        '    "rules": [\n' +
        '      {"id":"high-token","scope":"session","metric":"usage.total","op":"gt","threshold":10000}\n' +
        '    ]\n' +
        '  }\n',
    )
    .action(async (options: Record<string, any>) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      const rules = await deps.loadAlertRules(options.rules);
      const alerts = deps.evaluateRules(rules, sessions);

      const result = {
        evaluatedAt: new Date().toISOString(),
        sessions: sessions.length,
        rules: rules.length,
        alerts,
      };
      console.log(JSON.stringify(result, null, 2));

      if (options.webhookUrl) {
        await deps.sendAlertWebhook(options.webhookUrl, result, deps.parseHeaders(options.webhookHeaders));
        console.error(`webhook=sent url=${options.webhookUrl}`);
      }

      if (options.failOnAlert && alerts.length > 0) {
        process.exitCode = 2;
      }
    });

  program
    .command('hook')
    .description('Minimal hook entrypoint (defaults to runtime payload + ~/.spanory/.env + default export dir)')
    .option('--runtime <name>', 'Runtime name (default: SPANORY_HOOK_RUNTIME or claude-code)')
    .option('--runtime-home <path>', 'Override runtime home directory')
    .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
    .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
    .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
    .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
    .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
    .addHelpText(
      'after',
      '\nMinimal usage in SessionEnd hook command:\n' + '  spanory hook\n' + '  spanory hook --runtime openclaw\n',
    )
    .action(async (options: Record<string, any>) => {
      const runtimeName = options.runtime ?? process.env.SPANORY_HOOK_RUNTIME ?? 'claude-code';
      await deps.runHookMode({
        runtimeName,
        runtimeHome: options.runtimeHome,
        endpoint: options.endpoint,
        headers: options.headers,
        lastTurnOnly: options.lastTurnOnly,
        force: options.force,
        exportJsonDir:
          options.exportJsonDir ??
          process.env.SPANORY_HOOK_EXPORT_JSON_DIR ??
          deps.resolveRuntimeExportDir(runtimeName, options.runtimeHome),
      });
    });

  program
    .command('install')
    .description('Install Spanory integration for local runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--spanory-bin <path>', 'Spanory binary/command to write into runtime configs', 'spanory')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--openclaw-plugin-dir <path>', 'Override OpenClaw plugin directory (default: packages/openclaw-plugin)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .option('--opencode-plugin-dir <path>', 'Override OpenCode plugin directory (default: packages/opencode-plugin)')
    .option('--dry-run', 'Only print planned changes without writing files', false)
    .action(async (options: Record<string, any>) => {
      const report = await deps.runSetupApply(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  program
    .command('uninstall')
    .description('Remove Spanory integration from local runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .option('--dry-run', 'Only print planned changes without writing files', false)
    .action(async (options: Record<string, any>) => {
      const report = await deps.runSetupTeardown(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  program
    .command('doctor')
    .description('Run Spanory integration diagnostics for local runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .action(async (options: Record<string, any>) => {
      const report = await deps.runSetupDoctor(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  program
    .command('status')
    .description('Detect local runtime availability and Spanory integration status')
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home for reporting')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home for reporting')
    .action(async (options: Record<string, any>) => {
      const report = await deps.runSetupDetect(options);
      console.log(JSON.stringify(report, null, 2));
    });

  program
    .command('upgrade')
    .description('Upgrade spanory CLI from npm registry')
    .option('--dry-run', 'Print upgrade command without executing', false)
    .option('--manager <name>', 'Package manager override: npm|tnpm')
    .option('--scope <scope>', 'Install scope override: global|local')
    .action(async (options: Record<string, any>) => {
      const manager = options.manager === 'tnpm' ? 'tnpm' : deps.detectUpgradePackageManager();
      const scope =
        options.scope === 'local' ? 'local' : options.scope === 'global' ? 'global' : deps.detectUpgradeScope();
      const invocation = deps.resolveUpgradeInvocation(scope, manager);

      if (options.dryRun) {
        console.log(JSON.stringify({ dryRun: true, ...invocation }, null, 2));
        return;
      }

      const result = deps.runSystemCommand(invocation.command, invocation.args, { env: process.env });
      const output = (result.stdout || result.stderr || '').trim();
      if (result.code !== 0) {
        console.error(output || result.error || 'upgrade failed');
        process.exitCode = 2;
        return;
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            ...invocation,
            output,
          },
          null,
          2,
        ),
      );
    });

  return program;
}
