Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $root 'runtime\logs'
$pidDir = Join-Path $root 'runtime\pids'
$buildsDir = Join-Path $root 'builds'
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $logDir, $pidDir, $buildsDir, $dataDir | Out-Null

$panelLog = Join-Path $logDir 'control-panel.log'
$serverLog = Join-Path $logDir 'control-start-server.log'
$buildLog = Join-Path $logDir 'control-build-apk.log'
$backupLog = Join-Path $logDir 'control-backup.log'
$importLog = Join-Path $logDir 'control-import-excel.log'
$startBat = Join-Path $root 'tools\bat\START_GORY_STAFF.bat'
$buildBat = Join-Path $root 'tools\bat\BUILD_ANDROID_APK.bat'
$backupBat = Join-Path $root 'tools\bat\BACKUP_GORY_DATABASE.bat'
$importBat = Join-Path $root 'tools\bat\IMPORT_STAFF_FROM_EXCEL.bat'
$excelScript = Join-Path $root 'tools\export_excel_tables.py'
$excelFile = Join-Path $dataDir 'Gory-Data.xlsx'
$latestApk = Join-Path $buildsDir 'Gory-latest.apk'
$publicUrl = 'https://app.gory-staff.ru'

function Get-LogLength {
  param([string] $Path)
  try {
    if (Test-Path -LiteralPath $Path) {
      return (Get-Item -LiteralPath $Path).Length
    }
  } catch {}
  return 0
}

$jobs = @()
$serverStartRequestedAt = $null
$lastServerLogLength = Get-LogLength $serverLog
$lastBuildLogLength = Get-LogLength $buildLog
$lastBackupLogLength = Get-LogLength $backupLog
$lastImportLogLength = Get-LogLength $importLog

function New-Font($size, [System.Drawing.FontStyle] $style = [System.Drawing.FontStyle]::Regular) {
  New-Object System.Drawing.Font('Segoe UI', $size, $style)
}

function Add-Log {
  param([string] $Text)
  $line = ('{0:HH:mm:ss}  {1}' -f (Get-Date), $Text)
  Add-Content -LiteralPath $panelLog -Encoding UTF8 -Value $line
  if ($script:logBox) {
    $script:logBox.AppendText($line + [Environment]::NewLine)
    $script:logBox.SelectionStart = $script:logBox.TextLength
    $script:logBox.ScrollToCaret()
  }
}

function Test-GoryHealthUrl {
  param(
    [string] $Url,
    [int] $TimeoutSec = 8
  )

  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec
    if ($response.ok) {
      return [pscustomobject]@{ Ok = $true; Via = 'PowerShell'; Error = $null }
    }
    return [pscustomobject]@{ Ok = $false; Via = 'PowerShell'; Error = 'Ответ есть, но ok не true.' }
  } catch {
    $powerShellError = $_.Exception.Message
  }

  try {
    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
    if (-not $curl) {
      return [pscustomobject]@{ Ok = $false; Via = 'PowerShell'; Error = $powerShellError }
    }
    $raw = & $curl -L --max-time $TimeoutSec -fsS $Url 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
      $json = ($raw -join "`n") | ConvertFrom-Json
      if ($json.ok) {
        return [pscustomobject]@{ Ok = $true; Via = 'curl'; Error = $null }
      }
      return [pscustomobject]@{ Ok = $false; Via = 'curl'; Error = 'Ответ есть, но ok не true.' }
    }
    return [pscustomobject]@{ Ok = $false; Via = 'curl'; Error = $powerShellError }
  } catch {
    return [pscustomobject]@{ Ok = $false; Via = 'curl'; Error = $_.Exception.Message }
  }
}

function Set-Card {
  param(
    [System.Windows.Forms.Label] $Label,
    [string] $Text,
    [string] $Color
  )
  $Label.Text = $Text
  $Label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($Color)
}

