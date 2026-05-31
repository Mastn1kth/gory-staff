-- ============================================================================
-- OAUTH ИНТЕГРАЦИЯ ДЛЯ ГОСТЕЙ
-- ============================================================================
-- Поддержка входа через Яндекс и ВКонтакте
-- ============================================================================

-- Добавляем поля для OAuth в таблицу guest_users
ALTER TABLE guest_users
  ADD COLUMN IF NOT EXISTS yandex_id TEXT,
  ADD COLUMN IF NOT EXISTS vk_id TEXT,
  ADD COLUMN IF NOT EXISTS oauth_provider TEXT,
  ADD COLUMN IF NOT EXISTS oauth_email TEXT,
  ADD COLUMN IF NOT EXISTS oauth_avatar_url TEXT;

-- Индексы для быстрого поиска по OAuth ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_users_yandex_id ON guest_users(yandex_id) WHERE yandex_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_users_vk_id ON guest_users(vk_id) WHERE vk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_users_oauth_provider ON guest_users(oauth_provider) WHERE oauth_provider IS NOT NULL;

-- Таблица для хранения OAuth токенов (опционально, для будущего)
CREATE TABLE IF NOT EXISTS guest_oauth_tokens (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guest_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_guest_oauth_tokens_guest ON guest_oauth_tokens(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_oauth_tokens_provider ON guest_oauth_tokens(provider);

-- Комментарии
COMMENT ON COLUMN guest_users.yandex_id IS 'ID пользователя в Яндекс (из OAuth)';
COMMENT ON COLUMN guest_users.vk_id IS 'ID пользователя ВКонтакте (из OAuth)';
COMMENT ON COLUMN guest_users.oauth_provider IS 'Провайдер OAuth: yandex, vk';
COMMENT ON COLUMN guest_users.oauth_email IS 'Email из OAuth провайдера';
COMMENT ON COLUMN guest_users.oauth_avatar_url IS 'URL аватара из OAuth провайдера';

COMMENT ON TABLE guest_oauth_tokens IS 'OAuth токены гостей для будущих интеграций';
