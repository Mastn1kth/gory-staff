# APK-сборки «Горы»

## Первая EAS-сборка

- Статус: `finished`
- Build ID: `d49f88ba-460e-4204-a622-8a91d1b6d4af`
- Логи: https://expo.dev/accounts/mastn1k/projects/gory-staff/builds/d49f88ba-460e-4204-a622-8a91d1b6d4af
- APK: https://expo.dev/artifacts/eas/sfPTTK7YcJ3BxwJvewcCXR.apk

Важно: эта сборка была запущена до исправления адреса сервера для APK. Ее можно поставить, чтобы посмотреть внешний вид приложения, но для полноценной проверки с сервером лучше собрать новую версию через `BUILD_ANDROID_APK.bat`.

## Как собрать новую правильную версию

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
.\BUILD_ANDROID_APK.bat
```

Если нужен постоянный сервер:

```powershell
$env:EXPO_PUBLIC_API_URL="https://app.gory-staff.ru"
cd "C:\Users\user\Desktop\Gor Staff"
.\BUILD_ANDROID_APK.bat
```

Для теста можно указать IP компьютера в локальной сети, например `http://192.168.0.2:4000`.
