import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_TELEMETRY_DIR = 'telemetry';
export const DEFAULT_RUNTIMES = ['claude-code', 'codex', 'openclaw', 'opencode'];

const ALLOWED_PREFIXES = new Set([
  'agentic',
  'deployment',
  'gen_ai',
  'input',
  'langfuse',
  'mcp',
  'output',
  'process',
  'service',
  'session',
]);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

export async function readJsonYaml(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON-compatible YAML: ${filePath} (${error.message})`);
  }
}

export async function writeJsonYaml(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

function isTelemetryKey(key) {
  const prefix = String(key).split('.')[0];
  if (!ALLOWED_PREFIXES.has(prefix)) return false;
  if (prefix === 'session') return key === 'session.id';
  if (prefix === 'service') return key === 'service.name' || key === 'service.version';
  if (prefix === 'deployment') return key === 'deployment.environment' || key === 'deployment.environment.name';
  if (prefix === 'input') return key === 'input.value';
  if (prefix === 'output') return key === 'output.value';
  if (prefix === 'process') return key === 'process.command_line';
  return key.includes('.');
}

function extractKeysFromText(text) {
  const keys = new Set();
  const patterns = [
    /['"]([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)['"]\s*:/g,
    /\[['"]([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)['"]\]/g,
    /key\s*:\s*['"]([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1];
      if (isTelemetryKey(key)) keys.add(key);
    }
  }
  return keys;
}

export async function extractSpanoryFields(sourceFiles) {
  const fields = new Set();
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf-8');
    for (const key of extractKeysFromText(text)) fields.add(key);
  }
  return [...fields].sort();
}

export function officialCoverage(field, officialSet, platformPrivateSet) {
  if (officialSet.has(field)) return 'official_semconv';
  if (platformPrivateSet.has(field)) return 'platform_private';
  if (field.startsWith('agentic.')) return 'custom_agentic';
  return 'custom_other';
}

export function toSet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

export function computeDiffReport({ current, spec, otelLock, platformProfiles }) {
  const currentSet = toSet(current.fields);
  const specSet = new Set((spec.fields ?? []).map((item) => item.field));
  const officialSet = toSet(otelLock.official_fields);
  const deprecated = Array.isArray(spec.deprecated_fields) ? spec.deprecated_fields : [];

  const langfuseProfile = platformProfiles.platforms?.langfuse ?? {};
  const platformPrivateSet = new Set([
    ...(langfuseProfile.required_private_fields ?? []),
    ...((langfuseProfile.projection_rules ?? []).map((rule) => rule.field).filter(Boolean)),
  ]);

  const added = [...currentSet].filter((field) => !specSet.has(field)).sort();
  const removed = [...specSet].filter((field) => !currentSet.has(field)).sort();

  const deprecatedInUse = deprecated
    .filter((item) => item?.policy === 'forbidden' && currentSet.has(item.field))
    .map((item) => ({
      field: item.field,
      replacement: item.replacement,
      policy: item.policy,
      reason: item.reason ?? '',
    }));

  const renamed = deprecated
    .filter((item) => currentSet.has(item.replacement) && removed.includes(item.field))
    .map((item) => ({ from: item.field, to: item.replacement }));

  const typeChanged = [];
  const stabilityChanged = (spec.fields ?? [])
    .filter((item) => item.stability === 'official' && !officialSet.has(item.field))
    .map((item) => ({
      field: item.field,
      declared_stability: item.stability,
      official_status: 'missing_in_lock',
    }));

  const coverage = [...currentSet]
    .sort()
    .map((field) => ({
      field,
      classification: officialCoverage(field, officialSet, platformPrivateSet),
      in_spec: specSet.has(field),
    }));

  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      current_total: currentSet.size,
      spec_total: specSet.size,
      official_total: officialSet.size,
      added: added.length,
      removed: removed.length,
      renamed: renamed.length,
      deprecated: deprecatedInUse.length,
      type_changed: typeChanged.length,
      stability_changed: stabilityChanged.length,
    },
    changes: {
      added,
      removed,
      renamed,
      deprecated: deprecatedInUse,
      type_changed: typeChanged,
      stability_changed: stabilityChanged,
    },
    coverage,
  };

  report.sha256 = sha256Json(report);
  return report;
}

export function validateTelemetry({ current, spec, runtimeMapping, platformProfiles, otelLock, requiredRuntimes = DEFAULT_RUNTIMES }) {
  const errors = [];
  const warnings = [];
  const currentSet = toSet(current.fields);
  const specFields = Array.isArray(spec.fields) ? spec.fields : [];
  const specMap = new Map(specFields.map((item) => [item.field, item]));

  for (const field of currentSet) {
    if (!specMap.has(field)) {
      errors.push(`missing field spec: ${field}`);
    }
  }

  const requiredProps = Array.isArray(spec.required_field_properties) ? spec.required_field_properties : [];
  for (const item of specFields) {
    for (const key of requiredProps) {
      if (!(key in item)) {
        errors.push(`field ${item.field} missing required property: ${key}`);
      }
    }
    const runtimeSupport = Array.isArray(item.runtime_support) ? item.runtime_support : [];
    if (!runtimeSupport.length) {
      errors.push(`field ${item.field} has empty runtime_support`);
      continue;
    }
    for (const runtime of runtimeSupport) {
      if (!requiredRuntimes.includes(runtime)) {
        errors.push(`field ${item.field} has unknown runtime_support value: ${runtime}`);
      }
    }
  }

  const runtimes = runtimeMapping.runtimes ?? {};
  for (const runtime of requiredRuntimes) {
    if (!runtimes[runtime]) {
      errors.push(`runtime-mapping missing runtime: ${runtime}`);
    }
  }

  for (const [runtime, config] of Object.entries(runtimes)) {
    const overrides = Array.isArray(config.field_overrides) ? config.field_overrides : [];
    for (const override of overrides) {
      if (!specMap.has(override.field)) {
        errors.push(`runtime ${runtime} override references unknown field: ${override.field}`);
      }
    }
  }

  const deprecated = Array.isArray(spec.deprecated_fields) ? spec.deprecated_fields : [];
  for (const item of deprecated) {
    if (item.policy === 'forbidden' && currentSet.has(item.field)) {
      errors.push(`deprecated forbidden field in use: ${item.field} (replacement: ${item.replacement})`);
    }
  }

  const langfuseProfile = platformProfiles.platforms?.langfuse;
  if (!langfuseProfile) {
    errors.push('platform-profiles missing langfuse profile');
  } else {
    const knownPrivate = new Set([
      ...(langfuseProfile.required_private_fields ?? []),
      ...((langfuseProfile.projection_rules ?? []).map((rule) => rule.field).filter(Boolean)),
    ]);

    const currentPrivate = [...currentSet].filter(
      (field) => field.startsWith('langfuse.') || field === 'input.value' || field === 'output.value',
    );

    for (const field of currentPrivate) {
      if (!knownPrivate.has(field)) {
        errors.push(`platform profile missing private field mapping: ${field}`);
      }
    }
  }

  const officialSet = toSet(otelLock.official_fields);
  for (const item of specFields) {
    if (item.stability === 'official' && !officialSet.has(item.field)) {
      warnings.push(`official field not found in otel lock: ${item.field}`);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    pass: errors.length === 0,
    errors,
    warnings,
    summary: {
      current_total: currentSet.size,
      spec_total: specFields.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function renderMarkdownReport({ diff, validate }) {
  const lines = [];
  lines.push('# Telemetry Field Report');
  lines.push('');
  lines.push(`- Generated: ${diff.generated_at}`);
  lines.push(`- Validation: ${validate.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- Current fields: ${diff.summary.current_total}`);
  lines.push(`- Spec fields: ${diff.summary.spec_total}`);
  lines.push(`- OTel lock fields: ${diff.summary.official_total}`);
  lines.push('');

  lines.push('## Changes');
  lines.push(`- added: ${diff.summary.added}`);
  lines.push(`- removed: ${diff.summary.removed}`);
  lines.push(`- renamed: ${diff.summary.renamed}`);
  lines.push(`- deprecated: ${diff.summary.deprecated}`);
  lines.push(`- type_changed: ${diff.summary.type_changed}`);
  lines.push(`- stability_changed: ${diff.summary.stability_changed}`);
  lines.push('');

  const emitList = (title, values) => {
    lines.push(`### ${title}`);
    if (!values.length) {
      lines.push('- (none)');
    } else {
      for (const value of values) lines.push(`- ${value}`);
    }
    lines.push('');
  };

  emitList('Added Fields', diff.changes.added);
  emitList('Removed Fields', diff.changes.removed);
  emitList('Renamed Fields', diff.changes.renamed.map((item) => `${item.from} -> ${item.to}`));
  emitList(
    'Deprecated Fields In Use',
    diff.changes.deprecated.map((item) => `${item.field} -> ${item.replacement} (${item.reason || 'no reason'})`),
  );
  emitList('Validation Errors', validate.errors);
  emitList('Validation Warnings', validate.warnings);

  return `${lines.join('\n')}\n`;
}

