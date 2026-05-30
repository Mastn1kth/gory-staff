@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
set "PROJECT_ROOT=%CD%"
title Gory - start server

if not exist "runtime\logs" mkdir "runtime\logs" >nul 2>nul
if not exist "runtime\pids" mkdir "runtime\pids" >nul 2>nul

set "DEFAULT_PUBLIC_URL=https://app.gory-staff.ru"
set "PUBLIC_URL=%DEFAULT_PUBLIC_URL%"
set "TAILSCALE_PUBLIC_URL=%DEFAULT_PUBLIC_URL%"
set "PATH=C:\Program Files\Docker\Docker\resources\bin;%PATH%"

echo ========================================
echo Gory - full server start
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and run this file again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js and run this file again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

set "DOCKER_CMD="
for /f "delims=" %%D in ('where docker 2^>nul') do if not defined DOCKER_CMD set "DOCKER_CMD=%%D"
if not defined DOCKER_CMD if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" set "DOCKER_CMD=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if not defined DOCKER_CMD (
  echo Docker Desktop was not found.
  echo Install Docker Desktop, open it once, then run this file again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)
set "DOCKER_EXE=%DOCKER_CMD%"

"%DOCKER_CMD%" context use desktop-linux >nul 2>nul
"%DOCKER_CMD%" info >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    echo Starting Docker Desktop...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden"
  )
  echo Waiting for Docker Desktop. This can take 1-5 minutes...
  set "DOCKER_READY=0"
  for /l %%I in (1,1,100) do (
    "%DOCKER_CMD%" context use desktop-linux >nul 2>nul
    "%DOCKER_CMD%" info >nul 2>nul
    if not errorlevel 1 (
      set "DOCKER_READY=1"
      goto docker_ready
    )
    <nul set /p "=."
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3"
  )
)

:docker_ready
echo.
if not "%DOCKER_READY%"=="1" (
  "%DOCKER_CMD%" info >nul 2>nul
  if errorlevel 1 (
    echo Docker Desktop is not ready.
    echo.
    echo What to do:
    echo 1. Open Docker Desktop manually.
    echo 2. Wait until it says that Docker is running.
    echo 3. Open Gory Control again and press Start server.
    echo.
    if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
    exit /b 1
  )
)
echo Docker is ready.

set "TAILSCALE_CMD="
for /f "delims=" %%T in ('where tailscale 2^>nul') do if not defined TAILSCALE_CMD set "TAILSCALE_CMD=%%T"
if not defined TAILSCALE_CMD if exist "C:\Program Files\Tailscale\tailscale.exe" set "TAILSCALE_CMD=C:\Program Files\Tailscale\tailscale.exe"
if /i "%USE_TAILSCALE_PUBLIC_URL%"=="1" if defined TAILSCALE_CMD (
  for /f "usebackq delims=" %%U in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$tailscale=$env:TAILSCALE_CMD; try { $status=& $tailscale status --json | ConvertFrom-Json; if ($status.Self.DNSName) { 'https://' + ([string]$status.Self.DNSName).TrimEnd('.') } } catch {}"`) do set "TAILSCALE_PUBLIC_URL=%%U"
)
if /i "%USE_TAILSCALE_PUBLIC_URL%"=="1" set "PUBLIC_URL=%TAILSCALE_PUBLIC_URL%"

set "LOCAL_IP=localhost"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress; $ip = ($ips | Where-Object { $_ -like '192.168.*' } | Select-Object -First 1); if (-not $ip) { $ip = ($ips | Select-Object -First 1) }; if ($ip) { $ip } else { 'localhost' }"`) do set "LOCAL_IP=%%I"

echo Local server:
echo   http://localhost:4000
echo Phone in the same Wi-Fi:
echo   http://%LOCAL_IP%:4000
echo Phone through mobile internet:
echo   %PUBLIC_URL%
echo.

