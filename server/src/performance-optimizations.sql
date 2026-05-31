-- ============================================================================
-- ОПТИМИЗАЦИИ ПРОИЗВОДИТЕЛЬНОСТИ ДЛЯ ПРИЛОЖЕНИЯ "ГОРЫ"
-- ============================================================================
-- Этот файл содержит индексы и оптимизации для ускорения работы приложения
-- Применяется автоматически при инициализации БД
-- ============================================================================

-- ============================================================================
-- 1. ИНДЕКСЫ ДЛЯ ЧАСТО ЗАПРАШИВАЕМЫХ ПОЛЕЙ
-- ============================================================================

-- Индексы для меню (часто запрашивается гостями и персоналом)
CREATE INDEX IF NOT EXISTS idx_menu_items_category_status ON menu_items(category_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_items_status ON menu_items(status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_menu_categories_sort ON menu_categories(sort_order);

-- Индексы для стоп-листа (часто обновляется и проверяется)
CREATE INDEX IF NOT EXISTS idx_stop_list_menu_item_status ON stop_list(menu_item_id, status);
CREATE INDEX IF NOT EXISTS idx_stop_list_status_created ON stop_list(status, created_at DESC);

-- Индексы для броней (часто фильтруются по дате и статусу)
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_date_status ON reservations(date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_table_date ON reservations(table_id, date);
CREATE INDEX IF NOT EXISTS idx_reservations_phone ON reservations(guest_phone);

-- Индексы для листа ожидания
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_phone ON waitlist_entries(guest_phone);

-- Индексы для столов
CREATE INDEX IF NOT EXISTS idx_tables_status ON "tables"(status);
CREATE INDEX IF NOT EXISTS idx_tables_waiter ON "tables"(current_waiter_id) WHERE current_waiter_id IS NOT NULL;

-- ============================================================================
-- 2. ИНДЕКСЫ ДЛЯ ГОСТЕВОЙ СИСТЕМЫ
-- ============================================================================

-- Бонусные транзакции (история часто запрашивается)
CREATE INDEX IF NOT EXISTS idx_guest_bonus_transactions_guest_created ON guest_bonus_transactions(guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_bonus_transactions_type ON guest_bonus_transactions(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_bonus_transactions_iiko_order ON guest_bonus_transactions(iiko_order_id) WHERE iiko_order_id IS NOT NULL;

-- Гостевые сессии (проверяются при каждом запросе)
CREATE INDEX IF NOT EXISTS idx_guest_sessions_guest_expires ON guest_sessions(guest_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires ON guest_sessions(expires_at) WHERE revoked_at IS NULL;

-- Гостевые устройства
CREATE INDEX IF NOT EXISTS idx_guest_devices_guest ON guest_devices(guest_id, last_seen_at DESC);

-- Реферальная система
CREATE INDEX IF NOT EXISTS idx_guest_referrals_referrer ON guest_referrals(referrer_guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_referrals_referred ON guest_referrals(referred_guest_id);

-- ============================================================================
-- 3. ИНДЕКСЫ ДЛЯ ЗАКАЗОВ И IIKO ИНТЕГРАЦИИ
-- ============================================================================

-- Гостевые заказы
CREATE INDEX IF NOT EXISTS idx_guest_orders_guest_status ON guest_orders(guest_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_orders_table_status ON guest_orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_orders_iiko_order ON guest_orders(iiko_order_id) WHERE iiko_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_orders_status_created ON guest_orders(status, created_at DESC);

-- Позиции заказов
CREATE INDEX IF NOT EXISTS idx_guest_order_items_order ON guest_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_guest_order_items_iiko_sync ON guest_order_items(iiko_sync_status) WHERE iiko_sync_status IS NOT NULL;

-- iiko внешние заказы
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_order_id ON iiko_external_orders(iiko_order_id);
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_guest ON iiko_external_orders(guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_table ON iiko_external_orders(table_id) WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_created ON iiko_external_orders(created_at DESC);

-- iiko логи синхронизации заказов
CREATE INDEX IF NOT EXISTS idx_iiko_order_sync_log_order ON iiko_order_sync_log(order_id);
CREATE INDEX IF NOT EXISTS idx_iiko_order_sync_log_finished ON iiko_order_sync_log(finished_at DESC);

-- ============================================================================
-- 4. ИНДЕКСЫ ДЛЯ ПЕРСОНАЛА И СМЕН
-- ============================================================================

-- Пользователи
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Смены
CREATE INDEX IF NOT EXISTS idx_shifts_date_status ON shifts(date, status);
CREATE INDEX IF NOT EXISTS idx_shifts_user_status ON shifts(user_id, status);

-- Задачи
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Заметки блокнота
CREATE INDEX IF NOT EXISTS idx_notebook_user_shift ON notebook_notes(user_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_notebook_created ON notebook_notes(created_at DESC);

-- ============================================================================
-- 5. ИНДЕКСЫ ДЛЯ УВЕДОМЛЕНИЙ И PUSH
-- ============================================================================

-- Уведомления (часто фильтруются по пользователю и статусу прочтения)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC) WHERE user_type = 'staff';
CREATE INDEX IF NOT EXISTS idx_notifications_guest_read ON notifications(guest_id, is_read, created_at DESC) WHERE user_type = 'guest';
CREATE INDEX IF NOT EXISTS idx_notifications_status_created ON notifications(status, created_at DESC);

-- Push устройства (проверяются при отправке)
CREATE INDEX IF NOT EXISTS idx_push_devices_user_active ON push_devices(user_type, user_id, is_active);

-- Логи доставки уведомлений
CREATE INDEX IF NOT EXISTS idx_notification_delivery_status ON notification_delivery_log(status, created_at DESC);

-- ============================================================================
-- 6. ИНДЕКСЫ ДЛЯ ИСТОРИИ И ЛОГОВ
-- ============================================================================

-- История действий (часто запрашивается для аудита)
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action, created_at DESC);

-- Сообщения чата
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_deleted ON chat_messages(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- 7. ИНДЕКСЫ ДЛЯ БАНКЕТОВ И МЕРОПРИЯТИЙ
-- ============================================================================

-- События/банкеты
CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(date, status);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_responsible ON events(responsible_user_id, date);
CREATE INDEX IF NOT EXISTS idx_events_phone ON events(customer_phone);

-- ============================================================================
-- 8. ИНДЕКСЫ ДЛЯ ЗАЯВОК И ЧЕКЛИСТОВ
-- ============================================================================

-- Заявки на поставки
CREATE INDEX IF NOT EXISTS idx_supply_requests_created ON supply_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_requests_requested_by ON supply_requests(requested_by, status);

-- Чеклисты смены
CREATE INDEX IF NOT EXISTS idx_shift_checklist_done ON shift_checklist_items(is_done, date);

-- ============================================================================
-- 9. СОСТАВНЫЕ ИНДЕКСЫ ДЛЯ СЛОЖНЫХ ЗАПРОСОВ
-- ============================================================================

-- Для аналитики по гостям
CREATE INDEX IF NOT EXISTS idx_guest_users_status_visits ON guest_users(status, visits_count DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guest_users_status_spent ON guest_users(status, total_spent DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guest_users_loyalty ON guest_users(loyalty_level, status) WHERE deleted_at IS NULL;

-- Для поиска активных сессий столов
CREATE INDEX IF NOT EXISTS idx_table_guest_sessions_active ON table_guest_sessions(status, checked_in_at DESC) WHERE status = 'active';

-- Для поиска открытых сигналов зала
CREATE INDEX IF NOT EXISTS idx_hall_signals_open ON hall_signals(status, created_at DESC) WHERE status = 'open';

-- ============================================================================
-- 10. ЧАСТИЧНЫЕ ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ ПАМЯТИ
-- ============================================================================

-- Только активные записи
CREATE INDEX IF NOT EXISTS idx_guest_users_active ON guest_users(id, phone) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(id, name, category_id) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_stop_list_active ON stop_list(menu_item_id) WHERE status = 'active';

-- ============================================================================
-- КОММЕНТАРИИ К ОПТИМИЗАЦИЯМ
-- ============================================================================

COMMENT ON INDEX idx_menu_items_category_status IS 'Ускоряет загрузку меню по категориям';
COMMENT ON INDEX idx_guest_bonus_transactions_guest_created IS 'Ускоряет историю бонусов гостя';
COMMENT ON INDEX idx_notifications_user_read IS 'Ускоряет загрузку непрочитанных уведомлений';
COMMENT ON INDEX idx_guest_orders_status_created IS 'Ускоряет поиск открытых заказов';
COMMENT ON INDEX idx_activity_log_created IS 'Ускоряет загрузку истории действий';

-- ============================================================================
-- СТАТИСТИКА И ОБСЛУЖИВАНИЕ
-- ============================================================================

-- Обновление статистики для оптимизатора запросов
ANALYZE menu_items;
ANALYZE menu_categories;
ANALYZE guest_users;
ANALYZE guest_bonus_transactions;
ANALYZE notifications;
ANALYZE guest_orders;
ANALYZE reservations;
ANALYZE activity_log;
