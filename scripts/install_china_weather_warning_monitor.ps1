param(
  [ValidateRange(1, 60)]
  [int]$EveryMinutes = 5
)

$taskName = "TyphoonBossRadar-ChinaWeatherWarnings"
$runner = Join-Path $PSScriptRoot "run_china_weather_warnings_hidden.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description "Refresh the China Weather nationwide warning feed every $EveryMinutes minutes." -Force | Out-Null
Write-Output "Installed $taskName every $EveryMinutes minutes."
