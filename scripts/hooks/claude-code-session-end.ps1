#!/usr/bin/env pwsh

# Windows PowerShell wrapper for Claude Code SessionEnd hook.
# Reads hook payload from stdin and delegates to Spanory CLI.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$DotEnv = Join-Path $HOME ".env"
if (Test-Path $DotEnv) {
  Get-Content $DotEnv | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
  }
}

$StateDir = Join-Path $HOME ".claude\state"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$LogFile = if ($env:SPANORY_HOOK_LOG_FILE) { $env:SPANORY_HOOK_LOG_FILE } else { Join-Path $StateDir "spanory-hook.log" }

$Payload = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($Payload)) {
  exit 0
}

$Endpoint = if ($env:SPANORY_OTLP_ENDPOINT) { $env:SPANORY_OTLP_ENDPOINT } else { $env:OTEL_EXPORTER_OTLP_ENDPOINT }
$Headers = if ($env:SPANORY_OTLP_HEADERS) { $env:SPANORY_OTLP_HEADERS } else { $env:OTEL_EXPORTER_OTLP_HEADERS }
$ExportJsonDir = if ($env:SPANORY_HOOK_EXPORT_JSON_DIR) { $env:SPANORY_HOOK_EXPORT_JSON_DIR } else { Join-Path $StateDir "spanory-json" }

$NodeEntry = Join-Path $RepoRoot "packages\cli\src\index.js"

$Payload | node $NodeEntry runtime claude-code hook `
  --endpoint "$Endpoint" `
  --headers "$Headers" `
  --export-json-dir "$ExportJsonDir" `
  *>> $LogFile

exit 0
