@echo off
setlocal
cd /d "%~dp0\..\.."

if not exist "runtime\iiko\events" mkdir "runtime\iiko\events"
if not exist "runtime\logs" mkdir "runtime\logs"

echo Starting iiko event connector in background...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path '.').Path; $pidFile=Join-Path $root 'runtime\iiko\iiko-event-connector.pid'; if (Test-Path $pidFile) { try { $old=[int](Get-Content -Raw $pidFile); Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } catch {} }; $out=Join-Path $root 'runtime\logs\iiko-event-connector.out.log'; $err=Join-Path $root 'runtime\logs\iiko-event-connector.err.log'; $process=Start-Process -FilePath 'node.exe' -ArgumentList @('tools\iiko-event-connector.js','--dir','runtime\iiko\events','--watch','--interval-ms','1000') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru; Set-Content -Path $pidFile -Value $process.Id -Encoding ascii"

echo iiko event connector start requested.
echo Drop JSON or JSONL events into runtime\iiko\events.
echo Logs: runtime\logs\iiko-event-connector.out.log
echo Errors: runtime\logs\iiko-event-connector.err.log
endlocal
