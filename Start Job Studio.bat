@echo off
rem Double-click to open Job Studio. Close this window to shut it down.
title Job Studio
cd /d "%~dp0"

set "PATH=%LOCALAPPDATA%\JobStudio\bin;%USERPROFILE%\.bun\bin;%USERPROFILE%\.local\bin;%PATH%"

where bun >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Job Studio isn't set up on this computer yet.
  echo.
  echo   Double-click "install.bat" in this folder first.
  echo.
  pause
  exit /b 1
)

cls
echo.
echo   Job Studio
echo   Starting up. Your browser will open in a second.
echo   Keep this window open while you use the app. Close it to stop.
echo.

cd studio
bun run server.ts
pause
