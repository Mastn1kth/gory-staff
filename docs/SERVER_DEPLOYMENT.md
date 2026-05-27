# Сервер для «Горы»

## Рекомендуемый вариант для MVP

Для реального использования в ресторане сервер лучше держать не на телефоне и не внутри приложения, а отдельно:

- VPS/VDS на Windows или Linux;
- Node.js 20+;
- PostgreSQL 15+;
- постоянный адрес: домен или статический IP;
- HTTPS через Nginx/Caddy/Cloudflare Tunnel, если сервер открыт в интернет.

Для локального рабочего теста можно оставлять `START_GORY_STAFF.bat`: он запускает PostgreSQL в Docker и сервер на компьютере. Данные сохраняются в Docker volume `gory_staff_pgdata` между перезапусками.

Для публичного домена на этом ПК используется `https://app.gory-staff.ru`: Cloudflare Worker принимает запросы телефона, а `tools\bat\START_PUBLIC_RELAY.bat` на компьютере ресторана передаёт их локальному серверу исходящими HTTPS-запросами. Обычный Cloudflare Tunnel в этой сети не выбран, потому что его постоянное соединение обрывалось при проверках.

Relay делает один служебный запрос к Cloudflare примерно раз в 1,5 секунды, даже когда телефон не используется. Этого достаточно для небольшой проверки на Workers Free, но при постоянной рабочей эксплуатации и активных пользователях нужно контролировать лимиты Cloudflare или перевести Workers на платный тариф.

## Переменные сервера

Создать `server\.env`:

```env
PORT=4000
DATABASE_URL=postgres://gory:gory@localhost:5432/gory_staff
JWT_SECRET=replace-with-long-random-string-at-least-32-chars
INITIAL_MANAGER_LOGIN=owner@example.com
INITIAL_MANAGER_PASSWORD=strong-password
DEMO_STAFF_PASSWORD=another-strong-password
PUBLIC_SERVER_URL=https://your-public-server.example
EXPO_PUBLIC_API_URL=https://your-public-server.example
CORS_ORIGINS=https://your-public-server.example
```

Для запуска с PostgreSQL вручную:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
docker compose up -d
Copy-Item server\.env.example server\.env
npm run server
```

Обычно вручную это делать не нужно: `START_GORY_STAFF.bat` делает эти шаги сам.

## Адрес в APK

Сотрудники не вводят адрес сервера при входе. Адрес зашивается в приложение при сборке:

```powershell
$env:EXPO_PUBLIC_API_URL="https://app.gory-staff.ru"
cd "C:\Users\user\Desktop\Gor Staff"
.\BUILD_ANDROID_APK.bat
```

Для теста без домена можно использовать IP компьютера:

```powershell
$env:EXPO_PUBLIC_API_URL="http://192.168.0.2:4000"
cd "C:\Users\user\Desktop\Gor Staff"
.\BUILD_ANDROID_APK.bat
```

Если телефон и компьютер в одной Wi-Fi сети, приложение дополнительно ищет сервер само и запоминает найденный адрес. Для работы через мобильный интернет компьютер должен быть доступен снаружи: через домен, VPS, проброс порта или постоянный туннель. Обычный домашний компьютер за роутером телефон из мобильной сети сам найти не сможет.

Телефон и компьютер должны быть в одной сети для локального теста, а Windows Firewall должен разрешать входящие подключения на порт `4000`.

## Минимальный чек перед выдачей APK сотрудникам

- Войти управляющим через `INITIAL_MANAGER_LOGIN` и `INITIAL_MANAGER_PASSWORD` из `server\.env`.
- Проверить, что в админке видно режим сервера `postgres`, а не `demo-memory`.
- Создать бронь и увидеть ее на другом устройстве.
- Добавить блюдо в стоп-лист и проверить у официанта/кухни.
- Отправить сообщение в чат и проверить realtime-обновление.
- Создать нового сотрудника и назначить ему роль.
- Закрыть смену официантом и проверить сигнал управляющему.

## Резервное копирование

Для PostgreSQL нужен ежедневный дамп базы:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
.\tools\bat\BACKUP_GORY_DATABASE.bat
```

Копии сохраняются в папку `backups`. Батник оставляет последние 30 копий и проверяет дамп восстановлением во временную базу `gory_staff_backup_check`. Перед импортом настоящего меню и плана зала обязательно сделать отдельную копию.

## Что усилить после MVP

- Проверить реальную работу APK на телефоне через мобильный интернет и оставить `https://app.gory-staff.ru` как основной адрес. Сервер и локальный relay на компьютере должны быть запущены постоянно.
- Отдельные production-пароли для всех сотрудников.
- Роли администратора для нескольких управляющих.
- Логи действий с фильтрами по сотруднику и дате.
- Настоящие push-уведомления через Expo/FCM.
- Хранилище фото блюд и документов: S3/Supabase Storage.
