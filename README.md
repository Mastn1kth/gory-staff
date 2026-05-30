# Горы

## Быстрая навигация

Этот репозиторий - мобильное приложение и локальный сервер ресторана «Горы». Для обычной работы используйте `Горы Управление.exe`; технические скрипты лежат в `tools\bat`.

Ключевые документы:

- `docs\AI_PROJECT_CONTEXT.md` - короткий контекст проекта для ИИ и новых разработчиков: архитектура, входные точки, ограничения, что нельзя ломать.
- `START_ON_ANOTHER_PC_RU.txt` - развернутая инструкция, как скачать и запустить проект на другом Windows-компьютере.
- `docs\ROADMAP.md` - дорожная карта дальнейшей разработки по приоритетам.
- `docs\PROJECT_FULL_STATUS.md` - полный список уже реализованного функционала.
- `docs\TRANSFER_TO_ANOTHER_PC.md` - перенос на другой компьютер.
- `docs\IIKO_TROUBLESHOOTING.md` и `docs\IIKO_*CHECKLIST*.md` - диагностика и проверка iiko.
- `docs\SOCIAL_IMPORT_SETUP.md` - настройка импорта гостевых новостей.

Если проект открывает ИИ, сначала читать `docs\AI_PROJECT_CONTEXT.md`, потом этот README и только затем нужные файлы кода. Это экономит время и снижает риск случайно переписать рабочую логику.

## Карта проекта для разработки

- `mobile` - Expo React Native APK для гостей и сотрудников.
- `server` - Node.js/Express API, PostgreSQL, Socket.IO, роли, права, push, iiko и social routes.
- `tools` - утилиты запуска, сборки, Excel import/export, iiko event connector и Cloudflare relay.
- `gory-control` - панель управления для запуска проекта без ручных команд.
- `cloudflare\https-relay` - Worker/relay для публичного адреса.
- `docs` - документация, чек-листы, статус проекта и roadmap.
- `data`, `runtime`, `backups`, `builds` - локальные данные, логи, резервные копии и сборки. Их нельзя считать исходным кодом и нельзя тащить в Git без отдельной причины.

Главные проверки перед изменениями:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
git status --short
npm --workspace server test
npm run typecheck
```

Если меняется только документация, достаточно проверить diff:

```powershell
git diff -- README.md docs\AI_PROJECT_CONTEXT.md docs\ROADMAP.md
```

Важные ограничения:

- не хранить реальные секреты, `.env`, токены iiko/Firebase/social import в коде или документации;
- не зашивать `localhost` в APK для реального телефона;
- не ломать запуск через `Горы Управление.exe` и батники из `tools\bat`;
- не делать оплату, кассу или фискализацию видимостью готовой функции: сейчас приложение только принимает факт уже прошедшей оплаты из iiko-события;
- не откатывать чужие незакоммиченные изменения без прямой просьбы.

## Актуальный запуск

Главный файл для обычной работы: `Горы Управление.exe`.

В панели управления есть основные кнопки:

1. `Запустить сервер` — запускает Docker, PostgreSQL, backend на порту `4000`, обновляет Excel, поднимает публичный Cloudflare HTTPS relay и локальный iiko event connector.
2. `Остановить сервер` — останавливает backend, iiko connector, служебные процессы и PostgreSQL-контейнер. Данные базы не удаляются.
3. `Проверить сервер` — показывает, что работает: локальный сервер, Docker, APK, Excel и публичный домен.
4. `Создать APK` — собирает свежий Android APK локально через Android Studio / Gradle.
5. `Открыть APK` — открывает папку с последней сборкой `builds\Gory-latest.apk`.
6. `Открыть Excel` — обновляет и открывает `data\Gory-Data.xlsx`.
7. `Бэкап базы` — делает ручную резервную копию PostgreSQL в папку `backups`.

Технические батники лежат в `tools\bat`:

- `tools\bat\START_GORY_STAFF.bat`
- `tools\bat\STOP_GORY_STAFF.bat`
- `tools\bat\START_PUBLIC_RELAY.bat`
- `tools\bat\START_IIKO_EVENT_CONNECTOR.bat`
- `tools\bat\BUILD_ANDROID_APK.bat`
- `tools\bat\BACKUP_GORY_DATABASE.bat`

Основной адрес внутри APK: `https://app.gory-staff.ru`.

