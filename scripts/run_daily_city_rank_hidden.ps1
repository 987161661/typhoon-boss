$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  & npm.cmd run cities:rank:refresh
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
