# iiko Staff Sync: Синхронизация персонала

Обновлено: 2026-05-30

## Что это

Автоматическая синхронизация сотрудников из iikoCloud в локальную базу данных приложения «Горы».

## Зачем это нужно

- Единый источник данных о персонале
- Автоматическое создание учетных записей для новых сотрудников
- Синхронизация ролей и должностей
- Архивация уволенных сотрудников

## Как это работает

### 1. Получение данных из iiko

Сервер запрашивает список сотрудников через iiko API:
```
POST /api/1/employees
{
  "organizationIds": ["your-organization-id"],
  "includeDeleted": false
}
```

### 2. Маппинг ролей

iiko роли автоматически преобразуются в локальные:

| iiko роль | Локальная роль |
|-----------|----------------|
| Manager, Менеджер, Управляющий | `manager` |
| Host, Хостес | `hostess` |
| Waiter, Официант | `waiter` |
| Kitchen, Кухня, Повар | `kitchen` (cook) |
| Bar, Бар, Бармен | `bar` |
| Остальные | `waiter` (по умолчанию) |

### 3. Создание учетных записей

Для каждого нового сотрудника:
- Генерируется логин: `{имя}{последние4цифрытелефона}`
- Генерируется временный пароль (8 символов)
- Пароль сохраняется в `password_plain` для первого входа
- Создается запись в таблице `users`

### 4. Обновление существующих

Для существующих сотрудников обновляются:
- Имя
- Телефон
- Роль
- Должность
- Статус

### 5. Архивация

Сотрудники, которых больше нет в iiko, получают:
- `status = 'archived'`
- `iiko_is_deleted = TRUE`

## Настройка

### Обязательные переменные окружения

В `server\.env`:
```env
IIKO_ENABLED=true
IIKO_API_LOGIN=your-api-login
IIKO_ORGANIZATION_ID=your-organization-id
```

### Опциональные переменные

```env
IIKO_API_BASE=https://api-ru.iiko.services
```

## Использование

### Ручная синхронизация

#### Через API

```powershell
# Получить статус
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }

# Запустить синхронизацию
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/staff" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

#### Через приложение

1. Войдите как управляющий
2. Откройте `Админ-раздел`
3. Откройте `Push и онлайн-диагностика`
4. Нажмите `Синхронизировать персонал из iiko`

### Автоматическая синхронизация

✅ **Реализовано!** Автоматическая синхронизация персонала работает по расписанию.

#### Настройка

В `server\.env`:
```env
# Включить автоматическую синхронизацию (по умолчанию: true)
IIKO_STAFF_SYNC_ENABLED=true

# Интервал синхронизации в секундах (по умолчанию: 3600 = 1 час)
# Минимум: 1800 (30 минут)
IIKO_STAFF_SYNC_INTERVAL_SECONDS=3600

# Запускать синхронизацию при старте сервера (по умолчанию: true)
IIKO_STAFF_SYNC_ON_STARTUP=true
```

#### Как это работает

1. **Планировщик запускается при старте сервера**
   - Проверяет переменные окружения
   - Вычисляет интервал синхронизации (минимум 30 минут)
   - Запускает периодическую синхронизацию

2. **Синхронизация при старте** (опционально)
   - Если `IIKO_STAFF_SYNC_ON_STARTUP=true`
   - Запускается через 5 секунд после старта сервера
   - Обеспечивает актуальность данных сразу после запуска

3. **Периодическая синхронизация**
   - Запускается каждые N секунд (настраивается через env)
   - Использует ту же логику, что и ручная синхронизация
   - Предотвращает конкурентные запуски

4. **Логирование**
   - Все синхронизации записываются в `iiko_staff_sync_log`
   - Поле `trigger_type` указывает тип синхронизации:
     - `manual` - ручная синхронизация через API
     - `scheduled` - автоматическая по расписанию
     - `startup` - при старте сервера

#### Проверка статуса

```powershell
$response = Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }

