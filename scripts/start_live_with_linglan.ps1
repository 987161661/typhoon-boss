param(
  [int]$Port = 3038,
  [switch]$OpenBrowser,
  [switch]$NoLinglan
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vtuberRoot = 'D:\LocalToolset\vtuber\aituber-onair-main'
$linglanControlRoomLauncher = Join-Path $vtuberRoot 'Start-Linglan-ControlRoom.ps1'
$linglanLegacyLauncher = Join-Path $vtuberRoot 'Start-AITuber.ps1'
$linglanLauncher = if (Test-Path -LiteralPath $linglanControlRoomLauncher -PathType Leaf) {
  $linglanControlRoomLauncher
} elseif (Test-Path -LiteralPath $linglanLegacyLauncher -PathType Leaf) {
  $linglanLegacyLauncher
} else {
  $null
}
$runtimeDir = Join-Path $projectRoot '.runtime'
$serviceLogDir = Join-Path $projectRoot 'runtime\logs'
$liveUrl = "http://127.0.0.1:$Port/live"

function Test-TyphoonLiveAssets {
  param([string]$Url)

  try {
    $page = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'live-director') {
      return $false
    }
    # Validate every Next.js script and stylesheet referenced by the rendered
    # document. Checking only the route entry chunk misses stale shared chunks:
    # a long-running server can keep returning an old manifest after `.next`
    # has been rebuilt, which leaves the page at Next's client-side error screen.
    $assetMatches = [regex]::Matches(
      $page.Content,
      '(?:href|src)="([^"?#]*\/_next\/static\/[^"?#]+\.(?:css|js)(?:\?[^"#]*)?)"'
    )
    $assets = @($assetMatches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    if ($assets.Count -lt 2) {
      return $false
    }
    foreach ($asset in $assets) {
      $assetUrl = [Uri]::new([Uri]$Url, $asset).AbsoluteUri
      $response = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ne 200 -or $response.RawContentLength -le 0) {
        return $false
      }
    }
    return $true
  } catch {
    return $false
  }
}

function Wait-TyphoonHealth {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 45,
    [int]$RequestTimeoutSeconds = 6
  )

  $healthUrl = "$BaseUrl/api/health"
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $lastFailure = 'no response received'

  # A cold Next.js dev server compiles API routes on their first request. That
  # compile can outlive one HTTP request timeout while continuing successfully
  # in the server, so retry within one bounded startup budget instead of turning
  # the first timeout into a false launcher failure.
  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec $RequestTimeoutSeconds
      if ($health.status -eq 'ok') {
        return $health
      }
      $lastFailure = "status=$($health.status); storms=$($health.track.stormCount)"
    } catch {
      $lastFailure = $_.Exception.Message
    }

    if ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "Typhoon data connection did not become ready within $TimeoutSeconds seconds. Last result: $lastFailure"
}

if (-not $NoLinglan) {
  if (-not $linglanLauncher) {
    throw "Linglan runtime launcher was not found. Expected one of: $linglanControlRoomLauncher; $linglanLegacyLauncher"
  }

  # Prefer the current control-room launcher. It is self-sufficient when the
  # retired umbrella launcher is absent, and keeps the radar independent of a
  # Bilibili room ID. Do not open an extra operator window from this launcher.
  $linglanArguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $linglanLauncher)
  if ($linglanLauncher -eq $linglanControlRoomLauncher) {
    $linglanArguments += '-NoBrowser'
  }
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList $linglanArguments `
    -WorkingDirectory $vtuberRoot `
    -WindowStyle Hidden
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener -and -not (Test-TyphoonLiveAssets -Url $liveUrl)) {
  Write-Host "Existing radar server on port $Port has missing client assets; restarting it."
  $listener | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) { break }
  }
}

if (-not $listener) {
  New-Item -ItemType Directory -Path $serviceLogDir -Force | Out-Null
  $previousDistDir = $env:NEXT_DIST_DIR
  try {
    $env:NEXT_DIST_DIR = ".next-live-$Port"
    Start-Process -FilePath 'npm.cmd' `
      -ArgumentList @('run', 'dev', '--', '-H', '127.0.0.1', '-p', [string]$Port) `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $serviceLogDir "live-$Port.current.out.log") `
      -RedirectStandardError (Join-Path $serviceLogDir "live-$Port.current.err.log")
  } finally {
    $env:NEXT_DIST_DIR = $previousDistDir
  }
}

$liveReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if (Test-TyphoonLiveAssets -Url $liveUrl) {
    $liveReady = $true
    break
  }
  Start-Sleep -Milliseconds 500
}

if (-not $liveReady) {
  throw "Typhoon live page did not become ready: $liveUrl"
}

$health = Wait-TyphoonHealth -BaseUrl "http://127.0.0.1:$Port"

# The one-click live workflow is an operational session: enable the evolution
# agent explicitly after the web API is healthy. A manual Next start remains
# opt-in, while this launcher verifies that its requested background work is
# actually scheduled.
$agentSettings = @{ evolutionAgentEnabled = $true } | ConvertTo-Json -Compress
$agentStatus = Invoke-RestMethod `
  -Uri "http://127.0.0.1:$Port/api/live-control-settings" `
  -Method Patch `
  -ContentType 'application/json' `
  -Body $agentSettings `
  -TimeoutSec 12
if (-not $agentStatus.settings.evolutionAgentEnabled -or -not $agentStatus.scheduler.enabled) {
  throw 'Typhoon evolution agent was not enabled. Check TYPHOON_EVOLUTION_AGENT_ENABLED and the live-control settings.'
}

Write-Host "Typhoon live page: $liveUrl"
Write-Host "Evolution agent: enabled (every $($agentStatus.scheduler.intervalMinutes) minutes)"

if (-not $NoLinglan) {
  $hostReady = $false
  # Start-AITuber brings up the live-platform gateway and avatar services
  # before Vite listens on 5173. On a cold start that chain can exceed the
  # former 15-second allowance, even though it is healthy. Keep the radar
  # launcher attached long enough to validate the proxy rather than reporting
  # a false startup failure during that window.
  $hostStartupTimeoutSeconds = 90
  $hostStartedAt = Get-Date
  for ($attempt = 0; $attempt -lt ($hostStartupTimeoutSeconds * 2); $attempt += 1) {
    try {
      $hostHealth = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/digital-host/health" -UseBasicParsing -TimeoutSec 2
      if ($hostHealth.StatusCode -eq 200) {
        $hostReady = $true
        break
      }
    } catch { }
    if (($attempt + 1) % 20 -eq 0) {
      $elapsedSeconds = [math]::Floor(((Get-Date) - $hostStartedAt).TotalSeconds)
      Write-Host "Waiting for Linglan runtime ($elapsedSeconds/$hostStartupTimeoutSeconds seconds)..."
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $hostReady) {
    throw "Linglan runtime did not connect within $hostStartupTimeoutSeconds seconds through http://127.0.0.1:$Port/api/digital-host/health. Check D:\LocalToolset\vtuber\aituber-onair-main\logs\vite.out.log and vite.err.log."
  }
  Write-Host 'Linglan runtime: http://127.0.0.1:5173/?overlay=1'
} else {
  Write-Host 'Linglan runtime: skipped by -NoLinglan'
}

if ($OpenBrowser) {
  Start-Process $liveUrl
}
