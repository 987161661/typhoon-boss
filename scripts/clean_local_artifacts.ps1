[CmdletBinding()]
param(
  [switch]$RuntimeOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Remove-ProjectArtifact {
  param(
    [string]$RelativePath,
    [string]$Pattern
  )
  $directory = Join-Path $root $RelativePath
  Get-ChildItem -LiteralPath $directory -Force -Filter $Pattern -ErrorAction SilentlyContinue |
    ForEach-Object {
      $resolved = $_.FullName
      if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $resolved"
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
      Write-Host "Removed $($_.Name)"
    }
}

if (-not $RuntimeOnly) {
  @(
    '.codex-cdp-profile*',
    '.codex-chrome-profile*',
    '.codex-edge-profile*',
    '.codex-*.json',
    '.codex-*.log',
    '.codex-*.err.log',
    'next-*.log',
    'next-*.err.log',
    'tmp',
    'ref-pic.png',
    'tsconfig.tsbuildinfo',
    '.next'
  ) | ForEach-Object { Remove-ProjectArtifact '.' $_ }
}

# Runtime state is intentionally preserved. These patterns are known
# diagnostics or downloaded test fixtures and must never be treated as live
# settings, track snapshots, structure ledgers, toolchains, or caches.
@(
  'current-snapshot-inspect.json',
  'ecmwf-test.*',
  'lightning.kmz',
  'live-preview-*.log',
  'live-preview-*.err.log',
  'production-*-live.log',
  'production-*-live.err.log',
  'next-*.out.log',
  'next-*.err.log'
) | ForEach-Object { Remove-ProjectArtifact '.runtime' $_ }

Remove-ProjectArtifact '.runtime\wind-field' 'ncep-test'
@('live-dev-*.out.log', 'live-dev-*.err.log') |
  ForEach-Object { Remove-ProjectArtifact 'runtime\logs' $_ }

Write-Host 'Local artifacts cleaned. Preserved runtime state, caches, toolchains, .env.local and public assets.'
