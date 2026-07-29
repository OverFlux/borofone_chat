@echo off
setlocal
cd /d "%~dp0"

set "BOROTALK_ROUTE_SCRIPT=%~dp0Fix-RadminRoute.ps1"
if not exist "%BOROTALK_ROUTE_SCRIPT%" set "BOROTALK_ROUTE_SCRIPT=%~dp0scripts\Fix-RadminRoute.ps1"

if not exist "%BOROTALK_ROUTE_SCRIPT%" (
    echo Fix-RadminRoute.ps1 was not found.
    pause
    exit /b 1
)

title Borotalk - Radmin route repair
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BOROTALK_ROUTE_SCRIPT%" %*
exit /b %errorlevel%
