
export type RoleName =
  | 'pending'
  | 'technician'
  | 'owner'
  | 'manager'
  | 'administrator'
  | 'smm_manager'
  | 'hostess'
  | 'waiter'
  | 'chef'
  | 'cook'
  | 'bar'
  | 'technical_staff';

export type SectionKey =
  | 'home'
  | 'floor'
  | 'myTables'
  | 'notebook'
  | 'reservations'
  | 'waitlist'
  | 'menu'
  | 'stoplist'
  | 'schedule'
  | 'staff'
  | 'clients'
  | 'events'
  | 'announcements'
  | 'chat'
  | 'rules'
  | 'tasks'
  | 'notifications'
  | 'profile'
  | 'admin'
  | 'analytics'
  | 'smm'
  | 'settings'
  | 'about';

export type ApiSession = {
  apiUrl: string;
  token: string;
  user: User;
  permissions: string[];
  sections: SectionKey[];
};

export type MutationOptions = {
  returnErrorBody?: boolean;
};

export type MutationFn = (method: string, path: string, body?: unknown, options?: MutationOptions) => Promise<unknown | null>;

export type HallSignalType = 'hall_help' | 'dessert_ready' | 'bill_soon';

export type HallSignal = {
  id: string;
  table_id: string;
  table_number?: string;
  signal_type: HallSignalType;
  signal_label?: string;
  status: 'open' | 'acknowledged';
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
  version?: number;
};

export type TableGuestSession = {
  id: string;
  table_id: string;
  guest_id: string;
  guest_name?: string;
  guest_phone?: string;
  table_number?: string;
  status: string;
  checked_in_at: string;
  updated_at?: string;
  version?: number;
};

export type GuestOrder = {
  id: string;
  table_session_id?: string | null;
  table_id: string;
  table_number?: string;
  guest_id: string;
  guest_name?: string;
  status: 'open' | 'closed' | 'cancelled' | string;
  iiko_order_id?: string | null;
  iiko_correlation_id?: string | null;
  iiko_creation_status?: string | null;
  iiko_order_status?: string | null;
  iiko_order_number?: number | null;
  iiko_order_sum?: number | null;
  iiko_order_closed_at?: string | null;
  iiko_order_payload_json?: Record<string, unknown> | null;
  iiko_sync_status?: string | null;
  iiko_sync_error?: string | null;
  iiko_synced_at?: string | null;
  created_at: string;
  updated_at: string;
  version?: number;
};

export type GuestOrderItem = {
  id: string;
  order_id: string;
  table_id?: string;
  table_number?: string;
  guest_id?: string;
  guest_name?: string;
  menu_item_id: string;
  menu_item_name?: string;
  category_id?: string;
  item_type?: string | null;
  is_bar?: boolean | null;
  is_kitchen?: boolean | null;
  quantity: number;
  status: 'ordered' | 'accepted' | 'in_progress' | 'done' | 'served' | 'cancelled' | string;
  assigned_to?: string | null;
  comment?: string | null;
  iiko_position_id?: string | null;
  iiko_sync_status?: string | null;
  iiko_sync_error?: string | null;
  iiko_synced_at?: string | null;
  modifiers?: GuestOrderItemModifier[];
  created_at: string;
  updated_at: string;
  version?: number;
};

export type GuestOrderItemModifier = {
  id: string;
  order_item_id: string;
  menu_item_modifier_id?: string | null;
  modifier_group_id?: string | null;
  iiko_modifier_product_id: string;
  iiko_modifier_group_id?: string | null;
  name: string;
  amount: number;
  price: number;
  iiko_position_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MenuRestoredAlert = {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  created_at: string;
};

export type GuestSegment = {
  id: string;
  name: string;
  description?: string | null;
  rules_json?: Record<string, unknown>;
  member_count?: number;
};

export type User = {
  id: string;
  name: string;
  phone: string;
  login?: string;
  role: RoleName;
  position: string;
  status: 'on_shift' | 'off_shift' | 'sick' | 'vacation' | 'active' | 'inactive' | 'blocked' | 'fired';
  photo_url?: string | null;
  comment?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number;
};

export type Role = {
  id: string;
  name: RoleName;
  permissions: string[];
};

export type Shift = {
  id: string;
  user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  position: string;
  zone: string;
  status: 'planned' | 'active' | 'done' | 'cancelled';
  comment?: string | null;
  updated_at?: string;
  version?: number;
};

export type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
};

