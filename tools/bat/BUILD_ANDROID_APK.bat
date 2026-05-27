@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  cd /d "%SCRIPT_DIR%"
) else (
  cd /d "%SCRIPT_DIR%..\.."
)
set "PROJECT_ROOT=%CD%"
title Gory - build Android APK
if not exist "builds" mkdir "builds" >nul 2>nul

set "PUBLIC_API_URL=https://app.gory-staff.ru"
set "LOCAL_IP=localhost"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress; $ip = ($ips | Where-Object { $_ -like '192.168.*' } | Select-Object -First 1); if (-not $ip) { $ip = ($ips | Select-Object -First 1) }; if ($ip) { $ip } else { 'localhost' }"`) do set "LOCAL_IP=%%I"
if "%EXPO_PUBLIC_API_URL%"=="" set "EXPO_PUBLIC_API_URL=%PUBLIC_API_URL%"
if /i "%~1"=="wifi" set "EXPO_PUBLIC_API_URL=http://%LOCAL_IP%:4000"

echo ========================================
echo Gory - local Android APK build
echo ========================================
echo.
echo Build mode:
echo   Android Studio / Gradle local build
echo.
echo API address inside APK:
echo   %EXPO_PUBLIC_API_URL%
echo.
echo For phones outside the restaurant use the public HTTPS address.
echo For temporary Wi-Fi-only test you may run: BUILD_ANDROID_APK.bat wifi
echo.
echo Output files:
echo   %PROJECT_ROOT%\builds\Gory-latest.apk
echo.

echo %EXPO_PUBLIC_API_URL% | findstr /i "localhost 127.0.0.1" >nul
if not errorlevel 1 (
  echo Do not build a phone APK with localhost or 127.0.0.1.
  echo Use the public address or Wi-Fi IP of this PC.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

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

if not defined JAVA_HOME (
  if exist "C:\Program Files\Android\Android Studio\jbr" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"

where java >nul 2>nul
if errorlevel 1 (
  echo Java was not found.
  echo Install Android Studio or JDK 17, then run this file again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_SDK_ROOT set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
if not exist "%ANDROID_HOME%\platforms" (
  echo Android SDK was not found here:
  echo   %ANDROID_HOME%
  echo Open Android Studio once and install Android SDK, then run this file again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

if not exist "mobile\android\gradlew.bat" (
  echo Gradle wrapper was not found:
  echo   mobile\android\gradlew.bat
  echo Open/sync the Android project or restore mobile\android.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

echo Writing Android SDK path...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$sdk=$env:ANDROID_HOME -replace '\\','/'; Set-Content -Encoding ASCII -LiteralPath 'mobile\android\local.properties' -Value ('sdk.dir=' + $sdk)"
if errorlevel 1 (
  echo Could not write mobile\android\local.properties.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Preparing app version and API URL...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Resolve-Path -LiteralPath '.').Path;" ^
  "$appPath=Join-Path $root 'mobile\app.json';" ^
  "$gradlePath=Join-Path $root 'mobile\android\app\build.gradle';" ^
  "$app=Get-Content -Raw -Encoding UTF8 -LiteralPath $appPath | ConvertFrom-Json;" ^
  "$code=0; if ($app.expo.android.versionCode) { $code=[int]$app.expo.android.versionCode };" ^
  "$code=$code+1; $app.expo.android.versionCode=$code;" ^
  "$parts=([string]$app.expo.version).Split('.');" ^
  "if ($parts.Count -eq 3) { $patch=0; if ([int]::TryParse($parts[2], [ref]$patch)) { $parts[2]=[string]($patch+1); $app.expo.version=($parts -join '.') } };" ^
  "if (-not $app.expo.extra) { $app.expo | Add-Member -MemberType NoteProperty -Name extra -Value ([pscustomobject]@{}) -Force };" ^
  "$app.expo.extra | Add-Member -MemberType NoteProperty -Name apiUrl -Value $env:EXPO_PUBLIC_API_URL -Force;" ^
  "$configPath=Join-Path $root 'mobile\src\data\buildConfig.ts';" ^
  "$safeUrl=($env:EXPO_PUBLIC_API_URL -replace '''','''''');" ^
  "$configLines=@('// This file is rewritten by BUILD_ANDROID_APK.bat before every APK build.','// Do not put secrets here. It only stores the public API address baked into the APK.',('export const BUILD_API_URL = ''' + $safeUrl + ''';'));" ^
  "[IO.File]::WriteAllLines($configPath, $configLines, [Text.UTF8Encoding]::new($false));" ^
  "[IO.File]::WriteAllText($appPath, ($app | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false));" ^
  "$gradle=Get-Content -Raw -Encoding UTF8 -LiteralPath $gradlePath;" ^
  "$gradle=[regex]::Replace($gradle,'versionCode\s+\d+','versionCode ' + $code);" ^
  "$q=[char]34; $gradle=[regex]::Replace($gradle,'versionName\s+' + $q + '[^' + $q + ']+' + $q,'versionName ' + $q + $app.expo.version + $q);" ^
  "[IO.File]::WriteAllText($gradlePath, $gradle, [Text.UTF8Encoding]::new($false));" ^
  "Write-Host ('Version: ' + $app.expo.version + ' / Android code: ' + $code)"
if errorlevel 1 (
  echo Could not prepare app version.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo Checking TypeScript before build...
call npm --workspace mobile run typecheck
if errorlevel 1 (
  echo TypeScript check failed. Fix errors above, then build again.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo Building release APK locally. This can take several minutes.
echo Do not close this window.
echo.

pushd "mobile\android"
call gradlew.bat :app:assembleRelease --no-daemon
set "BUILD_EXIT=%ERRORLEVEL%"
popd

if not "%BUILD_EXIT%"=="0" (
  echo.
  echo Local Android build failed.
  echo Open mobile\android in Android Studio and run Gradle Sync if needed.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b %BUILD_EXIT%
)

set "APK_SOURCE=mobile\android\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK_SOURCE%" (
  echo Release APK was not found:
  echo   %APK_SOURCE%
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo Copying APK to project folder...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '.').Path;" ^
  "$source=Join-Path $root 'mobile\android\app\build\outputs\apk\release\app-release.apk';" ^
  "$builds=Join-Path $root 'builds'; New-Item -ItemType Directory -Force -Path $builds | Out-Null;" ^
  "$latest=Join-Path $builds 'Gory-latest.apk';" ^
  "Get-ChildItem -LiteralPath $root,$builds -Filter '*.apk' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Gory*.apk' -or $_.Name -like 'GoryStaff*.apk' } | Remove-Item -Force;" ^
  "Copy-Item -LiteralPath $source -Destination $latest -Force;" ^
  "Write-Host ('APK ready: ' + $latest)"
if errorlevel 1 (
  echo APK was built, but copying failed.
  if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo Done. Install this APK on the phone:
echo   %PROJECT_ROOT%\builds\Gory-latest.apk
echo.
if not "%GORY_CONTROL_NO_PAUSE%"=="1" pause
