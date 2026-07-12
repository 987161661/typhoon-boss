$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot "..\.runtime\tools\wgrib2"
$baseUrl = "https://ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/Windows10/v3.1.3"
$files = @(
  "wgrib2.exe",
  "cygwin1.dll",
  "cyggcc_s-seh-1.dll",
  "cyggfortran-5.dll",
  "cyggomp-1.dll",
  "cygquadmath-0.dll"
)

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($file in $files) {
  $destination = Join-Path $target $file
  if (-not (Test-Path -LiteralPath $destination)) {
    Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile $destination -UseBasicParsing -TimeoutSec 90
  }
}

& (Join-Path $target "wgrib2.exe") -version
if (-not (Test-Path -LiteralPath (Join-Path $target "wgrib2.exe"))) {
  throw "wgrib2 installation did not produce the executable."
}
Write-Output "wgrib2 is ready at $target"
exit 0