Если публичный relay не поднялся, сервер всё равно запускается для локального Wi-Fi режима. В этом случае телефон в той же сети использует адрес вида `http://IP_КОМПЬЮТЕРА:4000`, а мобильный интернет заработает после восстановления relay.

Публичный доступ сделан через Cloudflare Worker и локальный HTTPS relay на компьютере ресторана. Старый батник настройки службы Cloudflared оставлен только для диагностики прежнего варианта и для обычного запуска не нужен.

Чтобы показать приложение заказчику:

1. Откройте `Горы Управление.exe`.
2. Нажмите `Запустить сервер`.
3. Нажмите `Проверить сервер`.
4. Если локальный сервер работает, установите APK `builds\Gory-latest.apk` на телефон.
5. Для мобильного интернета проверьте в браузере телефона `https://app.gory-staff.ru/health`.
6. В приложении войдите как гость или через `Профиль -> Для сотрудников`.

Excel-файл с текущей базой находится здесь: `data\Gory-Data.xlsx`. В нём есть листы по сотрудникам и гостям. Панель управления обновляет этот файл кнопкой `Открыть Excel`.

Рабочий MVP мобильного приложения ресторана «Горы».

Это именно мобильное приложение на React Native / Expo для iPhone, Android и планшетов. Оно не является сайтом, PWA или веб-страницей. Серверная часть находится отдельно и хранит общие данные для всех устройств.

## Что внутри

- `mobile` — Expo React Native приложение «Горы».
- `server` — Node.js API, авторизация, роли, права, realtime через Socket.IO.
- `docker-compose.yml` — PostgreSQL для серверной базы.
- Демо-режим сервера на встроенной PostgreSQL-совместимой базе для быстрого локального запуска без Docker.

## Реальные файлы ресторана

В проект добавлены исходники из загрузок:

- `data/source/меню горы.xlsx` — исходное меню ресторана.
- `data/source/План света 1этаж.pdf` — исходный PDF первого этажа.
- `data/source/План света основной.pdf` — исходный PDF второго этажа.
- `mobile/assets/floor-plans/floor-1.png` и `mobile/assets/floor-plans/floor-2.png` — версии планов для мобильного приложения.
- `server/src/restaurantSourceData.json` — подготовленные категории, блюда, этажи и столы для загрузки в PostgreSQL.

При запуске и инициализации сервера эти данные подхватываются автоматически: меню обновляется из подготовленного списка, а в рабочем разделе зала столы накладываются поверх настоящих планов этажей.

## Доступ управляющего

При первом запуске `START_GORY_STAFF.bat` создаёт `server\.env` с секретами сервера и доступом управляющего:

- `INITIAL_MANAGER_LOGIN` — email или логин управляющего.
- `INITIAL_MANAGER_PASSWORD` — пароль управляющего.
- `DEMO_STAFF_PASSWORD` — отдельный временный пароль для демо-сотрудников.

Эти значения не хранятся в Git. Если нужно поменять доступ, остановите сервер, отредактируйте `server\.env` и снова нажмите `Запустить сервер`.

## Быстрый запуск демо

Для реальной проверки ресторана сначала установите Docker Desktop для Windows и дождитесь, пока он запустится. После этого откройте `START_GORY_STAFF.bat` в корне проекта. Батник сам:

- создаст настройки сервера `server\.env`, если их ещё нет;
- запустит PostgreSQL в Docker;
- дождётся готовности базы;
- запустит сервер `Горы`;
- покажет адрес для телефонов в Wi-Fi сети ресторана.

Данные в PostgreSQL сохраняются между перезапусками компьютера и сервера.

