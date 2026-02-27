#!/usr/bin/env pwsh

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

New-Item -ItemType Directory -Force -Path "dist" | Out-Null

$Target = if ($args.Count -gt 0) { $args[0] } else { "host" }

function Build-Host {
  if ($IsWindows) {
    npm run --workspace @spanory/cli build:bin:win-x64
  } else {
    throw "Unsupported host for this PowerShell build script."
  }
}

function Build-All {
  npm run --workspace @spanory/cli build:bin:macos-arm64
  npm run --workspace @spanory/cli build:bin:linux-x64
  npm run --workspace @spanory/cli build:bin:win-x64
}

if ($Target -eq "all") {
  Build-All
} else {
  Build-Host
}

Write-Host "Binary build complete."
Get-ChildItem "dist/spanory*" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
