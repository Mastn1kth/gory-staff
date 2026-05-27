@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)

if not exist "backups" mkdir "backups"

set "STAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "STAMP=%STAMP: =0%"
set "OUT=backups\gory_%STAMP%.sql"

echo Backup: %OUT%

docker compose exec -T postgres pg_dump -U gory -d gory_staff --clean --if-exists > "%OUT%"
if errorlevel 1 (
  del /f /q "%OUT%" >nul 2>nul
  echo Backup failed: PostgreSQL is not available or pg_dump could not read the database.
  echo Start the server and database, then run backup again.
  exit /b 1
)

for %%F in ("%OUT%") do set "BACKUP_SIZE=%%~zF"
if "%BACKUP_SIZE%"=="0" (
  del /f /q "%OUT%" >nul 2>nul
  echo Backup failed: pg_dump created an empty file, so it was removed.
  echo Check that PostgreSQL is running and the database has data.
  exit /b 1
)

echo Verifying restore in temporary database...
set "VERIFY_DB=gory_staff_backup_check"
docker compose exec -T postgres psql -U gory -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS %VERIFY_DB% WITH (FORCE);" >nul
if errorlevel 1 (
  del /f /q "%OUT%" >nul 2>nul
  echo Backup failed: could not prepare the temporary restore-check database.
  exit /b 1
)
docker compose exec -T postgres psql -U gory -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE %VERIFY_DB%;" >nul
if errorlevel 1 (
  del /f /q "%OUT%" >nul 2>nul
  echo Backup failed: could not create the temporary restore-check database.
  exit /b 1
)
docker compose exec -T postgres psql -U gory -d %VERIFY_DB% -v ON_ERROR_STOP=1 < "%OUT%" >nul
set "RESTORE_CODE=%ERRORLEVEL%"
docker compose exec -T postgres psql -U gory -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS %VERIFY_DB% WITH (FORCE);" >nul
if not "%RESTORE_CODE%"=="0" (
  del /f /q "%OUT%" >nul 2>nul
  echo Backup failed: restore verification failed, so the backup file was removed.
  exit /b 1
)

echo OK: %OUT%

for /f %%C in ('dir /b /o-d backups\gory_*.sql 2^>nul ^| find /c /v ""') do set COUNT=%%C
if %COUNT% GTR 30 (
  echo Trimming old backups - keep 30...
  powershell -NoProfile -Command "Get-ChildItem 'backups\gory_*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force"
)

exit /b 0