function Start-LoggedBat {
  param(
    [string] $Name,
    [string] $BatPath,
    [string] $LogPath,
    [switch] $PipeEnter
  )

  if (-not (Test-Path -LiteralPath $BatPath)) {
    Add-Log "Не найден файл: $BatPath"
    return
  }

  Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue
  $existingLogLength = Get-LogLength $LogPath
  if ($LogPath -eq $script:serverLog) { $script:lastServerLogLength = $existingLogLength }
  if ($LogPath -eq $script:buildLog) { $script:lastBuildLogLength = $existingLogLength }
  if ($LogPath -eq $script:backupLog) { $script:lastBackupLogLength = $existingLogLength }
  if ($LogPath -eq $script:importLog) { $script:lastImportLogLength = $existingLogLength }
  Add-Log "Запускаю: $Name"

  $batCommand = 'chcp 65001>nul'
  if ($PipeEnter) { $batCommand += ' & set "GORY_CONTROL_NO_PAUSE=1"' }
  $batCommand += ' & call "' + $BatPath + '" >> "' + $LogPath + '" 2>>&1'
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', $batCommand) -WorkingDirectory $root -WindowStyle Hidden -PassThru

  if ($Name -like '*сервер*') {
    Set-Content -Encoding ASCII -LiteralPath (Join-Path $pidDir 'gory-start-bat.pid') -Value $process.Id
  }

  Add-Log "$Name запущен в фоне. Журнал: $LogPath"
}

function Start-ControlJob {
  param(
    [string] $Name,
    [scriptblock] $ScriptBlock
  )
  Add-Log "Выполняю: $Name"
  $job = Start-Job -ScriptBlock $ScriptBlock
  $script:jobs += [pscustomobject]@{ Name = $Name; Job = $job }
}

function Stop-GoryStack {
  Start-ControlJob 'остановка сервера' {
    $root = $using:root
    $lines = @()
    $lines += 'Останавливаю сервер и процессы приложения...'
    $pidFiles = @(
      (Join-Path $root 'runtime\pids\gory-server.pid'),
      (Join-Path $root 'runtime\pids\gory-start-bat.pid'),
      (Join-Path $root '.gory-server.pid'),
      (Join-Path $root '.gory-start-bat.pid')
    )
    foreach ($pidFile in $pidFiles) {
      if (Test-Path -LiteralPath $pidFile) {
        try {
          $pidValue = [int](Get-Content -Raw -LiteralPath $pidFile)
          Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
          $lines += "Остановлен PID $pidValue"
        } catch {}
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      }
    }

    foreach ($port in @(4000, 8081, 19000, 19001, 19002)) {
      $ids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($id in $ids) {
        try {
          Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
          $lines += "Освобождён порт $port, PID $id"
        } catch {}
      }
    }

    try {
      $relayPidFile = Join-Path $root 'runtime\https-relay\edge-connector.pid'
      if (Test-Path -LiteralPath $relayPidFile) {
        $relayPid = [int](Get-Content -Raw -LiteralPath $relayPidFile)
        Stop-Process -Id $relayPid -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $relayPidFile -Force -ErrorAction SilentlyContinue
        $lines += "Остановлен публичный relay PID $relayPid"
      }
      $relayIds = Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -match 'tools[\\/]gory-edge-connector\.js' } |
        Select-Object -ExpandProperty ProcessId
      foreach ($id in $relayIds) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      }
    } catch {}

    try {
      $pidFiles = @(
        (Join-Path $root 'runtime\pids\cloudflared.pid'),
        (Join-Path $root 'runtime\pids\cloudflared-quick.pid')
      )
      foreach ($pidFile in $pidFiles) {
        if (Test-Path -LiteralPath $pidFile) {
          try {
            $pidValue = [int](Get-Content -Raw -LiteralPath $pidFile)
            Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
            $lines += "Остановлен Cloudflare PID $pidValue"
          } catch {}
          Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        }
      }
      $cloudflaredIds = Get-CimInstance Win32_Process |
        Where-Object { $_.Name -like '*cloudflared*' -and ($_.CommandLine -match 'gory-staff-local|30107770|app\.gory-staff\.ru|\.cloudflared\\config\.yml') } |
        Select-Object -ExpandProperty ProcessId
      foreach ($id in $cloudflaredIds) {
        try {
          Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
          $lines += "Остановлен Cloudflare PID $id"
        } catch {}
      }
      $lines += 'Старый Cloudflare Tunnel остановлен, если он был запущен.'
    } catch {
      $lines += 'Старый Cloudflare Tunnel не удалось остановить: ' + $_.Exception.Message
    }

    try {
      Push-Location $root
      docker compose stop postgres *> $null
      if ($LASTEXITCODE -eq 0) { $lines += 'PostgreSQL в Docker остановлен. Данные сохранены.' }
      else { $lines += 'Docker/PostgreSQL не остановлен или Docker не запущен.' }
      Pop-Location
    } catch {
      $lines += 'Docker недоступен: ' + $_.Exception.Message
    }
    $lines
  }
}

