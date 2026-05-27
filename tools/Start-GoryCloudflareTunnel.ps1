[CmdletBinding()]
param(
  [string]$PublicUrl = 'https://app.gory-staff.ru',
  [string]$ConfigPath = (Join-Path $env:USERPROFILE '.cloudflared\config.yml'),
  [string]$EdgeRegion = '',
  [switch]$SkipPublicCheck,
  [int]$PublicCheckSeconds = 90,
  [int]$PublicCheckSuccesses = 3
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$logDir = Join-Path $root 'runtime\logs'
$pidDir = Join-Path $root 'runtime\pids'
$statusFile = Join-Path $logDir 'cloudflared-status.txt'
$pidFile = Join-Path $pidDir 'cloudflared.pid'
$cloudflaredLog = Join-Path $logDir 'cloudflared-tunnel.log'
$outLog = Join-Path $logDir 'cloudflared-tunnel.out.log'
$errLog = Join-Path $logDir 'cloudflared-tunnel.err.log'

New-Item -ItemType Directory -Force -Path $logDir, $pidDir | Out-Null
Remove-Item -LiteralPath $statusFile -Force -ErrorAction SilentlyContinue

function Add-Status {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Encoding UTF8 -LiteralPath $statusFile -Value $line
  Write-Host $Message
}

function Fail {
  param([string]$Message)
  Add-Status "ERROR: $Message"
  exit 1
}

function Quote-Arg {
  param([string]$Value)
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

function Resolve-CloudflaredPath {
  $projectCloudflared = Join-Path $root 'runtime\bin\cloudflared.exe'
  if (Test-Path -LiteralPath $projectCloudflared) {
    return (Resolve-Path -LiteralPath $projectCloudflared).Path
  }

  $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $installedCloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  if (Test-Path -LiteralPath $installedCloudflared) {
    return $installedCloudflared
  }

  return $null
}

function Test-TcpPortAvailable {
  param([int]$Port)
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

function Select-MetricsPort {
  foreach ($port in 20242..20249) {
    if (Test-TcpPortAvailable -Port $port) {
      return $port
    }
  }
  return 0
}

function Stop-PreviousManagedTunnel {
  param([string]$ResolvedConfigPath)

  if (Test-Path -LiteralPath $pidFile) {
    try {
      $oldPid = [int](Get-Content -Raw -LiteralPath $pidFile)
      if ($oldPid -gt 0) {
        Add-Status "Stopping previous managed Cloudflare Tunnel PID $oldPid."
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Add-Status "Could not stop PID from ${pidFile}: $($_.Exception.Message)"
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }

  $servicePid = $null
  try {
    $service = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
    if ($service) {
      $servicePid = [int]$service.ProcessId
    }
  } catch {}

  $escapedConfig = [regex]::Escape($ResolvedConfigPath)
  $pattern = 'gory-staff-local|30107770-fe4a-4b78-a7c1-ec37419500ee|app\.gory-staff\.ru|' + $escapedConfig
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -like '*cloudflared*' -and
      $_.ProcessId -ne $PID -and
      ($null -eq $servicePid -or $_.ProcessId -ne $servicePid) -and
      $_.CommandLine -match $pattern
    }

  foreach ($process in $processes) {
    try {
      Add-Status "Stopping stale Cloudflare Tunnel PID $($process.ProcessId)."
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
      Add-Status "Could not stop Cloudflare PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Get-CloudflaredHaConnections {
  param([int]$MetricsPort)

  try {
    $metrics = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$MetricsPort/metrics" -TimeoutSec 2
    $match = [regex]::Match($metrics.Content, '(?m)^cloudflared_tunnel_ha_connections\s+(\d+)')
    if ($match.Success) {
      return [int]$match.Groups[1].Value
    }
  } catch {}

  return $null
}

function Get-CloudflaredConfigPathFromCommandLine {
  param([string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $null
  }

  $match = [regex]::Match($CommandLine, '--config\s+(?:"([^"]+)"|([^\s]+))')
  if (-not $match.Success) {
    return $null
  }

  if (-not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
    return $match.Groups[1].Value
  }

  return $match.Groups[2].Value
}

function Test-PublicHealth {
  param(
    [string]$Url,
    [int]$TimeoutSeconds,
    [int]$RequiredSuccesses
  )

  $healthUrl = $Url.TrimEnd('/') + '/health'
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $successes = 0
  $targetSuccesses = [Math]::Max(1, $RequiredSuccesses)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 8
      if ($response.ok) {
        $successes += 1
        Add-Status "Public health OK ($successes/$targetSuccesses consecutive public health checks): $healthUrl"
        if ($successes -ge $targetSuccesses) {
          return $true
        }
      } else {
        $successes = 0
      }
    } catch {
      $successes = 0
      Add-Status "Public health waiting: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 3
  }

  return $false
}

$uri = $null
try {
  $uri = [uri]$PublicUrl
} catch {
  Fail "Invalid PublicUrl: $PublicUrl"
}

if ($uri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($uri.Host)) {
  Fail "PublicUrl must be an https URL with a host: $PublicUrl"
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Fail "Cloudflare config was not found: $ConfigPath"
}

$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$configText = Get-Content -Raw -LiteralPath $resolvedConfig
if ($configText -notmatch [regex]::Escape($uri.Host)) {
  Fail "Cloudflare config does not contain hostname $($uri.Host): $resolvedConfig"
}

$cloudflared = Resolve-CloudflaredPath
if (-not $cloudflared) {
  Fail 'cloudflared.exe was not found.'
}

try {
  $service = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
  if ($service -and $service.State -eq 'Running') {
    $serviceConfigPath = Get-CloudflaredConfigPathFromCommandLine -CommandLine $service.PathName
    $serviceConfigHasHost = $false
    $serviceUsesForcedRegion = $service.PathName -match '--region\s+\S+'
    if ($serviceConfigPath -and (Test-Path -LiteralPath $serviceConfigPath)) {
      $serviceConfigHasHost = (Get-Content -Raw -LiteralPath $serviceConfigPath) -match [regex]::Escape($uri.Host)
    }

    if ($serviceConfigHasHost -and -not $serviceUsesForcedRegion) {
      Add-Status "Cloudflared Windows service already runs for $($uri.Host)."
      if ($SkipPublicCheck) {
        exit 0
      }
      if (Test-PublicHealth -Url $PublicUrl -TimeoutSeconds $PublicCheckSeconds -RequiredSuccesses $PublicCheckSuccesses) {
        exit 0
      }
      Fail 'Cloudflared service is running, but public health check failed.'
    }

    if ($serviceConfigHasHost -and $serviceUsesForcedRegion) {
      Add-Status "Cloudflared Windows service uses a forced edge region; managed user tunnel will be started."
    }

    if (-not $serviceConfigHasHost) {
      Add-Status "Cloudflared Windows service is running, but it is not configured for $($uri.Host). Managed user tunnel will be started."
    }
  }
} catch {
  Add-Status "Could not inspect Cloudflared Windows service: $($_.Exception.Message)"
}

$metricsPort = Select-MetricsPort
if ($metricsPort -eq 0) {
  Fail 'No free local metrics port in range 20242-20249.'
}

Stop-PreviousManagedTunnel -ResolvedConfigPath $resolvedConfig
Remove-Item -LiteralPath $outLog, $errLog, $cloudflaredLog -Force -ErrorAction SilentlyContinue

$argumentParts = @(
  'tunnel',
  '--config', (Quote-Arg $resolvedConfig),
  '--protocol', 'http2',
  '--edge-ip-version', '4'
)
if (-not [string]::IsNullOrWhiteSpace($EdgeRegion)) {
  $argumentParts += @('--region', $EdgeRegion)
}
$argumentParts += @(
  '--metrics', "127.0.0.1:$metricsPort",
  '--pidfile', (Quote-Arg $pidFile),
  '--loglevel', 'info',
  '--transport-loglevel', 'warn',
  '--logfile', (Quote-Arg $cloudflaredLog),
  'run'
)
$arguments = $argumentParts -join ' '

Add-Status "Starting Cloudflare Tunnel for $PublicUrl."
if ([string]::IsNullOrWhiteSpace($EdgeRegion)) {
  Add-Status 'Cloudflare Edge region: automatic'
} else {
  Add-Status "Cloudflare Edge region: $EdgeRegion"
}
Add-Status "Metrics: http://127.0.0.1:$metricsPort/metrics"
Add-Status "Log: $cloudflaredLog"

$process = Start-Process -FilePath $cloudflared `
  -ArgumentList $arguments `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Encoding ASCII -LiteralPath $pidFile -Value $process.Id

$connected = $false
for ($i = 0; $i -lt 30; $i++) {
  if ($process.HasExited) {
    Fail "cloudflared exited early with code $($process.ExitCode). Check $errLog and $cloudflaredLog."
  }

  $haConnections = Get-CloudflaredHaConnections -MetricsPort $metricsPort
  if ($null -ne $haConnections) {
    Add-Status "cloudflared_tunnel_ha_connections $haConnections"
    if ($haConnections -gt 0) {
      $connected = $true
      break
    }
  }

  if (Test-Path -LiteralPath $cloudflaredLog) {
    $recentLog = Get-Content -Tail 80 -LiteralPath $cloudflaredLog -ErrorAction SilentlyContinue
    if ($recentLog -match 'Registered tunnel connection|Connection .* registered') {
      $connected = $true
      break
    }
  }

  Start-Sleep -Seconds 2
}

if (-not $connected) {
  Fail "cloudflared started as PID $($process.Id), but no active HA connection was detected."
}

Add-Status "Cloudflare Tunnel is connected as PID $($process.Id)."

if ($SkipPublicCheck) {
  exit 0
}

if (-not (Test-PublicHealth -Url $PublicUrl -TimeoutSeconds $PublicCheckSeconds -RequiredSuccesses $PublicCheckSuccesses)) {
  Fail "Public health did not become ready: $($PublicUrl.TrimEnd('/'))/health"
}

exit 0
