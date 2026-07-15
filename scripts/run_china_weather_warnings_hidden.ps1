$root = Split-Path -Parent $PSScriptRoot
$command = "npm.cmd run warnings:china:refresh && npm.cmd run products:china:refresh && npm.cmd run visuals:china:refresh"
$process = Start-Process -FilePath $env:ComSpec -ArgumentList "/c", $command -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
exit $process.ExitCode
