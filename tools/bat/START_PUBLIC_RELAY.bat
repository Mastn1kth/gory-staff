@echo off
setlocal
cd /d "%~dp0\..\.."

if not exist "runtime\https-relay\register-token.txt" (
  echo Public relay is not configured yet.
  echo Missing runtime\https-relay\register-token.txt
  exit /b 1
)

echo Starting public mobile relay in background...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path '.').Path; $pidFile=Join-Path $root 'runtime\https-relay\edge-connector.pid'; if (Test-Path $pidFile) { try { $old=[int](Get-Content -Raw $pidFile); Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } catch {} }; $out=Join-Path $root 'runtime\logs\edge-connector.out.log'; $err=Join-Path $root 'runtime\logs\edge-connector.err.log'; Start-Process -FilePath 'node.exe' -ArgumentList @('tools\gory-edge-connector.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null"

echo Public relay start requested.
echo Status: runtime\logs\edge-connector.log
endlocal
