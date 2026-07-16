param(
  [string]$Time = "00:15",
  [ValidateRange(1, 24)]
  [int]$EveryHours = 12
)

$taskName = "TyphoonBossRadar-NationalCityRank"
$runner = Join-Path $PSScriptRoot "run_daily_city_rank_hidden.ps1"
$hiddenLauncher = Join-Path $PSScriptRoot "run_scheduled_task_hidden.vbs"
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$hiddenLauncher`" `"$runner`""
$clock = [datetime]::ParseExact($Time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$firstRun = (Get-Date).Date.Add($clock.TimeOfDay)
$triggers = foreach ($hourOffset in 0..23 | Where-Object { $_ % $EveryHours -eq 0 }) {
  New-ScheduledTaskTrigger -Daily -At $firstRun.AddHours($hourOffset)
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Description "Refresh the city-level QWeather ranking every $EveryHours hours." -Force | Out-Null
Write-Output "Installed $taskName every $EveryHours hours, starting at $Time local time."
