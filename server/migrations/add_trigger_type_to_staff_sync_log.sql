-- Migration: Add trigger_type column to iiko_staff_sync_log
-- Date: 2026-05-30
-- Purpose: Support automatic staff sync scheduler

-- Add trigger_type column if it doesn't exist
ALTER TABLE iiko_staff_sync_log
ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'manual';

-- Set default value for existing records
UPDATE iiko_staff_sync_log
SET trigger_type = 'manual'
WHERE trigger_type IS NULL;

-- Add comment to explain the column
COMMENT ON COLUMN iiko_staff_sync_log.trigger_type IS
  'Тип триггера синхронизации: manual (ручная), scheduled (по расписанию), startup (при старте сервера)';

-- Verify the migration
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'iiko_staff_sync_log'
  AND column_name = 'trigger_type';
