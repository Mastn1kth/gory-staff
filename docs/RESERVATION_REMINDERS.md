# Автоматический прозвон броней

Система автоматических напоминаний о бронях через голосовые звонки и SMS.

## Возможности

✅ **Автоматические напоминания за день до брони**
✅ **Голосовые звонки через Twilio**
✅ **SMS-уведомления**
✅ **Ручные напоминания**
✅ **Статистика звонков и доставки**
✅ **Повторные попытки при ошибках**
✅ **Webhook для статусов Twilio**

## Настройка Twilio

### 1. Создать аккаунт Twilio

1. Зарегистрируйтесь на [twilio.com](https://www.twilio.com)
2. Получите тестовые или рабочие credentials
3. Купите телефонный номер для исходящих звонков

### 2. Настроить переменные окружения

Добавьте в `server\.env`:

```env
# Twilio для автоматических звонков
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+79001234567

# Опционально: URL для webhook статусов
TWILIO_STATUS_CALLBACK_URL=https://app.gory-staff.ru/reservation-reminders/twilio/callback

# Интервал проверки напоминаний (по умолчанию 60000 = 1 минута)
RESERVATION_REMINDER_CHECK_INTERVAL_MS=60000
```

### 3. Проверить статус интеграции

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:4000/reservation-reminders/twilio/status" `
  -Headers @{ Authorization = "Bearer <staff-token>" }
```

Ответ:
```json
{
  "enabled": true,
  "accountSid": "ACxxxxxx...",
  "fromPhone": "+79001234567",
  "hasAuthToken": true
}
```

## Как работает

### Автоматический режим

1. **Фоновый процесс** проверяет брони каждую минуту
2. **Создаёт напоминания** для броней на следующие 7 дней
3. **Отправляет напоминания** за день до брони в 10:00 (настраивается)
4. **Повторяет** неудачные попытки до 2 раз

### Типы напоминаний

- **`day_before`** - за день до брони (автоматически)
- **`hour_before`** - за час до брони (опционально)
- **`manual`** - ручное напоминание

### Каналы отправки

- **`voice`** - голосовой звонок через Twilio
- **`sms`** - SMS через Twilio
- **`push`** - push-уведомление (будущее)

## API Endpoints

### Получить настройки

```http
GET /reservation-reminders/settings
Authorization: Bearer <staff-token>
```

### Обновить настройки

```http
PATCH /reservation-reminders/settings
Authorization: Bearer <staff-token>
Content-Type: application/json

{
  "enabled": true,
  "day_before_enabled": true,
  "day_before_time": "10:00:00",
  "voice_enabled": true,
  "sms_enabled": true,
  "voice_script_template": "Добрый день! Это ресторан Горы. Напоминаем о вашей брони на {date} в {time} на {guests_count} человек. Ждём вас!",
  "sms_template": "Ресторан Горы: напоминаем о брони {date} в {time} на {guests_count} чел. Ждём вас!"
}
```

### Получить список напоминаний

```http
GET /reservation-reminders?status=sent&limit=50
Authorization: Bearer <staff-token>
```

Параметры:
- `status` - фильтр по статусу: `pending`, `sent`, `failed`, `cancelled`
- `reservation_id` - фильтр по конкретной брони
- `limit` - количество записей (по умолчанию 50)

### Создать ручное напоминание

```http
POST /reservation-reminders
Authorization: Bearer <staff-token>
Content-Type: application/json

{
  "reservation_id": "uuid-брони",
  "channel": "voice",
  "scheduled_at": "2026-05-31T09:00:00Z",
  "voice_script": "Добрый день! Напоминаем о вашей брони сегодня в 19:00."
}
```

### Отменить напоминание

```http
DELETE /reservation-reminders/:id
Authorization: Bearer <staff-token>
```

### Получить статистику

```http
GET /reservation-reminders/stats
Authorization: Bearer <staff-token>
```

Ответ:
```json
{
  "pending": 5,
  "sent": 120,
  "failed": 3,
  "cancelled": 2,
  "voice_sent": 80,
  "sms_sent": 40,
  "calls_answered": 65,
  "avg_call_duration": 45.5
}
```

## Шаблоны сообщений

В шаблонах можно использовать переменные:

- `{guest_name}` - имя гостя
- `{date}` - дата брони (например, "31 мая")
- `{time}` - время брони (например, "19:00")
- `{guests_count}` - количество гостей

### Пример голосового скрипта

```
Добрый день, {guest_name}! Это ресторан Горы. Напоминаем о вашей брони на {date} в {time} на {guests_count} человек. Ждём вас!
```

### Пример SMS

```
Ресторан Горы: напоминаем о брони {date} в {time} на {guests_count} чел. Ждём вас! 🍽️
```

## Статусы напоминаний

- **`pending`** - ожидает отправки
- **`sent`** - отправлено в Twilio
- **`failed`** - ошибка отправки
- **`cancelled`** - отменено вручную

## Статусы Twilio

### Для звонков (CallStatus)
- `queued` - в очереди
- `ringing` - звонит
- `in-progress` - идёт разговор
- `completed` - завершён
- `busy` - занято
- `no-answer` - не ответили
- `failed` - ошибка

### Для SMS (MessageStatus)
- `queued` - в очереди
- `sent` - отправлено
- `delivered` - доставлено
- `failed` - ошибка
- `undelivered` - не доставлено

## Troubleshooting

### Напоминания не отправляются

1. Проверьте настройки Twilio:
```powershell
curl http://127.0.0.1:4000/reservation-reminders/twilio/status
```

2. Проверьте логи сервера:
```
[ReservationReminders] Запуск фонового процесса...
[ReservationReminders] Создано напоминание для брони...
[ReservationReminders] Отправка напоминания...
```

3. Проверьте баланс Twilio аккаунта

### Звонки не доходят

1. Проверьте формат номера телефона (должен быть E.164: +79001234567)
2. Проверьте, что номер не в чёрном списке
3. Проверьте статус в Twilio Console

### Ошибка "Twilio не настроен"

Убедитесь, что все три переменные заданы в `.env`:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

## Стоимость

### Twilio тарифы (примерно)

- **Голосовой звонок в Россию**: ~$0.02-0.05 за минуту
- **SMS в Россию**: ~$0.05-0.10 за сообщение
- **Аренда номера**: ~$1-2 в месяц

Для 100 броней в месяц:
- 100 звонков × $0.03 = **$3**
- 100 SMS × $0.07 = **$7**
- Аренда номера = **$1**
- **Итого: ~$11/месяц**

## Безопасность

- ✅ Все endpoints требуют staff-авторизацию
- ✅ Webhook защищён от спама
- ✅ Секреты не логируются
- ✅ Номера телефонов нормализуются
- ✅ Повторные попытки ограничены

## Будущие улучшения

- [ ] Интеграция с другими VoIP-провайдерами
- [ ] Голосовые меню (IVR) для подтверждения брони
- [ ] Распознавание речи для автоматического подтверждения
- [ ] A/B тестирование текстов сообщений
- [ ] Аналитика эффективности напоминаний
- [ ] Push-уведомления как альтернатива звонкам

## Примеры использования

### Включить только SMS

```json
{
  "voice_enabled": false,
  "sms_enabled": true
}
```

### Изменить время отправки на 12:00

```json
{
  "day_before_time": "12:00:00"
}
```

### Отключить автоматические напоминания

```json
{
  "enabled": false
}
```

## База данных

### Таблица `reservation_reminders`

Хранит все напоминания с полной информацией о статусе, провайдере и результатах.

### Таблица `reservation_reminder_settings`

Глобальные настройки системы напоминаний.

## Логи

Все действия логируются в консоль сервера:

```
[ReservationReminders] Запущен с интервалом 60с
[ReservationReminders] Создано напоминание для брони abc-123 на 2026-05-30T10:00:00Z
[ReservationReminders] Отправка напоминания xyz-456 (voice) на +79001234567
[ReservationReminders] Напоминание xyz-456 отправлено успешно
```

## Поддержка

При проблемах проверьте:
1. Настройки Twilio в `.env`
2. Логи сервера
3. Статус в Twilio Console
4. Формат номеров телефонов
5. Баланс Twilio аккаунта
