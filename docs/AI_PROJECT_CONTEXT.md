# Горы: контекст проекта для ИИ

Обновлено: 2026-05-31.

Цель файла: дать следующему ИИ короткий, проверяемый контекст проекта, чтобы он не тратил токены на первичный разбор структуры. Если факты ниже противоречат коду, верить коду и обновить этот документ.

## Суть проекта

`Gor Staff` - локальная система ресторана «Горы»: мобильное приложение для гостей и сотрудников, сервер на компьютере ресторана, PostgreSQL, публичный доступ через `https://app.gory-staff.ru`, офлайн-кэш, push-основа и интеграция с iiko.

Это не сайт и не PWA. Основной клиент - Expo React Native APK. Сервер - Node.js/Express API. Данные ресторана и секреты не должны попадать в Git.

## Быстрый порядок чтения

1. `docs/AI_PROJECT_CONTEXT.md` - этот файл, короткий контекст для старта.
2. `README.md` - запуск, эксплуатация, текущие пользовательские инструкции.
3. `docs/ROADMAP.md` - что делать дальше и в каком порядке.
4. `docs/PROJECT_FULL_STATUS.md` - полный список уже реализованных возможностей.
5. Документы по конкретной зоне: `docs/IIKO_*.md`, `docs/OAUTH_SETUP.md`, `docs/RESERVATION_REMINDERS.md`, `docs/SOCIAL_IMPORT_SETUP.md`, `docs/TRANSFER_TO_ANOTHER_PC.md`.

Не читай весь проект вслепую. Сначала найди нужную область через `rg`, потом открывай только связанные файлы.

## Текущая структура

- `mobile` - Expo React Native приложение «Горы».
- `server` - Node.js/Express API, Socket.IO, PostgreSQL, seed, роли, права, интеграции.
- `server/src/cache.js` - система in-memory кэширования для ускорения работы.
- `server/src/performance-optimizations.sql` - индексы БД для оптимизации запросов.
- `tools` - Windows/Node/Python утилиты: запуск, остановка, Excel import/export, iiko event connector, Cloudflare relay.
- `tools\bat` - технические батники запуска и обслуживания.
- `cloudflare\https-relay` - Cloudflare Worker relay.
- `gory-control` - PowerShell/C# панель управления.
- `docs` - проектные документы, чек-листы, roadmap-и и дизайн-превью.
- `data`, `runtime`, `backups`, `builds` - локальные/сгенерированные данные. Не считать их исходниками продукта.

## Входные точки

- Пользовательский запуск: `Горы Управление.exe`.
- Технический запуск сервера: `tools\bat\START_GORY_STAFF.bat`.
- Техническая остановка: `tools\bat\STOP_GORY_STAFF.bat`.
- Сборка APK: `tools\bat\BUILD_ANDROID_APK.bat`.
- Запуск iiko connector: `tools\bat\START_IIKO_EVENT_CONNECTOR.bat`.
- Серверный entrypoint: `server\src\index.js`.
- Мобильный entrypoint: `mobile\App.tsx`, `mobile\index.ts`.
- API-клиент мобильного приложения: `mobile\src\data\api.ts`.
- Схема БД: `server\src\schema.sql`.
- Seed: `server\src\seed.js`.

## Технологии

- Корень: npm workspaces.
- Backend: Node.js, Express 5, Socket.IO, PostgreSQL `pg`, `pg-mem` для тестов, JWT, bcrypt, Helmet, CORS, rate limit, compression (gzip).
- Оптимизации: 60+ индексов БД, in-memory кэш, HTTP compression, оптимизированный connection pool.
- Mobile: Expo 54, React 19, React Native 0.81, TypeScript, AsyncStorage, Expo notifications, Expo network/device/video, Socket.IO client.
- БД: PostgreSQL 16 в Docker (`docker-compose.yml`), порт `127.0.0.1:5432`.
- Публичный доступ: Cloudflare Worker + локальный HTTPS relay, рабочий домен `https://app.gory-staff.ru`.
- Тесты: Node test runner для server и отдельных JS-тестов mobile/utils/components.

