@echo off
setlocal

cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_live_with_linglan.ps1" -OpenBrowser
set "exitCode=%ERRORLEVEL%"

if not "%exitCode%"=="0" (
  echo.
  echo Startup failed. Review the error above, then press any key to close.
  pause >nul
)

exit /b %exitCode%
