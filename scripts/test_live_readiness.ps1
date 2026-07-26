param(
  [string]$RadarBaseUrl = 'http://127.0.0.1:3038',
  [int]$MaximumGfsAgeHours = 12,
  [switch]$SkipDigitalHost,
  [switch]$RequireRuntimeOwner
)

$ErrorActionPreference = 'Stop'
$baseUrl = $RadarBaseUrl.TrimEnd('/')

function Invoke-ReadinessJson {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$BudgetSeconds = 45,
    [int]$RequestTimeoutSeconds = 8
  )

  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $lastFailure = 'no response received'
  while ($stopwatch.Elapsed.TotalSeconds -lt $BudgetSeconds) {
    try {
      return Invoke-RestMethod -Uri $Url -TimeoutSec $RequestTimeoutSeconds
    } catch {
      $lastFailure = $_.Exception.Message
    }
    if ($stopwatch.Elapsed.TotalSeconds -lt $BudgetSeconds) {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Readiness request did not complete within $BudgetSeconds seconds: $Url. Last result: $lastFailure"
}

function Test-TyphoonLiveAssets {
  param([string]$Url)

  $page = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'live-director') {
    throw "Live page is not the expected broadcast document: $Url"
  }
  $assetMatches = [regex]::Matches(
    $page.Content,
    '(?:href|src)="([^"?#]*\/_next\/static\/[^"?#]+\.(?:css|js)(?:\?[^"#]*)?)"'
  )
  $assets = @($assetMatches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  if ($assets.Count -lt 2) {
    throw 'Live page did not publish a complete immutable asset set.'
  }
  foreach ($asset in $assets) {
    $assetUrl = [Uri]::new([Uri]$Url, $asset).AbsoluteUri
    $response = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec 8
    if ($response.StatusCode -ne 200 -or $response.RawContentLength -le 0) {
      throw "Live asset is missing: $assetUrl"
    }
  }
}

Test-TyphoonLiveAssets -Url "$baseUrl/live"

$radarHealth = Invoke-ReadinessJson -Url "$baseUrl/api/health"
if ($radarHealth.status -ne 'ok') {
  throw "Radar health is not ready: status=$($radarHealth.status)"
}

$snapshot = Invoke-ReadinessJson -Url "$baseUrl/api/radar/snapshot" -BudgetSeconds 60 -RequestTimeoutSeconds 15
$stormId = [string]$snapshot.activeStormId
if (-not $stormId) {
  throw 'Radar snapshot has no active storm for the GFS readiness probe.'
}
$storm = @($snapshot.storms | Where-Object { $_.id -eq $stormId })[0]
if (-not $storm) {
  throw "Active storm $stormId is missing from the radar snapshot."
}
$center = $storm.position
$west = [math]::Round([math]::Max(-180, [double]$center.lon - 9), 2)
$east = [math]::Round([math]::Min(180, [double]$center.lon + 9), 2)
$south = [math]::Round([math]::Max(-80, [double]$center.lat - 7), 2)
$north = [math]::Round([math]::Min(80, [double]$center.lat + 7), 2)
$windUrl = "$baseUrl/api/environment/wind-field?stormId=$([Uri]::EscapeDataString($stormId))&west=$west&east=$east&south=$south&north=$north"
$wind = Invoke-ReadinessJson -Url $windUrl -BudgetSeconds 75 -RequestTimeoutSeconds 25
if (
  $wind.status -ne 'available' -or
  $wind.source -ne 'NOAA/NCEP NOMADS Grib Filter' -or
  @($wind.points).Count -lt 42
) {
  throw "Direct GFS wind field is not ready: status=$($wind.status); source=$($wind.source); points=$(@($wind.points).Count)"
}
$windTime = [DateTimeOffset]::Parse([string]$wind.updatedAt)
$windAgeHours = ([DateTimeOffset]::UtcNow - $windTime).TotalHours
if ($windAgeHours -gt $MaximumGfsAgeHours) {
  throw "GFS frame is too old: $($wind.updatedAt) ($([math]::Round($windAgeHours, 1)) hours)."
}
if (-not $wind.analysisCenter) {
  throw 'Direct GFS frame has no analysis center for the active storm.'
}

if (-not $SkipDigitalHost) {
  $digitalHost = Invoke-ReadinessJson -Url "$baseUrl/api/digital-host/health" -BudgetSeconds 30
  if (-not $digitalHost.PSObject.Properties['runtimeOwner']) {
    throw 'Digital-host health omitted the runtimeOwner contract.'
  }
  if (-not $digitalHost.PSObject.Properties['lastFaults']) {
    throw 'Digital-host health omitted the lastFaults contract.'
  }
  if ($digitalHost.runtimeOwner.ttsConfigured -eq $false) {
    throw 'Digital-host TTS is not configured.'
  }
  if ($RequireRuntimeOwner -and (-not $digitalHost.runtimeOwner.active -or -not $digitalHost.runtimeOwner.available)) {
    throw 'No active digital-host runtime owner is ready to consume the live queue.'
  }
  $recentFaults = @(
    $digitalHost.lastFaults.PSObject.Properties |
      Where-Object {
        $_.Value -and
        $_.Value.at -and
        ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$_.Value.at) -lt 120000
      }
  )
  if ($recentFaults.Count -gt 0) {
    $faultNames = ($recentFaults | ForEach-Object { $_.Name }) -join ', '
    throw "Digital-host runtime has recent delivery faults: $faultNames"
  }
}

Write-Host "LIVE READINESS PASS | storm=$stormId | GFS=$($wind.updatedAt) | source=$($wind.source)"