Для ручной резервной копии базы откройте `BACKUP_GORY_DATABASE.bat`. Копии сохраняются в папку `backups`, последние 30 копий остаются на компьютере. `START_GORY_STAFF.bat` также пытается сделать безопасную копию базы перед запуском сервера.

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npm install
npm run server:demo
```

Старый ручной демо-запуск без Docker остаётся только для разработки. Во втором окне:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npm run mobile
```

Для запуска одной кнопкой откройте `START_GORY_STAFF.bat` в корне проекта. Он запускает PostgreSQL, сервер и показывает адрес для телефона. Это окно нужно держать открытым, пока сотрудники пользуются приложением.

Для создания нового Android APK откройте `BUILD_ANDROID_APK.bat` в корне проекта. Он сам увеличит номер версии, запустит EAS-сборку, дождется готовности и скачает файл `GoryStaff-latest.apk` прямо в папку проекта.

Адрес сервера не показывается сотруднику на экране входа. Рабочий APK по умолчанию использует публичный домен `https://app.gory-staff.ru`, потом последний рабочий адрес, потом ищет сервер в локальной Wi-Fi сети. Для Android Emulator используется `http://10.0.2.2:4000`. Для реального телефона нельзя зашивать `localhost` или `127.0.0.1`, потому что это будет сам телефон, а не компьютер-сервер.

Для локальной проверки батник `START_GORY_STAFF.bat` подставляет адрес автоматически. Для рабочего APK лучше указать постоянный адрес сервера:

```powershell
$env:EXPO_PUBLIC_API_URL="https://app.gory-staff.ru"
.\BUILD_ANDROID_APK.bat
```

Для теста можно указать IP компьютера в локальной сети, например `http://192.168.0.2:4000`. Если телефон и компьютер в одной Wi-Fi сети, приложение сможет найти сервер само. Для работы через мобильный интернет нужен внешний адрес: домен, VPS или постоянный туннель до компьютера.

## Сборка устанавливаемого приложения

Для внутренней установки на телефоны сотрудников проект подготовлен к EAS Build:

```powershell
cd "C:\Users\user\Desktop\Gor Staff\mobile"
npx eas build --profile preview --platform android
npx eas build --profile preview --platform ios
```

Перед первой сборкой APK нужно один раз войти в EAS:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npx eas-cli@latest login
```

После входа можно просто открыть `BUILD_ANDROID_APK.bat`. Если нужно собрать вручную, запустите из папки `mobile`:

```powershell
cd "C:\Users\user\Desktop\Gor Staff\mobile"
npx eas-cli@latest build --platform android --profile preview
```

EAS выдаст ссылку на APK.

Для iOS понадобится Apple Developer аккаунт и настройка внутреннего распространения.

## Запуск с PostgreSQL

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
docker compose up -d
Copy-Item server\.env.example server\.env
npm run server
```

По умолчанию сервер использует:

```env
DATABASE_URL=postgres://gory:gory@localhost:5432/gory_staff
PORT=4000
JWT_SECRET=long-random-secret-at-least-32-chars
INITIAL_MANAGER_LOGIN=owner@example.com
INITIAL_MANAGER_PASSWORD=strong-password
DEMO_STAFF_PASSWORD=another-strong-password
CORS_ORIGINS=https://your-public-server.example
```

При старте сервер создает таблицы и наполняет базу тестовыми данными.

## Реализованные разделы MVP

- Главная смены.
- План зала по 1 и 2 этажу.
- Мои столики для официанта.
- Брони с созданием, поиском и статусами.
- Меню с категориями, карточками блюд и подсказками официанту.
- Стоп-лист с обновлением статусов.
- График смен.
- Персонал и добавление сотрудника управляющим.
- Банкеты и мероприятия.
- Сигналы/новости по ролям.
- Внутренний чат в стиле мессенджера, групповые и сменные чаты.
- Задачи по смене.
- Блокнот официанта за смену.
- Профиль сотрудника.
- Регистрация нового сотрудника с ролью ожидания.
- Админ-раздел внутри приложения.
- Базовая аналитика.
- История действий и внутренние уведомления.
- Чек-лист смены для открытия, подготовки к посадке, банкетов и закрытия.
- Лист ожидания, прозвон брони и заметки по постоянным гостям.
- Заявки кухни/бара на закупку или довоз позиций из стоп-листа.
- Учет предоплаты и прозвона по банкетам.

