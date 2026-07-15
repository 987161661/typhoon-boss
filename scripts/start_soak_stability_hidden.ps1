param(
  [ValidateRange(1, 1440)]
  [int]$DurationMinutes = 120,

  [ValidateRange(1, 3600)]
  [int]$SampleIntervalSeconds = 10,

  [ValidateRange(1, 3600)]
  [int]$NationalIntervalSeconds = 300,

  [ValidateRange(1, 3600)]
  [int]$RadarIntervalSeconds = 10,

  [ValidateRange(100, 60000)]
  [int]$RequestTimeoutMs = 8000,

  [string]$BaseUrl = "http://127.0.0.1:3038",

  [string]$OutputDirectory = "",

  [string]$RunLabel = "2h",

  [switch]$Wait
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run_soak_stability.mjs"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Soak runner not found: $runner"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $root "evidence"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$safeLabel = ($RunLabel -replace '[^a-zA-Z0-9._-]', '-')
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss-fffZ")
$outputPrefix = Join-Path $OutputDirectory "soak-stability-$safeLabel-$timestamp"
$stdoutPath = "$outputPrefix.stdout.log"
$stderrPath = "$outputPrefix.stderr.log"
$durationSeconds = $DurationMinutes * 60

function Quote-ProcessArgument([string]$Value) {
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

$arguments = @(
  (Quote-ProcessArgument $runner),
  "--duration-seconds", "$durationSeconds",
  "--sample-interval-seconds", "$SampleIntervalSeconds",
  "--national-interval-seconds", "$NationalIntervalSeconds",
  "--radar-interval-seconds", "$RadarIntervalSeconds",
  "--request-timeout-ms", "$RequestTimeoutMs",
  "--base-url", (Quote-ProcessArgument $BaseUrl),
  "--output-prefix", (Quote-ProcessArgument $outputPrefix)
) -join ' '

$start = @{
  FilePath = (Get-Command node.exe -ErrorAction Stop).Source
  ArgumentList = $arguments
  WorkingDirectory = $root
  WindowStyle = "Hidden"
  PassThru = $true
  RedirectStandardOutput = $stdoutPath
  RedirectStandardError = $stderrPath
}

$process = Start-Process @start
[pscustomobject]@{
  pid = $process.Id
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  hidden = $true
  outputPrefix = $outputPrefix
  csv = "$outputPrefix.csv"
  json = "$outputPrefix.json"
  stdout = $stdoutPath
  stderr = $stderrPath
} | ConvertTo-Json -Compress

if ($Wait) {
  $process.WaitForExit()
  exit $process.ExitCode
}