export type MenuItem = {
  id: string;
  name: string;
  category_id: string;
  price: number;
  photo_url?: string | null;
  composition: string;
  weight?: string | null;
  cooking_time?: string | null;
  allergens?: string | null;
  calories?: string | null;
  description?: string | null;
  waiter_hint?: string | null;
  recommendation?: string | null;
  item_type?: 'food' | 'bar' | 'drink' | 'alcohol' | string | null;
  cost_price?: number | null;
  cost_percent?: number | null;
  is_bar?: boolean | null;
  is_kitchen?: boolean | null;
  spice_level: number;
  popularity: number;
  status: 'available' | 'stop' | 'soon_out';
  updated_at?: string;
  updated_by?: string | null;
  version?: number;
};

export type MenuItemModifierGroup = {
  id: string;
  menu_item_id: string;
  name: string;
  iiko_modifier_group_id?: string | null;
  iiko_modifier_schema_id?: string | null;
  required: boolean;
  min_amount?: number | null;
  max_amount?: number | null;
  sort_order: number;
  status: 'active' | 'archived' | string;
  iiko_payload_json?: Record<string, unknown>;
  iiko_last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MenuItemModifier = {
  id: string;
  modifier_group_id: string;
  iiko_modifier_product_id?: string | null;
  name: string;
  price: number;
  min_amount?: number | null;
  max_amount?: number | null;
  default_amount?: number | null;
  free_of_charge_amount?: number | null;
  hide_if_default_amount: boolean;
  sort_order: number;
  status: 'active' | 'archived' | string;
  iiko_payload_json?: Record<string, unknown>;
  iiko_last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type StopListItem = {
  id: string;
  menu_item_id: string;
  reason: string;
  status: 'out' | 'soon_out' | 'temporary' | 'back_later' | 'available';
  added_by: string;
  created_at: string;
  expected_return_at?: string | null;
  comment?: string | null;
  updated_at?: string;
  version?: number;
};

export type NotebookNote = {
  id: string;
  user_id: string;
  shift_id?: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  version?: number;
};

export type Floor = {
  id: string;
  name: string;
  sort_order: number;
  plan_image?: string | null;
};

export type RestaurantTable = {
  id: string;
  floor_id: string;
  number: string;
  seats: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  shape: 'round' | 'square' | 'rect';
  status: TableStatus;
  current_waiter_id?: string | null;
  iiko_table_id?: string | null;
  comment?: string | null;
  updated_at?: string;
  version?: number;
};

export type TableStatus =
  | 'free'
  | 'occupied'
  | 'reserved'
  | 'expected'
  | 'soon_free'
  | 'bill_waiting'
  | 'closed'
  | 'cleaning'
  | 'soon_reserved'
  | 'banquet';

export type ReservationStatus =
  | 'new'
  | 'confirmed'
  | 'waiting'
  | 'guests_arrived'
  | 'seated'
  | 'guests_left'
  | 'cancelled'
  | 'no_show';

export type Reservation = {
  id: string;
  guest_name: string;
  guest_phone: string;
  date: string;
  time: string;
  guests_count: number;
  table_id?: string | null;
  occasion?: string | null;
  status: ReservationStatus;
  source?: string | null;
  comment?: string | null;
  call_status?: 'not_called' | 'confirmed' | 'not_answered' | 'messenger_confirmed' | 'need_call' | string;
  call_comment?: string | null;
  created_by: string;
  created_at: string;
  updated_at?: string;
  version?: number;
};

export type WaitlistEntry = {
  id: string;
  guest_name: string;
  guest_phone: string;
  guests_count: number;
  desired_time: string;
  status: 'waiting' | 'offered' | 'seated' | 'cancelled' | string;
  comment?: string | null;
  call_status: 'not_called' | 'confirmed' | 'not_answered' | 'messenger_confirmed' | 'need_call' | string;
  call_comment?: string | null;
  seated_table_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at?: string;
  version?: number;
};

export type GuestNote = {
  id: string;
  guest_id?: string | null;
  guest_name: string;
  guest_phone: string;
  preferences?: string | null;
  allergens?: string | null;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type GuestUser = {
  id: string;
  name: string;
  phone: string;
  birthday?: string | null;
  gender?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  bonus_balance: number;
  lifetime_bonus_earned: number;
  lifetime_bonus_spent: number;
  loyalty_level: 'bronze' | 'silver' | 'gold' | 'platinum' | string;
  loyalty_level_label?: string;
  referral_code: string;
  referred_by?: string | null;
  referrer_name?: string | null;
  card_number?: string | null;
  invited_count?: number;
  visits_count: number;
  total_spent: number;
  average_check: number;
  last_visit_at?: string | null;
  favorite_category?: string | null;
  status: 'active' | 'blocked' | 'inactive' | string;
  marketing_consent: boolean;
  personal_data_consent: boolean;
  created_at: string;
  updated_at: string;
  version?: number;
};

export type GuestCard = {
  id: string;
  guest_id: string;
  card_number: string;
  level: string;
  issued_at: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type GuestBonusTransaction = {
  id: string;
  guest_id: string;
  type:
    | 'registration_bonus'
    | 'referral_bonus'
    | 'birthday_bonus'
    | 'manual_add'
    | 'manual_remove'
    | 'purchase_cashback'
    | 'correction'
    | 'expired'
    | 'spend'
    | 'staff_code_redeem'
    | string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  source: string;
  related_guest_id?: string | null;
  related_visit_id?: string | null;
  iiko_order_id?: string | null;
  iiko_payment_event_id?: string | null;
  local_order_id?: string | null;
  table_session_id?: string | null;
  created_by?: string | null;
  created_at: string;
};

export type GuestBonusRedemptionToken = {
  short_code: string;
  expires_at: string;
  created_at: string;
};

export type BonusCodeVerification = {
  valid: boolean;
  guest: {
    id: string;
    name: string;
    phone: string;
    bonus_balance: number;
    loyalty_level: string;
  };
  token: {
    short_code: string;
    expires_at: string;
    created_at: string;
  };
};

export type GuestBonusRedemption = {
  id: string;
  guest_id: string;
  table_session_id?: string | null;
  local_order_id?: string | null;
  iiko_order_id?: string | null;
  iiko_payment_event_id?: string | null;
  bonus_transaction_id?: string | null;
  amount: number;
  order_amount?: number;
  max_bonus_amount?: number;
  bonus_to_ruble_rate?: number;
  status: 'reserved' | 'applied' | 'cancelled' | string;
  reason?: string | null;
  created_at: string;
  updated_at?: string;
  applied_at?: string | null;
  cancelled_at?: string | null;
};

export type IikoExternalOrder = {
  id: string;
  iiko_order_id: string;
  iiko_order_number?: string | null;
  iiko_terminal_group_id?: string | null;
  iiko_organization_id?: string | null;
  iiko_table_id?: string | null;
  table_id?: string | null;
  table_number?: string | null;
  table_session_id?: string | null;
  guest_id?: string | null;
  guest_phone?: string | null;
  amount: number;
  status: string;
  first_seen_at?: string;
  updated_at?: string;
  closed_at?: string | null;
};

export type GuestFeedbackRequest = {
  id: string;
  guest_id: string;
  iiko_payment_event_id?: string | null;
  table_session_id?: string | null;
  local_order_id?: string | null;
  rating?: number | null;
  comment?: string | null;
  status: 'requested' | 'submitted' | string;
  notification_id?: string | null;
  requested_at: string;
  responded_at?: string | null;
};

export type GuestReferralSummary = {
  code: string;
  invited_count: number;
  bonuses_earned: number;
};

export type GuestProfilePayload = {
  token?: string;
  guest: GuestUser;
  card?: GuestCard | null;
  transactions: GuestBonusTransaction[];
  referral: GuestReferralSummary;
  notifications?: NotificationItem[];
  current_table_session?: (TableGuestSession & { table_number?: string }) | null;
  current_order_items?: GuestOrderItem[];
  feedback_requests?: GuestFeedbackRequest[];
  bonus_redemptions?: GuestBonusRedemption[];
  offers?: { id: string; title: string; text: string }[];
};

export type GuestMenuItem = {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  photo_url?: string | null;
  composition?: string | null;
  weight?: string | null;
  description?: string | null;
  item_type?: string | null;
  is_bar?: boolean | null;
  spice_level?: number | null;
  popularity?: number | null;
  status: string;
  is_available: boolean;
  guest_status_text?: string | null;
  updated_at?: string;
};

export type EventItem = {
  id: string;
  title: string;
  type: string;
  date: string;
  time: string;
  guests_count: number;
  customer_name: string;
  customer_phone: string;
  floor_id?: string | null;
  table_ids: string[];
  banquet_menu: string[];
  comment?: string | null;
  kitchen_comment?: string | null;
  waiter_comment?: string | null;
  responsible_user_id?: string | null;
  deposit_amount: number;
  prepayment_status: 'not_required' | 'invoice_sent' | 'paid' | 'partial' | string;
  call_status: 'not_called' | 'confirmed' | 'not_answered' | 'messenger_confirmed' | 'need_call' | string;
  status: string;
  alcohol_required?: number;
  alcohol_available?: number;
  alcohol_actual?: number;
  alcohol_comment?: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  text: string;
  author_id: string;
  target_role: string;
  importance: 'normal' | 'important' | 'urgent';
  created_at: string;
};

export type SocialPostMedia = {
  id: string;
  post_id: string;
  media_type: 'image' | 'video' | string;
  url: string;
  thumbnail_url?: string | null;
  sort_order?: number;
  created_at?: string;
};

export type SocialPost = {
  id: string;
  title: string;
  body: string;
  source: 'manual' | 'instagram' | 'vk' | string;
  source_url?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  status: 'draft' | 'published' | 'hidden' | string;
  published_at?: string | null;
  created_at: string;
  updated_at?: string;
  version?: number;
};

export type SocialPostComment = {
  id: string;
  post_id: string;
  guest_id: string;
  guest_name?: string;
  text: string;
  status: string;
  created_at: string;
};

export type RuleItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
};

export type TaskItem = {
  id: string;
  title: string;
  description: string;
  assigned_to?: string | null;
  due_date: string;
  status: 'new' | 'in_progress' | 'done';
  comment?: string | null;
  created_by: string;
  photo_required: boolean;
  updated_at?: string;
  version?: number;
};

export type ShiftChecklistItem = {
  id: string;
  title: string;
  category: string;
  target_role: string;
  date: string;
  sort_order: number;
  is_done: boolean;
  done_by?: string | null;
  done_at?: string | null;
  created_at: string;
  updated_at?: string;
  version?: number;
};

export type SupplyRequest = {
  id: string;
  title: string;
  category: string;
  quantity?: string | null;
  target_role: string;
  status: 'new' | 'ordered' | 'received' | 'cancelled' | string;
  requested_by: string;
  comment?: string | null;
  created_at: string;
  updated_at: string;
  version?: number;
};

export type Chat = {
  id: string;
  name: string;
  type: 'general' | 'department' | 'direct' | 'shift';
  created_by?: string | null;
  created_at: string;
};

export type ChatMember = {
  id: string;
  chat_id: string;
  user_id: string;
  role_in_chat: string;
  joined_at: string;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  message_text: string;
  message_type: 'text' | 'photo' | 'voice';
  file_url?: string | null;
  is_pinned: boolean;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
};

export type MessageRead = {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
};

export type ActivityLogItem = {
  id: string;
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
};

export type NotificationItem = {
  id: string;
  user_id?: string | null;
  guest_id?: string | null;
  user_type?: 'staff' | 'guest' | string;
  target_role: string;
  title: string;
  text: string;
  body?: string | null;
  type: string;
  data_json?: Record<string, unknown> | null;
  status?: string;
  is_read: boolean;
  created_at: string;
  sent_at?: string | null;
  read_at?: string | null;
  error_message?: string | null;
};

export type DataSnapshot = {
  server_time: string;
  server_status?: {
    service: string;
    mode: 'demo-memory' | 'postgres' | string;
    started_at: string;
    uptime_seconds: number;
    api_version: string;
  };
  connection?: {
    api_url: string;
    websocket_url: string;
    push_provider: string;
    push_disabled: boolean;
  };
  push_status?: {
    active_devices: number;
    devices: Array<{
      id: string;
      platform?: string | null;
      app_version?: string | null;
      device_name?: string | null;
      is_active: boolean;
      last_seen_at: string;
      created_at: string;
      updated_at?: string;
      revoked_at?: string | null;
    }>;
  };
  shift_brief?: {
    status: 'calm' | 'attention' | 'critical' | string;
    title: string;
    items: string[];
    on_shift: number;
    free_tables: number;
    occupied_tables: number;
    open_tasks: number;
    active_stop_list: number;
    unread_notifications: number;
    next_reservation_id?: string | null;
    next_event_id?: string | null;
  };
  restaurant: {
    name: string;
    app_name: string;
    concept: string;
    address: string;
    hours: string;
    seats: number;
    features: string[];
    contacts: string[];
  };
  current_user: User;
  permissions: string[];
  sections: SectionKey[];
  roles: Role[];
  users: User[];
  shifts: Shift[];
  menu_categories: MenuCategory[];
  menu_items: MenuItem[];
  menu_item_modifier_groups?: MenuItemModifierGroup[];
  menu_item_modifiers?: MenuItemModifier[];
  notebook_notes: NotebookNote[];
  stop_list: StopListItem[];
  floors: Floor[];
  tables: RestaurantTable[];
  reservations: Reservation[];
  events: EventItem[];
  announcements: Announcement[];
  rules: RuleItem[];
  tasks: TaskItem[];
  chats: Chat[];
  chat_members: ChatMember[];
  chat_messages: ChatMessage[];
  message_reads: MessageRead[];
  activity_log: ActivityLogItem[];
  notifications: NotificationItem[];
  waitlist_entries: WaitlistEntry[];
  guest_notes: GuestNote[];
  guest_clients?: GuestUser[];
  guest_client_transactions?: GuestBonusTransaction[];
  guest_bonus_redemptions?: GuestBonusRedemption[];
  iiko_external_orders?: IikoExternalOrder[];
  shift_checklist: ShiftChecklistItem[];
  supply_requests: SupplyRequest[];
  guest_orders?: GuestOrder[];
  guest_order_items?: GuestOrderItem[];
  guest_order_item_modifiers?: GuestOrderItemModifier[];
  social_posts?: SocialPost[];
  social_post_media?: SocialPostMedia[];
  social_post_comments?: SocialPostComment[];
  hall_signals?: HallSignal[];
  table_guest_sessions?: TableGuestSession[];
  menu_restored_alerts?: MenuRestoredAlert[];
  guest_segments?: GuestSegment[];
};

export type AnalyticsSnapshot = {
  reservations_today: number;
  reservations_week: number;
  guests_today: number;
  cancelled_week: number;
  no_show_week: number;
  free_tables: number;
  busy_tables: number;
  stop_list_count: number;
  completed_tasks: number;
  total_tasks: number;
  peak_hours: { hour: string; count: number }[];
  stop_list_items: { name: string; count: number }[];
  chat_activity: { name: string; messages: number }[];
};