## Офлайн и синхронизация

Приложение сохраняет последний загруженный снимок данных на устройстве. Если связь пропала, пользователь видит последние данные, а действия попадают в очередь. После восстановления связи очередь отправляется на сервер, а данные обновляются через API и realtime-события.

## Работа через мобильный интернет

Основной адрес для установленного APK: `https://app.gory-staff.ru`.

Схема работы: телефон -> мобильный интернет или Wi-Fi -> Cloudflare HTTPS relay -> сервер на ПК -> PostgreSQL.

Чтобы проверить внешний доступ:

1. Запустите `START_GORY_STAFF.bat`.
2. Дождитесь строки, что сервер готов.
3. Откройте на телефоне в браузере `https://app.gory-staff.ru/health`.
4. Если виден ответ с `ok: true`, APK сможет работать через мобильную сеть.
5. Если публичный адрес не открывается, проверьте публичный relay и не закрывайте окно сервера.

Для телефона в одной Wi-Fi сети можно использовать адрес вида `http://192.168.x.x:4000`. Для Android Emulator используется `http://10.0.2.2:4000`. Для реального телефона нельзя использовать `localhost` или `127.0.0.1`.

## Push-уведомления

В приложении добавлена базовая push-архитектура через `expo-notifications`:

- таблица `push_devices` хранит устройства гостей и сотрудников;
- таблица `notifications` хранит внутренние уведомления;
- таблица `notification_settings` готова для отключения типов уведомлений;
- таблица `notification_delivery_log` хранит результат отправки;
- сервер умеет отправить тестовое push-уведомление текущему гостю или сотруднику;
- в админ-диагностике видны API URL, WebSocket URL, realtime-статус и push-статус.

Проверка на телефоне:

1. Установите свежий APK.
2. Запустите сервер через `START_GORY_STAFF.bat`.
3. Войдите гостем или сотрудником.
4. Разрешите уведомления Android.
5. Для гостя push подключается автоматически после входа или регистрации. Тестовая кнопка в обычном гостевом профиле скрыта, чтобы не портить интерфейс.
6. Для управляющего: `Для сотрудников` → войдите логином и паролем из `server\.env` → `Админ-раздел` → `Push и онлайн-диагностика` → `Проверить push`.

Если push не приходит:

- проверьте, что уведомления разрешены в настройках Android;
- проверьте, что телефон видит сервер через `https://app.gory-staff.ru/health`;
- проверьте в диагностике, что `Push token` получен;
- если сервер пишет `no_devices`, нажмите `Разрешить push` или войдите заново;
- Expo push работает на реальном телефоне, на эмуляторе токен может не получиться.

Для будущего перехода на чистый FCM нужно добавить Firebase-проект, положить `google-services.json` в Android-проект и вынести ключи отправки в `.env`. Секретные ключи нельзя хранить в коде или в README.

## Будущее подключение настоящих данных

Тестовое меню и тестовый план зала уже отделены от интерфейса. Когда появятся настоящие меню и схема рассадки, их можно загрузить в таблицы `menu_categories`, `menu_items`, `floors` и `tables` без переписывания экранов приложения.

## Offline-first проверка

Приложение теперь должно открываться без интернета, если нужные данные хотя бы один раз были загружены на телефон.

Что хранится на телефоне:

- гостевая сессия, профиль, бонусная карта, история бонусов и меню;
- рабочая сессия сотрудника, роль, разделы, снимок данных смены, план зала, брони, задачи, банкеты, стоп-лист и блокнот;
- очередь безопасных офлайн-действий.

Что можно делать без интернета:

