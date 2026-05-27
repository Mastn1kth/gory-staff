[CmdletBinding()]
param(
  [string]$PublicUrl = 'https://app.gory-staff.ru',
  [string]$ConfigPath = (Join-Path $env:USERPROFILE '.cloudflared\config.yml'),
  [string]$EdgeRegion = ''
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$logDir = Join-Path $root 'runtime\logs'
$pidDir = Join-Path $root 'runtime\pids'
$serviceDir = Join-Path $root 'runtime\cloudflared-service'
$configLog = Join-Path $logDir 'cloudflared-service-config.log'
$serviceLog = Join-Path $logDir 'cloudflared-service.log'
$servicePid = Join-Path $pidDir 'cloudflared-service.pid'
$serviceConfig = Join-Path $serviceDir 'config.yml'

New-Item -ItemType Directory -Force -Path $logDir, $pidDir, $serviceDir | Out-Null

function Write-ConfigLog {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Encoding UTF8 -LiteralPath $configLog -Value $line
  Write-Host $Message
}

function Fail {
  param([string]$Message)
  Write-ConfigLog "ERROR: $Message"
  exit 1
}

function Quote-ServiceArg {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
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

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Administrator rights are required to replace the Cloudflared Windows service.'
  Write-Host 'A UAC prompt will open now.'

  $argumentList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Quote-ServiceArg $MyInvocation.MyCommand.Path),
    '-PublicUrl', (Quote-ServiceArg $PublicUrl),
    '-ConfigPath', (Quote-ServiceArg $ConfigPath)
  )
  if (-not [string]::IsNullOrWhiteSpace($EdgeRegion)) {
    $argumentList += @('-EdgeRegion', (Quote-ServiceArg $EdgeRegion))
  }
  $argumentList = $argumentList -join ' '

  Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Verb RunAs
  exit 0
}

Remove-Item -LiteralPath $configLog -Force -ErrorAction SilentlyContinue
Write-ConfigLog "Configuring Cloudflared Windows service for $PublicUrl."

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

$credentialMatch = [regex]::Match($configText, '(?m)^\s*credentials-file:\s*(.+?)\s*$')
if (-not $credentialMatch.Success) {
  Fail "Cloudflare config does not contain credentials-file: $resolvedConfig"
}

$credentialPath = $credentialMatch.Groups[1].Value.Trim().Trim('"').Trim("'")
if (-not [IO.Path]::IsPathRooted($credentialPath)) {
  $credentialPath = Join-Path (Split-Path -Parent $resolvedConfig) $credentialPath
}
if (-not (Test-Path -LiteralPath $credentialPath)) {
  Fail "Cloudflare credentials file was not found: $credentialPath"
}

$serviceCredential = Join-Path $serviceDir (Split-Path -Leaf $credentialPath)
Copy-Item -LiteralPath $credentialPath -Destination $serviceCredential -Force

$serviceCredentialYaml = ($serviceCredential -replace '\\', '/')
$serviceConfigText = [regex]::Replace(
  $configText,
  '(?m)^\s*credentials-file:\s*.+$',
  'credentials-file: "' + $serviceCredentialYaml + '"'
)
Set-Content -Encoding UTF8 -LiteralPath $serviceConfig -Value $serviceConfigText

try {
  $managedPidFile = Join-Path $pidDir 'cloudflared.pid'
  if (Test-Path -LiteralPath $managedPidFile) {
    $managedPid = [int](Get-Content -Raw -LiteralPath $managedPidFile)
    Stop-Process -Id $managedPid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $managedPidFile -Force -ErrorAction SilentlyContinue
    Write-ConfigLog "Stopped user-managed Cloudflare Tunnel PID $managedPid."
  }
} catch {
  Write-ConfigLog "Could not stop user-managed Cloudflare Tunnel: $($_.Exception.Message)"
}

