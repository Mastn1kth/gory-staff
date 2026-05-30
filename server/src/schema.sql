



CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_plain TEXT,
  role TEXT NOT NULL REFERENCES roles(name),
  position TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'off_shift',
  photo_url TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_plain TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  position TEXT NOT NULL,
  zone TEXT NOT NULL,
  status TEXT NOT NULL,
  comment TEXT
);

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE menu_categories
  ADD COLUMN IF NOT EXISTS iiko_id TEXT;

ALTER TABLE menu_categories
  ADD COLUMN IF NOT EXISTS iiko_parent_group_id TEXT;

ALTER TABLE menu_categories
  ADD COLUMN IF NOT EXISTS iiko_is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE menu_categories
  ADD COLUMN IF NOT EXISTS iiko_last_seen_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_categories_iiko_id ON menu_categories(iiko_id) WHERE iiko_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES menu_categories(id),
  price INTEGER NOT NULL,
  photo_url TEXT,
  composition TEXT NOT NULL,
  weight TEXT,
  cooking_time TEXT,
  allergens TEXT,
  calories TEXT,
  description TEXT,
  waiter_hint TEXT,
  recommendation TEXT,
  item_type TEXT NOT NULL DEFAULT 'food',
  cost_price INTEGER,
  cost_percent INTEGER,
  is_bar BOOLEAN NOT NULL DEFAULT FALSE,
  is_kitchen BOOLEAN NOT NULL DEFAULT TRUE,
  spice_level INTEGER NOT NULL DEFAULT 0,
  popularity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id)
);

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'food';

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS cost_price INTEGER;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS cost_percent INTEGER;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS is_bar BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS is_kitchen BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_id TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_group_id TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_product_category_id TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_size_id TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_modifier_schema_id TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_raw_type TEXT;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS iiko_last_seen_at TIMESTAMPTZ;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_iiko_id ON menu_items(iiko_id) WHERE iiko_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_items_iiko_group ON menu_items(iiko_group_id);

CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  iiko_modifier_group_id TEXT NOT NULL,
  iiko_modifier_schema_id TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  min_amount INTEGER,
  max_amount INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  iiko_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  iiko_last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(menu_item_id, iiko_modifier_group_id)
);