- смотреть гостевой профиль, бонусную карту, меню и адрес;
- смотреть рабочую зону сотрудника из последних сохранённых данных;
- писать заметки в блокнот официанта;
- менять статус столика, создавать простую бронь, менять стоп-лист и отмечать задачу, если действие попадает в очередь.

Что нельзя делать без интернета:

- входить новым пользователем, если он раньше не входил на этом телефоне;
- регистрировать гостя;
- начислять или списывать бонусы;
- менять роли, блокировать сотрудников, удалять данные и выполнять критичные админские действия.

Как проверить:

1. Запустить `START_GORY_STAFF.bat`.
2. Открыть приложение и войти гостем или сотрудником.
3. Открыть основные разделы, чтобы данные попали в кэш.
4. Отключить интернет на телефоне.
5. Закрыть и снова открыть приложение.
6. Проверить, что аккаунт не сбросился, а данные остались.
7. Сделать разрешённое офлайн-действие, например запись в блокнот официанта.
8. Включить интернет.
9. Дождаться сообщения о восстановлении связи.
10. Проверить, что очередь ушла на сервер.

## Полный состав проекта

Коротко: это Android-приложение «Горы» для гостей и сотрудников ресторана, сервер на ПК, PostgreSQL, Cloudflare HTTPS relay, APK, гостевая бонусная система, рабочая зона персонала, push-основа и offline-first режим.

Главные файлы в корне:

- `START_GORY_STAFF.bat` — запуск сервера, Docker, PostgreSQL, публичного HTTPS relay и iiko event connector.
- `STOP_GORY_STAFF.bat` — остановка сервера, PostgreSQL, публичного relay, iiko connector и фоновых процессов.
- `START_PUBLIC_RELAY.bat` — запуск исходящей связи компьютера с Cloudflare для домена `https://app.gory-staff.ru`.
- `BUILD_ANDROID_APK.bat` — сборка свежего Android APK.
- `Gory-latest.apk` — готовое приложение для установки на телефон.
- `README.md` — инструкция.
- `docs/PROJECT_FULL_STATUS.md` — полный список того, что уже реализовано.

Что уже есть в приложении:

- гостевая часть с вкладками Профиль, Главная, Меню, Как добраться;
- гостевой профиль, регистрация, бонусная карта, бонусы и реферальный код;
- рабочая зона персонала через Профиль → Для сотрудников;
- роли управляющего, хостес, официанта, кухни и бара;
- план зала, брони, меню, стоп-лист, график, персонал, банкеты, новости, задачи, профиль, админка, аналитика;
- клиентская база для управляющего;
- серверная база PostgreSQL;
- публичный доступ через домен и Cloudflare HTTPS relay;
- push-архитектура и тестовые push-уведомления;
- работа без интернета через кэш и очередь офлайн-действий.
- отдельный экран маршрута с кнопками Яндекс Карт, звонка и копирования адреса;
- QR-карточка реферального кода;
- окно уровней лояльности;
- быстрые dev-кнопки входа сотрудников;
- аватарки-заглушки сотрудника в профиле;
- лист ожидания хостес;
- ручное начисление и списание бонусов управляющим;
- push-события по бонусам, рефералам, броням, ожиданию, стоп-листу и задачам;
- блок `Акценты продаж` в меню официанта.

Что специально не добавлено:

- корзина;
- доставка;
- онлайн-заказ;
- оплата;
- веб-версия;
- PWA;
- чат в интерфейсе.

## Последняя UX-полировка

В текущей версии дополнительно сделано:

- рабочий экран управляющего начинается с `Пульса` без лишней карточки с именем сотрудника;
- раздел `Клиенты` очищен от общего блока `Последние операции`; история бонусов теперь показывается внутри действия по выбранному клиенту;
- форм
а входа сотрудников поднимается над клавиатурой;
- официант видит блок `Акценты продаж` прямо в меню;
- корневая папка проекта визуально очищена: сверху остаются только батники, README и актуальный APK.

## Интеграция с iiko

