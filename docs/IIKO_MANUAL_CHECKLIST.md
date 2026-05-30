# Ручная проверка iikoCloud

Связанные документы:

- `docs/IIKO_READONLY_ROADMAP.md` - план read-only развития без заказов, оплаты, кассы и cron;
- `docs/IIKO_CHECK_REPORT_TEMPLATE.md` - шаблон будущего отчета ручной проверки без секретов;
- `docs/IIKO_TROUBLESHOOTING.md` - типовые ошибки и безопасная диагностика.

## 1. Цель проверки

Этот чек-лист нужен, чтобы безопасно проверить текущий read-only этап интеграции iikoCloud на реальной тестовой организации. Проверяется только ручной импорт данных из iikoCloud в локальную PostgreSQL-базу проекта: категории меню, позиции меню, цены, архивирование исчезнувших iiko-позиций и stop-list, если эти данные есть в тестовой организации.

Интеграция не отправляет данные в iikoCloud и не выполняет операции ресторана. Она читает iikoCloud и обновляет локальные таблицы проекта.

## 2. Что НЕ проверяется

Для всех пунктов ниже действует правило: на текущем этапе не реализовано / не проверяется.

- создание заказов;
- оплата;
- касса;
- фискализация;
- отправка заказов на кухню;
- автоматический menu sync;
- UI или админка для iiko.

## 3. Перед началом

У проверяющего должны быть:

- доступ к тестовой iikoCloud-организации;
- API login для тестовой организации;
- organization id;
- terminal group id, если нужно проверить stop-list по конкретной terminal group;
- локально установленный Node.js;
- установленный PostgreSQL или запущенный PostgreSQL из `docker-compose.yml`;
- заполненный `server\.env`, который не коммитится в репозиторий;
- staff-аккаунт в приложении с правом `manage:menu`;
- резервная копия локальной БД перед первым sync на реальных тестовых данных.

Нельзя коммитить, публиковать или отправлять без маскирования:

- `.env` и `server\.env`;
- полный `IIKO_API_LOGIN`;
- пароли;
- токены;
- дампы БД с реальными или production-данными;
- скриншоты, где видны секреты.

## 4. Env-переменные

Переменные указываются в `server\.env`.

Обязательные для успешной проверки:

```env
IIKO_ENABLED=true
IIKO_API_LOGIN=your-api-login
IIKO_ORGANIZATION_ID=your-organization-id
```

Опциональные:

```env
IIKO_API_BASE=https://api-ru.iiko.services
IIKO_TERMINAL_GROUP_ID=your-terminal-group-id
```

Факты по текущему коду:

- `IIKO_ENABLED` должен быть ровно `true`, иначе sync вернет `status = "disabled"`;
- `IIKO_API_LOGIN` обязателен, но полный login нельзя публиковать;
- `IIKO_ORGANIZATION_ID` обязателен для запроса меню и успешного sync;
- `IIKO_API_BASE` можно не указывать, тогда код использует `https://api-ru.iiko.services`;
- `IIKO_TERMINAL_GROUP_ID` не входит в обязательные env, но используется как фильтр при чтении stop-list, если задан.

В `GET /iiko/status` полный `IIKO_API_LOGIN` должен быть только в маске, например `yo***in`.

## 5. Команды PowerShell

Из корня проекта:

```powershell
cd "C:\Users\user\Desktop\Gor Staff"
npm install
npm --workspace server test
```

Если PostgreSQL запускается через Docker:

```powershell
docker compose up -d
```

Запуск сервера без watch-режима:

```powershell
npm --workspace server start
```

Альтернативная команда из root `package.json` для разработки с watch-режимом:

```powershell
npm run server
```

Порт берется из `PORT` в `server\.env`. Если `PORT` не задан, текущий код использует `4000`.

## 6. Получение staff token

Оба iiko endpoint требуют авторизацию и право `manage:menu`. В текущих ролях это право есть у `manager`, `chef` и `technician`; точный набор прав определяется файлом `server/src/permissions.js`.

Пример для PowerShell:

```powershell
$login = "your-manager-login"
$password = "your-manager-password"
$auth = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/auth/login" `
  -ContentType "application/json" `
  -Body (@{ login = $login; password = $password } | ConvertTo-Json)
$token = $auth.token
```

Не сохраняйте реальные логин, пароль и token в файлы проекта.

## 7. Проверка статуса

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer $token" }
```

Если в `server\.env` задан другой `PORT`, замените `4000` на фактический порт.

Что проверить в ответе:

- `enabled` равен `true`;
- `env.ok` равен `true`;
- `env.missing` пустой;
- `env.apiLoginMasked` заполнен;
- полный `IIKO_API_LOGIN` нигде не виден;
- `env.organizationId` соответствует тестовой организации;
- `env.terminalGroupId` заполнен только если он задан в env;
- `lastSync.status` может быть `null`, если sync еще не запускался;
- после успешного sync `lastSync.status` должен быть `success`;
- при ошибке `lastSync.status` будет `failed`;
- при отключенной интеграции без sync `lastSync.status` будет `disabled`.

Если `env.ok = false`, сначала исправьте `server\.env`, перезапустите сервер и снова проверьте `/iiko/status`.

## 8. Запуск ручной синхронизации

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/menu" `
  -Headers @{ Authorization = "Bearer $token" }
```

Текущий endpoint не требует body.

Ожидаемый успешный ответ:

- HTTP `200`;
- `status = "completed"`;
- заполнены `started_at`, `finished_at`, `duration_ms`;
- есть счетчики `categories`, `items`, `stop_list`.

Если интеграция отключена env-переменными, endpoint вернет HTTP `200` и `status = "disabled"`. Если во время обращения к iikoCloud или записи в БД произошла ошибка, endpoint вернет HTTP `502` и `status = "failed"`.

## 9. Проверка БД

Минимальная проверка журнала sync:

```sql
select *
from iiko_sync_log
order by started_at desc
limit 5;
```

Более удобный запрос по последним sync:

```sql
select
  status,
  started_at,
  finished_at,
  duration_ms,
  categories_created,
  categories_updated,
  items_created,
  items_updated,
  items_archived,
  stop_list_items,
  error_message
from iiko_sync_log
order by started_at desc
limit 5;
```

Категории:

```sql
select count(*) as iiko_categories
from menu_categories
where iiko_id is not null;

select id, name, sort_order, iiko_id, iiko_parent_group_id, iiko_is_deleted, iiko_last_seen_at
from menu_categories
where iiko_id is not null
order by sort_order asc, name asc
limit 50;
```

Позиции меню и цены:

```sql
select count(*) as iiko_items
from menu_items
where iiko_id is not null;

select id, name, category_id, price, status, iiko_id, iiko_group_id, iiko_product_category_id, iiko_size_id, iiko_last_seen_at
from menu_items
where iiko_id is not null
order by name asc
limit 50;
```

Архивирование:

```sql
select id, name, status, archived_at, iiko_id, iiko_last_seen_at
from menu_items
where iiko_id is not null
  and status = 'archived'
