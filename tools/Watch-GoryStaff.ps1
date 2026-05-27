param(
  [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path,
  [int]$IntervalSeconds = 20
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Set-Location -LiteralPath $ProjectRoot

$LogDir = Join-Path $ProjectRoot 'runtime\logs'
$PidDir = Join-Path $ProjectRoot 'runtime\pids'
$RelayDir = Join-Path $ProjectRoot 'runtime\https-relay'
$WatchdogLog = Join-Path $LogDir 'gory-watchdog.log'
$WatchdogPidFile = Join-Path $PidDir 'gory-watchdog.pid'
$ServerPidFile = Join-Path $PidDir 'gory-server.pid'
$RelayPidFile = Join-Path $RelayDir 'edge-connector.pid'
$RelayTokenFile = Join-Path $RelayDir 'register-token.txt'
$PublicUrl = 'https://app.gory-staff.ru'

New-Item -ItemType Directory -Force -Path $LogDir, $PidDir, $RelayDir | Out-Null
Set-Content -Encoding ASCII -LiteralPath $WatchdogPidFile -Value $PID

function Write-WatchLog {
  param([string]$Message)
  Add-Content -Encoding UTF8 -LiteralPath $WatchdogLog -Value "$(Get-Date -Format o) $Message"
}

function Get-PidFileValue {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    return [int]((Get-Content -Raw -LiteralPath $Path).Trim())
  } catch {
    return $null
  }
}

function Test-ProcessAlive {
  param([int]$ProcessId)
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    return -not $process.HasExited
  } catch {
    return $false
  }
}

function Get-GoryApiProcessIds {
  $ids = @()
  try {
    $ids += Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {}
  try {
    $ids += Get-CimInstance Win32_Process |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'server[\\/]src[\\/]index\.js' } |
      Select-Object -ExpandProperty ProcessId
  } catch {}
  return @($ids | Where-Object { $_ } | Select-Object -Unique)
}

function Stop-GoryApi {
  foreach ($id in (Get-GoryApiProcessIds)) {
    try {
      Write-WatchLog "Stopping stale API PID $id"
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}

function Test-GoryApiHealth {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 3
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Start-GoryApi {
  Stop-GoryApi
  $out = Join-Path $LogDir 'server-live.out.log'
  $err = Join-Path $LogDir 'server-live.err.log'
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  Write-WatchLog 'Starting Gory API'
  $process = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('--workspace', 'server', 'run', 'start') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err `
    -PassThru
  Set-Content -Encoding ASCII -LiteralPath $ServerPidFile -Value $process.Id
}

function Ensure-GoryApi {
  if (Test-GoryApiHealth) {
    return $true
  }

  Write-WatchLog 'API health failed; restarting API'
  Start-GoryApi
  for ($i = 0; $i -lt 45; $i += 1) {
    Start-Sleep -Seconds 1
    if (Test-GoryApiHealth) {
      Write-WatchLog 'API health restored'
      return $true
    }
  }

  Write-WatchLog 'API did not become healthy after restart'
  return $false
}

function Get-PublicRelayProcessIds {
  $ids = @()
  $pidFromFile = Get-PidFileValue $RelayPidFile
  if ($pidFromFile -and (Test-ProcessAlive $pidFromFile)) {
    $ids += $pidFromFile
  }
  try {
    $ids += Get-CimInstance Win32_Process |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'tools[\\/]gory-edge-connector\.js' } |
      Select-Object -ExpandProperty ProcessId
  } catch {}
  return @($ids | Where-Object { $_ } | Select-Object -Unique)
}

function Stop-PublicRelay {
  foreach ($id in (Get-PublicRelayProcessIds)) {
    try {
      Write-WatchLog "Stopping public relay PID $id"
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Remove-Item -LiteralPath $RelayPidFile -Force -ErrorAction SilentlyContinue
}

function Test-PublicRelayStatus {
  try {
    $status = Invoke-RestMethod -Uri "$PublicUrl/_gory_relay/status" -TimeoutSec 8
    return $status.connected -eq $true
  } catch {
    return $false
  }
}

function Start-PublicRelay {
  if (-not (Test-Path -LiteralPath $RelayTokenFile)) {
    Write-WatchLog 'Public relay token is missing; relay cannot start'
    return
  }

  Stop-PublicRelay
  $out = Join-Path $LogDir 'edge-connector.out.log'
  $err = Join-Path $LogDir 'edge-connector.err.log'
  Write-WatchLog 'Starting public relay'
  $process = Start-Process -FilePath 'node.exe' `
    -ArgumentList @('tools\gory-edge-connector.js') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err `
    -PassThru
  Set-Content -Encoding ASCII -LiteralPath $RelayPidFile -Value $process.Id
}

function Ensure-PublicRelay {
  $relayIds = Get-PublicRelayProcessIds
  if ($relayIds.Count -gt 0 -and (Test-PublicRelayStatus)) {
    return $true
  }

  Write-WatchLog 'Public relay is not connected; restarting relay'
  Start-PublicRelay
  for ($i = 0; $i -lt 20; $i += 1) {
    Start-Sleep -Seconds 1
    if ((Get-PublicRelayProcessIds).Count -gt 0 -and (Test-PublicRelayStatus)) {
      Write-WatchLog 'Public relay restored'
      return $true
    }
  }

  Write-WatchLog 'Public relay did not confirm connection after restart'
  return $false
}

function Ensure-Postgres {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) {
    Write-WatchLog 'Docker was not found; PostgreSQL cannot be checked'
    return $false
  }

  try {
    & $docker.Source context use desktop-linux *> $null
  } catch {}

  try {
    & $docker.Source compose exec -T postgres pg_isready -U gory -d gory_staff *> $null
    if ($LASTEXITCODE -eq 0) {
      return $true
    }
  } catch {}

  Write-WatchLog 'PostgreSQL is not ready; starting Docker compose postgres'
  try {
    & $docker.Source compose up -d postgres *> $null
  } catch {}

  for ($i = 0; $i -lt 30; $i += 1) {
    Start-Sleep -Seconds 2
    try {
      & $docker.Source compose exec -T postgres pg_isready -U gory -d gory_staff *> $null
      if ($LASTEXITCODE -eq 0) {
        Write-WatchLog 'PostgreSQL restored'
        return $true
      }
    } catch {}
  }

  Write-WatchLog 'PostgreSQL did not become ready'
  return $false
}

Write-WatchLog "Watchdog started for $ProjectRoot"

while ($true) {
  try {
    Ensure-Postgres | Out-Null
    Ensure-GoryApi | Out-Null
    Ensure-PublicRelay | Out-Null
  } catch {
    Write-WatchLog "Watchdog loop error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $IntervalSeconds
}
