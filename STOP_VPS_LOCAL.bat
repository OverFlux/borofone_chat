@echo off
setlocal
cd /d "%~dp0"

title Stop Borotalk Local VPS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Test-VpsLocal.ps1" -Stop
set "BOROTALK_EXIT=%errorlevel%"

echo.
if not "%BOROTALK_EXIT%"=="0" (
    echo Borotalk Local VPS could not be stopped.
) else (
    echo Borotalk Local VPS stopped. Test data was preserved.
)
pause
exit /b %BOROTALK_EXIT%
