import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { FloorPlan } from '../../components/FloorPlan';
import { HallSignalsFeed } from '../../components/HallSignalsFeed';
import { MenuRestoredBanner } from '../../components/MenuRestoredBanner';
import {
  Avatar,
  Card,
  EmptyState,
  Field,
  MetricCard,
  ModalSheet,
  Pill,
  PrimaryButton,
  ScreenScroll,
  SecondaryButton,
} from '../../components/ui';
import { canManage, labelForRole, sectionDefinitions } from '../../data/permissions';
import { palette, tableStatusLabel } from '../../theme';
import type {
  Announcement,
  Chat,
  ChatMessage,
  DataSnapshot,
  EventItem,
  MenuItem,
  Reservation,
  RestaurantTable,
  RoleName,
  SectionKey,
  StopListItem,
  TaskItem,
  User,
} from '../../types';

import { ClientsScreen } from './clients';
import {
  assignableRoles,
  categoryName,
  isBarCategory,
  isBarMenuItem,
  menuItem,
  reservationLabels,
  roleTone,
  shiftLabels,
  shortDate,
  shortDateTime,
  staffStatusActions,
  stopLabels,
  tableName,
  taskLabels,
  todayISO,
  userName,
  userStatusLabels,
} from './shared';
import type { MutationFn, SectionProps } from './types';
import { InfoBlock, MiniRow, PulseMetric, styles } from './widgets';

const orderStatusLabels: Record<string, string> = {
  ordered: 'Заказал',
  accepted: 'Принято',
  in_progress: 'В работе',
  done: 'Сделано',
  served: 'Принесли',
  cancelled: 'Отменено',
};

function minutesUntilReservation(reservation: Reservation) {
  const dateTime = new Date(`${reservation.date?.slice(0, 10)}T${reservation.time ?? '00:00'}:00`);
  if (Number.isNaN(dateTime.getTime())) return null;
  return Math.round((dateTime.getTime() - Date.now()) / 60000);
}

function reservationReminderLabel(reservation: Reservation) {
  const minutes = minutesUntilReservation(reservation);
  if (minutes === null) return 'Проверить';
  if (minutes < -15) return 'Просрочена';
  if (minutes <= 0) return 'Сейчас';
  if (minutes < 60) return `Через ${minutes} мин`;
  return `Через ${Math.round(minutes / 60)} ч`;
}

function reservationNeedsReminder(reservation: Reservation) {
  if (!['new', 'confirmed', 'waiting'].includes(reservation.status)) return false;
  const minutes = minutesUntilReservation(reservation);
  if (minutes === null) return reservation.call_status === 'need_call' || reservation.call_status === 'not_called';
  return minutes >= -15 && minutes <= 180;
}

