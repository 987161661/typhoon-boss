[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Remove-LocalArtifact {
  param([string]$Pattern)
  Get-ChildItem -LiteralPath $root -Force -Filter $Pattern -ErrorAction SilentlyContinue |
    ForEach-Object {
      $resolved = $_.FullName
      if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $resolved"
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
      Write-Host "Removed $($_.Name)"
    }
}

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
) | ForEach-Object { Remove-LocalArtifact $_ }

Write-Host 'Local artifacts cleaned. Preserved source files, .runtime, .env.local and public assets.'
