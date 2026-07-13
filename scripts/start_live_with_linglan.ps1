param(
  [int]$Port = 3038,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vtuberRoot = 'D:\LocalToolset\vtuber\aituber-onair-main'
$linglanLauncher = Join-Path $vtuberRoot 'Start-Linglan-Bilibili.ps1'
$runtimeDir = Join-Path $projectRoot '.runtime'
$serviceLogDir = Join-Path $projectRoot 'runtime\logs'

if (-not (Test-Path -LiteralPath $linglanLauncher)) {
  throw "Linglan runtime was not found: $linglanLauncher"
}

# Starts the Bilibili supervisor and the avatar/TTS runtime only when their
# ports are not already occupied. The launcher is intentionally idempotent.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $linglanLauncher

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  New-Item -ItemType Directory -Path $serviceLogDir -Force | Out-Null
  Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '-H', '127.0.0.1', '-p', [string]$Port) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $serviceLogDir "live-$Port.current.out.log") `
    -RedirectStandardError (Join-Path $serviceLogDir "live-$Port.current.err.log")
}

$liveUrl = "http://127.0.0.1:$Port/live"
$liveReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri $liveUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $liveReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $liveReady) {
  throw "Typhoon live page did not become ready: $liveUrl"
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 8
if ($health.status -ne 'ok' -or $health.track.stormCount -lt 1) {
  throw "Typhoon data connection is not ready. status=$($health.status); storms=$($health.track.stormCount)"
}

$hostReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  try {
    $hostHealth = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/digital-host/health" -UseBasicParsing -TimeoutSec 2
    if ($hostHealth.StatusCode -eq 200) {
      $hostReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $hostReady) {
  throw "Linglan runtime did not connect through http://127.0.0.1:$Port/api/digital-host/health"
}

Write-Host "Typhoon live page: $liveUrl"
Write-Host 'Linglan runtime: http://127.0.0.1:5173/?overlay=1'

if ($OpenBrowser) {
  Start-Process $liveUrl
}