$response.staffSync
```

Ответ:
```json
{
  "enabled": true,
  "disabledReason": null,
  "scheduler": {
    "enabled": true,
    "intervalMs": 3600000
  },
  "lastSync": {
    "status": "success",
    "rawStatus": "completed",
    "triggerType": "scheduled",
    "startedAt": "2026-05-30T10:00:00.000Z",
    "finishedAt": "2026-05-30T10:00:05.123Z",
    "durationMs": 5123,
    "staffCreated": 3,
    "staffUpdated": 12,
    "staffArchived": 1,
    "error": null
  }
}
```

#### Отключение автоматической синхронизации

Если нужно временно отключить:
```env
IIKO_STAFF_SYNC_ENABLED=false
```

Перезапустите сервер. Ручная синхронизация продолжит работать.

## Структура данных

### Таблица users

Новые поля для iiko:
```sql
iiko_id TEXT                    -- ID сотрудника в iiko
iiko_code TEXT                  -- Табельный номер
iiko_is_deleted BOOLEAN         -- Удален в iiko
iiko_last_seen_at TIMESTAMPTZ   -- Последняя синхронизация
```

### Таблица iiko_staff_sync_log

Лог синхронизаций:
```sql
id TEXT PRIMARY KEY
status TEXT                     -- completed, failed, disabled
started_at TIMESTAMPTZ
finished_at TIMESTAMPTZ
duration_ms INTEGER
staff_created INTEGER           -- Создано сотрудников
staff_updated INTEGER           -- Обновлено сотрудников
staff_archived INTEGER          -- Архивировано сотрудников
error_message TEXT
```

## Результат синхронизации

### Успешная синхронизация

```json
{
  "status": "completed",
  "started_at": "2026-05-30T10:00:00.000Z",
  "finished_at": "2026-05-30T10:00:05.123Z",
  "duration_ms": 5123,
  "staff": {
    "created": 3,
    "updated": 12,
    "archived": 1
  },
  "new_credentials": [
    {
      "id": "user-uuid-1",
      "name": "Иван Петров",
      "login": "ivanpetrov1234",
      "password": "a7b3c9d2",
      "role": "waiter"
    },
    {
      "id": "user-uuid-2",
      "name": "Мария Сидорова",
      "login": "mariasidorova5678",
      "password": "x4y2z8w1",
      "role": "hostess"
    }
  ]
}
```

### Ошибка синхронизации

```json
{
  "status": "failed",
  "started_at": "2026-05-30T10:00:00.000Z",
  "finished_at": "2026-05-30T10:00:01.456Z",
  "duration_ms": 1456,
  "staff": {
    "created": 0,
    "updated": 0,
    "archived": 0
  },
  "new_credentials": [],
  "error": "iiko request /api/1/employees failed with 401: Unauthorized"
}
```

### Отключена интеграция

```json
{
  "status": "disabled",
  "started_at": "2026-05-30T10:00:00.000Z",
  "finished_at": "2026-05-30T10:00:00.001Z",
  "duration_ms": 1,
  "staff": {
    "created": 0,
    "updated": 0,
    "archived": 0
  },
  "new_credentials": [],
  "disabled_reason": "IIKO_ENABLED is not true."
}
```

## Безопасность

### Пароли

- Временные пароли генерируются случайно (8 символов)
- Хранятся в `password_plain` только для первого входа
- Хешируются через bcrypt в `password_hash`
- **Важно:** Сотрудник должен сменить пароль после первого входа

### Доступ к API

- Требуется авторизация staff-пользователя
- Требуется право `manage:staff`
- Доступно только ролям: `manager`, `owner`, `technician`

### Логи

- Все синхронизации записываются в `iiko_staff_sync_log`
- Пароли не попадают в логи
- Ошибки записываются без секретов

## Диагностика

### Проверка статуса

```powershell
$response = Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }

