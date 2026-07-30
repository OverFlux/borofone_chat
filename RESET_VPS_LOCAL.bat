@echo off
setlocal
cd /d "%~dp0"

title Reset Borotalk Local VPS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Test-VpsLocal.ps1" -Reset
set "BOROTALK_EXIT=%errorlevel%"

echo.
if not "%BOROTALK_EXIT%"=="0" (
    echo Reset was cancelled or failed.
) else (
    echo Borotalk Local VPS test data was removed.
)
pause
exit /b %BOROTALK_EXIT%
