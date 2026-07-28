@echo off
setlocal
cd /d "%~dp0"

title Borotalk Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Borotalk.ps1" %*
set "BOROTALK_EXIT=%errorlevel%"

if not "%BOROTALK_EXIT%"=="0" (
    echo.
    echo Borotalk failed to start. See the error message above.
    pause
)

exit /b %BOROTALK_EXIT%