function Check-GoryState {
  Start-ControlJob 'проверка состояния' {
    $root = $using:root
    $publicUrl = $using:publicUrl
    $lines = @()
    function Test-GoryHealthUrl {
      param(
        [string] $Url,
        [int] $TimeoutSec = 8,
        [switch] $ForcePublicDns
      )

      if ($ForcePublicDns) {
        try {
          $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
          if (-not $curl) {
            return [pscustomobject]@{ Ok = $false; Error = 'curl.exe не найден.' }
          }
          $hostName = ([uri]$Url).Host
          $ips = @()
          try {
            $ips = & nslookup $hostName 1.1.1.1 2>$null |
              Select-String -Pattern '^\s*(\d{1,3}\.){3}\d{1,3}\s*$' |
              ForEach-Object { $_.Matches[0].Value.Trim() } |
              Where-Object { $_ -notlike '100.*' } |
              Select-Object -Unique
          } catch {}
          if (-not $ips) {
            return [pscustomobject]@{ Ok = $false; Error = 'Публичные IP Cloudflare не найдены.' }
          }
          for ($attempt = 0; $attempt -lt 3; $attempt++) {
            foreach ($ip in $ips) {
              $resolveArg = $hostName + ':443:' + $ip
              $raw = & $curl -L --max-time $TimeoutSec --resolve $resolveArg -fsS $Url 2>$null
              if ($LASTEXITCODE -eq 0 -and $raw) {
                $json = ($raw -join "`n") | ConvertFrom-Json
                if ($json.ok) {
                  return [pscustomobject]@{ Ok = $true; Error = $null }
                }
              }
            }
            Start-Sleep -Seconds 2
          }
          return [pscustomobject]@{ Ok = $false; Error = 'Публичный домен не ответил снаружи.' }
        } catch {
          return [pscustomobject]@{ Ok = $false; Error = $_.Exception.Message }
        }
      }

      try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec
        if ($response.ok) {
          return [pscustomobject]@{ Ok = $true; Error = $null }
        }
        return [pscustomobject]@{ Ok = $false; Error = 'Ответ есть, но ok не true.' }
      } catch {
        $powerShellError = $_.Exception.Message
      }

      try {
        $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
        if (-not $curl) {
          return [pscustomobject]@{ Ok = $false; Error = $powerShellError }
        }
        $raw = & $curl -L --max-time $TimeoutSec -fsS $Url 2>$null
        if ($LASTEXITCODE -eq 0 -and $raw) {
          $json = ($raw -join "`n") | ConvertFrom-Json
          if ($json.ok) {
            return [pscustomobject]@{ Ok = $true; Error = $null }
          }
        }
        return [pscustomobject]@{ Ok = $false; Error = $powerShellError }
      } catch {
        return [pscustomobject]@{ Ok = $false; Error = $_.Exception.Message }
      }
    }

    $lines += '=== Проверка сервера ==='
    try {
      $local = Test-GoryHealthUrl -Url 'http://127.0.0.1:4000/health' -TimeoutSec 4
      if ($local.Ok) { $lines += 'Локальный сервер: работает.' } else { $lines += 'Локальный сервер: ответил, но ok не true.' }
    } catch {
      $lines += 'Локальный сервер: не отвечает.'
    }

    try {
      $public = Test-GoryHealthUrl -Url ($publicUrl + '/health') -TimeoutSec 15 -ForcePublicDns
      if ($public.Ok) {
        $lines += 'Мобильный интернет: работает через публичный HTTPS relay.'
      } else {
        $lines += 'Мобильный интернет: не работает: ' + $public.Error
        $lines += 'Нажми «Запустить сервер», чтобы заново поднять публичный relay.'
      }
    } catch {
      $lines += 'Мобильный интернет: не работает. Проверь публичный relay.'
    }

    try {
      $tcpConnections = @(Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue)
      $listener = $tcpConnections | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
      if ($listener) {
        $lines += ('Порт 4000: слушает PID ' + $listener.OwningProcess)
      } elseif ($tcpConnections) {
        $lines += 'Порт 4000: есть только временные соединения, сервер не слушает порт.'
      } else {
        $lines += 'Порт 4000: свободен, сервер не поднят.'
      }
    } catch {}

    try {
      $docker = docker ps --filter 'name=gory-staff-postgres' --format '{{.Names}} {{.Status}}'
      if ($LASTEXITCODE -eq 0 -and $docker) { $lines += 'Docker: ' + ($docker -join '; ') } else { $lines += 'Docker: база gory-staff-postgres не запущена.' }
    } catch {
      $lines += 'Docker: не отвечает.'
    }

    try {
      $relayProcess = Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -match 'tools[\\/]gory-edge-connector\.js' } |
        Select-Object -First 1
      if ($relayProcess) {
        $lines += 'Публичный relay: процесс запущен.'
      } else {
        $lines += 'Публичный relay: процесс не запущен.'
      }
    } catch {
      $lines += 'Публичный relay: не проверен.'
    }

    $apk = Join-Path $root 'builds\Gory-latest.apk'
    $excel = Join-Path $root 'data\Gory-Data.xlsx'
    $lines += if (Test-Path -LiteralPath $apk) { 'APK: найден builds\Gory-latest.apk' } else { 'APK: не найден, нажми Создать APK.' }
    $lines += if (Test-Path -LiteralPath $excel) { 'Excel: найден data\Gory-Data.xlsx' } else { 'Excel: не найден, нажми Открыть Excel для создания.' }
    $lines
  }
}

