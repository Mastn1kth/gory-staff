# Проверка синхронизации заказов iiko

Этот чек-лист нужен для безопасной проверки отправки гостевых заказов из приложения в тестовую iiko-организацию. Реальные `IIKO_API_LOGIN`, токены, пароли и production-данные сюда не вставлять.

## Что проверяется

- локальный гостевой заказ создает table order в iiko через `/api/1/order/create`;
- новые позиции существующего локального заказа уходят через `/api/1/order/add_items`;
- локальный `guest_orders.iiko_order_id` сохраняется после успешного создания;
- iiko-модификаторы импортируются как данные в `menu_item_modifier_groups` и `menu_item_modifiers`, но пока не выбираются гостем в UI заказа;
- позиции получают `guest_order_items.iiko_position_id` и `iiko_sync_status = 'synced'`;
- статус iiko-заказа подтягивается обратно через `/api/1/order/by_id`;
- при `Closed` локальный `guest_orders.status` становится `closed`, активная `table_guest_sessions` завершается;
- ошибки сохраняются в `guest_orders.iiko_sync_error`, `guest_order_items.iiko_sync_error` и `iiko_order_sync_log`.

## Env

```env
IIKO_ENABLED=true
IIKO_API_LOGIN=***
IIKO_ORGANIZATION_ID=***
IIKO_TERMINAL_GROUP_ID=***
IIKO_ORDER_SYNC_ENABLED=true
IIKO_ORDER_STATUS_SYNC_ENABLED=true
IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS=60
IIKO_ORDER_STATUS_SYNC_LIMIT=50
IIKO_SOURCE_KEY=gory-staff
IIKO_SERVICE_PRINT=true
IIKO_CHECK_STOP_LIST=true
IIKO_TRANSPORT_TIMEOUT_SECONDS=15
```

`IIKO_TERMINAL_GROUP_ID` обязателен для order sync. Если нужно проверить только импорт меню, можно оставить order sync выключенным через `IIKO_ORDER_SYNC_ENABLED=false`.

## Перед проверкой

1. Запустить сервер.
2. Импортировать меню через `POST /iiko/sync/menu`.
3. Убедиться, что у тестовой позиции меню заполнен `menu_items.iiko_id`.
4. Если нужно привязать заказ к реальному столу iiko, заполнить `tables.iiko_table_id` для тестового стола. Без этого сервер отправит заказ без `tableIds`, с `tabName = "Table <number>"`.

## Проверка

1. Гость входит в приложение и делает check-in за тестовым столом.
2. Гость добавляет позицию меню в заказ.
3. Проверить ответ `POST /guest/orders/items`: поле `iiko_sync.status` должно быть `completed`.
4. Проверить локальную БД:

```sql
select id, iiko_order_id, iiko_correlation_id, iiko_creation_status, iiko_sync_status, iiko_sync_error
from guest_orders
order by updated_at desc
limit 5;

select id, order_id, iiko_position_id, iiko_sync_status, iiko_sync_error
from guest_order_items
order by updated_at desc
limit 10;

select operation, status, items_synced, iiko_order_id, correlation_id, error_message, finished_at
from iiko_order_sync_log
order by finished_at desc
limit 10;
```

5. Добавить вторую позицию в тот же локальный заказ. В `iiko_order_sync_log.operation` должен появиться `add_items`.
6. Закрыть тестовый заказ в iiko или перевести его в состояние, которое нужно проверить, затем вызвать локальный status sync:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/<guest_orders.id>/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

После ответа `completed` проверить:

```sql
select id, status, iiko_order_status, iiko_order_number, iiko_order_sum, iiko_order_closed_at, iiko_sync_status, iiko_sync_error
from guest_orders
where id = '<guest_orders.id>';

select id, status, ended_at
from table_guest_sessions
where id = '<table_guest_sessions.id>';
```

7. Проверить batch pull всех открытых локальных iiko-заказов:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/statuses" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Ожидаемый ответ: `status = "completed"`, `operation = "pull_open_statuses"`, счетчики `orders.scanned`, `orders.synced`, `orders.failed`, `orders.closed`, `orders.cancelled`.
8. Для проверки фонового sync оставить сервер запущенным минимум на `IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS` секунд и убедиться, что в `iiko_order_sync_log` появились свежие строки `operation = 'pull_status'` по открытым заказам.

## Ручной retry

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/orders/<guest_orders.id>" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

## Что пока не проверяется этим чек-листом

- оплата;
- касса;
- фискализация;
- закрытие заказа в iiko из приложения;
- UI выбора модификаторов iiko в заказе;
- sync персонала.
