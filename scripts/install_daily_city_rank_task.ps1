param(
  [string]$Time = "03:15"
)

$root = Split-Path -Parent $PSScriptRoot
$taskName = "TyphoonBossRadar-NationalCityRank"
$runner = Join-Path $PSScriptRoot "run_daily_city_rank.cmd"
$action = New-ScheduledTaskAction -Execute $runner
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description "Refresh nationwide QWeather city-point ranking once per day." -Force | Out-Null
Write-Output "Installed $taskName at $Time local time."
