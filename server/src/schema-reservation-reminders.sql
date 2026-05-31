-- Автоматические напоминания о бронях

CREATE TABLE IF NOT EXISTS reservation_reminders (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL, -- 'day_before', 'hour_before', 'manual'
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'cancelled'
  channel TEXT NOT NULL DEFAULT 'voice', -- 'voice', 'sms', 'push'
  phone_number TEXT NOT NULL,
  message_text TEXT,
  voice_script TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  provider TEXT, -- 'twilio', 'manual', 'internal'
  provider_call_sid TEXT,
  provider_message_sid TEXT,
  provider_status TEXT,
  provider_response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  call_duration_seconds INTEGER,
  call_answered BOOLEAN,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservation_reminders_reservation ON reservation_reminders(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_reminders_status_scheduled ON reservation_reminders(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reservation_reminders_provider_sid ON reservation_reminders(provider_call_sid) WHERE provider_call_sid IS NOT NULL;

CREATE TABLE IF NOT EXISTS reservation_reminder_settings (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  day_before_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  day_before_time TIME NOT NULL DEFAULT '10:00:00', -- Время отправки напоминания за день
  hour_before_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  hour_before_minutes INTEGER NOT NULL DEFAULT 60,
  voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  voice_script_template TEXT NOT NULL DEFAULT 'Добрый день! Это ресторан Горы. Напоминаем о вашей брони на {date} в {time} на {guests_count} человек. Ждём вас!',
  sms_template TEXT NOT NULL DEFAULT 'Ресторан Горы: напоминаем о брони {date} в {time} на {guests_count} чел. Ждём вас!',
  auto_confirm_on_answer BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Вставляем настройки по умолчанию
INSERT INTO reservation_reminder_settings (id, enabled)
VALUES ('default', true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE reservation_reminders IS 'Автоматические напоминания о бронях через звонки/SMS';
COMMENT ON TABLE reservation_reminder_settings IS 'Настройки системы автоматических напоминаний';
