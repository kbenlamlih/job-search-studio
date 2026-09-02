@echo off
rem Double-click this file to set up Job Studio on Windows.
rem It just hands over to install.ps1, because Windows won't run a
rem PowerShell script from a double-click on its own.
title Job Studio setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. Send this window to whoever set this up for you.
  pause
)
