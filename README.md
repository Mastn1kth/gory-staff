# Горы

Локальная система ресторана «Горы»: мобильное приложение для гостей и сотрудников, сервер на компьютере ресторана, PostgreSQL, публичный доступ через Cloudflare relay и интеграции с iiko/Twilio/OAuth.

Это не сайт и не PWA. Основной клиент - Expo React Native APK. Основной рабочий запуск для ресторана - `Горы Управление.exe`.

## Что сейчас есть

- Android APK для гостей и персонала.
- Гостевой профиль, бонусная карта, реферальный код, QR для списания бонусов.
- OAuth-вход гостя через mobile deep link `gory-staff://oauth/{provider}`.
- Рабочая зона персонала: роли, зал, брони, меню, стоп-лист, клиенты, банкеты, задачи, аналитика.
- Node.js/Express API, PostgreSQL, Socket.IO.
- Offline-first кэш и часть очереди рабочих действий.
- iikoCloud: меню, стоп-лист, модификаторы, заказы, статусы, события оплаты, синхронизация персонала.
- Twilio SMS-напоминания о бронях с проверкой подписи webhook.
- Cloudflare Worker/relay для `https://app.gory-staff.ru`.

## Быстрый запуск

Обычный запуск на Windows:

1. Открыть `Горы Управление.exe`.
2. Нажать `Запустить сервер`.
3. Нажать `Проверить сервер`.
4. Установить APK из `builds\Gory-latest.apk`, если нужна проверка на телефоне.

Технические батники лежат в `tools\bat`:

- `START_GORY_STAFF.bat` - Docker, PostgreSQL, backend, Cloudflare relay, iiko connector.
- `STOP_GORY_STAFF.bat` - остановка backend, контейнера, relay и фоновых процессов.
- `BUILD_ANDROID_APK.bat` - сборка Android APK.
- `BACKUP_GORY_DATABASE.bat` - ручной backup PostgreSQL.
- `RESTORE_GORY_DATABASE.bat` - восстановление PostgreSQL из backup.

Для разработки:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npm install
npm --workspace server test
npm run typecheck
npm run server:demo
npm run mobile
```

## Карта проекта

- `mobile` - Expo React Native приложение.
- `server` - Express API, схема БД, routes, интеграции, тесты.
- `tools` - запуск, backup/restore, Excel import/export, iiko connector.
- `gory-control` - PowerShell/C# панель управления.
- `cloudflare\https-relay` - Cloudflare Worker.
- `docs` - roadmap, статус, инструкции и чек-листы.
- `data`, `runtime`, `backups`, `builds` - локальные данные и артефакты. Не коммитить без отдельной причины.

## Важные документы

- `docs\AI_PROJECT_CONTEXT.md` - короткий контекст для следующего ИИ или разработчика.
- `docs\ROADMAP.md` - приоритеты и следующие шаги.
- `docs\PROJECT_FULL_STATUS.md` - полный список реализованного функционала.
- `docs\IIKO_STAFF_SYNC.md` - синхронизация персонала из iiko.
- `docs\OAUTH_SETUP.md` - настройка OAuth и mobile redirect URI.
- `docs\RESERVATION_REMINDERS.md` - SMS-напоминания и Twilio webhook.
- `docs\IIKO_TROUBLESHOOTING.md` и `docs\IIKO_*CHECKLIST*.md` - ручная проверка iiko.
- `docs\TRANSFER_TO_ANOTHER_PC.md` и `START_ON_ANOTHER_PC_RU.txt` - перенос на другой Windows-ПК.

## Конфигурация

Секреты хранятся в `server\.env`. В Git добавлять только пример `server\.env.example`.

Критичные env:

- `JWT_SECRET`, `GUEST_JWT_SECRET` - разные сильные секреты.
- `INITIAL_MANAGER_LOGIN`, `INITIAL_MANAGER_PASSWORD` - первый управляющий.
- `IIKO_ENABLED`, `IIKO_API_LOGIN`, `IIKO_ORGANIZATION_ID`, `IIKO_TERMINAL_GROUP_ID`.
- `IIKO_WEBHOOK_SECRET` - проверка локальных iiko событий.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- `TWILIO_STATUS_CALLBACK_URL` - публичный URL callback; нужен, чтобы подпись Twilio совпадала за прокси.
- `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `VK_CLIENT_ID`, `VK_CLIENT_SECRET`.
- `OAUTH_MOBILE_SCHEME` - по умолчанию `gory-staff`.

Для мобильного OAuth в кабинетах провайдеров должны быть зарегистрированы:

- `gory-staff://oauth/yandex`
- `gory-staff://oauth/vk`

Если провайдер не принимает custom scheme, нужен отдельный server callback с одноразовым ticket и редиректом в приложение.

## Проверки перед коммитом

Минимум для серверных правок:

```powershell
npm --workspace server test
```

Минимум для мобильных правок:

```powershell
npm run typecheck
node --test mobile/src/**/*.test.js
```

Для изменений вроде OAuth, Twilio и iiko дополнительно нужны ручные smoke-проверки на реальной среде:

- OAuth на устройстве после регистрации redirect URI у провайдеров.
- Twilio callback на публичном URL с реальным `TWILIO_AUTH_TOKEN`.
- QR списания бонусов в гостевом приложении и staff/admin flow.
- iiko staff sync на реальной или тестовой организации.

## Правила, которые нельзя ломать

- Не хранить реальные `.env`, токены, пароли, APK, backup и рабочие данные в Git.
- Не зашивать `localhost` или `127.0.0.1` в APK для реального телефона.
- Не выдавать оплату/кассу/фискализацию за готовую функцию: сейчас система только принимает факт оплаты из iiko-событий.
- Не ломать запуск через `Горы Управление.exe` и батники из `tools\bat`.
- Не откатывать чужие незакоммиченные изменения без прямой просьбы.
