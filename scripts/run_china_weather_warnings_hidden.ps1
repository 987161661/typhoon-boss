$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  foreach ($task in @(
    "warnings:china:refresh",
    "products:china:refresh",
    "visuals:china:refresh"
  )) {
    & npm.cmd run $task
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
} finally {
  Pop-Location
}

exit 0
