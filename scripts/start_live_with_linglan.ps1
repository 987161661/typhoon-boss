param(
  [int]$Port = 3038,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vtuberRoot = 'D:\LocalToolset\vtuber\aituber-onair-main'
$linglanLauncher = Join-Path $vtuberRoot 'Start-Linglan-Bilibili.ps1'
$runtimeDir = Join-Path $projectRoot '.runtime'

if (-not (Test-Path -LiteralPath $linglanLauncher)) {
  throw "Linglan runtime was not found: $linglanLauncher"
}

# Starts the Bilibili supervisor and the avatar/TTS runtime only when their
# ports are not already occupied. The launcher is intentionally idempotent.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $linglanLauncher

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '-H', '127.0.0.1', '-p', [string]$Port) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDir 'live-next.out.log') `
    -RedirectStandardError (Join-Path $runtimeDir 'live-next.err.log')
}

$liveUrl = "http://127.0.0.1:$Port/live"
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri $liveUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

Write-Host "Typhoon live page: $liveUrl"
Write-Host 'Linglan runtime: http://127.0.0.1:5173/?overlay=1'

if ($OpenBrowser) {
  Start-Process $liveUrl
}
