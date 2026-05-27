@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)

echo ========================================
echo Gory - configure Cloudflare service
echo ========================================
echo.
echo This will open a Windows administrator prompt if needed.
echo It replaces the Cloudflared service with the app.gory-staff.ru tunnel.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "tools\Configure-GoryCloudflareService.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Cloudflare service configuration command was started.
) else (
  echo Cloudflare service configuration failed. Check runtime\logs\cloudflared-service-config.log.
)

if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