Добавлена синхронизация с iikoCloud: сервер может вручную загрузить категории, блюда, цены, стоп-лист и данные модификаторов из iiko в PostgreSQL, гостевые заказы из приложения отправляются в iiko как table order через `/api/1/order/create` и `/api/1/order/add_items`, а статус конкретного iiko-заказа можно подтянуть обратно через `/api/1/order/by_id`. Интеграция не принимает оплату, не работает с кассой и не делает фискализацию.

Настройка iiko задается только через `server\.env`.

Обязательные переменные для успешного sync:

```env
IIKO_ENABLED=true
IIKO_API_LOGIN=your-api-login
IIKO_ORGANIZATION_ID=your-organization-id
```

Опциональные переменные:

```env
IIKO_API_BASE=https://api-ru.iiko.services
IIKO_TERMINAL_GROUP_ID=your-terminal-group-id
IIKO_ORDER_SYNC_ENABLED=true
IIKO_ORDER_STATUS_SYNC_ENABLED=true
IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS=60
IIKO_ORDER_STATUS_SYNC_LIMIT=50
IIKO_SOURCE_KEY=gory-staff
IIKO_SERVICE_PRINT=true
IIKO_CHECK_STOP_LIST=true
IIKO_TRANSPORT_TIMEOUT_SECONDS=15
IIKO_WEBHOOK_SECRET=long-random-secret-for-iiko-connector
```

`IIKO_ENABLED` должен быть ровно `true`, иначе синхронизация отключена. Если `IIKO_API_LOGIN` пустой, синхронизация тоже отключена. `IIKO_ORGANIZATION_ID` нужен для успешной загрузки меню. `IIKO_TERMINAL_GROUP_ID` используется для фильтра stop-list и обязателен для отправки заказов в iiko. `IIKO_ORDER_SYNC_ENABLED=false` отключает отправку гостевых заказов и автоматический pull статусов, оставляя импорт меню. `IIKO_ORDER_STATUS_SYNC_ENABLED=false` отдельно отключает только фоновое подтягивание статусов. Секреты и реальные ключи в код, README и коммиты не добавляются.

Что делает sync:

- берет токен iiko через `POST /api/1/access_token`;
- читает меню через `POST /api/1/nomenclature`;
- читает стоп-лист через `POST /api/1/stop_lists`;
- обновляет `menu_categories`, `menu_items`, `stop_list`, `menu_item_modifier_groups`, `menu_item_modifiers`;
- повторный запуск не создает дубли, записи сопоставляются по `iiko_id`;
- блюда, исчезнувшие из ответа iiko, не удаляются, а получают `status = 'archived'`;
- группы модификаторов и позиции модификаторов не попадают в обычное видимое меню как блюда, а хранятся отдельно и архивируются, если исчезли из nomenclature;
- локальные поля вроде подсказок официанту, рекомендаций, себестоимости и служебных полей не затираются;
- результат пишется в `iiko_sync_log`.

Что делает order sync:

- при добавлении гостем позиции в заказ создает заказ в iiko, если у локального `guest_orders` еще нет `iiko_order_id`;
- если `iiko_order_id` уже есть, отправляет только новые несинхронизированные позиции через `/api/1/order/add_items`;
- сопоставляет позиции по `menu_items.iiko_id`, сохраняет `iiko_position_id`, `iiko_sync_status`, `iiko_sync_error` и `iiko_synced_at`;
- сохраняет состояние заказа в `guest_orders.iiko_order_id`, `iiko_correlation_id`, `iiko_creation_status`, `iiko_order_status`, `iiko_order_number`, `iiko_order_sum`, `iiko_order_closed_at`, `iiko_sync_status`, `iiko_sync_error`;
- результат каждой попытки пишет в `iiko_order_sync_log`;
- ручной повтор отправки доступен через `POST /iiko/sync/orders/:orderId`;
- ручное подтягивание статуса из iiko доступно через `POST /iiko/sync/orders/:orderId/status`; если iiko вернул `Closed`, локальный `guest_orders.status` становится `closed`, активная `table_guest_sessions` закрывается;
- batch pull открытых заказов доступен через `POST /iiko/sync/orders/statuses`;
- при старте сервера включается фоновый pull открытых iiko-заказов раз в `IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS` секунд, если iiko и order sync включены; минимум интервала 30 секунд, за один проход берется до `IIKO_ORDER_STATUS_SYNC_LIMIT` открытых локальных заказов.

