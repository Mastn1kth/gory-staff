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
title Gory - restore database

echo ========================================
echo Gory - restore PostgreSQL database
echo ========================================
echo.

set "BACKUP_FILE=%~1"
if not defined BACKUP_FILE (
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath 'backups' -Filter '*.sql' -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "BACKUP_FILE=%%F"
)

if not defined BACKUP_FILE (
  echo No SQL backup was found.
  echo Put a non-empty .sql file into the backups folder or pass a file path:
  echo   tools\bat\RESTORE_GORY_DATABASE.bat backups\gory_YYYYMMDD_HHMMSS.sql
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:BACKUP_FILE; if (-not [IO.Path]::IsPathRooted($p)) { $p=Join-Path (Resolve-Path -LiteralPath '.').Path $p }; (Resolve-Path -LiteralPath $p).Path" 2^>nul`) do set "BACKUP_FILE=%%F"

if not exist "%BACKUP_FILE%" (
  echo Backup file was not found:
  echo   %BACKUP_FILE%
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

for %%F in ("%BACKUP_FILE%") do set "BACKUP_SIZE=%%~zF"
if "%BACKUP_SIZE%"=="0" (
  echo Backup file is empty:
  echo   %BACKUP_FILE%
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Backup:
echo   %BACKUP_FILE%
echo.
echo This will replace the local gory_staff database in Docker.
echo The current database on this PC should already be backed up.
echo.

if /i not "%GORY_RESTORE_CONFIRM%"=="1" (
  set "ANSWER="
  set /p "ANSWER=Type RESTORE and press Enter to continue: "
  if /i not "!ANSWER!"=="RESTORE" (
    echo Restore cancelled.
    exit /b 1
  )
)

set "PATH=C:\Program Files\Docker\Docker\resources\bin;%PATH%"
set "DOCKER_CMD="
for /f "delims=" %%D in ('where docker 2^>nul') do if not defined DOCKER_CMD set "DOCKER_CMD=%%D"
if not defined DOCKER_CMD if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" set "DOCKER_CMD=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if not defined DOCKER_CMD (
  echo Docker Desktop was not found.
  echo Install Docker Desktop, open it once, then run restore again.
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
    if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

echo Stopping app processes before restore...
set "ORIGINAL_GORY_CONTROL_NO_PAUSE=%GORY_CONTROL_NO_PAUSE%"
set "GORY_CONTROL_NO_PAUSE=1"
call "tools\bat\STOP_GORY_STAFF.bat" >nul 2>nul
set "GORY_CONTROL_NO_PAUSE=%ORIGINAL_GORY_CONTROL_NO_PAUSE%"

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

echo Terminating active database sessions...
"%DOCKER_CMD%" compose exec -T postgres psql -U gory -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'gory_staff' AND pid <> pg_backend_pid();" >nul
if errorlevel 1 (
  echo Could not terminate database sessions.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Restoring backup...
"%DOCKER_CMD%" compose exec -T postgres psql -U gory -d gory_staff -v ON_ERROR_STOP=1 < "%BACKUP_FILE%"
if errorlevel 1 (
  echo Restore failed. Check the backup file and Docker logs.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo OK: database was restored.
echo Now open Gory Control and press Start server.
echo.
if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