$response.staffSync
```

Ответ:
```json
{
  "enabled": true,
  "disabledReason": null,
  "lastSync": {
    "status": "success",
    "rawStatus": "completed",
    "startedAt": "2026-05-30T10:00:00.000Z",
    "finishedAt": "2026-05-30T10:00:05.123Z",
    "durationMs": 5123,
    "staffCreated": 3,
    "staffUpdated": 12,
    "staffArchived": 1,
    "error": null
  }
}
```

### Типичные ошибки

#### 1. IIKO_ENABLED is not true

**Причина:** Интеграция отключена в `.env`

**Решение:**
```env
IIKO_ENABLED=true
```

#### 2. IIKO_API_LOGIN is not configured

**Причина:** Не указан API login

**Решение:**
```env
IIKO_API_LOGIN=your-api-login
```

#### 3. IIKO_ORGANIZATION_ID is not configured

**Причина:** Не указан ID организации

**Решение:**
```env
IIKO_ORGANIZATION_ID=your-organization-id
```

#### 4. iiko request /api/1/employees failed with 401

**Причина:** Неверный API login или истек токен

**Решение:**
- Проверьте `IIKO_API_LOGIN` в `.env`
- Проверьте права API login в iiko

#### 5. Invalid response from iiko employees API

**Причина:** iiko вернул неожиданный формат данных

**Решение:**
- Проверьте версию iiko API
- Проверьте логи сервера для деталей

## Ограничения

### Что синхронизируется

- ✅ Имя сотрудника
- ✅ Телефон
- ✅ Роль/должность
- ✅ Табельный номер (iiko_code)
- ✅ Статус (активен/архивирован)

### Что НЕ синхронизируется

- ❌ Фото сотрудника
- ❌ Email
- ❌ Дата рождения
- ❌ График работы
- ❌ Зарплата
- ❌ Права доступа (используются локальные роли)

### Конфликты

- Если в iiko изменился телефон, он обновится локально
- Если локально изменили роль, она перезапишется из iiko
- Если сотрудник удален в iiko, он архивируется локально (не удаляется)

## Roadmap

### P1 - Базовая функциональность (✅ Готово)

- ✅ Получение списка сотрудников из iiko
- ✅ Создание новых учетных записей
- ✅ Обновление существующих
- ✅ Архивация удаленных
- ✅ Маппинг ролей
- ✅ API endpoints
- ✅ Логирование

### P2 - Автоматизация (✅ Готово)

- ✅ Ежедневная автоматическая синхронизация
- ✅ Синхронизация при старте сервера
- ✅ Настройка расписания через env

### P3 - Улучшения

- ⏳ Webhook от iiko при изменении персонала
- ⏳ UI для просмотра истории синхронизаций
- ⏳ Уведомления о новых сотрудниках
- ⏳ Экспорт учетных данных в Excel
- ⏳ Отправка учетных данных на email/SMS

### P4 - Расширенная синхронизация

- ⏳ Синхронизация графика работы
- ⏳ Синхронизация фото
- ⏳ Двусторонняя синхронизация (локальные изменения → iiko)
- ⏳ Разрешение конфликтов

## Примеры использования

### Первичная настройка

1. Настройте `.env`:
```env
IIKO_ENABLED=true
IIKO_API_LOGIN=your-api-login
IIKO_ORGANIZATION_ID=your-organization-id
```

2. Запустите сервер:
```powershell
tools\bat\START_GORY_STAFF.bat
```

3. Войдите как управляющий

4. Запустите первую синхронизацию:
```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/staff" `
  -Headers @{ Authorization = "Bearer <your-token>" }
```

5. Сохраните учетные данные новых сотрудников из `new_credentials`

6. Раздайте логины и пароли сотрудникам

### Регулярное использование

1. Запускайте синхронизацию после изменений в iiko:
   - Прием нового сотрудника
   - Увольнение сотрудника
   - Изменение должности

2. Проверяйте статус последней синхронизации:
```powershell
$status = Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/iiko/status" `
  -Headers @{ Authorization = "Bearer <your-token>" }

$status.staffSync.lastSync
```

3. Сохраняйте учетные данные новых сотрудников

## Безопасное хранение учетных данных

### Для управляющего

После синхронизации сохраните `new_credentials` в безопасное место:

```powershell
# Сохранить в файл
$result = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/iiko/sync/staff" `
  -Headers @{ Authorization = "Bearer <your-token>" }

$result.new_credentials | ConvertTo-Json | Out-File "staff_credentials_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
```

### Для сотрудников

1. Раздайте логин и временный пароль лично
2. Попросите сменить пароль после первого входа
3. Не храните пароли в открытом виде

## Связанные документы

- `docs/IIKO_TROUBLESHOOTING.md` - Диагностика проблем iiko
- `docs/IIKO_MANUAL_CHECKLIST.md` - Ручная проверка интеграции
- `README.md` - Общая документация проекта
- `docs/AI_PROJECT_CONTEXT.md` - Контекст проекта для разработчиков
