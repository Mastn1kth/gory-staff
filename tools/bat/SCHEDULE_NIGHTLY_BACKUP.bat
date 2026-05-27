@echo off
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
echo Registering nightly backup at 03:00...
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\register_nightly_backup.ps1"
pause