CREATE TABLE IF NOT EXISTS menu_item_modifiers (
  id TEXT PRIMARY KEY,
  modifier_group_id TEXT NOT NULL REFERENCES menu_item_modifier_groups(id) ON DELETE CASCADE,
  iiko_modifier_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  min_amount INTEGER,
  max_amount INTEGER,
  default_amount INTEGER,
  free_of_charge_amount INTEGER,
  hide_if_default_amount BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  iiko_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  iiko_last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(modifier_group_id, iiko_modifier_product_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_modifier_groups_menu_item ON menu_item_modifier_groups(menu_item_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_group ON menu_item_modifiers(modifier_group_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_iiko_product ON menu_item_modifiers(iiko_modifier_product_id);

CREATE TABLE IF NOT EXISTS stop_list (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  added_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_return_at TIMESTAMPTZ,
  comment TEXT
);

ALTER TABLE stop_list
  ALTER COLUMN added_by DROP NOT NULL;

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS iiko_product_id TEXT;

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS iiko_size_id TEXT;

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS iiko_terminal_group_id TEXT;

ALTER TABLE stop_list
  ADD COLUMN IF NOT EXISTS iiko_last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stop_list_iiko_product ON stop_list(iiko_product_id, status);

CREATE TABLE IF NOT EXISTS iiko_sync_log (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  categories_created INTEGER NOT NULL DEFAULT 0,
  categories_updated INTEGER NOT NULL DEFAULT 0,
  items_created INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_archived INTEGER NOT NULL DEFAULT 0,
  stop_list_items INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifier_groups_created INTEGER NOT NULL DEFAULT 0;

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifier_groups_updated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifier_groups_archived INTEGER NOT NULL DEFAULT 0;

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifiers_created INTEGER NOT NULL DEFAULT 0;

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifiers_updated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE iiko_sync_log
  ADD COLUMN IF NOT EXISTS modifiers_archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_iiko_sync_log_finished ON iiko_sync_log(finished_at DESC);

CREATE TABLE IF NOT EXISTS notebook_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notebook_notes
  ADD COLUMN IF NOT EXISTS shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE notebook_notes
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  plan_image TEXT
);

ALTER TABLE floors
  ADD COLUMN IF NOT EXISTS plan_image TEXT;

CREATE TABLE IF NOT EXISTS "tables" (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  seats INTEGER NOT NULL,
  x_position INTEGER NOT NULL,
  y_position INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 14,
  height INTEGER NOT NULL DEFAULT 14,
  shape TEXT NOT NULL,
  status TEXT NOT NULL,
  current_waiter_id TEXT REFERENCES users(id),
  comment TEXT
);

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  guests_count INTEGER NOT NULL,
  table_id TEXT REFERENCES "tables"(id),
  occasion TEXT,
  status TEXT NOT NULL,
  source TEXT,
  comment TEXT,
  call_status TEXT NOT NULL DEFAULT 'not_called',
  call_comment TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS call_status TEXT NOT NULL DEFAULT 'not_called';

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS call_comment TEXT;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id TEXT PRIMARY KEY,
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  guests_count INTEGER NOT NULL,
  desired_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  comment TEXT,
  call_status TEXT NOT NULL DEFAULT 'not_called',
  call_comment TEXT,
  seated_table_id TEXT REFERENCES "tables"(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS guest_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  birthday DATE,
  gender TEXT,
  email TEXT,
  avatar_url TEXT,
  bonus_balance INTEGER NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  lifetime_bonus_earned INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_bonus_earned >= 0),
  lifetime_bonus_spent INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_bonus_spent >= 0),
  loyalty_level TEXT NOT NULL DEFAULT 'bronze',
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT REFERENCES guest_users(id) ON DELETE SET NULL,
  visits_count INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  average_check INTEGER NOT NULL DEFAULT 0,
  last_visit_at TIMESTAMPTZ,
  favorite_category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  personal_data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE guest_users
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS guest_cards (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  card_number TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL DEFAULT 'bronze',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_bonus_transactions (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'guest_app',
  related_guest_id TEXT REFERENCES guest_users(id) ON DELETE SET NULL,
  related_visit_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guest_bonus_transactions
  ADD COLUMN IF NOT EXISTS iiko_order_id TEXT;

ALTER TABLE guest_bonus_transactions
  ADD COLUMN IF NOT EXISTS iiko_payment_event_id TEXT;

ALTER TABLE guest_bonus_transactions
  ADD COLUMN IF NOT EXISTS local_order_id TEXT;

ALTER TABLE guest_bonus_transactions
  ADD COLUMN IF NOT EXISTS table_session_id TEXT;

CREATE TABLE IF NOT EXISTS guest_referrals (
  id TEXT PRIMARY KEY,
  referrer_guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  referred_guest_id TEXT NOT NULL UNIQUE REFERENCES guest_users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  bonus_given_to_referrer BOOLEAN NOT NULL DEFAULT FALSE,
  bonus_given_to_referred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT,
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS guest_devices (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  push_token TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guest_id, device_id)
);

CREATE TABLE IF NOT EXISTS guest_consents (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE(guest_id, consent_type)
);

CREATE TABLE IF NOT EXISTS guest_notes (
  id TEXT PRIMARY KEY,
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  preferences TEXT,
  allergens TEXT,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guest_notes
  ADD COLUMN IF NOT EXISTS guest_id TEXT REFERENCES guest_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS guest_segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_segment_members (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES guest_segments(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(segment_id, guest_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  guests_count INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  floor_id TEXT REFERENCES floors(id),
  table_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  banquet_menu JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment TEXT,
  kitchen_comment TEXT,
  waiter_comment TEXT,
  responsible_user_id TEXT REFERENCES users(id),
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  prepayment_status TEXT NOT NULL DEFAULT 'not_required',
  call_status TEXT NOT NULL DEFAULT 'not_called',
  status TEXT NOT NULL
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS prepayment_status TEXT NOT NULL DEFAULT 'not_required';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS call_status TEXT NOT NULL DEFAULT 'not_called';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS alcohol_required INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS alcohol_available INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS alcohol_actual INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS alcohol_comment TEXT;

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  target_role TEXT NOT NULL DEFAULT 'all',
  importance TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assigned_to TEXT REFERENCES users(id),
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  photo_required BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS shift_checklist_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  target_role TEXT NOT NULL DEFAULT 'all',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  done_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shift_checklist_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE shift_checklist_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS supply_requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity TEXT,
  target_role TEXT NOT NULL DEFAULT 'kitchen',
  status TEXT NOT NULL DEFAULT 'new',
  requested_by TEXT NOT NULL REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_chat TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  file_url TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS message_reads (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT REFERENCES guest_users(id) ON DELETE CASCADE,
  user_type TEXT NOT NULL DEFAULT 'staff',
  body TEXT,
  target_role TEXT NOT NULL DEFAULT 'all',
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'created',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS guest_id TEXT REFERENCES guest_users(id) ON DELETE CASCADE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'staff';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS body TEXT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS data_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'created';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT,
  platform TEXT,
  push_token TEXT NOT NULL,
  app_version TEXT,
  device_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_type, user_id, push_token)
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'all',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_type, user_id, type)
);

ALTER TABLE supply_requests
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  push_device_id TEXT REFERENCES push_devices(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  provider_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_notebook_user_time ON notebook_notes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date, time);
CREATE INDEX IF NOT EXISTS idx_waitlist_status_time ON waitlist_entries(status, desired_time);
CREATE INDEX IF NOT EXISTS idx_guest_notes_phone ON guest_notes(guest_phone);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_id ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_users_phone ON guest_users(phone);
CREATE INDEX IF NOT EXISTS idx_guest_users_referral_code ON guest_users(referral_code);
CREATE INDEX IF NOT EXISTS idx_guest_users_status ON guest_users(status);
CREATE INDEX IF NOT EXISTS idx_guest_users_created_at ON guest_users(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_cards_guest_id_unique ON guest_cards(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_bonus_transactions_guest_id ON guest_bonus_transactions(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_bonus_transactions_created_at ON guest_bonus_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_guest_referrals_referral_code ON guest_referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_token_hash ON guest_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_tables_floor ON "tables"(floor_id);
CREATE INDEX IF NOT EXISTS idx_shift_checklist_date_role ON shift_checklist_items(date, target_role);
CREATE INDEX IF NOT EXISTS idx_supply_requests_status_role ON supply_requests(status, target_role);
CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON chat_messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_staff_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_guest_user ON notifications(guest_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type_status ON notifications(type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_type, user_id);
CREATE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(push_token);
CREATE INDEX IF NOT EXISTS idx_push_devices_active ON push_devices(is_active, revoked_at);
CREATE INDEX IF NOT EXISTS idx_notification_settings_user ON notification_settings(user_type, user_id, type);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_notification ON notification_delivery_log(notification_id);

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS checkin_token TEXT;

ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS iiko_table_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_checkin_token ON "tables"(checkin_token) WHERE checkin_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tables_iiko_table_id ON "tables"(iiko_table_id) WHERE iiko_table_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hall_signals (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES "tables"(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL REFERENCES users(id),
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hall_signals
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE hall_signals
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_hall_signals_status_time ON hall_signals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hall_signals_table ON hall_signals(table_id, created_at DESC);

CREATE TABLE IF NOT EXISTS table_guest_sessions (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES "tables"(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

ALTER TABLE table_guest_sessions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE table_guest_sessions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_table_guest_sessions_table ON table_guest_sessions(table_id, status);
CREATE INDEX IF NOT EXISTS idx_table_guest_sessions_guest ON table_guest_sessions(guest_id, status);

CREATE TABLE IF NOT EXISTS guest_orders (
  id TEXT PRIMARY KEY,
  table_session_id TEXT REFERENCES table_guest_sessions(id) ON DELETE SET NULL,
  table_id TEXT NOT NULL REFERENCES "tables"(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_id TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_correlation_id TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_creation_status TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_sync_status TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_sync_error TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_synced_at TIMESTAMPTZ;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_status TEXT;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_number INTEGER;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_sum INTEGER;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_closed_at TIMESTAMPTZ;

ALTER TABLE guest_orders
  ADD COLUMN IF NOT EXISTS iiko_order_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS guest_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES guest_orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ordered',
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guest_order_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE guest_order_items
  ADD COLUMN IF NOT EXISTS iiko_position_id TEXT;

ALTER TABLE guest_order_items
  ADD COLUMN IF NOT EXISTS iiko_sync_status TEXT;

ALTER TABLE guest_order_items
  ADD COLUMN IF NOT EXISTS iiko_sync_error TEXT;

ALTER TABLE guest_order_items
  ADD COLUMN IF NOT EXISTS iiko_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS guest_order_item_modifiers (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES guest_order_items(id) ON DELETE CASCADE,
  menu_item_modifier_id TEXT REFERENCES menu_item_modifiers(id) ON DELETE SET NULL,
  modifier_group_id TEXT REFERENCES menu_item_modifier_groups(id) ON DELETE SET NULL,
  iiko_modifier_product_id TEXT NOT NULL,
  iiko_modifier_group_id TEXT,
  name TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  iiko_position_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_orders_guest_status ON guest_orders(guest_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_orders_table_status ON guest_orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_orders_iiko_order_id ON guest_orders(iiko_order_id) WHERE iiko_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_order_items_order ON guest_order_items(order_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_order_items_iiko_sync ON guest_order_items(order_id, iiko_sync_status);
CREATE INDEX IF NOT EXISTS idx_guest_order_item_modifiers_item ON guest_order_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS idx_guest_order_item_modifiers_iiko_product ON guest_order_item_modifiers(iiko_modifier_product_id);

CREATE TABLE IF NOT EXISTS iiko_order_sync_log (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  items_synced INTEGER NOT NULL DEFAULT 0,
  iiko_order_id TEXT,
  correlation_id TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_iiko_order_sync_log_finished ON iiko_order_sync_log(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_iiko_order_sync_log_order ON iiko_order_sync_log(order_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS iiko_external_orders (
  id TEXT PRIMARY KEY,
  iiko_order_id TEXT NOT NULL UNIQUE,
  iiko_order_number TEXT,
  iiko_terminal_group_id TEXT,
  iiko_organization_id TEXT,
  iiko_table_id TEXT,
  table_id TEXT REFERENCES "tables"(id) ON DELETE SET NULL,
  table_number TEXT,
  table_session_id TEXT REFERENCES table_guest_sessions(id) ON DELETE SET NULL,
  guest_id TEXT REFERENCES guest_users(id) ON DELETE SET NULL,
  guest_phone TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_guest_status ON iiko_external_orders(guest_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_session ON iiko_external_orders(table_session_id, status);
CREATE INDEX IF NOT EXISTS idx_iiko_external_orders_table ON iiko_external_orders(table_id, status);

CREATE TABLE IF NOT EXISTS iiko_payment_events (
  id TEXT PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  iiko_order_id TEXT,
  iiko_payment_id TEXT,
  iiko_terminal_group_id TEXT,
  iiko_organization_id TEXT,
  local_order_id TEXT REFERENCES guest_orders(id) ON DELETE SET NULL,
  table_session_id TEXT REFERENCES table_guest_sessions(id) ON DELETE SET NULL,
  guest_id TEXT REFERENCES guest_users(id) ON DELETE SET NULL,
  guest_phone TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iiko_payment_events_guest ON iiko_payment_events(guest_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_iiko_payment_events_iiko_order ON iiko_payment_events(iiko_order_id) WHERE iiko_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS guest_bonus_redemptions (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  table_session_id TEXT REFERENCES table_guest_sessions(id) ON DELETE SET NULL,
  local_order_id TEXT REFERENCES guest_orders(id) ON DELETE SET NULL,
  iiko_order_id TEXT,
  iiko_payment_event_id TEXT REFERENCES iiko_payment_events(id) ON DELETE SET NULL,
  bonus_transaction_id TEXT REFERENCES guest_bonus_transactions(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  order_amount INTEGER NOT NULL DEFAULT 0 CHECK (order_amount >= 0),
  max_bonus_amount INTEGER NOT NULL DEFAULT 0 CHECK (max_bonus_amount >= 0),
  bonus_to_ruble_rate INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_bonus_redemptions_guest_status ON guest_bonus_redemptions(guest_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_bonus_redemptions_iiko_order ON guest_bonus_redemptions(iiko_order_id) WHERE iiko_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_bonus_redemptions_payment ON guest_bonus_redemptions(iiko_payment_event_id) WHERE iiko_payment_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_bonus_redemptions_session ON guest_bonus_redemptions(table_session_id, status);

CREATE TABLE IF NOT EXISTS guest_feedback_requests (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  iiko_payment_event_id TEXT REFERENCES iiko_payment_events(id) ON DELETE SET NULL,
  table_session_id TEXT REFERENCES table_guest_sessions(id) ON DELETE SET NULL,
  local_order_id TEXT REFERENCES guest_orders(id) ON DELETE SET NULL,
  rating INTEGER,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE(iiko_payment_event_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_feedback_requests_guest ON guest_feedback_requests(guest_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_external_id TEXT,
  source_url TEXT,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  import_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS social_post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image',
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_external_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, guest_id)
);

CREATE TABLE IF NOT EXISTS social_post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guest_users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS social_import_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status_published ON social_posts(status, published_at DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_source_external ON social_posts(source, source_external_id) WHERE source_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_post_media_post ON social_post_media(post_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_social_post_likes_guest ON social_post_likes(guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_post_comments_post ON social_post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_import_runs_source_time ON social_import_runs(source, created_at DESC);

CREATE TABLE IF NOT EXISTS menu_restored_alerts (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  menu_item_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_restored_alert_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL REFERENCES menu_restored_alerts(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_restored_alerts_created ON menu_restored_alerts(created_at DESC);

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS guest_segment_id TEXT REFERENCES guest_segments(id) ON DELETE SET NULL;
