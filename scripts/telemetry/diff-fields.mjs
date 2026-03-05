import path from 'node:path';

import {
  DEFAULT_TELEMETRY_DIR,
  computeDiffReport,
  ensureReportsDir,
  parseArgs,
  readJsonYaml,
  writeJsonYaml,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const telemetryDir = args['telemetry-dir'] ?? DEFAULT_TELEMETRY_DIR;
const currentPath = args.current ?? path.join(telemetryDir, 'spanory-fields.current.yaml');
const specPath = args.spec ?? path.join(telemetryDir, 'field-spec.yaml');
const lockPath = args.lock ?? path.join(telemetryDir, 'otel-semconv.lock.yaml');
const platformPath = args.platform ?? path.join(telemetryDir, 'platform-profiles.yaml');
const reportsDir = await ensureReportsDir(telemetryDir);
const outputPath = args.output ?? path.join(reportsDir, 'field-diff.json');

const [current, spec, otelLock, platformProfiles] = await Promise.all([
  readJsonYaml(currentPath),
  readJsonYaml(specPath),
  readJsonYaml(lockPath),
  readJsonYaml(platformPath),
]);

const report = computeDiffReport({ current, spec, otelLock, platformProfiles });
await writeJsonYaml(outputPath, report);
console.log(JSON.stringify({ ok: true, output: outputPath, summary: report.summary }, null, 2));