export function HomeScreen({ snapshot, navigate, onMutate, onRefresh }: SectionProps) {
  const today = todayISO();
  const freeTables = snapshot.tables.filter((table) => table.status === 'free').length;
  const occupiedTables = snapshot.tables.filter((table) => ['occupied', 'banquet'].includes(table.status)).length;
  const stopCount = snapshot.stop_list.filter((item) => item.status !== 'available').length;
  const shiftBrief = snapshot.shift_brief;
  const todayReservations = snapshot.reservations.filter((reservation) => reservation.date?.slice(0, 10) === today);
  const todayEvents = snapshot.events.filter((event) => event.date?.slice(0, 10) >= today).slice(0, 2);
  const importantAnnouncements = snapshot.announcements.filter((item) => item.importance !== 'normal').slice(0, 2);
  const todayShift = snapshot.shifts.find((shift) => shift.user_id === snapshot.current_user.id && shift.date?.slice(0, 10) === today);
  const shiftActive = snapshot.current_user.status === 'on_shift' || todayShift?.status === 'active';
  const homeActions = [
    shiftBrief && shiftBrief.active_stop_list > 0 && snapshot.sections.includes('stoplist')
      ? { key: 'stoplist' as SectionKey, label: 'Стоп-лист', count: shiftBrief.active_stop_list }
      : null,
    shiftBrief && shiftBrief.open_tasks > 0 && snapshot.sections.includes('tasks')
      ? { key: 'tasks' as SectionKey, label: 'Задачи', count: shiftBrief.open_tasks }
      : null,
    shiftBrief && shiftBrief.unread_notifications > 0 && snapshot.sections.includes('notifications')
      ? { key: 'notifications' as SectionKey, label: 'Сигналы', count: shiftBrief.unread_notifications }
      : null,
    shiftBrief?.next_reservation_id && snapshot.sections.includes('reservations') ? { key: 'reservations' as SectionKey, label: 'Брони' } : null,
    shiftBrief?.next_event_id && snapshot.sections.includes('events') ? { key: 'events' as SectionKey, label: 'Банкеты' } : null,
  ].filter(Boolean) as { key: SectionKey; label: string; count?: number }[];

  return (
    <ScreenScroll>
      <View style={styles.metricsRow}>
        <MetricCard label="Свободно" value={freeTables} detail="столиков" />
        <MetricCard label="Занято" value={occupiedTables} detail="столиков" />
        <MetricCard label="Стоп" value={stopCount} detail="позиций" />
      </View>
      {['technician', 'manager', 'administrator', 'hostess'].includes(snapshot.current_user.role) ? (
        <HallSignalsFeed snapshot={snapshot} onMutate={onMutate} onRefresh={onRefresh} canAcknowledge />
      ) : null}
      {shiftBrief ? (
        <Card tone={shiftBrief.status === 'critical' ? 'dark' : shiftBrief.status === 'attention' ? 'soft' : 'light'}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={shiftBrief.status === 'critical' ? styles.darkTitle : styles.cardTitle}>Пульс смены</Text>
              <Text style={shiftBrief.status === 'critical' ? styles.darkText : styles.bodyText}>{shiftBrief.title}</Text>
            </View>
            <Pill
              label={shiftBrief.status === 'critical' ? 'Срочно' : shiftBrief.status === 'attention' ? 'Контроль' : 'Спокойно'}
              tone={shiftBrief.status === 'critical' ? 'bad' : shiftBrief.status === 'attention' ? 'warn' : 'good'}
            />
          </View>
          <View style={styles.pulseGrid}>
            <PulseMetric label="На смене" value={shiftBrief.on_shift} critical={shiftBrief.status === 'critical'} />
            <PulseMetric label="Задачи" value={shiftBrief.open_tasks} critical={shiftBrief.status === 'critical'} />
            <PulseMetric label="Сигналы" value={shiftBrief.unread_notifications} critical={shiftBrief.status === 'critical'} />
          </View>
          {shiftBrief.items.slice(0, 4).map((item) => (
            <MiniRow key={item} title={item} text="Откройте нужный раздел для деталей." />
          ))}
          {homeActions.length > 0 ? (
            <View style={styles.quickGrid}>
              {homeActions.map((action) => (
                <SecondaryButton
                  key={action.key}
                  title={action.count ? `${action.label}: ${action.count}` : action.label}
                  compact
                  onPress={() => navigate(action.key)}
                />
              ))}
            </View>
          ) : null}
          {snapshot.current_user.role !== 'pending' ? (
            <PrimaryButton
              title={shiftActive ? 'Завершить смену' : 'Начать смену'}
              compact
              onPress={() => onMutate('PATCH', '/me/status', { status: shiftActive ? 'off_shift' : 'on_shift' })}
            />
          ) : null}
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>Важные объявления</Text>
        {importantAnnouncements.length === 0 ? <Text style={styles.mutedText}>Новых срочных объявлений нет.</Text> : null}
        {importantAnnouncements.map((announcement) => (
          <MiniRow key={announcement.id} title={announcement.title} text={announcement.text} pill={announcement.importance === 'urgent' ? 'Срочно' : 'Важно'} />
        ))}
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Ближайшие брони</Text>
        {todayReservations.slice(0, 4).map((reservation) => (
          <MiniRow
            key={reservation.id}
            title={`${reservation.time} · ${reservation.guest_name}`}
            text={`${reservation.guests_count} гостей · ${tableName(snapshot, reservation.table_id)} · ${reservation.comment ?? ''}`}
            pill={reservationLabels[reservation.status]}
          />
        ))}
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Банкеты и мероприятия</Text>
        {todayEvents.map((event) => (
          <MiniRow
            key={event.id}
            title={`${shortDate(event.date)} ${event.time} · ${event.title}`}
            text={`${event.guests_count} гостей · ${event.kitchen_comment ?? event.comment ?? ''}`}
            pill={event.status}
          />
        ))}
      </Card>
    </ScreenScroll>
  );
}

export function FloorScreen({ snapshot, onMutate, onlyMine }: SectionProps & { onlyMine?: boolean }) {
  const manageable = canManage(snapshot.permissions, 'manage:floor') && !onlyMine;
  return (
    <ScreenScroll>
      <FloorPlan
        snapshot={snapshot}
        onlyMine={onlyMine}
        canManage={manageable}
        onMutate={onMutate}
        onUpdateTable={async (id, body) => {
          await onMutate('PATCH', `/tables/${id}`, body);
        }}
      />
    </ScreenScroll>
  );
}

export function NotebookScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'shift' | 'all'>('shift');
  const [form, setForm] = useState({ title: '', body: '' });
  const today = todayISO();
  const currentShift = snapshot.shifts.find((shift) => shift.user_id === snapshot.current_user.id && shift.date?.slice(0, 10) === today);
  const notes = snapshot.notebook_notes.filter((note) => (filter === 'all' ? true : currentShift ? note.shift_id === currentShift.id : note.created_at?.slice(0, 10) === today));

  return (
    <ScreenScroll>
      <Card tone="soft">
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Текущая смена</Text>
            <Text style={styles.bodyText}>
              {currentShift ? `${shortDate(currentShift.date)} · ${currentShift.start_time?.slice(0, 5)}-${currentShift.end_time?.slice(0, 5)} · ${currentShift.zone}` : 'Сегодня смена не найдена. Записи сохранятся как заметки дня.'}
            </Text>
          </View>
          <Pill label={`${notes.length} записей`} tone="info" />
        </View>
      </Card>
      <View style={styles.actionGrid}>
        <SecondaryButton title="Запись" compact onPress={() => setShowForm(true)} />
        <SecondaryButton title="Эта смена" compact onPress={() => setFilter('shift')} />
        <SecondaryButton title="Все записи" compact onPress={() => setFilter('all')} />
      </View>
      {notes.map((note) => {
        const noteShift = snapshot.shifts.find((shift) => shift.id === note.shift_id);
        return (
          <Card key={note.id}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{note.title}</Text>
                <Text style={styles.mutedText}>
                  {noteShift ? `${shortDate(noteShift.date)} · ${noteShift.zone}` : 'Без смены'} · {shortDateTime(note.updated_at)}
                </Text>
              </View>
              <SecondaryButton title="Удалить" compact danger onPress={() => onMutate('DELETE', `/notebook/${note.id}`)} />
            </View>
            <Text style={styles.bodyText}>{note.body}</Text>
          </Card>
        );
      })}
      {notes.length === 0 ? <EmptyState title="Записей пока нет" text="Добавьте заметку по гостю, столу или договоренности. Она попадет в итоги смены." /> : null}
      <ModalSheet visible={showForm} title="Новая запись смены" onClose={() => setShowForm(false)}>
        <Field label="Заголовок" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} placeholder="Стол 6, постоянный гость..." />
        <Field label="Заметка" value={form.body} onChangeText={(value) => setForm({ ...form, body: value })} multiline />
        <PrimaryButton
          title="Сохранить за смену"
          onPress={async () => {
            await onMutate('POST', '/notebook', { ...form, shift_id: currentShift?.id ?? null });
            setShowForm(false);
            setForm({ title: '', body: '' });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function LegacyNotebookScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });

  return (
    <ScreenScroll>
      <View style={styles.actionGrid}>
        <SecondaryButton title="Запись" compact onPress={() => setShowForm(true)} />
      </View>
      {snapshot.notebook_notes.map((note) => (
        <Card key={note.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{note.title}</Text>
              <Text style={styles.mutedText}>{shortDateTime(note.updated_at)}</Text>
            </View>
            <SecondaryButton title="Удалить" compact danger onPress={() => onMutate('DELETE', `/notebook/${note.id}`)} />
          </View>
          <Text style={styles.bodyText}>{note.body}</Text>
        </Card>
      ))}
      {snapshot.notebook_notes.length === 0 ? <EmptyState title="Записей пока нет" text="Добавьте первую заметку по гостю или столу." /> : null}
      <ModalSheet visible={showForm} title="Новая запись" onClose={() => setShowForm(false)}>
        <Field label="Заголовок" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} placeholder="Стол 6, постоянный гость..." />
        <Field label="Заметка" value={form.body} onChangeText={(value) => setForm({ ...form, body: value })} multiline />
        <PrimaryButton
          title="Сохранить"
          onPress={async () => {
            await onMutate('POST', '/notebook', form);
            setShowForm(false);
            setForm({ title: '', body: '' });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function ReservationsScreen({ snapshot, onMutate }: SectionProps) {
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    guest_name: '',
    guest_phone: '',
    date: todayISO(),
    time: '19:00',
    guests_count: '2',
    table_id: snapshot.tables[0]?.id ?? '',
    occasion: 'regular',
    comment: '',
  });
  const manageable = canManage(snapshot.permissions, 'manage:reservations');
  const filtered = snapshot.reservations.filter((reservation) => {
    const needle = `${reservation.guest_name} ${reservation.guest_phone} ${reservation.comment ?? ''}`.toLowerCase();
    return needle.includes(query.toLowerCase());
  });
  const activeReservations = filtered.filter((reservation) => !['guests_arrived', 'seated', 'guests_left', 'cancelled', 'no_show'].includes(reservation.status));
  const archivedReservations = filtered.filter((reservation) => !activeReservations.includes(reservation));
  const reservationReminders = activeReservations
    .filter(reservationNeedsReminder)
    .sort((a, b) => String(`${a.date} ${a.time}`).localeCompare(String(`${b.date} ${b.time}`)))
    .slice(0, 5);

  return (
    <ScreenScroll>
      {manageable ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Новая" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      <Field label="Поиск брони" value={query} onChangeText={setQuery} placeholder="Имя, телефон или комментарий" />
      {reservationReminders.length ? (
        <Card tone="soft">
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Напоминания по броням</Text>
              <Text style={styles.mutedText}>Ближайшие гости, которых нужно встретить или подтвердить.</Text>
            </View>
            <Pill label={`${reservationReminders.length}`} tone="warn" />
          </View>
          {reservationReminders.map((reservation) => (
            <View key={`reminder-${reservation.id}`} style={styles.reminderRow}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{reservation.guest_name}</Text>
                <Text style={styles.mutedText}>
                  {shortDate(reservation.date)} · {reservation.time} · {tableName(snapshot, reservation.table_id)}
                </Text>
                <Text style={styles.bodyText}>{reservation.call_status === 'confirmed' ? 'Звонок подтверждён' : 'Нужно подтвердить или встретить гостей'}</Text>
              </View>
              <View style={styles.reminderActions}>
                <Pill label={reservationReminderLabel(reservation)} tone="warn" />
                {manageable ? (
                  <View style={styles.actionGrid}>
                    <SecondaryButton title="Подтв." compact onPress={() => onMutate('PATCH', `/reservations/${reservation.id}`, { call_status: 'confirmed' })} />
                    <SecondaryButton title="Не ответ" compact onPress={() => onMutate('PATCH', `/reservations/${reservation.id}`, { call_status: 'not_answered' })} />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {activeReservations.map((reservation) => (
        <Card key={reservation.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{reservation.guest_name}</Text>
              <Text style={styles.mutedText}>
                {shortDate(reservation.date)} · {reservation.time} · {reservation.guests_count} гостей
              </Text>
              <Text style={styles.bodyText}>{tableName(snapshot, reservation.table_id)}</Text>
              {reservation.comment ? <Text style={styles.bodyText}>{reservation.comment}</Text> : null}
            </View>
            <Pill label={reservationLabels[reservation.status]} tone={roleTone(reservation.status)} />
          </View>
          {manageable ? (
            <View style={styles.actionGrid}>
              <SecondaryButton title="Ожидаем" compact onPress={() => onMutate('POST', `/reservations/${reservation.id}/status`, { status: 'waiting' })} />
              <SecondaryButton title="Пришли" compact onPress={() => onMutate('POST', `/reservations/${reservation.id}/status`, { status: 'guests_arrived' })} />
              <SecondaryButton title="Отмена" compact danger onPress={() => onMutate('POST', `/reservations/${reservation.id}/status`, { status: 'cancelled' })} />
            </View>
          ) : null}
        </Card>
      ))}
      {archivedReservations.length ? <Text style={styles.formLabel}>Архив и посадки</Text> : null}
      {archivedReservations.map((reservation) => (
        <Card key={reservation.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{reservation.guest_name}</Text>
              <Text style={styles.mutedText}>
                {shortDate(reservation.date)} · {reservation.time} · {reservation.guests_count} гостей
              </Text>
              <Text style={styles.bodyText}>{tableName(snapshot, reservation.table_id)}</Text>
              {reservation.comment ? <Text style={styles.bodyText}>{reservation.comment}</Text> : null}
            </View>
            <Pill label={reservationLabels[reservation.status]} tone={roleTone(reservation.status)} />
          </View>
          {manageable && ['guests_arrived', 'seated'].includes(reservation.status) ? (
            <View style={styles.actionGrid}>
              <SecondaryButton title="Гости ушли" compact onPress={() => onMutate('POST', `/reservations/${reservation.id}/status`, { status: 'guests_left' })} />
            </View>
          ) : null}
        </Card>
      ))}
      {filtered.length === 0 ? <EmptyState title="Брони не найдены" text="Попробуйте другой запрос или дату." /> : null}

      <ModalSheet visible={showForm} title="Новая бронь" onClose={() => setShowForm(false)}>
        <Field label="Имя гостя" value={form.guest_name} onChangeText={(value) => setForm({ ...form, guest_name: value })} />
        <Field label="Телефон" value={form.guest_phone} onChangeText={(value) => setForm({ ...form, guest_phone: value })} keyboardType="phone-pad" />
        <View style={styles.twoColumns}>
          <Field label="Дата" value={form.date} onChangeText={(value) => setForm({ ...form, date: value })} />
          <Field label="Время" value={form.time} onChangeText={(value) => setForm({ ...form, time: value })} />
        </View>
        <Field label="Количество гостей" value={form.guests_count} onChangeText={(value) => setForm({ ...form, guests_count: value })} keyboardType="number-pad" />
        <Text style={styles.formLabel}>Столик</Text>
        <View style={styles.actionGrid}>
          {snapshot.tables.slice(0, 12).map((table) => (
            <SecondaryButton key={table.id} title={`Стол ${table.number}`} compact onPress={() => setForm({ ...form, table_id: table.id })} />
          ))}
        </View>
        <Field label="Повод" value={form.occasion} onChangeText={(value) => setForm({ ...form, occasion: value })} />
        <Field label="Комментарий" value={form.comment} onChangeText={(value) => setForm({ ...form, comment: value })} multiline />
        <PrimaryButton
          title="Создать бронь"
          onPress={async () => {
            await onMutate('POST', '/reservations', { ...form, guests_count: Number(form.guests_count), status: 'confirmed' });
            setShowForm(false);
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function MenuScreen({ snapshot, onMutate }: SectionProps) {
  const [category, setCategory] = useState<string>(snapshot.current_user.role === 'bar' ? 'bar' : 'all');
  const [query, setQuery] = useState('');
  const canStop = canManage(snapshot.permissions, 'manage:stoplist');
  const isBarRole = snapshot.current_user.role === 'bar';
  const hasBarItems = snapshot.menu_items.some((item) => isBarMenuItem(snapshot, item));
  const visibleCategories = isBarRole
    ? snapshot.menu_categories.filter((categoryItem) => snapshot.menu_items.some((item) => item.category_id === categoryItem.id && isBarMenuItem(snapshot, item)))
    : snapshot.menu_categories;
  const items = snapshot.menu_items.filter((item) => {
    const barAllowed = !isBarRole || isBarMenuItem(snapshot, item);
    const byCategory = category === 'all' || (category === 'bar' ? isBarMenuItem(snapshot, item) : item.category_id === category);
    const needle = `${item.name} ${item.composition} ${item.description ?? ''} ${categoryName(snapshot, item.category_id)}`.toLowerCase();
    return barAllowed && byCategory && needle.includes(query.toLowerCase());
  });

  return (
    <ScreenScroll>
      <Field label="Поиск" value={query} onChangeText={setQuery} placeholder="Блюдо, напиток, состав или подсказка" />
      <View style={styles.categoryRow}>
        {hasBarItems ? <SecondaryButton title={isBarRole ? 'Все барное' : 'Бар'} compact onPress={() => setCategory('bar')} /> : null}
        {!isBarRole ? <SecondaryButton title="Все меню" compact onPress={() => setCategory('all')} /> : null}
        {visibleCategories.map((item) => (
          <SecondaryButton key={item.id} title={item.name} compact onPress={() => setCategory(item.id)} />
        ))}
      </View>
      {items.map((item) => (
        <Card key={item.id}>
          {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.menuImage} /> : null}
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.mutedText}>{categoryName(snapshot, item.category_id)} · {item.weight} · {item.cooking_time}</Text>
            </View>
            <Pill label={`${item.price} ₽`} tone="dark" />
          </View>
          <Text style={styles.bodyText}>{item.description}</Text>
          <InfoBlock label="Состав" text={item.composition} />
          <InfoBlock label="Подсказка официанту" text={item.waiter_hint ?? 'Подсказка будет добавлена позже.'} />
          <InfoBlock label="С чем предлагать" text={item.recommendation ?? 'Пока не указано.'} />
          <View style={styles.actionGrid}>
            <Pill label={item.status === 'available' ? 'Доступно' : item.status === 'soon_out' ? 'Скоро закончится' : 'В стоп-листе'} tone={roleTone(item.status)} />
            <Pill label={`Острота ${item.spice_level}/5`} tone="warn" />
            <Pill label={`Популярность ${item.popularity}`} tone="info" />
          </View>
          {canStop && item.status !== 'stop' ? (
            <SecondaryButton
              title="В стоп-лист"
              compact
              onPress={() => onMutate('POST', '/stop-list', { menu_item_id: item.id, reason: 'Добавлено из меню', status: 'out' })}
            />
          ) : null}
        </Card>
      ))}
      {items.length === 0 ? <EmptyState title="Ничего не найдено" text="Поменяйте фильтр или поисковый запрос." /> : null}
    </ScreenScroll>
  );
}

export function LegacyMenuScreen({ snapshot, onMutate }: SectionProps) {
  const [category, setCategory] = useState<string>(snapshot.current_user.role === 'bar' ? 'bar' : 'all');
  const [query, setQuery] = useState('');
  const canEdit = canManage(snapshot.permissions, 'manage:menu');
  const canStop = canManage(snapshot.permissions, 'manage:stoplist');
  const items = snapshot.menu_items.filter((item) => {
    const byCategory = category === 'all' || (category === 'bar' ? isBarCategory(item.category_id) : item.category_id === category);
    const needle = `${item.name} ${item.composition} ${item.description ?? ''}`.toLowerCase();
    return byCategory && needle.includes(query.toLowerCase());
  });
  const hasBarCategories = snapshot.menu_categories.some((item) => isBarCategory(item.id));

  return (
    <ScreenScroll>
      <Field label="Поиск блюда" value={query} onChangeText={setQuery} placeholder="Название, состав, подсказка" />
      <View style={styles.categoryRow}>
        <SecondaryButton title="Все" compact onPress={() => setCategory('all')} />
        {snapshot.menu_categories.map((item) => (
          <SecondaryButton key={item.id} title={item.name} compact onPress={() => setCategory(item.id)} />
        ))}
      </View>
      {items.map((item) => (
        <Card key={item.id}>
          {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.menuImage} /> : null}
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.mutedText}>{categoryName(snapshot, item.category_id)} · {item.weight} · {item.cooking_time}</Text>
            </View>
            <Pill label={`${item.price} ₽`} tone="dark" />
          </View>
          <Text style={styles.bodyText}>{item.description}</Text>
          <InfoBlock label="Состав" text={item.composition} />
          <InfoBlock label="Подсказка официанту" text={item.waiter_hint ?? 'Подсказка будет добавлена позже.'} />
          <InfoBlock label="Рекомендовать с" text={item.recommendation ?? 'Пока не указано.'} />
          <View style={styles.actionGrid}>
            <Pill label={item.status === 'available' ? 'Доступно' : item.status === 'soon_out' ? 'Скоро закончится' : 'В стоп-листе'} tone={roleTone(item.status)} />
            <Pill label={`Острота ${item.spice_level}/5`} tone="warn" />
            <Pill label={`Популярность ${item.popularity}`} tone="info" />
          </View>
          {(canStop || canEdit) && item.status !== 'stop' ? (
            <SecondaryButton
              title="Добавить в стоп-лист"
              compact
              onPress={() => onMutate('POST', '/stop-list', { menu_item_id: item.id, reason: 'Добавлено из карточки меню', status: 'out' })}
            />
          ) : null}
        </Card>
      ))}
    </ScreenScroll>
  );
}

export function StopListScreen({ snapshot, onMutate, onRefresh }: SectionProps) {
  const [category, setCategory] = useState(snapshot.current_user.role === 'bar' ? 'bar' : 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(snapshot.menu_items[0]?.id ?? '');
  const [itemQuery, setItemQuery] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'out' | 'soon_out' | 'temporary' | 'back_later'>('out');
  const manageable = canManage(snapshot.permissions, 'manage:stoplist');
  const activeStopList = snapshot.stop_list.filter((item) => item.status !== 'available');
  const filtered = activeStopList.filter((item) => {
    const dish = menuItem(snapshot, item.menu_item_id);
    return category === 'all' || (category === 'bar' ? isBarMenuItem(snapshot, dish) : dish?.category_id === category);
  });
  const menuChoices = snapshot.menu_items.filter((item) => {
    const byCategory = category === 'all' || (category === 'bar' ? isBarMenuItem(snapshot, item) : item.category_id === category);
    const needle = `${item.name} ${categoryName(snapshot, item.category_id)} ${item.composition}`.toLowerCase();
    return byCategory && needle.includes(itemQuery.toLowerCase());
  });
  const selectedDish = menuItem(snapshot, selectedItem) ?? menuChoices[0];

  return (
    <ScreenScroll>
      <MenuRestoredBanner snapshot={snapshot} onMutate={onMutate} onDismiss={onRefresh} />
      <View style={styles.stopToolbar}>
        {manageable ? <SecondaryButton title="Добавить" compact onPress={() => setShowForm(true)} /> : null}
        <SecondaryButton title="Фильтры" compact onPress={() => setShowFilters(true)} />
        <Pill
          label={category === 'all' ? 'Все категории' : category === 'bar' ? 'Бар' : categoryName(snapshot, category)}
          tone={category === 'bar' ? 'info' : 'warn'}
        />
        <Pill label={`${filtered.length} активных`} tone={filtered.length > 0 ? 'bad' : 'good'} />
      </View>
      {filtered.map((item) => {
        const dish = menuItem(snapshot, item.menu_item_id);
        return (
          <Card key={item.id}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{dish?.name ?? 'Позиция меню'}</Text>
                <Text style={styles.mutedText}>{dish ? categoryName(snapshot, dish.category_id) : 'Категория не найдена'}</Text>
              </View>
              <Pill label={stopLabels[item.status]} tone={roleTone(item.status)} />
            </View>
            <Text style={styles.bodyText}>{item.reason}</Text>
            <Text style={styles.mutedText}>Добавил: {userName(snapshot, item.added_by)} · {shortDateTime(item.created_at)}</Text>
            {item.expected_return_at ? <Text style={styles.mutedText}>Ожидаем возврат: {shortDateTime(item.expected_return_at)}</Text> : null}
            {item.comment ? <Text style={styles.bodyText}>{item.comment}</Text> : null}
            {manageable ? (
              <View style={styles.actionGrid}>
                <SecondaryButton title="Скоро закончится" compact onPress={() => onMutate('PATCH', `/stop-list/${item.id}`, { status: 'soon_out' })} />
                <SecondaryButton title="Снова доступно" compact onPress={() => onMutate('PATCH', `/stop-list/${item.id}`, { status: 'available' })} />
              </View>
            ) : null}
          </Card>
        );
      })}
      {filtered.length === 0 ? <EmptyState title="Стоп-лист пуст" text="Для выбранного фильтра ограничений нет." /> : null}

      <ModalSheet visible={showFilters} title="Фильтры стоп-листа" onClose={() => setShowFilters(false)}>
        <View style={styles.actionGrid}>
          <SecondaryButton title="Все" compact onPress={() => setCategory('all')} />
          <SecondaryButton title="Бар" compact onPress={() => setCategory('bar')} />
          {snapshot.menu_categories.map((item) => (
            <SecondaryButton key={item.id} title={item.name} compact onPress={() => setCategory(item.id)} />
          ))}
        </View>
        <PrimaryButton title="Готово" onPress={() => setShowFilters(false)} />
      </ModalSheet>

      <ModalSheet visible={showForm} title="Добавить в стоп-лист" onClose={() => setShowForm(false)}>
        <Field label="Поиск позиции" value={itemQuery} onChangeText={setItemQuery} placeholder="Название блюда или напитка" />
        <View style={styles.actionGrid}>
          {menuChoices.slice(0, 18).map((item) => (
            <SecondaryButton key={item.id} title={item.name} compact onPress={() => setSelectedItem(item.id)} />
          ))}
        </View>
        {selectedDish ? <Pill label={`Выбрано: ${selectedDish.name}`} tone="info" /> : null}
        <View style={styles.actionGrid}>
          <SecondaryButton title="Нет" compact onPress={() => setStatus('out')} />
          <SecondaryButton title="Скоро кончится" compact onPress={() => setStatus('soon_out')} />
          <SecondaryButton title="Временно" compact onPress={() => setStatus('temporary')} />
          <SecondaryButton title="Позже вернется" compact onPress={() => setStatus('back_later')} />
        </View>
        <Field label="Причина" value={reason} onChangeText={setReason} placeholder="Например: закончился сулугуни" multiline />
        <PrimaryButton
          title="Поставить в стоп"
          disabled={!selectedDish}
          onPress={async () => {
            if (!selectedDish) return;
            await onMutate('POST', '/stop-list', { menu_item_id: selectedDish.id, reason: reason.trim() || 'Уточнить у ответственного', status });
            setShowForm(false);
            setReason('');
            setItemQuery('');
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function LegacyStopListScreen({ snapshot, onMutate }: SectionProps) {
  const [category, setCategory] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(snapshot.menu_items[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const manageable = canManage(snapshot.permissions, 'manage:stoplist');
  const activeStopList = snapshot.stop_list.filter((item) => item.status !== 'available');
  const filtered = activeStopList.filter((item) => {
    const dish = menuItem(snapshot, item.menu_item_id);
    return category === 'all' || dish?.category_id === category;
  });

  return (
    <ScreenScroll>
      <View style={styles.categoryRow}>
        {manageable ? <SecondaryButton title="Добавить" compact onPress={() => setShowForm(true)} /> : null}
        <SecondaryButton title="Все" compact onPress={() => setCategory('all')} />
        {snapshot.menu_categories.map((item) => (
          <SecondaryButton key={item.id} title={item.name} compact onPress={() => setCategory(item.id)} />
        ))}
      </View>
      {filtered.map((item) => {
        const dish = menuItem(snapshot, item.menu_item_id);
        return (
          <Card key={item.id}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{dish?.name ?? 'Позиция меню'}</Text>
                <Text style={styles.mutedText}>{dish ? categoryName(snapshot, dish.category_id) : 'Категория не найдена'}</Text>
              </View>
              <Pill label={stopLabels[item.status]} tone={roleTone(item.status)} />
            </View>
            <Text style={styles.bodyText}>{item.reason}</Text>
            <Text style={styles.mutedText}>Добавил: {userName(snapshot, item.added_by)} · {shortDateTime(item.created_at)}</Text>
            {item.expected_return_at ? <Text style={styles.mutedText}>Ожидаем возврат: {shortDateTime(item.expected_return_at)}</Text> : null}
            {item.comment ? <Text style={styles.bodyText}>{item.comment}</Text> : null}
            {manageable ? (
              <View style={styles.actionGrid}>
                <SecondaryButton title="Скоро закончится" compact onPress={() => onMutate('PATCH', `/stop-list/${item.id}`, { status: 'soon_out' })} />
                <SecondaryButton title="Снова доступно" compact onPress={() => onMutate('PATCH', `/stop-list/${item.id}`, { status: 'available' })} />
              </View>
            ) : null}
          </Card>
        );
      })}
      {filtered.length === 0 ? <EmptyState title="Стоп-лист пуст" text="Для выбранной категории ограничений нет." /> : null}

      <ModalSheet visible={showForm} title="Добавить в стоп-лист" onClose={() => setShowForm(false)}>
        <Text style={styles.formLabel}>Позиция</Text>
        <View style={styles.actionGrid}>
          {snapshot.menu_items.slice(0, 12).map((item) => (
            <SecondaryButton key={item.id} title={item.name} compact onPress={() => setSelectedItem(item.id)} />
          ))}
        </View>
        <Field label="Причина" value={reason} onChangeText={setReason} multiline />
        <PrimaryButton
          title="Добавить"
          onPress={async () => {
            await onMutate('POST', '/stop-list', { menu_item_id: selectedItem, reason, status: 'out' });
            setShowForm(false);
            setReason('');
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function ScheduleScreen({ snapshot }: SectionProps) {
  const [filter, setFilter] = useState('today');
  const today = todayISO();
  const shifts = snapshot.shifts.filter((shift) => {
    if (filter === 'mine') return shift.user_id === snapshot.current_user.id;
    if (filter === 'today') return shift.date?.slice(0, 10) === today;
    return true;
  });

  return (
    <ScreenScroll>
      <View style={styles.actionGrid}>
        <SecondaryButton title="Сегодня" compact onPress={() => setFilter('today')} />
        <SecondaryButton title="Мои смены" compact onPress={() => setFilter('mine')} />
        <SecondaryButton title="Неделя" compact onPress={() => setFilter('week')} />
      </View>
      {shifts.map((shift) => (
        <Card key={shift.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{userName(snapshot, shift.user_id)}</Text>
              <Text style={styles.mutedText}>{shortDate(shift.date)} · {shift.start_time?.slice(0, 5)}-{shift.end_time?.slice(0, 5)}</Text>
              <Text style={styles.bodyText}>{shift.position} · {shift.zone}</Text>
              {shift.comment ? <Text style={styles.bodyText}>{shift.comment}</Text> : null}
            </View>
            <Pill label={shiftLabels[shift.status]} tone={roleTone(shift.status)} />
          </View>
        </Card>
      ))}
    </ScreenScroll>
  );
}

export function StaffScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', login: '', phone: '', password: '', role: 'waiter', position: 'Официант' });
  const [passwordReset, setPasswordReset] = useState<{ user: User | null; password: string; error: string | null }>({ user: null, password: '', error: null });
  const canEdit = canManage(snapshot.permissions, 'manage:staff');
  const users = [...snapshot.users].sort((a, b) => {
    if (a.role === 'pending' && b.role !== 'pending') return -1;
    if (a.role !== 'pending' && b.role === 'pending') return 1;
    if (a.status === 'on_shift' && b.status !== 'on_shift') return -1;
    if (a.status !== 'on_shift' && b.status === 'on_shift') return 1;
    return a.name.localeCompare(b.name);
  });
  const visibleUsers = snapshot.current_user.role === 'owner' ? users.filter((user) => user.id !== snapshot.current_user.id) : users;

  return (
    <ScreenScroll>
      {canEdit ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Добавить" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      {visibleUsers.map((user) => (
        <Card key={user.id}>
          <View style={styles.personRow}>
            <Avatar uri={user.photo_url} name={user.name} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.name}</Text>
              <Text style={styles.mutedText}>{user.position} · {labelForRole(user.role)}</Text>
              <Text style={styles.bodyText}>{user.phone}</Text>
              {user.comment ? <Text style={styles.bodyText}>{user.comment}</Text> : null}
            </View>
            <Pill label={user.role === 'pending' ? 'Ждет роль' : userStatusLabels[user.status] ?? user.status} tone={user.role === 'pending' ? 'warn' : roleTone(user.status)} />
          </View>
          {canEdit ? (
            <View style={styles.roleAssignBox}>
              {user.role === 'pending' ? (
                <>
                  <Text style={styles.roleAssignTitle}>Назначить роль</Text>
                  <View style={styles.actionGrid}>
                    {assignableRoles.map((option) => (
                      <SecondaryButton
                        key={option.role}
                        title={option.label}
                        compact
                        onPress={() => onMutate('PATCH', `/users/${user.id}`, { role: option.role, position: option.position, comment: '' })}
                      />
                    ))}
                  </View>
                </>
              ) : null}
              <Text style={styles.roleAssignTitle}>Статус смены</Text>
              <View style={styles.actionGrid}>
                {staffStatusActions.map((option) => (
                  <SecondaryButton
                    key={option.status}
                    title={option.label}
                    compact
                    onPress={() => onMutate('PATCH', `/users/${user.id}`, { status: option.status })}
                  />
                ))}
              </View>
              <View style={styles.actionGrid}>
                <SecondaryButton
                  title="Сменить пароль"
                  compact
                  onPress={() => setPasswordReset({ user, password: '', error: null })}
                />
              </View>
            </View>
          ) : null}
        </Card>
      ))}
      <ModalSheet visible={showForm} title="Новый сотрудник" onClose={() => setShowForm(false)}>
        <Field label="Имя и фамилия" value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} />
        <Field label="Логин" value={form.login} onChangeText={(value) => setForm({ ...form, login: value })} autoCapitalize="none" />
        <Field
          label="Временный пароль"
          value={form.password}
          onChangeText={(value) => setForm({ ...form, password: value })}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Field label="Телефон" value={form.phone} onChangeText={(value) => setForm({ ...form, phone: value })} />
        <Text style={styles.formLabel}>Роль</Text>
        <View style={styles.actionGrid}>
          {assignableRoles.map((option) => (
            <SecondaryButton key={option.role} title={option.label} compact onPress={() => setForm({ ...form, role: option.role, position: option.position })} />
          ))}
        </View>
        <Field label="Должность" value={form.position} onChangeText={(value) => setForm({ ...form, position: value })} />
        <PrimaryButton
          title="Добавить сотрудника"
          onPress={async () => {
            await onMutate('POST', '/users', { ...form, status: 'off_shift' });
            setShowForm(false);
            setForm({ name: '', login: '', phone: '', password: '', role: 'waiter', position: 'Официант' });
          }}
        />
      </ModalSheet>
      <ModalSheet
        visible={Boolean(passwordReset.user)}
        title={passwordReset.user ? `Пароль: ${passwordReset.user.name}` : 'Смена пароля'}
        onClose={() => setPasswordReset({ user: null, password: '', error: null })}
      >
        <Field
          label="Новый пароль"
          value={passwordReset.password}
          onChangeText={(value) => setPasswordReset((current) => ({ ...current, password: value, error: null }))}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {passwordReset.error ? <Text style={styles.mutedText}>{passwordReset.error}</Text> : null}
        <PrimaryButton
          title="Сохранить пароль"
          onPress={async () => {
            if (!passwordReset.user) return;
            const password = passwordReset.password.trim();
            if (password.length < 8) {
              setPasswordReset((current) => ({ ...current, error: 'Пароль должен быть не короче 8 символов.' }));
              return;
            }
            await onMutate('PATCH', `/users/${passwordReset.user.id}/password`, { password });
            setPasswordReset({ user: null, password: '', error: null });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function LegacyStaffScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', login: '', phone: '', password: '', role: 'waiter', position: 'Официант' });
  const canEdit = canManage(snapshot.permissions, 'manage:staff');
  const users = [...snapshot.users].sort((a, b) => {
    if (a.role === 'pending' && b.role !== 'pending') return -1;
    if (a.role !== 'pending' && b.role === 'pending') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ScreenScroll>
      {canEdit ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Добавить" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      {users.map((user) => (
        <Card key={user.id}>
          <View style={styles.personRow}>
            <Avatar uri={user.photo_url} name={user.name} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.name}</Text>
              <Text style={styles.mutedText}>{user.position} · {labelForRole(user.role)}</Text>
              <Text style={styles.bodyText}>{user.phone}</Text>
              {user.comment ? <Text style={styles.bodyText}>{user.comment}</Text> : null}
            </View>
            <Pill label={user.role === 'pending' ? 'Ждет роль' : user.status === 'on_shift' ? 'На смене' : user.status === 'vacation' ? 'Отпуск' : user.status === 'sick' ? 'Больничный' : 'Выходной'} tone={user.role === 'pending' ? 'warn' : roleTone(user.status)} />
          </View>
          {canEdit && user.role === 'pending' ? (
            <View style={styles.roleAssignBox}>
              <Text style={styles.roleAssignTitle}>Назначить роль</Text>
              <View style={styles.actionGrid}>
                {assignableRoles.map((option) => (
                  <SecondaryButton
                    key={option.role}
                    title={option.label}
                    compact
                    onPress={() => onMutate('PATCH', `/users/${user.id}`, { role: option.role, position: option.position, comment: '' })}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ))}
      <ModalSheet visible={showForm} title="Новый сотрудник" onClose={() => setShowForm(false)}>
        <Field label="Имя и фамилия" value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} />
        <Field label="Логин" value={form.login} onChangeText={(value) => setForm({ ...form, login: value })} autoCapitalize="none" />
        <Field
          label="Временный пароль"
          value={form.password}
          onChangeText={(value) => setForm({ ...form, password: value })}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Field label="Телефон" value={form.phone} onChangeText={(value) => setForm({ ...form, phone: value })} />
        <Field label="Роль" value={form.role} onChangeText={(value) => setForm({ ...form, role: value })} />
        <Field label="Должность" value={form.position} onChangeText={(value) => setForm({ ...form, position: value })} />
        <PrimaryButton
          title="Добавить сотрудника"
          onPress={async () => {
            await onMutate('POST', '/users', { ...form, status: 'off_shift' });
            setShowForm(false);
            setForm({ name: '', login: '', phone: '', password: '', role: 'waiter', position: 'Официант' });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function EventsScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<string[]>([]);
  const [form, setForm] = useState({
    title: '',
    type: 'banquet',
    date: todayISO(),
    time: '19:00',
    guests_count: '10',
    customer_name: '',
    customer_phone: '',
    comment: '',
    kitchen_comment: '',
    waiter_comment: '',
    alcohol_required: '0',
    alcohol_available: '0',
    alcohol_actual: '0',
    alcohol_comment: '',
  });
  const manageable = canManage(snapshot.permissions, 'manage:events');
  const upcoming = [...snapshot.events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const nextDates = Array.from(new Set(upcoming.map((event) => event.date?.slice(0, 10)))).slice(0, 5);

  function toggleTable(id: string) {
    setSelectedTables((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleMenu(id: string) {
    setSelectedMenu((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <ScreenScroll>
      {manageable ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Создать" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>Календарь</Text>
        {nextDates.map((date) => {
          const count = upcoming.filter((event) => event.date?.slice(0, 10) === date).length;
          return <MiniRow key={date} title={shortDate(date)} text={`${count} событий · ближайшие банкеты и крупные посадки`} pill={count > 1 ? 'Плотно' : 'Спокойно'} />;
        })}
      </Card>
      {upcoming.map((event) => (
        <EventCard key={event.id} event={event} snapshot={snapshot} onMutate={onMutate} />
      ))}
      <ModalSheet visible={showForm} title="Новое событие" onClose={() => setShowForm(false)}>
        <Field label="Название" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} placeholder="Банкет, свадьба, юбилей" />
        <View style={styles.twoColumns}>
          <View style={styles.flex}>
            <Field label="Дата" value={form.date} onChangeText={(value) => setForm({ ...form, date: value })} />
          </View>
          <View style={styles.flex}>
            <Field label="Время" value={form.time} onChangeText={(value) => setForm({ ...form, time: value })} />
          </View>
        </View>
        <Field label="Гостей" value={form.guests_count} onChangeText={(value) => setForm({ ...form, guests_count: value })} keyboardType="numeric" />
        <Field label="Заказчик" value={form.customer_name} onChangeText={(value) => setForm({ ...form, customer_name: value })} />
        <Field label="Телефон" value={form.customer_phone} onChangeText={(value) => setForm({ ...form, customer_phone: value })} keyboardType="phone-pad" />
        <Text style={styles.formLabel}>Столы под событие</Text>
        <View style={styles.actionGrid}>
          {snapshot.tables.map((table) => (
            <SecondaryButton key={table.id} title={`Стол ${table.number}`} compact onPress={() => toggleTable(table.id)} />
          ))}
        </View>
        {selectedTables.length ? <Pill label={`Выбрано столов: ${selectedTables.length}`} tone="info" /> : null}
        <Text style={styles.formLabel}>Банкетное меню</Text>
        <View style={styles.actionGrid}>
          {snapshot.menu_items.filter((item) => item.category_id === 'cat-19' || selectedMenu.includes(item.id)).slice(0, 12).map((item) => (
            <SecondaryButton key={item.id} title={item.name} compact onPress={() => toggleMenu(item.id)} />
          ))}
        </View>
        <Field label="Общий комментарий" value={form.comment} onChangeText={(value) => setForm({ ...form, comment: value })} multiline />
        <Field label="Кухня" value={form.kitchen_comment} onChangeText={(value) => setForm({ ...form, kitchen_comment: value })} multiline />
        <Field label="Официанты" value={form.waiter_comment} onChangeText={(value) => setForm({ ...form, waiter_comment: value })} multiline />
        <View style={styles.twoColumns}>
          <Field label="Алкоголя нужно" value={form.alcohol_required} onChangeText={(value) => setForm({ ...form, alcohol_required: value })} keyboardType="numeric" />
          <Field label="Уже есть" value={form.alcohol_available} onChangeText={(value) => setForm({ ...form, alcohol_available: value })} keyboardType="numeric" />
        </View>
        <Field label="Факт бара" value={form.alcohol_actual} onChangeText={(value) => setForm({ ...form, alcohol_actual: value })} keyboardType="numeric" />
        <Field label="Комментарий бара" value={form.alcohol_comment} onChangeText={(value) => setForm({ ...form, alcohol_comment: value })} multiline />
        <PrimaryButton
          title="Создать событие"
          onPress={async () => {
            await onMutate('POST', '/events', {
              ...form,
              guests_count: Number(form.guests_count || 1),
              table_ids: selectedTables,
              banquet_menu: selectedMenu,
              alcohol_required: Number(form.alcohol_required || 0),
              alcohol_available: Number(form.alcohol_available || 0),
              alcohol_actual: Number(form.alcohol_actual || 0),
              alcohol_comment: form.alcohol_comment,
              floor_id: snapshot.tables.find((table) => selectedTables.includes(table.id))?.floor_id ?? snapshot.floors[0]?.id ?? null,
              status: 'preparation',
            });
            setShowForm(false);
            setSelectedTables([]);
            setSelectedMenu([]);
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function LegacyEventsScreen({ snapshot }: SectionProps) {
  return (
    <ScreenScroll>
      {snapshot.events.map((event) => (
        <EventCard key={event.id} event={event} snapshot={snapshot} />
      ))}
    </ScreenScroll>
  );
}

export function EventCard({ event, snapshot, onMutate }: { event: EventItem; snapshot: DataSnapshot; onMutate?: MutationFn }) {
  const [alcoholActual, setAlcoholActual] = useState(String(event.alcohol_actual ?? event.alcohol_available ?? 0));
  const [alcoholComment, setAlcoholComment] = useState(event.alcohol_comment ?? '');
  const reservedTables = event.table_ids
    .map((id) => snapshot.tables.find((table) => table.id === id)?.number)
    .filter(Boolean)
    .join(', ');
  const banquetMenu = event.banquet_menu
    .map((id) => menuItem(snapshot, id)?.name)
    .filter(Boolean)
    .join(', ');
  const requiredAlcohol = Number(event.alcohol_required ?? 0);
  const availableAlcohol = Number(event.alcohol_available ?? 0);
  const actualAlcohol = Number(event.alcohol_actual ?? availableAlcohol);
  const missingAlcohol = Math.max(requiredAlcohol - Math.max(actualAlcohol, availableAlcohol), 0);
  const canEditAlcohol = Boolean(onMutate) && ['bar', 'manager', 'administrator', 'technician'].includes(snapshot.current_user.role);
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text style={styles.mutedText}>{shortDate(event.date)} · {event.time} · {event.guests_count} гостей</Text>
        </View>
        <Pill label={event.status} tone={roleTone(event.status)} />
      </View>
      <InfoBlock label="Забраны столы" text={reservedTables ? `Столы ${reservedTables}` : 'Столы еще не выбраны'} />
      <InfoBlock label="Меню события" text={banquetMenu || 'Меню уточняется'} />
      <Text style={styles.bodyText}>Заказчик: {event.customer_name}, {event.customer_phone}</Text>
      <Text style={styles.bodyText}>Зона: {snapshot.floors.find((floor) => floor.id === event.floor_id)?.name ?? 'Не выбрана'}</Text>
      <InfoBlock label="Кухня" text={event.kitchen_comment ?? 'Комментариев нет'} />
      <InfoBlock label="Официанты" text={event.waiter_comment ?? 'Комментариев нет'} />
      <InfoBlock label="Ответственный" text={userName(snapshot, event.responsible_user_id)} />
      <View style={styles.metricsRow}>
        <MetricCard label="Алкоголь нужен" value={requiredAlcohol} />
        <MetricCard label="Уже есть" value={availableAlcohol} />
        <MetricCard label="Докупить" value={missingAlcohol} />
      </View>
      <InfoBlock label="Факт бара" text={`${actualAlcohol} · ${event.alcohol_comment || 'Комментария нет'}`} />
      {canEditAlcohol ? (
        <>
          <View style={styles.twoColumns}>
            <Field label="Факт алкоголя" value={alcoholActual} onChangeText={setAlcoholActual} keyboardType="numeric" />
            <Field label="Комментарий" value={alcoholComment} onChangeText={setAlcoholComment} />
          </View>
          <SecondaryButton
            title="Сохранить алкоголь"
            compact
            onPress={() =>
              onMutate?.('PATCH', `/events/${event.id}`, {
                alcohol_actual: Number(alcoholActual || 0),
                alcohol_comment: alcoholComment,
              })
            }
          />
        </>
      ) : null}
    </Card>
  );
}

export function AnnouncementsScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', text: '', target_role: 'all', importance: 'normal' });
  const manageable = canManage(snapshot.permissions, 'manage:announcements');

  return (
    <ScreenScroll>
      {manageable ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Опубликовать" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      {snapshot.announcements.map((announcement) => (
        <AnnouncementCard key={announcement.id} announcement={announcement} snapshot={snapshot} />
      ))}
      <ModalSheet visible={showForm} title="Новое объявление" onClose={() => setShowForm(false)}>
        <Field label="Заголовок" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} />
        <Field label="Текст" value={form.text} onChangeText={(value) => setForm({ ...form, text: value })} multiline />
        <Field label="Кому показывать" value={form.target_role} onChangeText={(value) => setForm({ ...form, target_role: value })} />
        <Field label="Важность" value={form.importance} onChangeText={(value) => setForm({ ...form, importance: value })} />
        <PrimaryButton
          title="Опубликовать"
          onPress={async () => {
            await onMutate('POST', '/announcements', form);
            setShowForm(false);
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function AnnouncementCard({ announcement, snapshot }: { announcement: Announcement; snapshot: DataSnapshot }) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{announcement.title}</Text>
        <Pill label={announcement.importance === 'urgent' ? 'Срочно' : announcement.importance === 'important' ? 'Важно' : 'Обычное'} tone={announcement.importance === 'urgent' ? 'bad' : announcement.importance === 'important' ? 'warn' : 'neutral'} />
      </View>
      <Text style={styles.bodyText}>{announcement.text}</Text>
      <Text style={styles.mutedText}>{userName(snapshot, announcement.author_id)} · {shortDateTime(announcement.created_at)} · {announcement.target_role}</Text>
    </Card>
  );
}

export function ChatScreen({ snapshot, onMutate }: SectionProps) {
  const [chatId, setChatId] = useState(snapshot.chats[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!snapshot.chats.length) return;
    if (!chatId || !snapshot.chats.some((chat) => chat.id === chatId)) {
      setChatId(snapshot.chats[0].id);
    }
  }, [chatId, snapshot.chats]);
  const selectedChat = snapshot.chats.find((chat) => chat.id === chatId) ?? snapshot.chats[0];
  const messages = snapshot.chat_messages
    .filter((message) => message.chat_id === selectedChat?.id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const lastByChat = new Map<string, ChatMessage>();
  snapshot.chat_messages.forEach((message) => {
    const previous = lastByChat.get(message.chat_id);
    if (!previous || String(previous.created_at) < String(message.created_at)) lastByChat.set(message.chat_id, message);
  });

  if (!selectedChat) {
    return (
      <ScreenScroll>
        <EmptyState title="Чаты не найдены" text="Попросите управляющего добавить вас в рабочий чат." />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={styles.chatList}>
        {snapshot.chats.map((chat) => {
          const last = lastByChat.get(chat.id);
          return (
            <Pressable
              key={chat.id}
              onPress={() => setChatId(chat.id)}
              style={({ pressed }) => [styles.chatListItem, chat.id === selectedChat.id ? styles.chatListItemActive : null, pressed ? styles.pressed : null]}
            >
              <View style={styles.chatAvatar}>
                <Text style={styles.chatAvatarText}>{chat.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.chatListTitle, chat.id === selectedChat.id ? styles.chatListTitleActive : null]} numberOfLines={1}>
                  {chat.name}
                </Text>
                <Text style={[styles.chatListPreview, chat.id === selectedChat.id ? styles.chatListPreviewActive : null]} numberOfLines={1}>
                  {last ? last.message_text : 'Сообщений пока нет'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.telegramPanel}>
        <View style={styles.telegramHeader}>
          <View>
            <Text style={styles.telegramTitle}>{selectedChat.name}</Text>
            <Text style={styles.telegramMeta}>{messages.length} сообщений · {selectedChat.type === 'shift' ? 'смена' : selectedChat.type === 'direct' ? 'личный чат' : 'группа'}</Text>
          </View>
          <Pill label={selectedChat.type === 'shift' ? 'Смена' : selectedChat.type === 'direct' ? 'Личный' : 'Группа'} tone="info" />
        </View>
        {messages
          .filter((message) => message.is_pinned)
          .map((message) => (
            <View key={`pinned-${message.id}`} style={styles.pinned}>
              <Text style={styles.pinnedText}>Закреплено: {message.message_text}</Text>
            </View>
          ))}
        <View style={styles.messageStack}>
          {messages.length === 0 ? <EmptyState title="Сообщений пока нет" text="Напишите первое сообщение в этот чат." /> : null}
          {messages.map((message) => (
            <View key={message.id} style={styles.messageWrap}>
              <MessageBubble message={message} snapshot={snapshot} mine={message.sender_id === snapshot.current_user.id} />
              {canManage(snapshot.permissions, 'chat:pin_shift') ? (
                <Pressable onPress={() => onMutate('PATCH', `/chat/messages/${message.id}/pin`, { is_pinned: !message.is_pinned })}>
                  <Text style={styles.pinAction}>{message.is_pinned ? 'Открепить' : 'Закрепить'}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.composer}>
          <Field label="Сообщение" value={draft} onChangeText={setDraft} placeholder="@Кухня, стол 12..." multiline />
          <PrimaryButton
            title="Отправить"
            onPress={async () => {
              if (!draft.trim()) return;
              await onMutate('POST', '/chat/messages', { chat_id: selectedChat.id, message_text: draft.trim() });
              setDraft('');
            }}
          />
        </View>
      </View>
    </ScreenScroll>
  );
}

export function LegacyChatScreen({ snapshot, onMutate }: SectionProps) {
  const [chatId, setChatId] = useState(snapshot.chats[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!snapshot.chats.length) return;
    if (!chatId || !snapshot.chats.some((chat) => chat.id === chatId)) {
      setChatId(snapshot.chats[0].id);
    }
  }, [chatId, snapshot.chats]);
  const selectedChat = snapshot.chats.find((chat) => chat.id === chatId) ?? snapshot.chats[0];
  const messages = snapshot.chat_messages
    .filter((message) => message.chat_id === selectedChat?.id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  if (!selectedChat) {
    return (
      <ScreenScroll>
        <EmptyState title="Чаты не найдены" text="Попросите управляющего добавить вас в рабочий чат." />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={styles.categoryRow}>
        {snapshot.chats.map((chat) => (
          <Pressable
            key={chat.id}
            onPress={() => setChatId(chat.id)}
            style={({ pressed }) => [styles.chatChip, chat.id === selectedChat.id ? styles.chatChipActive : null, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.chatChipText, chat.id === selectedChat.id ? styles.chatChipTextActive : null]} numberOfLines={1}>
              {chat.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>{selectedChat.name}</Text>
          <Pill label={selectedChat.type === 'shift' ? 'Смена' : selectedChat.type === 'direct' ? 'Личный' : 'Группа'} tone="info" />
        </View>
        {messages
          .filter((message) => message.is_pinned)
          .map((message) => (
            <View key={`pinned-${message.id}`} style={styles.pinned}>
              <Text style={styles.pinnedText}>Закреплено: {message.message_text}</Text>
            </View>
          ))}
        <View style={styles.messageStack}>
          {messages.length === 0 ? <EmptyState title="Сообщений пока нет" text="Напишите первое сообщение в этот чат." /> : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} snapshot={snapshot} mine={message.sender_id === snapshot.current_user.id} />
          ))}
        </View>
        <Field label="Сообщение" value={draft} onChangeText={setDraft} placeholder="@Кухня, стол 12..." multiline />
        <PrimaryButton
          title="Отправить"
          onPress={async () => {
            if (!draft.trim()) return;
            await onMutate('POST', '/chat/messages', { chat_id: selectedChat.id, message_text: draft.trim() });
            setDraft('');
          }}
        />
      </Card>
    </ScreenScroll>
  );
}

export function MessageBubble({ message, snapshot, mine }: { message: ChatMessage; snapshot: DataSnapshot; mine: boolean }) {
  const time = new Date(message.created_at);
  const timeText = Number.isNaN(time.getTime()) ? shortDateTime(message.created_at) : time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
      {!mine ? <Text style={styles.bubbleAuthor}>{userName(snapshot, message.sender_id)}</Text> : null}
      <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>{message.message_text}</Text>
      <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>{timeText}{message.is_pinned ? ' · закреплено' : ''}</Text>
    </View>
  );
}

export function LegacyMessageBubble({ message, snapshot, mine }: { message: ChatMessage; snapshot: DataSnapshot; mine: boolean }) {
  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
      <Text style={[styles.bubbleAuthor, mine ? styles.bubbleAuthorMine : null]}>{mine ? 'Вы' : userName(snapshot, message.sender_id)}</Text>
      <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>{message.message_text}</Text>
      <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>{shortDateTime(message.created_at)}</Text>
    </View>
  );
}

export function NotificationsScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', text: '', target_role: 'all', importance: 'important' });
  const manageable = canManage(snapshot.permissions, 'manage:announcements');
  const unread = snapshot.notifications.filter((item) => !item.is_read).length;
  const pushDisabled = snapshot.connection?.push_disabled || snapshot.push_status?.active_devices === 0;

  return (
    <ScreenScroll>
      {manageable ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Новость" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      <View style={styles.metricsRow}>
        <MetricCard label="Непрочитано" value={unread} />
        <MetricCard label="Всего" value={snapshot.notifications.length} />
      </View>
      <Card tone={pushDisabled ? 'soft' : 'light'}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Push-уведомления</Text>
            <Text style={styles.mutedText}>
              {snapshot.connection?.push_disabled
                ? 'Push отключён на сервере.'
                : snapshot.push_status?.active_devices
                  ? `Активных устройств: ${snapshot.push_status.active_devices}`
                  : 'Нет активного устройства для push.'}
            </Text>
          </View>
          <Pill label={pushDisabled ? 'Проверить' : 'Готово'} tone={pushDisabled ? 'warn' : 'good'} />
        </View>
        <View style={styles.actionGrid}>
          <SecondaryButton title="Тест push" compact onPress={() => onMutate('POST', '/push/test')} />
        </View>
      </Card>
      {snapshot.notifications.map((item) => (
        <Card key={item.id} tone={item.is_read ? 'light' : 'soft'}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.mutedText}>{shortDateTime(item.created_at)} · {item.target_role}</Text>
            </View>
            <Pill label={item.is_read ? 'Прочитано' : 'Новое'} tone={item.is_read ? 'neutral' : 'warn'} />
          </View>
          <Text style={styles.bodyText}>{item.text}</Text>
          {!item.is_read ? <SecondaryButton title="Отметить прочитанным" compact onPress={() => onMutate('PATCH', `/notifications/${item.id}/read`)} /> : null}
        </Card>
      ))}
      {snapshot.notifications.length === 0 ? <EmptyState title="Сигналов пока нет" text="Когда появятся важные новости, они будут здесь." /> : null}

      <ModalSheet visible={showForm} title="Новая новость" onClose={() => setShowForm(false)}>
        <Field label="Заголовок" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} />
        <Field label="Текст" value={form.text} onChangeText={(value) => setForm({ ...form, text: value })} multiline />
        <Text style={styles.formLabel}>Кому показать</Text>
        <View style={styles.actionGrid}>
          {['all', 'hall', 'kitchen', 'bar', 'waiter', 'hostess', 'management'].map((target) => (
            <SecondaryButton key={target} title={target} compact onPress={() => setForm({ ...form, target_role: target })} />
          ))}
        </View>
        <Text style={styles.formLabel}>Важность</Text>
        <View style={styles.actionGrid}>
          <SecondaryButton title="Обычная" compact onPress={() => setForm({ ...form, importance: 'normal' })} />
          <SecondaryButton title="Важная" compact onPress={() => setForm({ ...form, importance: 'important' })} />
          <SecondaryButton title="Срочная" compact danger onPress={() => setForm({ ...form, importance: 'urgent' })} />
        </View>
        <PrimaryButton
          title="Опубликовать"
          onPress={async () => {
            await onMutate('POST', '/announcements', form);
            setShowForm(false);
            setForm({ title: '', text: '', target_role: 'all', importance: 'important' });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function RulesScreen({ snapshot }: SectionProps) {
  const [query, setQuery] = useState('');
  const rules = snapshot.rules.filter((rule) => `${rule.title} ${rule.category} ${rule.content}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <ScreenScroll>
      <Field label="Поиск по правилам" value={query} onChangeText={setQuery} />
      {rules.map((rule) => (
        <Card key={rule.id}>
          <Pill label={rule.category} tone="warn" />
          <Text style={styles.cardTitle}>{rule.title}</Text>
          <Text style={styles.bodyText}>{rule.content}</Text>
        </Card>
      ))}
    </ScreenScroll>
  );
}

export function TasksScreen({ snapshot, onMutate }: SectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assigned_to: snapshot.users[0]?.id ?? '', due_date: new Date().toISOString() });
  const manageable = canManage(snapshot.permissions, 'manage:tasks');
  const today = todayISO();
  const cooksOnShift = snapshot.users.filter((user) => {
    if (user.role !== 'cook') return false;
    if (user.status === 'on_shift') return true;
    return snapshot.shifts.some((shift) => shift.user_id === user.id && shift.date?.slice(0, 10) === today && shift.status === 'active');
  });
  const isKitchenRole = ['chef', 'cook', 'bar', 'manager', 'administrator', 'technician'].includes(snapshot.current_user.role);
  const orderItems = (snapshot.guest_order_items ?? []).filter((item) => {
    if (snapshot.current_user.role === 'bar') {
      const dish = menuItem(snapshot, item.menu_item_id);
      return Boolean(item.is_bar || ['bar', 'drink', 'alcohol'].includes(String(item.item_type ?? '')) || isBarMenuItem(snapshot, dish));
    }
    if (snapshot.current_user.role === 'cook') return Boolean(item.is_kitchen && (!item.assigned_to || item.assigned_to === snapshot.current_user.id));
    if (snapshot.current_user.role === 'chef') return Boolean(item.is_kitchen);
    return Boolean(item.is_kitchen || item.is_bar || ['bar', 'drink', 'alcohol'].includes(String(item.item_type ?? '')));
  });

  return (
    <ScreenScroll>
      {manageable ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="Создать" compact onPress={() => setShowForm(true)} />
        </View>
      ) : null}
      {isKitchenRole ? (
        <Card tone="soft">
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{snapshot.current_user.role === 'bar' ? 'Заказы бара' : 'Заказы кухни'}</Text>
              <Text style={styles.mutedText}>
                {snapshot.current_user.role === 'bar' ? 'Только напитки, барные позиции и алкоголь.' : 'Кухонные позиции из заказов гостей.'}
              </Text>
            </View>
            <Pill label={`${orderItems.length} позиций`} tone={orderItems.length ? 'warn' : 'good'} />
          </View>
          {snapshot.current_user.role !== 'bar' ? (
            <View style={styles.actionGrid}>
              {cooksOnShift.length ? cooksOnShift.map((cook) => <Pill key={cook.id} label={cook.name.split(' ')[0]} tone="info" />) : <Pill label="Поваров на смене нет" tone="warn" />}
            </View>
          ) : null}
        </Card>
      ) : null}
      {isKitchenRole && orderItems.length === 0 ? (
        <EmptyState title={snapshot.current_user.role === 'bar' ? 'Заказов бара нет' : 'Кухонных заказов нет'} text="Новые позиции появятся здесь после заказа гостя из меню." />
      ) : null}
      {isKitchenRole
        ? orderItems.map((item) => <KitchenOrderCard key={item.id} item={item} snapshot={snapshot} cooksOnShift={cooksOnShift} onMutate={onMutate} />)
        : null}
      {snapshot.tasks.map((task) => (
        <TaskCard key={task.id} task={task} snapshot={snapshot} onMutate={onMutate} />
      ))}
      <ModalSheet visible={showForm} title="Новая задача" onClose={() => setShowForm(false)}>
        <Field label="Название" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} />
        <Field label="Описание" value={form.description} onChangeText={(value) => setForm({ ...form, description: value })} multiline />
        <Text style={styles.formLabel}>Кому назначить</Text>
        <View style={styles.actionGrid}>
          {snapshot.users.slice(0, 12).map((user) => (
            <SecondaryButton key={user.id} title={user.name.split(' ')[0]} compact onPress={() => setForm({ ...form, assigned_to: user.id })} />
          ))}
        </View>
        <Field label="Срок" value={form.due_date} onChangeText={(value) => setForm({ ...form, due_date: value })} />
        <PrimaryButton
          title="Создать задачу"
          onPress={async () => {
            await onMutate('POST', '/tasks', form);
            setShowForm(false);
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function KitchenOrderCard({
  item,
  snapshot,
  cooksOnShift,
  onMutate,
}: {
  item: NonNullable<DataSnapshot['guest_order_items']>[number];
  snapshot: DataSnapshot;
  cooksOnShift: User[];
  onMutate: MutationFn;
}) {
  const currentRole = snapshot.current_user.role;
  const assignedName = item.assigned_to ? userName(snapshot, item.assigned_to) : 'Не назначен';
  const canAssign = ['chef', 'manager', 'administrator', 'technician'].includes(currentRole) && Boolean(item.is_kitchen);
  const canWork =
    ['chef', 'manager', 'administrator', 'technician'].includes(currentRole) ||
    (currentRole === 'cook' && Boolean(item.is_kitchen) && (!item.assigned_to || item.assigned_to === snapshot.current_user.id)) ||
    currentRole === 'bar';
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>
            {item.menu_item_name ?? 'Позиция'} x{item.quantity ?? 1}
          </Text>
          <Text style={styles.mutedText}>
            Стол {item.table_number ?? '—'} · {item.guest_name ?? 'Гость'} · {assignedName}
          </Text>
        </View>
        <Pill label={orderStatusLabels[item.status] ?? item.status} tone={item.status === 'done' ? 'good' : item.status === 'cancelled' ? 'bad' : 'warn'} />
      </View>
      {item.comment ? <Text style={styles.bodyText}>{item.comment}</Text> : null}
      {canAssign ? (
        <View style={styles.actionGrid}>
          {cooksOnShift.length ? (
            cooksOnShift.map((cook) => (
              <SecondaryButton key={cook.id} title={cook.name.split(' ')[0]} compact onPress={() => onMutate('PATCH', `/guest-order-items/${item.id}`, { assigned_to: cook.id })} />
            ))
          ) : (
            <Pill label="Нет поваров на смене" tone="warn" />
          )}
        </View>
      ) : null}
      {canWork ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="В работе" compact onPress={() => onMutate('PATCH', `/guest-order-items/${item.id}`, { status: 'in_progress' })} />
          <SecondaryButton title="Сделано" compact onPress={() => onMutate('PATCH', `/guest-order-items/${item.id}`, { status: 'done' })} />
        </View>
      ) : null}
    </Card>
  );
}

export function TaskCard({ task, snapshot, onMutate }: { task: TaskItem; snapshot: DataSnapshot; onMutate: MutationFn }) {
  const canUpdate = canManage(snapshot.permissions, 'manage:tasks') || task.assigned_to === snapshot.current_user.id;
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{task.title}</Text>
          <Text style={styles.mutedText}>Срок: {shortDateTime(task.due_date)} · {userName(snapshot, task.assigned_to)}</Text>
        </View>
        <Pill label={taskLabels[task.status]} tone={roleTone(task.status)} />
      </View>
      <Text style={styles.bodyText}>{task.description}</Text>
      {task.comment ? <Text style={styles.mutedText}>{task.comment}</Text> : null}
      {task.photo_required ? <Pill label="Нужен фотоотчет" tone="warn" /> : null}
      {canUpdate ? (
        <View style={styles.actionGrid}>
          <SecondaryButton title="В работу" compact onPress={() => onMutate('PATCH', `/tasks/${task.id}`, { status: 'in_progress' })} />
          <SecondaryButton title="Выполнено" compact onPress={() => onMutate('PATCH', `/tasks/${task.id}`, { status: 'done' })} />
        </View>
      ) : null}
    </Card>
  );
}

export function ProfileScreen({ snapshot, onLogout, onMutate }: SectionProps) {
  const user = snapshot.current_user;
  const today = todayISO();
  const todayShift = snapshot.shifts.find((shift) => shift.user_id === user.id && shift.date?.slice(0, 10) === today);
  const upcoming = snapshot.shifts.filter((shift) => shift.user_id === user.id).slice(0, 4);
  const myTasks = snapshot.tasks.filter((task) => task.assigned_to === user.id);
  const myTables = snapshot.tables.filter((table) => table.current_waiter_id === user.id);
  const shiftActive = user.status === 'on_shift';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', repeat_password: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (user.role === 'pending') {
    return (
      <ScreenScroll>
        <Card>
          <View style={styles.personRow}>
            <Avatar uri={user.photo_url} name={user.name} size={64} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.name}</Text>
              <Text style={styles.mutedText}>Новый сотрудник</Text>
              <Text style={styles.bodyText}>{user.phone || 'Телефон не указан'}</Text>
            </View>
          </View>
        </Card>
        <Card tone="soft">
          <Text style={styles.cardTitle}>Ожидает роли</Text>
          <Text style={styles.bodyText}>Пока доступны только профиль и информация о ресторане. Управляющий увидит вас в персонале и выдаст профессию.</Text>
        </Card>
        <PrimaryButton title="Выйти из аккаунта" onPress={onLogout} />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <Card>
        <View style={styles.personRow}>
          <Avatar uri={user.photo_url} name={user.name} size={64} />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{user.name}</Text>
            <Text style={styles.mutedText}>{user.position} · {labelForRole(user.role)}</Text>
            <Text style={styles.bodyText}>{user.phone}</Text>
          </View>
          <Pill label={userStatusLabels[user.status] ?? user.status} tone={roleTone(user.status)} />
        </View>
      </Card>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Сегодняшняя смена</Text>
            <Text style={styles.bodyText}>
              {todayShift ? `${todayShift.start_time?.slice(0, 5)}-${todayShift.end_time?.slice(0, 5)} · ${todayShift.zone}` : 'Сегодня смена не назначена.'}
            </Text>
          </View>
          <Pill label={shiftActive ? 'На смене' : 'Не на смене'} tone={shiftActive ? 'good' : 'neutral'} />
        </View>
        <PrimaryButton
          title={shiftActive ? 'Завершить смену' : 'Начать смену'}
          onPress={() => onMutate('PATCH', '/me/status', { status: shiftActive ? 'off_shift' : 'on_shift' })}
        />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Ближайшие смены</Text>
        {upcoming.map((shift) => (
          <MiniRow key={shift.id} title={`${shortDate(shift.date)} · ${shift.start_time?.slice(0, 5)}`} text={`${shift.position} · ${shift.zone}`} pill={shiftLabels[shift.status]} />
        ))}
      </Card>
      <View style={styles.metricsRow}>
        <MetricCard label="Мои задачи" value={myTasks.length} />
        <MetricCard label="Мои столы" value={myTables.length} />
        <MetricCard label="Новости" value={snapshot.notifications.filter((item) => !item.is_read).length} />
      </View>
      <Card>
        <Text style={styles.cardTitle}>Пароль</Text>
        <SecondaryButton title="Сменить пароль" compact onPress={() => setPasswordVisible(true)} />
      </Card>
      <PrimaryButton title="Выйти из аккаунта" onPress={onLogout} />
      <ModalSheet
        visible={passwordVisible}
        title="Смена пароля"
        onClose={() => {
          setPasswordVisible(false);
          setPasswordError(null);
          setPasswordForm({ current_password: '', new_password: '', repeat_password: '' });
        }}
      >
        <Field
          label="Текущий пароль"
          value={passwordForm.current_password}
          onChangeText={(value) => setPasswordForm({ ...passwordForm, current_password: value })}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
        <Field
          label="Новый пароль"
          value={passwordForm.new_password}
          onChangeText={(value) => setPasswordForm({ ...passwordForm, new_password: value })}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Field
          label="Повторите пароль"
          value={passwordForm.repeat_password}
          onChangeText={(value) => setPasswordForm({ ...passwordForm, repeat_password: value })}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {passwordError ? <Text style={styles.mutedText}>{passwordError}</Text> : null}
        <PrimaryButton
          title="Сохранить пароль"
          onPress={async () => {
            const newPassword = passwordForm.new_password.trim();
            if (newPassword.length < 8) {
              setPasswordError('Пароль должен быть не короче 8 символов.');
              return;
            }
            if (newPassword !== passwordForm.repeat_password.trim()) {
              setPasswordError('Пароли не совпадают.');
              return;
            }
            await onMutate('PATCH', '/me/password', {
              current_password: passwordForm.current_password,
              new_password: newPassword,
            });
            setPasswordVisible(false);
            setPasswordError(null);
            setPasswordForm({ current_password: '', new_password: '', repeat_password: '' });
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

export function LegacyProfileScreen({ snapshot, onLogout }: SectionProps) {
  const user = snapshot.current_user;
  const today = todayISO();
  const todayShift = snapshot.shifts.find((shift) => shift.user_id === user.id && shift.date?.slice(0, 10) === today);
  const upcoming = snapshot.shifts.filter((shift) => shift.user_id === user.id).slice(0, 4);
  const myTasks = snapshot.tasks.filter((task) => task.assigned_to === user.id);
  const myTables = snapshot.tables.filter((table) => table.current_waiter_id === user.id);

  if (user.role === 'pending') {
    return (
      <ScreenScroll>
        <Card>
          <View style={styles.personRow}>
            <Avatar uri={user.photo_url} name={user.name} size={64} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.name}</Text>
              <Text style={styles.mutedText}>Новый сотрудник</Text>
              <Text style={styles.bodyText}>{user.phone || 'Телефон не указан'}</Text>
            </View>
          </View>
        </Card>
        <Card tone="soft">
          <Text style={styles.cardTitle}>Ожидает роли</Text>
          <Text style={styles.bodyText}>Пока доступны только профиль и информация о ресторане. Управляющий увидит вас в разделе персонала и выдаст нужную профессию.</Text>
        </Card>
        <PrimaryButton title="Выйти из аккаунта" onPress={onLogout} />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <Card>
        <View style={styles.personRow}>
          <Avatar uri={user.photo_url} name={user.name} size={64} />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{user.name}</Text>
            <Text style={styles.mutedText}>{user.position} · {labelForRole(user.role)}</Text>
            <Text style={styles.bodyText}>{user.phone}</Text>
          </View>
        </View>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Сегодняшняя смена</Text>
        <Text style={styles.bodyText}>
          {todayShift ? `${todayShift.start_time?.slice(0, 5)}-${todayShift.end_time?.slice(0, 5)} · ${todayShift.zone}` : 'Сегодня смена не назначена.'}
        </Text>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Ближайшие смены</Text>
        {upcoming.map((shift) => (
          <MiniRow key={shift.id} title={`${shortDate(shift.date)} · ${shift.start_time?.slice(0, 5)}`} text={`${shift.position} · ${shift.zone}`} pill={shiftLabels[shift.status]} />
        ))}
      </Card>
      <View style={styles.metricsRow}>
        <MetricCard label="Мои задачи" value={myTasks.length} />
        <MetricCard label="Мои столики" value={myTables.length} />
        <MetricCard label="Новости" value={snapshot.notifications.filter((item) => !item.is_read).length} />
      </View>
      <PrimaryButton title="Выйти из аккаунта" onPress={onLogout} />
    </ScreenScroll>
  );
}

export function AdminScreen({ snapshot, navigate }: SectionProps) {
  const status = snapshot.server_status;
  const brief = snapshot.shift_brief;
  const adminSections: SectionKey[] = ['staff', 'schedule', 'menu', 'stoplist', 'floor', 'reservations', 'events', 'tasks', 'notifications', 'analytics'];
  const availableAdminSections = adminSections
    .filter((key) => snapshot.sections.includes(key))
    .map((key) => sectionDefinitions.find((section) => section.key === key))
    .filter(Boolean) as { key: SectionKey; label: string; shortLabel: string; icon: string }[];
  return (
    <ScreenScroll>
      <Card>
        <Text style={styles.cardTitle}>Сервер и синхронизация</Text>
        <View style={styles.metricsRow}>
          <MetricCard label="Режим" value={status?.mode === 'demo-memory' ? 'Демо' : 'База'} detail={status?.api_version ?? '0.1.0'} />
          <MetricCard label="Аптайм" value={status ? `${Math.floor(status.uptime_seconds / 60)}м` : 'ок'} detail="сервер онлайн" />
          <MetricCard label="Сигналы" value={brief?.unread_notifications ?? 0} detail="непрочитано" />
        </View>
        <Text style={styles.mutedText}>Последняя синхронизация: {shortDateTime(snapshot.server_time)}</Text>
      </Card>
      {brief ? (
        <Card>
          <Text style={styles.cardTitle}>Готовность смены</Text>
          {brief.items.slice(0, 6).map((item) => (
            <MiniRow key={item} title={item} text="Сводка собрана сервером из задач, стоп-листа, броней, событий и сигналов." />
          ))}
        </Card>
      ) : null}
      <View style={styles.adminGrid}>
        {availableAdminSections.map((section) => (
          <Pressable key={section.key} onPress={() => navigate(section.key)} style={({ pressed }) => [styles.adminTile, pressed ? styles.pressed : null]}>
            <Text style={styles.adminTileTitle}>{section.label}</Text>
            <Text style={styles.adminTileText}>Открыть управление</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <Text style={styles.cardTitle}>История изменений</Text>
        {snapshot.activity_log.slice(0, 8).map((item) => (
          <MiniRow key={item.id} title={item.action} text={`${userName(snapshot, item.user_id)} · ${item.entity_type} · ${shortDateTime(item.created_at)}`} />
        ))}
      </Card>
    </ScreenScroll>
  );
}

export function AnalyticsScreen({ snapshot }: SectionProps) {
  const today = todayISO();
  const reservationsToday = snapshot.reservations.filter((item) => item.date?.slice(0, 10) === today);
  const reservationsWeek = snapshot.reservations.filter((item) => item.date?.slice(0, 10) >= today);
  const guestsToday = reservationsToday.filter((item) => !['cancelled', 'no_show'].includes(item.status)).reduce((sum, item) => sum + item.guests_count, 0);
  const cancelled = reservationsWeek.filter((item) => item.status === 'cancelled').length;
  const noShows = reservationsWeek.filter((item) => item.status === 'no_show').length;
  const taskDone = snapshot.tasks.filter((task) => task.status === 'done').length;
  return (
    <ScreenScroll>
      <View style={styles.metricsRow}>
        <MetricCard label="Брони сегодня" value={reservationsToday.length} />
        <MetricCard label="Гостей сегодня" value={guestsToday} />
        <MetricCard label="Брони неделя" value={reservationsWeek.length} />
      </View>
      <View style={styles.metricsRow}>
        <MetricCard label="Отмены" value={cancelled} />
        <MetricCard label="Не пришли" value={noShows} />
        <MetricCard label="Задачи" value={`${taskDone}/${snapshot.tasks.length}`} />
      </View>
      <Card>
        <Text style={styles.cardTitle}>Загрузка столов</Text>
        {snapshot.tables.map((table) => (
          <MiniRow key={table.id} title={`Стол ${table.number}`} text={`${table.seats} мест · ${tableStatusLabel[table.status]} · ${userName(snapshot, table.current_waiter_id)}`} />
        ))}
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Блюда в стоп-листе</Text>
        {snapshot.stop_list.slice(0, 6).map((item) => (
          <MiniRow key={item.id} title={menuItem(snapshot, item.menu_item_id)?.name ?? 'Позиция'} text={item.reason} pill={stopLabels[item.status]} />
        ))}
      </Card>
    </ScreenScroll>
  );
}

export function AboutScreen({ snapshot }: SectionProps) {
  return (
    <ScreenScroll>
      <Card>
        <Text style={styles.cardTitle}>{snapshot.restaurant.name}</Text>
        <Text style={styles.bodyText}>{snapshot.restaurant.concept}</Text>
        <InfoBlock label="Адрес" text={snapshot.restaurant.address} />
        <InfoBlock label="Режим работы" text={snapshot.restaurant.hours} />
        <InfoBlock label="Посадка" text={`${snapshot.restaurant.seats} гостей`} />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Особенности</Text>
        <View style={styles.actionGrid}>
          {snapshot.restaurant.features.map((feature) => (
            <Pill key={feature} label={feature} tone="warn" />
          ))}
        </View>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Важные контакты</Text>
        {snapshot.restaurant.contacts.map((contact) => (
          <Text key={contact} style={styles.bodyText}>{contact}</Text>
        ))}
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Для новых сотрудников</Text>
        <Text style={styles.bodyText}>
          В начале смены проверьте объявления, график, стоп-лист и свои задачи. Все изменения по столам, броням и стоп-листу фиксируются в истории действий.
        </Text>
      </Card>
    </ScreenScroll>
  );
}
