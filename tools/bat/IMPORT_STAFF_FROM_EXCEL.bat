@echo off
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
echo Import staff and guests from data\Gory-Data.xlsx...
if not exist "data\Gory-Data.xlsx" (
  echo Place Gory-Data.xlsx in the data folder.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)
python tools\import_excel_tables.py "data\Gory-Data.xlsx"
if errorlevel 1 (
  echo Import failed.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)
echo Import finished.
if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
