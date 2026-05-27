@echo off
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%gory-control\GoryControl.ps1" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
title Gory - Control Panel

powershell -NoProfile -ExecutionPolicy Bypass -STA -Command "[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; & '.\gory-control\GoryControl.ps1'"
if errorlevel 1 (
  echo.
  echo Could not start control panel.
  pause
)