export async function ensureReportsDir(telemetryDir) {
  const reportsDir = path.join(telemetryDir, 'reports');
  await mkdir(reportsDir, { recursive: true });
  return reportsDir;
}

export async function fetchSemconvTree({ ref = 'main' } = {}) {
  const endpoint = `https://api.github.com/repos/open-telemetry/semantic-conventions/git/trees/${ref}?recursive=1`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'spanory-telemetry-sync',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch semantic-conventions tree: ${response.status}`);
  }
  const json = await response.json();
  return Array.isArray(json.tree) ? json.tree : [];
}

function normalizeIdCandidate(raw) {
  const value = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!value.includes('.')) return null;
  if (!/^[a-z][a-z0-9_.-]+$/.test(value)) return null;
  return value;
}

export function extractSemconvIdsFromText(text) {
  const ids = new Set();
  const regex = /^\s*(?:-\s*)?id:\s*(["']?[a-zA-Z0-9_.-]+["']?)\s*$/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const normalized = normalizeIdCandidate(match[1]);
    if (normalized) ids.add(normalized);
  }
  return ids;
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await mapper(current));
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchOfficialSemconvFields({ ref = 'main', concurrency = 10 } = {}) {
  const tree = await fetchSemconvTree({ ref });
  const files = tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path)
    .filter((p) => p.startsWith('model/') && (p.endsWith('.yaml') || p.endsWith('.yml')));

  const resultSet = new Set();

  await mapLimit(files, concurrency, async (filePath) => {
    const rawUrl = `https://raw.githubusercontent.com/open-telemetry/semantic-conventions/${ref}/${filePath}`;
    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': 'spanory-telemetry-sync',
      },
    });
    if (!response.ok) return;
    const text = await response.text();
    const ids = extractSemconvIdsFromText(text);
    for (const id of ids) resultSet.add(id);
  });

  return [...resultSet].sort();
}