## Основные команды

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npm install
npm run server:demo
npm run server
npm run mobile
npm run typecheck
npm --workspace server test
```

Для реального локального запуска ресторана предпочтительнее панель `Горы Управление.exe` или батники из `tools\bat`, потому что они поднимают не только API, но и Docker/PostgreSQL/relay/iiko connector.

## Конфигурация и секреты

Секреты лежат в `server\.env`, пример - `server\.env.example`. В Git нельзя добавлять реальные значения:

- `JWT_SECRET`, `GUEST_JWT_SECRET`;
- `INITIAL_MANAGER_LOGIN`, `INITIAL_MANAGER_PASSWORD`, `DEMO_STAFF_PASSWORD`;
- `IIKO_API_LOGIN`, `IIKO_ORGANIZATION_ID`, `IIKO_TERMINAL_GROUP_ID`, `IIKO_WEBHOOK_SECRET`;
- social import токены;
- любые Firebase/FCM ключи.

В production `JWT_SECRET` и `GUEST_JWT_SECRET` должны быть разными и сильными. Сервер в `server\src\index.js` падает при слабых секретах.

## Ключевые доменные зоны

- Гость: регистрация/вход по телефону, **OAuth вход (Яндекс, ВКонтакте)**, профиль, бонусная карта, история бонусов, рефералы, меню, новости, маршрут, feedback после визита.
- Персонал: роли, права, рабочие разделы, смена, столы, брони, стоп-лист, задачи, банкеты, клиенты, аналитика, профиль.
- Offline-first: мобильное приложение кэширует гостевые и staff-данные, хранит очередь разрешенных офлайн-действий и отправляет их после восстановления связи.
- Push: Expo push token, `push_devices`, `notifications`, `notification_settings`, `notification_delivery_log`.
- iiko: импорт меню/стоп-листа/модификаторов, отправка гостевых заказов в iiko table orders, pull статусов, webhook-и `order-updated` и `payment-paid`, локальный event connector.
- Social/news: маршруты `server\src\routes\social.js`, импорт и гостевая лента новостей.
- OAuth: вход гостей через Яндекс и ВКонтакте, автоматическая регистрация, привязка к существующим аккаунтам.

## API-роуты по файлам

- `server\src\routes\health.js` - `/`, `/health`, restaurant info.
- `server\src\routes\auth.js` - staff login/register/me/profile.
- `server\src\routes\sync.js` - мобильный snapshot и синхронизация.
- `server\src\routes\guests.js` - гостевой профиль, меню, новости, push, бонусы, feedback.
- `server\src\routes\oauth.js` - OAuth вход через Яндекс и ВКонтакте.
- `server\src\routes\floor.js` - столы, брони, ожидание, зал.
- `server\src\routes\menu.js` - меню, стоп-лист, позиции.
- `server\src\routes\staff.js` - задачи, график, персонал, события, блокнот и рабочие операции.
- `server\src\routes\admin.js` - админские действия и клиентская база.
- `server\src\routes\push.js` - push-устройства и тестовые push.
- `server\src\routes\iiko.js` - iiko status/sync/webhook-и.
- `server\src\routes\social.js` - social import/news.
- `server\src\coordination.js` - hall signals, table guest sessions, menu restored alerts.

## Инварианты, которые нельзя ломать

- Реальный телефон не должен использовать `localhost` или `127.0.0.1` как API. Для APK основной адрес - `https://app.gory-staff.ru`, fallback - сохраненный адрес и локальный Wi-Fi discovery.
- Обычный запуск для ресторана должен оставаться "одной кнопкой" через панель/батники.
- Секреты и реальные данные ресторана не коммитить.
- Runtime-папки `data`, `runtime`, `backups`, `builds`, `node_modules` не превращать в source of truth.
- Гостевой API и staff API разделять по авторизации.
- Критичные admin-действия не ставить в offline queue.
- iiko payment webhook принимает факт уже прошедшей оплаты. Приложение не проводит оплату, не работает с кассой и не фискализирует чек.
- Повторные iiko/payment события должны быть идемпотентны.
- Локальные поля меню не должны затираться импортом iiko, если их нет в iiko.

## Что не реализовано

- Онлайн-оплата в приложении.
- Касса и фискализация.
- Закрытие заказа и изменение оплат в iiko из приложения.
- Native iikoFront plugin внутри кассового терминала.
- Live-проверка на реальной iiko-точке в этом репозитории.
- Sync персонала из iiko.
- UI выбора модификаторов в гостевом заказе.
- Веб-версия и PWA.
- iOS production/TestFlight процесс.

## Риски и слабые места

- Много локальной Windows-автоматизации. Перед изменением батников проверяй реальные пути и PowerShell/CMD-совместимость.
- README содержит большой исторический контекст. При противоречии проверяй фактические файлы через `rg --files`.
- В рабочей копии могут быть незакоммиченные изменения. Всегда сначала проверять `git status --short` и не откатывать чужие правки.
- iiko-интеграция без реальной live-проверки остается зоной риска.
- Production security еще требует отдельного прохода: секреты, домен/HTTPS без туннельной зависимости, backup policy, доступы.
- Push через Expo готов как базовая архитектура, но полноценный production FCM еще не закрыт.

## Как работать следующему ИИ

1. Сначала выполни `git status --short` и пойми, какие файлы уже изменены.
2. Найди нужный участок через `rg`, не читай весь `server\src\index.js` без причины.
3. Если меняешь API, проверь мобильный клиент в `mobile\src\data\api.ts` и типы в `mobile\src\types.ts`.
4. Если меняешь БД, обнови `server\src\schema.sql`, seed/миграционную логику и тесты.
5. Если меняешь iiko, смотри `server\src\integrations\iiko`, `server\src\routes\iiko.js`, `tools\iiko-event-connector.js` и `docs\IIKO_*.md`.
6. Если меняешь offline-first, проверь whitelist в `isOfflineMutationAllowed`, версионирование и обработку конфликтов.
7. Если меняешь роли/права, смотри `server\src\permissions.js`, `mobile\src\data\permissions.ts`, секции в `mobile\src\screens`.
8. После правок запускай минимально релевантные проверки и честно фиксируй, что не удалось проверить.

## Минимальная проверка перед ответом

Для документации:

```powershell
git diff -- README.md docs\AI_PROJECT_CONTEXT.md docs\ROADMAP.md
```

Для backend:

```powershell
npm --workspace server test
```

Для mobile type changes:

```powershell
npm run typecheck
```

Для запуска:

```powershell
tools\bat\START_GORY_STAFF.bat
```

Не заявляй, что APK, iiko или push полностью проверены, если реально не проверялось на устройстве/реальной точке.
