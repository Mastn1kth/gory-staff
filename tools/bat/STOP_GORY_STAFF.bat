@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
title Gory - stop all

echo ========================================
echo Gory - full stop
echo ========================================
echo.

echo Stopping watchdog...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path; $pidFile=Join-Path $root 'runtime\pids\gory-watchdog.pid';" ^
  "if (Test-Path -LiteralPath $pidFile) { try { $watchdogPid=[int](Get-Content -Raw -LiteralPath $pidFile); Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue };" ^
  "$ids=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'Watch-GoryStaff.ps1' } | Select-Object -ExpandProperty ProcessId;" ^
  "foreach ($id in $ids) { try { Write-Host ('Stopping watchdog PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo Stopping server, Metro, Expo, and debug processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path; $pidFiles=@((Join-Path $root 'runtime\pids\gory-server.pid'), (Join-Path $root '.gory-server.pid'), (Join-Path $root '.gory-start-bat.pid'));" ^
  "foreach ($pidFile in $pidFiles) { if (Test-Path -LiteralPath $pidFile) { try { $serverPid=[int](Get-Content -Raw -LiteralPath $pidFile); Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } };" ^
  "$ports=@(4000,8081,19000,19001,19002);" ^
  "$ids=@();" ^
  "foreach ($port in $ports) { $ids += Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique }" ^
  "$related = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'server[\\/]+src[\\/]+index\.js|expo start|expo run|metro|react-native|gradle' } | Select-Object -ExpandProperty ProcessId;" ^
  "$ids = @($ids + $related) | Where-Object { $_ } | Select-Object -Unique;" ^
  "foreach ($id in $ids) { try { $p=Get-Process -Id $id -ErrorAction Stop; Write-Host ('Stopping PID ' + $id + ' (' + $p.ProcessName + ')'); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo.
echo Stopping Android Gradle daemons...
if exist "mobile\android\gradlew.bat" (
  pushd "mobile\android"
  call gradlew.bat --stop >nul 2>nul
  popd
)

echo.
echo Stopping iiko event connector...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path; $pidFile=Join-Path $root 'runtime\iiko\iiko-event-connector.pid';" ^
  "if (Test-Path -LiteralPath $pidFile) { try { Stop-Process -Id ([int](Get-Content -Raw -LiteralPath $pidFile)) -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue };" ^
  "$ids=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tools[\\/]iiko-event-connector\.js' } | Select-Object -ExpandProperty ProcessId;" ^
  "foreach ($id in $ids) { try { Write-Host ('Stopping iiko connector PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo.
echo Stopping public mobile relay...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path; $pidFile=Join-Path $root 'runtime\https-relay\edge-connector.pid';" ^
  "if (Test-Path -LiteralPath $pidFile) { try { Stop-Process -Id ([int](Get-Content -Raw -LiteralPath $pidFile)) -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue };" ^
  "$ids=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tools[\\/]gory-edge-connector\.js' } | Select-Object -ExpandProperty ProcessId;" ^
  "foreach ($id in $ids) { try { Write-Host ('Stopping public relay PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo.
echo Cleaning legacy Cloudflare Tunnel process if present...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path;" ^
  "$pidFiles=@((Join-Path $root 'runtime\pids\cloudflared.pid'), (Join-Path $root 'runtime\pids\cloudflared-quick.pid'));" ^
  "foreach ($pidFile in $pidFiles) { if (Test-Path -LiteralPath $pidFile) { try { Stop-Process -Id ([int](Get-Content -Raw -LiteralPath $pidFile)) -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue } };" ^
  "$ids=Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*cloudflared*' -and ($_.CommandLine -match 'gory-staff-local|30107770|app\.gory-staff\.ru|\.cloudflared\\config\.yml') } | Select-Object -ExpandProperty ProcessId;" ^
  "foreach ($id in $ids) { try { Write-Host ('Stopping Cloudflare PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo.
echo Stopping PostgreSQL container. Database files stay saved.
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found.
) else (
  docker compose stop postgres
)

echo.
echo Cleaning temporary root logs...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path; Get-ChildItem -LiteralPath $root -File -Filter '*.log' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue; Get-ChildItem -LiteralPath $root -File -Filter '.gory-*.pid' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue"

echo.
echo Done. Server, public tunnel, Android build daemons, and PostgreSQL are stopped.
echo Data was not deleted.
if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
