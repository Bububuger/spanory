import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  DEFAULT_TELEMETRY_DIR,
  computeDiffReport,
  ensureReportsDir,
  extractSpanoryFields,
  readJsonYaml,
  renderMarkdownReport,
  validateTelemetry,
  writeJsonYaml,
} from './lib.mjs';

const telemetryDir = process.argv[2] || DEFAULT_TELEMETRY_DIR;
const reportsDir = await ensureReportsDir(telemetryDir);

const sourceFiles = [
  'packages/cli/src/runtime/shared/normalize.ts',
  'packages/cli/src/runtime/codex/adapter.ts',
  'packages/otlp-core/src/index.ts',
  'packages/backend-langfuse/src/index.ts',
  'packages/opencode-plugin/src/index.ts',
];

const fields = await extractSpanoryFields(sourceFiles);
const current = {
  spec_version: '1.0.0',
  generated_at: new Date().toISOString(),
  source_files: sourceFiles,
  total_fields: fields.length,
  fields,
};

const currentPath = path.join(telemetryDir, 'spanory-fields.current.yaml');
await writeJsonYaml(currentPath, current);

const [spec, runtimeMapping, platformProfiles, otelLock] = await Promise.all([
  readJsonYaml(path.join(telemetryDir, 'field-spec.yaml')),
  readJsonYaml(path.join(telemetryDir, 'runtime-mapping.yaml')),
  readJsonYaml(path.join(telemetryDir, 'platform-profiles.yaml')),
  readJsonYaml(path.join(telemetryDir, 'otel-semconv.lock.yaml')),
]);

const diff = computeDiffReport({ current, spec, otelLock, platformProfiles });
const validate = validateTelemetry({ current, spec, runtimeMapping, platformProfiles, otelLock });

const diffPath = path.join(reportsDir, 'field-diff.json');
const validatePath = path.join(reportsDir, 'validate.json');
const markdownPath = path.join(reportsDir, 'telemetry-field-report.md');
const reportPath = path.join(reportsDir, 'telemetry-field-report.json');

await Promise.all([
  writeJsonYaml(diffPath, diff),
  writeJsonYaml(validatePath, validate),
  writeJsonYaml(reportPath, {
    generated_at: new Date().toISOString(),
    pass: validate.pass,
    diff_summary: diff.summary,
    validate_summary: validate.summary,
  }),
  writeFile(markdownPath, renderMarkdownReport({ diff, validate }), 'utf-8'),
]);

const output = {
  ok: validate.pass,
  current: currentPath,
  reports: {
    diff: diffPath,
    validate: validatePath,
    report: reportPath,
    markdown: markdownPath,
  },
  summary: {
    fields: current.total_fields,
    added: diff.summary.added,
    removed: diff.summary.removed,
    deprecated: diff.summary.deprecated,
    validationErrors: validate.summary.errors,
    validationWarnings: validate.summary.warnings,
  },
};

console.log(JSON.stringify(output, null, 2));
if (!validate.pass) process.exit(1);
