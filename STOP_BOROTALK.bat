@echo off
setlocal
cd /d "%~dp0"

title Borotalk Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Borotalk.ps1" -Stop %*
set "BOROTALK_EXIT=%errorlevel%"

if not "%BOROTALK_EXIT%"=="0" (
    echo.
    echo Borotalk could not be stopped. See the error message above.
    pause
)

exit /b %BOROTALK_EXIT%