order by archived_at desc
limit 20;
```

Stop-list:

```sql
select id, menu_item_id, status, source, iiko_product_id, iiko_size_id, iiko_terminal_group_id, iiko_last_seen_at, updated_at
from stop_list
where source = 'iiko'
order by updated_at desc
limit 50;
```

## 10. Как понять, что данные загрузились

Категории считаются загруженными, если в `menu_categories` есть строки с `iiko_id`, а повторный sync не создает дубли по тем же `iiko_id`.

Блюда/позиции меню считаются загруженными, если в `menu_items` есть строки с `iiko_id`, `category_id` ссылается на существующую категорию, а повторный sync обновляет эти строки без дублей.

Цены проверяются на этом этапе. Текущий код берет цену из `sizePrices[].price.currentPrice`, округляет ее до целого и пишет в `menu_items.price`. Проверьте несколько тестовых позиций вручную по данным iikoCloud.

Архивирование старых позиций поддерживается текущим кодом. Если позиция, ранее импортированная из iiko, исчезла из ответа nomenclature, после следующего sync локальная строка не удаляется, а получает `menu_items.status = 'archived'` и `archived_at`.

Stop-list поддерживается текущей read-only логикой через `/api/1/stop_lists`. Если в iiko есть stop-позиции, после sync должны появиться строки `stop_list.source = 'iiko'`, а соответствующие позиции меню должны получить статус `stop`. Если в тестовой организации stop-list пустой, отсутствие строк `source = 'iiko'` само по себе не доказывает ошибку.

Модификаторы текущий код не импортирует как обычные блюда. Группы и позиции модификаторов хранятся отдельно в `menu_item_modifier_groups` и `menu_item_modifiers`, чтобы следующий слой мог использовать их при заказе. Категории-модификаторы и удаленные/скрытые группы не становятся видимыми категориями меню.

## 11. Как читать `iiko_sync_log`

Важные поля:

- `status`: внутренний статус записанного sync, обычно `completed` или `failed`; отключенный sync возвращает `status = "disabled"` в API-ответе, но текущий код не пишет такую строку в `iiko_sync_log`;
- `started_at`: когда sync начался;
- `finished_at`: когда sync завершился;
- `duration_ms`: длительность;
- `categories_created` и `categories_updated`: сколько категорий создано или обновлено;
- `items_created`, `items_updated`, `items_archived`: сколько позиций создано, обновлено или архивировано;
- `stop_list_items`: сколько iiko stop-list строк обработано;
- `error_message`: текст ошибки, если sync завершился `failed`.

В `/iiko/status` внутренний `completed` показывается как публичный `lastSync.status = "success"`.

## 12. Успешный результат

Проверку можно считать успешной, если:

- `/iiko/status` показывает `enabled = true` и `env.ok = true`;
- полный `IIKO_API_LOGIN` не виден в ответах API, логах и документации;
- `POST /iiko/sync/menu` завершается без ошибки и возвращает `status = "completed"`;
- в `iiko_sync_log` появилась свежая запись со статусом `completed`;
- `started_at` и `finished_at` заполнены;
- `error_message` пустой;
- счетчики категорий/позиций соответствуют фактической обработке;
- в `menu_categories` появились или обновились строки с `iiko_id`;
- в `menu_items` появились или обновились строки с `iiko_id`;
- цены в `menu_items.price` совпадают с выбранными тестовыми позициями из iikoCloud;
- архивирование и stop-list ведут себя как описано выше, если эти сценарии есть в тестовой организации.

## 13. Признаки ошибки

Смотрите на такие признаки:

- `/iiko/status` показывает `env.ok = false`;
- `env.missing` содержит обязательные переменные;
- `enabled = false` при ожидаемой включенной интеграции;
- неверный `IIKO_API_LOGIN`;
- неверный `IIKO_ORGANIZATION_ID`;
- неверный `IIKO_TERMINAL_GROUP_ID` для проверки stop-list;
- сеть или iikoCloud недоступны;
- iikoCloud возвращает пустое меню для тестовой организации;
- ошибка схемы БД или отсутствие таблиц;
- `POST /iiko/sync/menu` вернул HTTP `502`;
- sync завершился `status = "failed"`;
- в `iiko_sync_log.error_message` есть текст ошибки;
- `finished_at` не заполнен после завершения;
- в ответе API, логах или отчете случайно виден полный `IIKO_API_LOGIN`.

## 14. Что делать при ошибке

Безопасный порядок действий:

1. Сначала открыть `/iiko/status` и проверить `enabled`, `env.ok`, `env.missing`, masked login и `lastSync`.
2. Проверить последние строки `iiko_sync_log`.
3. Проверить server logs.
4. Проверить `server\.env`, не копируя реальные значения в чат, issue или документацию.
5. Убедиться, что тестовая организация, organization id и terminal group id выданы именно для этой проверки.
6. Если нужно передать ошибку другому человеку, скрыть полный API login, пароли, токены, production-данные и лишние части URL/headers.

Если ошибка связана с реальными ключами или доступом к организации, ее нельзя полноценно проверить без владельца тестовой iikoCloud-организации.
