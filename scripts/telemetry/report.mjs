import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  DEFAULT_TELEMETRY_DIR,
  ensureReportsDir,
  parseArgs,
  readJsonYaml,
  renderMarkdownReport,
  writeJsonYaml,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const telemetryDir = args['telemetry-dir'] ?? DEFAULT_TELEMETRY_DIR;
const reportsDir = await ensureReportsDir(telemetryDir);
const diffPath = args.diff ?? path.join(reportsDir, 'field-diff.json');
const validatePath = args.validate ?? path.join(reportsDir, 'validate.json');
const markdownPath = args.markdown ?? path.join(reportsDir, 'telemetry-field-report.md');
const jsonPath = args.output ?? path.join(reportsDir, 'telemetry-field-report.json');

const [diff, validate] = await Promise.all([readJsonYaml(diffPath), readJsonYaml(validatePath)]);

const markdown = renderMarkdownReport({ diff, validate });
const json = {
  generated_at: new Date().toISOString(),
  pass: validate.pass,
  diff_summary: diff.summary,
  validate_summary: validate.summary,
  report_files: {
    diff: diffPath,
    validate: validatePath,
    markdown: markdownPath,
  },
};

await Promise.all([
  writeFile(markdownPath, markdown, 'utf-8'),
  writeJsonYaml(jsonPath, json),
]);

console.log(JSON.stringify({ ok: true, markdown: markdownPath, json: jsonPath, pass: validate.pass }, null, 2));