Payment-paid webhook для iikoFront/локального коннектора:

- endpoint: `POST /iiko/events/payment-paid`;
- alias: `POST /iiko/webhooks/payment-paid`;
- предварительный импорт/обновление iiko-заказа: `POST /iiko/events/order-updated`, alias `POST /iiko/webhooks/order-updated`;
- защита: заголовок `X-Gory-Iiko-Secret: <IIKO_WEBHOOK_SECRET>` или `Authorization: Bearer <IIKO_WEBHOOK_SECRET>`;
- `order-updated` сохраняет iiko-заказ в `iiko_external_orders` и пытается связать его с активным гостем по `guest_id`, телефону, `table_session_id`, `table_id`, `iiko_table_id` или номеру стола;
- сервер принимает только факт уже прошедшей оплаты; приложение не проводит оплату, не работает с кассой и не фискализирует чек;
- если событие сопоставилось с гостем по `guest_id`, `local_order_id`, `iiko_order_id`, `table_session_id`, телефону или активному столу, сервер обновляет визиты гостя, закрывает локальный гостевой заказ/сессию и создает push-запрос `Оцените визит`;
- бонусы можно зарезервировать под оплачиваемый iiko-заказ через `POST /guest/bonus/redemptions` или `POST /admin/guests/:id/bonus-redemptions`;
- правило списания: `1` балл = `1` рубль, максимум `20%` от суммы заказа; для связи нужен `iiko_order_id` или `local_order_id`;
- при payment-paid webhook зарезервированное списание получает статус `applied`; если фактическая сумма оплаты дает меньший лимит, лишние бонусы возвращаются отдельной операцией;
- если `order-updated` уже связал iiko-заказ с гостем, `payment-paid` может прийти только с `order_id` и суммой: сервер найдет гостя через `iiko_external_orders`;
- повторы не начисляют визит второй раз: событие идемпотентно по `event_id`, `payment_id` и `order_id`.

Минимальный payload от коннектора для `order-updated`:

```json
{
  "order_id": "iiko-order-id",
  "order_number": "77",
  "table_number": "12",
  "amount": 1900,
  "status": "open"
}
```

Минимальный payload от коннектора для `payment-paid`:

```json
{
  "order_id": "iiko-order-id",
  "payment_id": "iiko-payment-id",
  "local_order_id": "guest_orders.id, если есть",
  "table_session_id": "table_guest_sessions.id, если есть",
  "guest_phone": "+7 900 000-00-00",
  "amount": 1900,
  "status": "paid"
}
```

Локальный мост событий для iiko:

- файл: `tools/iiko-event-connector.js`;
- это не iikoFront plugin и не кассовый модуль; это безопасный мост, который принимает JSON/JSONL события от iikoFront plugin, внешнего скрипта или выгрузки и отправляет их в серверные webhook-и Gory Staff;
- читает один JSON-объект, JSON-массив, JSONL-файл, папку с `.json`/`.jsonl` файлами или stdin;
- отправляет `order_updated`, `order_changed`, `order_created`, `order_opened` и события с `order_id` без признака оплаты в `/iiko/events/order-updated`;
- отправляет в `/iiko/events/payment-paid` только явно оплаченные события: `type/event_type = payment_paid/order_paid/order_closed`, `status = paid/closed/completed/success/...`, `paid: true` или `is_paid: true`; один `payment_id` без paid-статуса не считается оплатой;
- добавляет заголовок `X-Gory-Iiko-Secret` из `--secret`, переменных окружения `IIKO_WEBHOOK_SECRET`/`GORY_IIKO_WEBHOOK_SECRET` или из `server\.env`;
- по умолчанию пишет state-файл `runtime/iiko-event-connector-state.json`, чтобы повторный запуск не отправлял уже отправленные `event_id`/`payment_id`/`order_id` повторно;
- для постоянной работы использует `--watch` и опрашивает папку `runtime\iiko\events`, куда внешний iikoFront plugin или локальный скрипт должен складывать события.

