# Шаблон отчета ручной проверки iikoCloud

Этот шаблон нужен для будущей проверки на тестовой iikoCloud-организации. Реальные секреты, полный `IIKO_API_LOGIN`, пароли, токены и production-данные сюда не вставлять.

## 1. Общая информация

- Дата проверки:
- Кто проверял:
- Проект/ветка:
- Серверный порт:
- База данных: local PostgreSQL / Docker PostgreSQL / другое
- iiko организация: тестовая / согласованная безопасная

## 2. Env без секретов

Заполнять только факт наличия, без реальных значений.

```text
IIKO_ENABLED: true/false
IIKO_API_BASE: default/custom
IIKO_API_LOGIN: configured/missing, masked value only
IIKO_ORGANIZATION_ID: configured/missing
IIKO_TERMINAL_GROUP_ID: configured/missing
```

Полный `IIKO_API_LOGIN` не писать.

## 3. `/iiko/status`

Команда:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer $token" }
```

Результат:

```text
enabled:
env.ok:
env.missing:
env.apiLoginMasked:
env.organizationIdConfigured:
env.terminalGroupIdConfigured:
lastSync.status:
lastSync.startedAt:
lastSync.finishedAt:
lastSync.error:
```

Проверка секрета:

```text
Полный IIKO_API_LOGIN в ответе отсутствует: да/нет
```

## 4. `/iiko/sync/menu`

Команда:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/menu" `
  -Headers @{ Authorization = "Bearer $token" }
```

Результат:

```text
HTTP status:
status:
started_at:
finished_at:
duration_ms:
categories.created:
categories.updated:
items.created:
items.updated:
items.archived:
stop_list.items:
error:
```

## 5. Проверка БД

Последний sync:

```sql
select *
from iiko_sync_log
order by started_at desc
limit 5;
```

Итог:

```text
Свежая строка есть:
status:
started_at заполнен:
finished_at заполнен:
error_message пустой:
```

Категории:

```sql
select count(*) as iiko_categories
from menu_categories
where iiko_id is not null;
```

```text
Количество iiko категорий:
Дубли по iiko_id замечены: да/нет
```

Позиции:

```sql
select count(*) as iiko_items
from menu_items
where iiko_id is not null;
```

```text
Количество iiko позиций:
Дубли по iiko_id замечены: да/нет
```

Цены:

```text
Проверенные позиции:
1.
2.
3.

Цены совпали с iikoCloud: да/нет/частично
```

Stop-list:

```text
В тестовой iiko есть stop-позиции: да/нет/не проверялось
Строки source = 'iiko' появились: да/нет/не применимо
Статус menu_items стал stop: да/нет/не применимо
```

Архивирование:

```text
Сценарий выполнялся: да/нет
Тестовая позиция:
Статус стал archived: да/нет/не применимо
archived_at заполнен: да/нет/не применимо
```

## 6. Ошибки

```text
Были ошибки: да/нет
Где ошибка:
HTTP status:
iiko_sync_log.error_message:
server log без секретов:
Что сделали:
Что осталось:
```

## 7. Итог

```text
Проверка успешна: да/нет/частично
Что подтверждено:
Что не удалось проверить:
Что нужно уточнить:
```

## 8. Запрещенные данные

Перед сохранением отчета проверить, что в нем нет:

- полного `IIKO_API_LOGIN`;
- паролей;
- bearer token;
- `.env`;
- production-данных;
- дампов БД;
- скриншотов с секретами.