try {
  $staleProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -like '*cloudflared*' -and
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match '30107770-fe4a-4b78-a7c1-ec37419500ee|app\.gory-staff\.ru|cloudflared-region-test|runtime\\cloudflared-service|\.cloudflared\\config\.yml'
    }
  foreach ($process in $staleProcesses) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
      Write-ConfigLog "Stopped stale Cloudflare Tunnel PID $($process.ProcessId)."
    } catch {}
  }
} catch {
  Write-ConfigLog "Could not stop stale Cloudflare Tunnel processes: $($_.Exception.Message)"
}

try {
  Write-ConfigLog 'Cleaning stale Cloudflare connector records.'
  $cleanupOutput = & $cloudflared tunnel --config $serviceConfig cleanup gory-staff-local
  $cleanupExitCode = $LASTEXITCODE
  $cleanupOutput | ForEach-Object { Write-ConfigLog $_ }
  if ($cleanupExitCode -ne 0) {
    Write-ConfigLog "Cloudflare connector cleanup returned exit code $cleanupExitCode."
  }
} catch {
  Write-ConfigLog "Could not clean stale Cloudflare connector records: $($_.Exception.Message)"
}

$existingService = Get-Service -Name Cloudflared -ErrorAction SilentlyContinue
if ($existingService) {
  Write-ConfigLog 'Stopping existing Cloudflared service.'
  try {
    Stop-Service -Name Cloudflared -Force -ErrorAction SilentlyContinue
    $existingService.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  } catch {
    Write-ConfigLog "Existing Cloudflared service did not stop cleanly: $($_.Exception.Message)"
  }

  Write-ConfigLog 'Deleting existing Cloudflared service.'
  & sc.exe delete Cloudflared | ForEach-Object { Write-ConfigLog $_ }
  Start-Sleep -Seconds 2
}

Remove-Item -LiteralPath $serviceLog, $servicePid -Force -ErrorAction SilentlyContinue

$binPathParts = @(
  (Quote-ServiceArg $cloudflared),
  'tunnel',
  '--config', (Quote-ServiceArg $serviceConfig),
  '--protocol', 'http2',
  '--edge-ip-version', '4'
)
if (-not [string]::IsNullOrWhiteSpace($EdgeRegion)) {
  $binPathParts += @('--region', $EdgeRegion)
}
$binPathParts += @(
  '--metrics', '127.0.0.1:20242',
  '--pidfile', (Quote-ServiceArg $servicePid),
  '--loglevel', 'info',
  '--transport-loglevel', 'warn',
  '--logfile', (Quote-ServiceArg $serviceLog),
  'run'
)
$binPath = $binPathParts -join ' '

if ([string]::IsNullOrWhiteSpace($EdgeRegion)) {
  Write-ConfigLog 'Cloudflare Edge region: automatic'
} else {
  Write-ConfigLog "Cloudflare Edge region: $EdgeRegion"
}

Write-ConfigLog 'Creating Cloudflared service.'
New-Service `
  -Name Cloudflared `
  -BinaryPathName $binPath `
  -DisplayName 'Cloudflared agent' `
  -StartupType Automatic | Out-Null
Write-ConfigLog 'Cloudflared service entry created.'

$failureOutput = & sc.exe failure Cloudflared reset= 86400 actions= 'restart/20000/restart/20000/restart/20000'
$failureExitCode = $LASTEXITCODE
$failureOutput | ForEach-Object { Write-ConfigLog $_ }
if ($failureExitCode -ne 0) {
  Fail "sc.exe failure Cloudflared failed with exit code $failureExitCode."
}

Write-ConfigLog 'Starting Cloudflared service.'
Start-Service -Name Cloudflared

$serviceReady = $false
for ($i = 0; $i -lt 30; $i++) {
  $service = Get-Service -Name Cloudflared -ErrorAction Stop
  if ($service.Status -eq 'Running') {
    $serviceReady = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $serviceReady) {
  Fail 'Cloudflared service did not reach Running state.'
}

Write-ConfigLog "Cloudflared service is running for https://app.gory-staff.ru."
Write-ConfigLog "Service config: $serviceConfig"
Write-ConfigLog "Service log: $serviceLog"
exit 0