if not exist "node_modules" (
  echo Installing project dependencies...
  npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

echo Updating server settings...
echo Preserving IIKO_WEBHOOK_SECRET and other IIKO_* settings from server\.env if they already exist.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$path='server\.env';" ^
  "$existing=@{}; if (Test-Path -LiteralPath $path) { foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $path) { if ($line -match '^([^#=]+)=(.*)$') { $existing[$matches[1]]=([string]$matches[2]).Trim() } } };" ^
  "$newSecret={ param([int]$size) $bytes=New-Object byte[] $size; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose(); [Convert]::ToBase64String($bytes) };" ^
  "$secret=([string]$existing.JWT_SECRET -replace '\s',''); if ([string]::IsNullOrWhiteSpace($secret)) { $secret=& $newSecret 48 };" ^
  "$guestSecret=([string]$existing.GUEST_JWT_SECRET -replace '\s',''); if ([string]::IsNullOrWhiteSpace($guestSecret) -or $guestSecret -eq $secret) { $guestSecret=& $newSecret 48 };" ^
  "$public=([string]$env:PUBLIC_URL -replace '\s',''); if ([string]::IsNullOrWhiteSpace($public)) { $public='https://app.gory-staff.ru' };" ^
  "$managerLogin=([string]$existing.INITIAL_MANAGER_LOGIN).Trim(); if ([string]::IsNullOrWhiteSpace($managerLogin)) { $managerLogin='owner@gory.local' };" ^
  "$managerPassword=([string]$existing.INITIAL_MANAGER_PASSWORD).Trim(); if ([string]::IsNullOrWhiteSpace($managerPassword)) { $managerPassword=& $newSecret 18 };" ^
  "$staffPassword=([string]$existing.DEMO_STAFF_PASSWORD).Trim(); if ([string]::IsNullOrWhiteSpace($staffPassword)) { $staffPassword=& $newSecret 18 };" ^
  "$coreKeys=@('DATABASE_URL','PORT','JWT_SECRET','GUEST_JWT_SECRET','PUBLIC_SERVER_URL','EXPO_PUBLIC_API_URL','CORS_ORIGINS','INITIAL_MANAGER_LOGIN','INITIAL_MANAGER_PASSWORD','DEMO_STAFF_PASSWORD','SEED_DEMO_DATA');" ^
  "$lines=@('DATABASE_URL=postgres://gory:gory@localhost:5432/gory_staff','PORT=4000',('JWT_SECRET=' + $secret),('GUEST_JWT_SECRET=' + $guestSecret),('PUBLIC_SERVER_URL=' + $public),('EXPO_PUBLIC_API_URL=' + $public),('CORS_ORIGINS=' + $public),('INITIAL_MANAGER_LOGIN=' + $managerLogin),('INITIAL_MANAGER_PASSWORD=' + $managerPassword),('DEMO_STAFF_PASSWORD=' + $staffPassword),'SEED_DEMO_DATA=if-empty');" ^
  "$preservedKeys=@($existing.Keys | Where-Object { $coreKeys -notcontains $_ } | Sort-Object); foreach ($key in $preservedKeys) { $lines += ($key + '=' + [string]$existing[$key]) };" ^
  "[IO.File]::WriteAllLines($path, $lines, [Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
  echo Could not update server\.env.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Stopping old server process on port 4000 if it exists...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ids = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($id in $ids) { try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }"

echo Checking Windows Firewall for Wi-Fi phones...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$name='Gory API 4000';" ^
  "$rule=Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue;" ^
  "if ($rule) { Write-Host 'Firewall rule already exists.'; exit 0 }" ^
  "$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);" ^
  "if (-not $isAdmin) { Write-Host 'Run this BAT as administrator if Wi-Fi phones cannot connect.'; exit 0 }" ^
  "New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Private,Domain | Out-Null; Write-Host 'Firewall rule added.'"

echo Starting PostgreSQL in Docker...
"%DOCKER_CMD%" compose up -d postgres
if errorlevel 1 (
  echo PostgreSQL could not be started.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Waiting for PostgreSQL...
set "PG_READY=0"
for /l %%I in (1,1,40) do (
  "%DOCKER_CMD%" compose exec -T postgres pg_isready -U gory -d gory_staff >nul 2>nul
  if not errorlevel 1 (
    set "PG_READY=1"
    goto postgres_ready
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2"
)
:postgres_ready
if not "%PG_READY%"=="1" (
  echo PostgreSQL did not become ready in time.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Applying database tables and migrations...
call npm --workspace server run db:init
if errorlevel 1 (
  echo Database initialization failed.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

if exist "tools\export_excel_tables.py" (
  echo Updating Excel tables for staff and guests...
  python "tools\export_excel_tables.py" >nul 2>nul
  if exist "data\Gory-Data.xlsx" (
    echo Excel file: %PROJECT_ROOT%\data\Gory-Data.xlsx
  ) else (
    echo Excel file was not created. Server will continue anyway.
  )
)

if /i not "%USE_TAILSCALE_FUNNEL%"=="1" goto skip_tailscale_funnel
if defined TAILSCALE_CMD (
  echo Checking Tailscale for mobile internet...
  set "TAILSCALE_READY=0"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$tailscale=$env:TAILSCALE_CMD; $ok=$false; for ($i=0; $i -lt 5; $i++) { try { $s=& $tailscale status --json | ConvertFrom-Json; if ($s.BackendState -eq 'Running' -and $s.Self.DNSName) { $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if ($ok) { exit 0 } else { exit 1 }"
  if not errorlevel 1 set "TAILSCALE_READY=1"
  if not "!TAILSCALE_READY!"=="1" (
    echo Tailscale is not ready. Server startup will continue in local Wi-Fi mode.
    echo Open Tailscale manually and sign in if mobile internet mode is needed.
  )
  if "!TAILSCALE_READY!"=="1" (
    echo Starting Tailscale Serve and Funnel...
    "%TAILSCALE_CMD%" funnel reset >nul 2>nul
    "%TAILSCALE_CMD%" serve reset >nul 2>nul
    "%TAILSCALE_CMD%" funnel --bg --yes 4000 >nul 2>nul
    if errorlevel 1 (
      echo Tailscale is connected, but Funnel did not start.
      echo Check that Funnel is allowed in Tailscale Access Controls.
    ) else (
      echo Tailscale Funnel started.
      echo Waiting for Tailscale Funnel to publish...
      powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 20"
    )
  ) else (
    echo.
    echo Tailscale is not connected, so mobile internet mode is NOT ready.
    echo Open the Tailscale app, sign in, and check that it says Connected.
    echo If it is stuck, restart the PC and press Start server in Gory Control again.
    echo Wi-Fi mode can still work while the phone is in the same network as this PC.
    echo.
  )
) else (
  echo Tailscale was not found. Mobile internet mode will not work until Tailscale is installed.
)
:skip_tailscale_funnel
if /i not "%USE_TAILSCALE_FUNNEL%"=="1" (
  echo Starting public mobile HTTPS relay...
  call "tools\bat\START_PUBLIC_RELAY.bat"
  if errorlevel 1 (
    echo Public relay did not start. Check runtime\logs\edge-connector.log.
  ) else (
    echo Public relay started for %PUBLIC_URL%.
  )
)

echo.
echo Starting Gory API...
echo Keep this window open while phones use the app.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Resolve-Path -LiteralPath '.').Path;" ^
  "$logDir=Join-Path $root 'runtime\logs'; $pidDir=Join-Path $root 'runtime\pids'; New-Item -ItemType Directory -Force -Path $logDir,$pidDir | Out-Null;" ^
  "$out=Join-Path $logDir 'server-live.out.log'; $err=Join-Path $logDir 'server-live.err.log'; $pidFile=Join-Path $pidDir 'gory-server.pid'; $legacyPid=Join-Path $root '.gory-server.pid';" ^
  "Remove-Item -LiteralPath $out,$err,$pidFile,$legacyPid -Force -ErrorAction SilentlyContinue;" ^
  "$p=Start-Process -FilePath 'npm.cmd' -ArgumentList @('--workspace','server','run','start') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru;" ^
  "Set-Content -Encoding ASCII -LiteralPath $pidFile -Value $p.Id;" ^
  "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 2; if ($h.ok) { $ok=$true; break } } catch {}; if ($p.HasExited) { break }; Start-Sleep -Seconds 1 };" ^
  "if (-not $ok) { Write-Host 'Server did not start on port 4000.'; Write-Host 'Last server log:'; if (Test-Path $err) { Get-Content -Tail 40 $err }; if (Test-Path $out) { Get-Content -Tail 40 $out }; exit 1 };" ^
  "$pgOk=$false; try { docker compose exec -T postgres pg_isready -U gory -d gory_staff *> $null; if ($LASTEXITCODE -eq 0) { $pgOk=$true } } catch {};" ^
  "$pushState=if ($env:DISABLE_PUSH -eq '1') { 'OFF (DISABLE_PUSH=1)' } else { 'ON (Expo push)' };" ^
  "$publicOk=$false; $publicUrl=[string]$env:PUBLIC_URL; $hostName=([uri]$publicUrl).Host; $ips=@(); try { $ips=(& nslookup $hostName 1.1.1.1 2>$null | Select-String -Pattern '^\s*(\d{1,3}\.){3}\d{1,3}\s*$' | ForEach-Object { $_.Matches[0].Value.Trim() } | Where-Object { $_ -notlike '100.*' } | Select-Object -Unique) } catch {}; if (-not $ips) { $ips=@($null) }; for ($i=0; $i -lt 3 -and -not $publicOk; $i++) { foreach ($ip in $ips) { try { $resolveArg=$null; if ($ip) { $resolveArg=($hostName + ':443:' + $ip) }; if ($resolveArg) { & curl.exe -L --max-time 10 --resolve $resolveArg -fsS ($publicUrl + '/health') *> $null } else { & curl.exe -L --max-time 10 -fsS ($publicUrl + '/health') *> $null }; if ($LASTEXITCODE -eq 0) { $publicOk=$true; break } } catch {} }; if (-not $publicOk) { Start-Sleep -Seconds 1 } };" ^
  "Write-Host ''; Write-Host 'HEALTH SUMMARY'; Write-Host ('  API local:    OK'); Write-Host ('  PostgreSQL:   ' + $(if ($pgOk) { 'OK' } else { 'CHECK' })); Write-Host ('  Push:         ' + $pushState); Write-Host ('  Public HTTPS: ' + $(if ($publicOk) { 'OK' } else { 'CHECK PUBLIC RELAY' })); Write-Host ''; Write-Host 'READY'; Write-Host ('PC:      http://localhost:4000/health'); Write-Host ('Wi-Fi:   http://%LOCAL_IP%:4000/health'); Write-Host ('Mobile:  ' + $env:PUBLIC_URL + '/health'); Write-Host ''; Write-Host 'Do not close this window. Use the control app or tools\bat\STOP_GORY_STAFF.bat to stop everything.'"
if errorlevel 1 (
  echo.
  echo Server start failed.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo Starting iiko event connector...
call "tools\bat\START_IIKO_EVENT_CONNECTOR.bat"
if errorlevel 1 (
  echo iiko event connector did not start. Check runtime\logs\iiko-event-connector.err.log.
) else (
  echo iiko event connector started.
)

echo.
echo Starting watchdog for API and public relay...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Resolve-Path -LiteralPath '.').Path;" ^
  "$pidFile=Join-Path $root 'runtime\pids\gory-watchdog.pid';" ^
  "$out=Join-Path $root 'runtime\logs\gory-watchdog.out.log'; $err=Join-Path $root 'runtime\logs\gory-watchdog.err.log';" ^
  "$script=Join-Path $root 'tools\Watch-GoryStaff.ps1';" ^
  "if (Test-Path -LiteralPath $pidFile) { try { $old=[int](Get-Content -Raw -LiteralPath $pidFile); Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue };" ^
  "$ids=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'Watch-GoryStaff.ps1' } | Select-Object -ExpandProperty ProcessId;" ^
  "foreach ($id in $ids) { try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} };" ^
  "$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $script + '"'),'-ProjectRoot',('"' + $root + '"')) -join ' ';" ^
  "$p=Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru;" ^
  "Set-Content -Encoding ASCII -LiteralPath $pidFile -Value $p.Id; Write-Host ('Watchdog PID ' + $p.Id)"
if errorlevel 1 (
  echo Watchdog did not start. Server can work, but automatic restart is not active.
) else (
  echo Watchdog started. If API or public relay falls, it will be restarted automatically.
)

:keep_alive
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 10"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 2; if ($h.ok) { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  echo.
  echo Server stopped or port 4000 is not answering.
  echo Watchdog will try to restart it automatically. Check runtime\logs\gory-watchdog.log.
)
goto keep_alive

echo.
echo Server stopped.
if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