function Open-GoryApk {
  $apk = $latestApk
  if (-not (Test-Path -LiteralPath $apk)) {
    $candidate = Get-ChildItem -LiteralPath $buildsDir -Filter '*.apk' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { $apk = $candidate.FullName }
  }
  if (Test-Path -LiteralPath $apk) {
    Add-Log "Открываю APK: $apk"
    Start-Process explorer.exe -ArgumentList "/select,`"$apk`""
  } else {
    Add-Log 'APK не найден. Нажми «Создать APK».'
  }
}

function Open-GoryExcel {
  Add-Log 'Готовлю Excel с сотрудниками и гостями...'
  if (Test-Path -LiteralPath $excelScript) {
    try {
      $result = & python $excelScript 2>&1
      if ($LASTEXITCODE -eq 0) { Add-Log 'Excel обновлён.' } else { Add-Log ('Excel не обновился: ' + ($result -join ' ')) }
    } catch {
      Add-Log ('Не удалось обновить Excel: ' + $_.Exception.Message)
    }
  }
  if (Test-Path -LiteralPath $excelFile) {
    Add-Log "Открываю Excel: $excelFile"
    Start-Process -FilePath $excelFile
  } else {
    Add-Log 'Excel-файл не найден: data\Gory-Data.xlsx'
  }
}

function Pull-NewLogText {
  param(
    [string] $Path,
    [ref] $LastLength
  )
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    $info = Get-Item -LiteralPath $Path
    if ($info.Length -le $LastLength.Value) { return }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
    try {
      $stream.Seek($LastLength.Value, [System.IO.SeekOrigin]::Begin) | Out-Null
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
      $chunk = $reader.ReadToEnd()
      $LastLength.Value = $info.Length
      foreach ($line in ($chunk -split "`r?`n")) {
        if ($line.Trim()) {
          $text = $line.Trim()
          Add-Log $text
          if ($Path -eq $serverLog) {
            if ($text -eq 'READY' -or $text -like 'API local:*OK*') { Set-Card $apiCard 'работает' '#2F7D46' }
            if ($text -like 'Server stopped*' -or $text -like 'Server start failed*' -or $text -like 'Server did not start*') { Set-Card $apiCard 'не отвечает' '#9F2D3F' }
            if ($text -like 'Public HTTPS:*OK*') { Set-Card $mobileCard 'работает' '#2F7D46' }
            if ($text -like '*CHECK PUBLIC RELAY*') { Set-Card $mobileCard 'только Wi-Fi' '#D7A94A' }
          }
        }
      }
    } finally {
      $stream.Dispose()
    }
  } catch {}
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Горы — управление'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(980, 720)
$form.MinimumSize = New-Object System.Drawing.Size(900, 640)
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#F5EFE4')
$form.Font = New-Font 10
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
$form.MaximizeBox = $true
$form.MinimizeBox = $true
$form.ControlBox = $true

$header = New-Object System.Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = 112
$header.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#24211E')
$form.Controls.Add($header)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Горы'
$title.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#FFF8EA')
$title.Font = New-Font 25 ([System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(28, 18)
$title.Size = New-Object System.Drawing.Size(400, 40)
$header.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Панель запуска сервера, APK и Excel'
$subtitle.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#D7A94A')
$subtitle.Font = New-Font 11 ([System.Drawing.FontStyle]::Bold)
$subtitle.Location = New-Object System.Drawing.Point(31, 62)
$subtitle.Size = New-Object System.Drawing.Size(560, 28)
$header.Controls.Add($subtitle)

function New-Button($Text, $X, $Y, $W = 180) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($W, 48)
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 0
  $button.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#7A2638')
  $button.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#FFF8EA')
  $button.Font = New-Font 10 ([System.Drawing.FontStyle]::Bold)
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $form.Controls.Add($button)
  $button
}

function New-StatusCard($Title, $X, $Y) {
  $panel = New-Object System.Windows.Forms.Panel
  $panel.Location = New-Object System.Drawing.Point($X, $Y)
  $panel.Size = New-Object System.Drawing.Size(282, 72)
  $panel.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#FFF9EF')
  $form.Controls.Add($panel)

  $caption = New-Object System.Windows.Forms.Label
  $caption.Text = $Title
  $caption.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#7B6F63')
  $caption.Font = New-Font 9 ([System.Drawing.FontStyle]::Bold)
  $caption.Location = New-Object System.Drawing.Point(14, 10)
  $caption.Size = New-Object System.Drawing.Size(250, 20)
  $panel.Controls.Add($caption)

  $value = New-Object System.Windows.Forms.Label
  $value.Text = 'не проверено'
  $value.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#8A2638')
  $value.Font = New-Font 12 ([System.Drawing.FontStyle]::Bold)
  $value.Location = New-Object System.Drawing.Point(14, 34)
  $value.Size = New-Object System.Drawing.Size(250, 24)
  $panel.Controls.Add($value)
  $value
}

$btnStart = New-Button 'Запустить сервер' 28 136
$btnStop = New-Button 'Остановить сервер' 224 136
$btnCheck = New-Button 'Проверить сервер' 420 136
$btnImportExcel = New-Button 'Импорт Excel' 616 136
$btnDomain = New-Button 'Проверить домен' 812 136 128
$btnBuild = New-Button 'Создать APK' 28 198
$btnOpenApk = New-Button 'Открыть APK' 224 198
$btnOpenExcel = New-Button 'Открыть Excel' 420 198
$btnBackup = New-Button 'Бэкап базы' 616 198

$apiCard = New-StatusCard 'Локальный сервер' 28 272
$mobileCard = New-StatusCard 'Мобильный интернет' 326 272
$filesCard = New-StatusCard 'APK / Excel' 624 272

$logLabel = New-Object System.Windows.Forms.Label
$logLabel.Text = 'Журнал работы'
$logLabel.Location = New-Object System.Drawing.Point(28, 366)
$logLabel.Size = New-Object System.Drawing.Size(300, 24)
$logLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#2B241F')
$logLabel.Font = New-Font 13 ([System.Drawing.FontStyle]::Bold)
$form.Controls.Add($logLabel)

$script:logBox = New-Object System.Windows.Forms.TextBox
$script:logBox.Multiline = $true
$script:logBox.ScrollBars = 'Vertical'
$script:logBox.ReadOnly = $true
$script:logBox.WordWrap = $false
$script:logBox.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#211E1B')
$script:logBox.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#FFF8EA')
$script:logBox.Font = New-Object System.Drawing.Font('Consolas', 10)
$script:logBox.Anchor = 'Top,Bottom,Left,Right'
$script:logBox.Location = New-Object System.Drawing.Point(28, 396)
$script:logBox.Size = New-Object System.Drawing.Size(912, 260)
$form.Controls.Add($script:logBox)

$btnStart.Add_Click({
  Set-Card $apiCard 'запускается' '#D7A94A'
  Set-Card $mobileCard 'проверим после старта' '#D7A94A'
  $script:serverStartRequestedAt = Get-Date
  Start-LoggedBat 'сервер' $startBat $serverLog -PipeEnter
})

$btnStop.Add_Click({
  Set-Card $apiCard 'останавливается' '#D7A94A'
  Stop-GoryStack
})

$btnCheck.Add_Click({
  Check-GoryState
})

$btnBuild.Add_Click({
  Set-Card $filesCard 'сборка APK' '#D7A94A'
  Start-LoggedBat 'сборка APK' $buildBat $buildLog -PipeEnter
})

$btnOpenApk.Add_Click({ Open-GoryApk })
$btnOpenExcel.Add_Click({ Open-GoryExcel })
$btnImportExcel.Add_Click({
  Set-Card $filesCard 'импорт Excel' '#D7A94A'
  Start-LoggedBat 'импорт Excel' $importBat $importLog -PipeEnter
})
$btnDomain.Add_Click({
  Set-Card $mobileCard 'проверка домена' '#D7A94A'
  Check-GoryState
})
$btnBackup.Add_Click({
  Set-Card $filesCard 'бэкап базы' '#D7A94A'
  Start-LoggedBat 'ручной бэкап базы' $backupBat $backupLog -PipeEnter
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({
  Pull-NewLogText $serverLog ([ref]$script:lastServerLogLength)
  Pull-NewLogText $buildLog ([ref]$script:lastBuildLogLength)
  Pull-NewLogText $backupLog ([ref]$script:lastBackupLogLength)
  Pull-NewLogText $importLog ([ref]$script:lastImportLogLength)

  foreach ($entry in @($script:jobs)) {
    if ($entry.Job.State -in @('Completed', 'Failed', 'Stopped')) {
      $output = Receive-Job -Job $entry.Job -ErrorAction SilentlyContinue
      foreach ($line in $output) {
        if ([string]$line) {
          $text = [string]$line
          Add-Log $text
          if ($text -like 'Локальный сервер: работает*') { Set-Card $apiCard 'работает' '#2F7D46' }
          if ($text -like 'Локальный сервер: не отвечает*') { Set-Card $apiCard 'не отвечает' '#9F2D3F' }
          if ($text -like 'Мобильный интернет: работает*') { Set-Card $mobileCard 'работает' '#2F7D46' }
          if ($text -like 'Мобильный интернет: не работает*') { Set-Card $mobileCard 'не работает' '#9F2D3F' }
        }
      }
      Remove-Job -Job $entry.Job -Force -ErrorAction SilentlyContinue
      $script:jobs = @($script:jobs | Where-Object { $_.Job.Id -ne $entry.Job.Id })
      Add-Log "Готово: $($entry.Name)"
    }
  }

  try {
    $local = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 1
    if ($local.ok) { Set-Card $apiCard 'работает' '#2F7D46' }
  } catch {
    $isStartingGrace = $false
    if ($apiCard.Text -eq 'запускается' -and $script:serverStartRequestedAt) {
      $isStartingGrace = ((Get-Date) - $script:serverStartRequestedAt).TotalSeconds -lt 360
    }
    if (-not $isStartingGrace -and $apiCard.Text -ne 'останавливается') { Set-Card $apiCard 'не отвечает' '#9F2D3F' }
  }

  if ((Test-Path -LiteralPath $latestApk) -and (Test-Path -LiteralPath $excelFile)) {
    Set-Card $filesCard 'готово' '#2F7D46'
  } elseif (Test-Path -LiteralPath $latestApk) {
    Set-Card $filesCard 'APK есть' '#2F7D46'
  } else {
    if ($filesCard.Text -ne 'сборка APK') { Set-Card $filesCard 'APK не найден' '#9F2D3F' }
  }
})
$timer.Start()

Add-Log 'Панель управления готова.'
Add-Log 'Кнопки: запустить, остановить, проверить сервер, домен, создать APK, открыть APK, открыть Excel, бэкап базы.'
Add-Log 'Если мобильный интернет не работает, нажми «Проверить сервер» и смотри строки публичного relay.'

[void] $form.ShowDialog()