Запуск из файла:

```powershell
$env:GORY_SERVER_URL = "http://127.0.0.1:4000"
$env:IIKO_WEBHOOK_SECRET = "<тот же секрет, что в server\.env>"
node tools\iiko-event-connector.js --file runtime\iiko\events.jsonl
```

Запуск из папки с событиями:

```powershell
node tools\iiko-event-connector.js --dir runtime\iiko\events
```

Постоянный запуск папки событий:

```powershell
node tools\iiko-event-connector.js --dir runtime\iiko\events --watch --interval-ms 1000
```

Запуск постоянного коннектора в фоне на Windows:

```bat
tools\bat\START_IIKO_EVENT_CONNECTOR.bat
```

Батник создает `runtime\iiko\events`, перезапускает старый процесс по `runtime\iiko\iiko-event-connector.pid` и пишет логи в `runtime\logs\iiko-event-connector.out.log` / `runtime\logs\iiko-event-connector.err.log`. Секрет берется из `server\.env`, если его не передали в окружении.

Обычный `START_GORY_STAFF.bat` теперь тоже запускает этот коннектор после успешного старта API и сохраняет существующие `IIKO_*` переменные в `server\.env`, а `STOP_GORY_STAFF.bat` его останавливает.

Потоковый запуск:

```powershell
Get-Content runtime\iiko\events.jsonl | node tools\iiko-event-connector.js
```

Текущий код использует `/api/1/access_token`, потому что этот этап настроен через `IIKO_API_LOGIN`.

Проверить статус:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

`GET /iiko/status` показывает расширенную диагностику: включена ли интеграция, хватает ли обязательных env, какие env отсутствуют, `IIKO_API_LOGIN` только в маске, organization/terminal group, последний menu sync из `iiko_sync_log`, последний order sync из `iiko_order_sync_log`, счетчики обработанных категорий/позиций/заказных позиций и последнюю ошибку. Полный `IIKO_API_LOGIN` в ответ не выводится.

Запустить sync вручную:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/menu" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Повторить отправку конкретного локального заказа в iiko:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/<guest_orders.id>" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Подтянуть статус конкретного iiko-заказа обратно в локальную БД:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/<guest_orders.id>/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Подтянуть статусы всех открытых локальных iiko-заказов пачкой:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/statuses" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Доступ к `/iiko/status`, `/iiko/sync/menu`, `/iiko/sync/orders/:orderId`, `/iiko/sync/orders/:orderId/status` и `/iiko/sync/orders/statuses` есть только у авторизованных staff-пользователей с правом `manage:menu`.

Документы по iiko:

- `docs/IIKO_MANUAL_CHECKLIST.md` — чек-лист ручной проверки на реальной тестовой организации;
- `docs/IIKO_ORDER_SYNC_CHECKLIST.md` — чек-лист проверки отправки гостевых заказов в iiko;
- `docs/IIKO_READONLY_ROADMAP.md` — старый read-only roadmap, теперь оставлен как историческая заметка;
- `docs/IIKO_CHECK_REPORT_TEMPLATE.md` — шаблон отчета будущей проверки без секретов;
- `docs/IIKO_TROUBLESHOOTING.md` — типовые ошибки и безопасная диагностика.

Пока не реализовано:

- онлайн-оплата;
- касса и фискализация;
- изменение оплат и закрытие заказа в iiko из приложения;
- sync персонала из iiko;
- UI выбора модификаторов в заказе.

## Public repository data policy

Runtime data is intentionally not stored in Git. The public repository excludes `data/`, `server/.env`, `server/src/restaurantSourceData.json`, generated APK files, local backups, and local build folders. PostgreSQL schema and application code stay in Git; real restaurant data and database exports stay local.
