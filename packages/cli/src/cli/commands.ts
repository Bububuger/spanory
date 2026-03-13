// @ts-nocheck
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';

import { Command } from 'commander';

function runtimeDisplayName(runtimeName) {
  if (runtimeName === 'codex') return 'Codex';
  if (runtimeName === 'openclaw') return 'OpenClaw';
  if (runtimeName === 'opencode') return 'OpenCode';
  return 'Claude Code';
}

function runtimeDescription(runtimeName) {
  return `${runtimeDisplayName(runtimeName)} transcript runtime`;
}

function registerRuntimeCommands(runtimeRoot, runtimeName, deps) {
  const runtimeCmd = runtimeRoot.command(runtimeName).description(runtimeDescription(runtimeName));
  const displayName = runtimeDisplayName(runtimeName);
  const hasTranscriptAdapter = Boolean(deps.runtimeAdapters[runtimeName]);

  if (hasTranscriptAdapter) {
    const exportCmd = runtimeCmd
      .command('export')
      .description(`Export one ${displayName} session as OTLP spans`);

    if (runtimeName !== 'codex') {
      exportCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      exportCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }

    exportCmd
      .requiredOption('--session-id <id>', `${displayName} session id (jsonl filename without extension)`)
      .option('--transcript-path <path>', 'Override transcript path instead of <runtime-home>/projects/<project>/<session>.jsonl')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json <path>', 'Write parsed events and OTLP payload to a local JSON file')
      .addHelpText(
        'after',
        '\nExamples:\n'
          + `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234\n`
          + `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234 --endpoint http://localhost:3000/api/public/otel/v1/traces\n`,
      )
      .action(async (options) => {
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
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', false)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n'
          + `  echo "{...}" | spanory runtime ${runtimeName} hook\n`
          + `  cat payload.json | spanory runtime ${runtimeName} hook --export-json-dir ${deps.resolveRuntimeExportDir(runtimeName)}\n`,
      )
      .action(async (options) => deps.runHookMode({
        runtimeName,
        runtimeHome: options.runtimeHome,
        endpoint: options.endpoint,
        headers: options.headers,
        lastTurnOnly: options.lastTurnOnly,
        force: options.force,
        exportJsonDir: options.exportJsonDir,
      }));

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
        '\nExamples:\n'
          + `  spanory runtime ${runtimeName} backfill --project-id my-project --since 2026-02-27T00:00:00Z --limit 20\n`
          + `  spanory runtime ${runtimeName} backfill --project-id my-project --session-ids a,b,c --dry-run\n`,
      )
      .action(async (options) => {
        const adapter = deps.getRuntimeAdapter(runtimeName);
        const endpoint = deps.resolveEndpoint(options.endpoint);
        const headers = deps.resolveHeaders(options.headers);

        const candidates = await deps.listCandidateSessions(runtimeName, options.projectId ?? 'codex', options);
        if (!candidates.length) {
          console.log('backfill=empty selected=0');
          return;
        }

        console.log(`backfill=selected count=${candidates.length}`);

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

          const events = await adapter.collectEvents(context);
          const exportJsonPath = options.exportJsonDir ? path.join(options.exportJsonDir, `${candidate.sessionId}.json`) : undefined;

          await deps.emitSession({
            runtimeName: adapter.runtimeName,
            context,
            events,
            endpoint,
            headers,
            exportJsonPath,
          });
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
        '\nExamples:\n'
          + '  spanory runtime codex watch\n'
          + '  spanory runtime codex watch --include-existing --once --settle-ms 0\n',
      )
      .action(async (options) => {
        await deps.runCodexWatch(options);
      });

    runtimeCmd
      .command('proxy')
      .description('Run OpenAI-compatible proxy capture for Codex traffic with full redaction')
      .option('--listen <host:port>', 'Listen address (default: 127.0.0.1:8787)', '127.0.0.1:8787')
      .option('--upstream <url>', 'Upstream OpenAI-compatible base URL')
      .option('--spool-dir <path>', 'Capture spool directory')
      .option('--max-body-bytes <n>', 'Maximum bytes to keep per redacted body', '131072')
      .action(async (options) => {
        const { host, port } = deps.parseListenAddress(options.listen);
        if (!Number.isFinite(port) || port <= 0) {
          throw new Error(`invalid --listen port: ${options.listen}`);
        }
        const proxy = deps.createCodexProxyServer({
          upstreamBaseUrl: options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL,
          spoolDir: options.spoolDir
            ?? process.env.SPANORY_CODEX_PROXY_SPOOL_DIR
            ?? path.join(deps.resolveRuntimeStateRoot('codex'), 'spanory', 'proxy-spool'),
          maxBodyBytes: Number(options.maxBodyBytes),
          logger: console,
        });
        await proxy.start({ host, port });
        console.log(`proxy=listening url=${proxy.url()} upstream=${options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'}`);
        await new Promise((resolve) => {
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
    const plugin = runtimeCmd
      .command('plugin')
      .description('Manage Spanory OpenClaw plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenClaw plugin using openclaw plugins install -l')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/openclaw-plugin)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const pluginDir = path.resolve(options.pluginDir ?? deps.resolveOpenclawPluginDir());
        const result = deps.runSystemCommand('openclaw', ['plugins', 'install', '-l', pluginDir], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins install failed');
        }
      });

    plugin
      .command('enable')
      .description('Enable Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'enable', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
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
      .action((options) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'disable', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
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
      .action((options) => {
        const result = deps.runSystemCommand('openclaw', ['plugins', 'uninstall', deps.openclawPluginId], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: deps.resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
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
      .action(async (options) => {
        const report = await deps.runOpenclawPluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }

  if (runtimeName === 'opencode') {
    const plugin = runtimeCmd
      .command('plugin')
      .description('Manage Spanory OpenCode plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenCode plugin loader into ~/.config/opencode/plugin')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/opencode-plugin)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const result = await deps.installOpencodePlugin(options.runtimeHome, options.pluginDir);
        console.log(`installed=${result.loaderFile}`);
      });

    plugin
      .command('uninstall')
      .description('Remove Spanory OpenCode plugin loader')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const loaderFile = deps.opencodePluginLoaderPath(options.runtimeHome);
        await rm(loaderFile, { force: true });
        console.log(`removed=${loaderFile}`);
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenCode plugin')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const report = await deps.runOpencodePluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }
}

export function createProgram(deps) {
  const program = new Command();
  program
    .name('spanory')
    .description('Cross-runtime observability CLI for agent sessions')
    .showHelpAfterError()
    .showSuggestionAfterError(true)
    .version(deps.cliVersion, '-v, --version');

  const runtime = program.command('runtime').description('Runtime-specific parsers and exporters');
  for (const runtimeName of ['claude-code', 'codex', 'openclaw', 'opencode']) {
    registerRuntimeCommands(runtime, runtimeName, deps);
  }

  const report = program.command('report').description('Aggregate exported session JSON into infra-level views');

  report
    .command('session')
    .description('Session-level summary view')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'session-summary', rows: deps.summarizeSessions(sessions) }, null, 2));
    });

  report
    .command('mcp')
    .description('MCP server aggregation view')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'mcp-summary', rows: deps.summarizeMcp(sessions) }, null, 2));
    });

  report
    .command('command')
    .description('Agent command aggregation view')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'command-summary', rows: deps.summarizeCommands(sessions) }, null, 2));
    });

  report
    .command('agent')
    .description('Agent activity summary per session')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'agent-summary', rows: deps.summarizeAgents(sessions) }, null, 2));
    });

  report
    .command('cache')
    .description('Cache usage summary per session')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'cache-summary', rows: deps.summarizeCache(sessions) }, null, 2));
    });

  report
    .command('tool')
    .description('Tool usage aggregation view')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'tool-summary', rows: deps.summarizeTools(sessions) }, null, 2));
    });

  report
    .command('context')
    .description('Context observability summary per session')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'context-summary', rows: deps.summarizeContext(sessions) }, null, 2));
    });

  report
    .command('turn-diff')
    .description('Turn input diff summary view')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .action(async (options) => {
      const sessions = await deps.loadExportedEvents(options.inputJson);
      console.log(JSON.stringify({ view: 'turn-diff-summary', rows: deps.summarizeTurnDiff(sessions) }, null, 2));
    });

  const alert = program.command('alert').description('Evaluate alert rules against exported telemetry data');

  alert
    .command('eval')
    .description('Run threshold rules and emit alert events')
    .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
    .requiredOption('--rules <path>', 'Path to alert rules JSON file')
    .option('--webhook-url <url>', 'Optional webhook URL to post alert payload')
    .option('--webhook-headers <kv>', 'Webhook headers, comma-separated k=v')
    .option('--fail-on-alert', 'Exit with non-zero code when alert count > 0', false)
    .addHelpText(
      'after',
      '\nRule file format:\n'
        + '  {\n'
        + '    "rules": [\n'
        + '      {"id":"high-token","scope":"session","metric":"usage.total","op":"gt","threshold":10000}\n'
        + '    ]\n'
        + '  }\n',
    )
    .action(async (options) => {
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
        console.log(`webhook=sent url=${options.webhookUrl}`);
      }

      if (options.failOnAlert && alerts.length > 0) {
        process.exitCode = 2;
      }
    });

  const issue = program.command('issue').description('Manage local issue status for automation巡检');

  issue
    .command('sync')
    .description('Sync pending items from todo.md into issue state file')
    .option('--todo-file <path>', 'Path to todo markdown file (default: ./todo.md)')
    .option('--state-file <path>', 'Path to issue state json file (default: ./docs/issues/state.json)')
    .action(async (options) => {
      const todoFile = deps.resolveTodoPath(options.todoFile);
      const stateFile = deps.resolveIssueStatePath(options.stateFile);
      const todoRaw = await readFile(todoFile, 'utf-8');
      const pending = deps.parsePendingTodoItems(todoRaw, 'todo.md');
      const prev = await deps.loadIssueState(stateFile);
      const result = deps.syncIssueState(prev, pending);
      await deps.saveIssueState(stateFile, result.state);
      console.log(JSON.stringify({
        stateFile,
        todoFile,
        pending: pending.length,
        added: result.added,
        reopened: result.reopened,
        autoClosed: result.autoClosed,
        total: result.state.issues.length,
      }, null, 2));
    });

  issue
    .command('list')
    .description('List issues from state file')
    .option('--state-file <path>', 'Path to issue state json file (default: ./docs/issues/state.json)')
    .option('--status <status>', 'Filter by status: open,in_progress,blocked,done')
    .action(async (options) => {
      const stateFile = deps.resolveIssueStatePath(options.stateFile);
      const state = await deps.loadIssueState(stateFile);
      const statusFilter = options.status ? String(options.status).trim() : '';
      const rows = statusFilter
        ? state.issues.filter((item) => item.status === statusFilter)
        : state.issues;
      console.log(JSON.stringify({ stateFile, total: rows.length, issues: rows }, null, 2));
    });

  issue
    .command('set-status')
    .description('Update one issue status in state file')
    .requiredOption('--id <id>', 'Issue id, e.g. T2')
    .requiredOption('--status <status>', 'Target status: open|in_progress|blocked|done')
    .option('--note <text>', 'Optional status note')
    .option('--state-file <path>', 'Path to issue state json file (default: ./docs/issues/state.json)')
    .action(async (options) => {
      const stateFile = deps.resolveIssueStatePath(options.stateFile);
      const prev = await deps.loadIssueState(stateFile);
      const next = deps.setIssueStatus(prev, {
        id: options.id,
        status: options.status,
        note: options.note,
      });
      await deps.saveIssueState(stateFile, next);
      const issueItem = next.issues.find((item) => item.id === options.id);
      console.log(JSON.stringify({ stateFile, issue: issueItem }, null, 2));
    });

  program
    .command('hook')
    .description('Minimal hook entrypoint (defaults to runtime payload + ~/.spanory/.env + default export dir)')
    .option('--runtime <name>', 'Runtime name (default: SPANORY_HOOK_RUNTIME or claude-code)')
    .option('--runtime-home <path>', 'Override runtime home directory')
    .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
    .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
    .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
    .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', false)
    .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
    .addHelpText(
      'after',
      '\nMinimal usage in SessionEnd hook command:\n'
        + '  spanory hook\n'
        + '  spanory hook --runtime openclaw\n',
    )
    .action(async (options) => {
      const runtimeName = options.runtime ?? process.env.SPANORY_HOOK_RUNTIME ?? 'claude-code';
      await deps.runHookMode({
        runtimeName,
        runtimeHome: options.runtimeHome,
        endpoint: options.endpoint,
        headers: options.headers,
        lastTurnOnly: options.lastTurnOnly,
        force: options.force,
        exportJsonDir:
          options.exportJsonDir
          ?? process.env.SPANORY_HOOK_EXPORT_JSON_DIR
          ?? deps.resolveRuntimeExportDir(runtimeName, options.runtimeHome),
      });
    });

  const setup = program.command('setup').description('One-command local runtime integration setup and diagnostics');

  setup
    .command('detect')
    .description('Detect local runtime availability and setup status')
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home for reporting')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home for reporting')
    .action(async (options) => {
      const report = await deps.runSetupDetect(options);
      console.log(JSON.stringify(report, null, 2));
    });

  setup
    .command('apply')
    .description('Apply idempotent local setup for selected runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--spanory-bin <path>', 'Spanory binary/command to write into runtime configs', 'spanory')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .option('--dry-run', 'Only print planned changes without writing files', false)
    .action(async (options) => {
      const report = await deps.runSetupApply(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  setup
    .command('doctor')
    .description('Run setup diagnostics for selected runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .action(async (options) => {
      const report = await deps.runSetupDoctor(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  setup
    .command('teardown')
    .description('Remove all Spanory integration from local runtimes')
    .option(
      '--runtimes <csv>',
      `Comma-separated runtimes (default: ${deps.defaultSetupRuntimes.join(',')})`,
      deps.defaultSetupRuntimes.join(','),
    )
    .option('--home <path>', 'Home directory root override (default: $HOME)')
    .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
    .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
    .option('--dry-run', 'Only print planned changes without writing files', false)
    .action(async (options) => {
      const report = await deps.runSetupTeardown(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
    });

  program
    .command('upgrade')
    .description('Upgrade spanory CLI from npm registry')
    .option('--dry-run', 'Print upgrade command without executing', false)
    .option('--manager <name>', 'Package manager override: npm|tnpm')
    .option('--scope <scope>', 'Install scope override: global|local')
    .action(async (options) => {
      const manager = options.manager === 'tnpm' ? 'tnpm' : deps.detectUpgradePackageManager();
      const scope = options.scope === 'local' ? 'local' : options.scope === 'global' ? 'global' : deps.detectUpgradeScope();
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

      console.log(JSON.stringify({
        ok: true,
        ...invocation,
        output,
      }, null, 2));
    });

  return program;
}
