@echo off
setlocal
cd /d "%~dp0"

title Borotalk Local VPS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Test-VpsLocal.ps1"
set "BOROTALK_EXIT=%errorlevel%"

echo.
if not "%BOROTALK_EXIT%"=="0" (
    echo Borotalk Local VPS failed to start.
) else (
    echo Borotalk Local VPS is ready.
)
pause
exit /b %BOROTALK_EXIT%
