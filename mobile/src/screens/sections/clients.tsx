import { useState } from 'react';
import { Text, View } from 'react-native';

import { SegmentBroadcastPanel } from '../../components/SegmentBroadcastPanel';
import {
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
import { palette } from '../../theme';
import type { DataSnapshot, GuestBonusTransaction, GuestUser, User } from '../../types';

import type { MutationFn } from './types';

const guestBonusLabels: Record<string, string> = {
  registration_bonus: 'Бонус за регистрацию',
  referral_bonus: 'Бонус за приглашение',
  birthday_bonus: 'Бонус ко дню рождения',
  manual_add: 'Ручное начисление',
  manual_remove: 'Ручное списание',
  purchase_cashback: 'Кэшбэк',
  correction: 'Корректировка',
  expired: 'Сгоревшие бонусы',
  spend: 'Списание',
};

function roleTone(status?: string) {
  if (status === 'active' || status === 'on_shift' || status === 'done' || status === 'available') return 'good' as const;
  if (status === 'blocked' || status === 'cancelled' || status === 'out' || status === 'fired') return 'bad' as const;
  return 'warn' as const;
}

function shortDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function MiniRow({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.miniRow}>
      <View style={styles.flex}>
        <Text style={styles.miniTitle}>{title}</Text>
        <Text style={styles.miniText}>{text}</Text>
      </View>
    </View>
  );
}

function GuestBonusRow({ transaction, client }: { transaction: GuestBonusTransaction; client?: GuestUser }) {
  const positive = Number(transaction.amount) > 0;
  return (
    <View style={styles.miniRow}>
      <View style={styles.flex}>
        <Text style={styles.miniTitle}>{client?.name ?? 'Гость'}</Text>
        <Text style={styles.miniText}>
          {guestBonusLabels[transaction.type] ?? transaction.reason} · {shortDateTime(transaction.created_at)}
        </Text>
      </View>
      <Pill label={`${positive ? '+' : ''}${transaction.amount}`} tone={positive ? 'good' : 'bad'} />
    </View>
  );
}

export function ClientsScreen({
  snapshot,
  currentUser,
  onMutate,
}: {
  snapshot: DataSnapshot;
  currentUser: User;
  onMutate: MutationFn;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GuestUser | null>(null);
  const [operation, setOperation] = useState<'manual_add' | 'manual_remove'>('manual_add');
  const [amount, setAmount] = useState('300');
  const [reason, setReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked' | 'inactive'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | 'bronze' | 'silver' | 'gold' | 'platinum'>('all');
  const [sortMode, setSortMode] = useState<'updated' | 'bonus' | 'created' | 'activity'>('updated');
  const [noteDraft, setNoteDraft] = useState('');

  const canViewClients = ['technician', 'owner', 'manager'].includes(currentUser.role);
  const clients = snapshot.guest_clients ?? [];
  const transactions = snapshot.guest_client_transactions ?? [];
  const query = search.trim().toLowerCase();

  const filtered = clients
    .filter((client) => {
      if (!query) return true;
      return `${client.name} ${client.phone} ${client.referral_code}`.toLowerCase().includes(query);
    })
    .filter((client) => statusFilter === 'all' || client.status === statusFilter)
    .filter((client) => levelFilter === 'all' || client.loyalty_level === levelFilter)
    .sort((a, b) => {
      if (sortMode === 'bonus') return Number(b.bonus_balance ?? 0) - Number(a.bonus_balance ?? 0);
      if (sortMode === 'created') return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
      if (sortMode === 'activity') {
        return String(b.last_visit_at ?? b.updated_at ?? '').localeCompare(String(a.last_visit_at ?? a.updated_at ?? ''));
      }
      return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    });

  const activeClients = clients.filter((client) => client.status === 'active').length;
  const totalBonus = clients.reduce((sum, client) => sum + Number(client.bonus_balance ?? 0), 0);
  const selectedNotes = selected
    ? (snapshot.guest_notes ?? [])
        .filter((note) => note.guest_id === selected.id || note.guest_phone === selected.phone)
        .slice(0, 4)
    : [];

  if (!canViewClients) {
    return (
      <ScreenScroll>
        <EmptyState title="Нет доступа" text="Официанты, кухня и бар не видят клиентскую базу." />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={styles.metricsRow}>
        <MetricCard label="Клиенты" value={clients.length} detail={`${activeClients} активных`} />
        <MetricCard label="Бонусы" value={totalBonus} detail="на всех картах" />
        <MetricCard label="Операции" value={transactions.length} detail="последние записи" />
      </View>
      <SegmentBroadcastPanel onMutate={onMutate} onSent={() => undefined} />
      <Field label="Поиск" value={search} onChangeText={setSearch} placeholder="Имя, телефон или код" />
      <View style={styles.categoryRow}>
        <SecondaryButton
          title={
            statusFilter === 'all'
              ? 'Все статусы'
              : statusFilter === 'active'
                ? 'Активные'
                : statusFilter === 'blocked'
                  ? 'Заблокированные'
                  : 'Неактивные'
          }
          compact
          onPress={() =>
            setStatusFilter(
              statusFilter === 'all' ? 'active' : statusFilter === 'active' ? 'blocked' : statusFilter === 'blocked' ? 'inactive' : 'all',
            )
          }
        />
        <SecondaryButton
          title={
            levelFilter === 'all'
              ? 'Все уровни'
              : levelFilter === 'bronze'
                ? 'Бронза'
                : levelFilter === 'silver'
                  ? 'Серебро'
                  : levelFilter === 'gold'
                    ? 'Золото'
                    : 'Платина'
          }
          compact
          onPress={() =>
            setLevelFilter(
              levelFilter === 'all' ? 'bronze' : levelFilter === 'bronze' ? 'silver' : levelFilter === 'silver' ? 'gold' : levelFilter === 'gold' ? 'platinum' : 'all',
            )
          }
        />
        <SecondaryButton
          title={
            sortMode === 'updated'
              ? 'По активности'
              : sortMode === 'bonus'
                ? 'По бонусам'
                : sortMode === 'created'
                  ? 'По регистрации'
                  : 'По визиту'
          }
          compact
          onPress={() =>
            setSortMode(sortMode === 'updated' ? 'bonus' : sortMode === 'bonus' ? 'created' : sortMode === 'created' ? 'activity' : 'updated')
          }
        />
      </View>
      {filtered.length === 0 ? (
        <EmptyState title="Клиенты не найдены" text="Гости появятся здесь после регистрации в приложении." />
      ) : null}
      {filtered.map((client) => (
        <Card key={client.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{client.name}</Text>
              <Text style={styles.mutedText}>
                {client.phone} · код {client.referral_code}
              </Text>
              <Text style={styles.bodyText}>
                {client.bonus_balance} бонусов · {client.loyalty_level_label ?? client.loyalty_level}
              </Text>
            </View>
            <Pill label={client.status} tone={roleTone(client.status)} />
          </View>
          <View style={styles.rowActions}>
            <SecondaryButton
              title="Начислить"
              compact
              onPress={() => {
                setSelected(client);
                setOperation('manual_add');
                setAmount('300');
                setReason('Ручное начисление');
              }}
            />
            <SecondaryButton
              title="Списать"
              compact
              danger
              onPress={() => {
                setSelected(client);
                setOperation('manual_remove');
                setAmount('300');
                setReason('Ручное списание');
              }}
            />
            {client.status === 'blocked' ? (
              <SecondaryButton
                title="Разблокировать"
                compact
                onPress={() => onMutate('PATCH', `/admin/guests/${client.id}/status`, { status: 'active' })}
              />
            ) : (
              <SecondaryButton
                title="Заблокировать"
                compact
                danger
                onPress={() => onMutate('PATCH', `/admin/guests/${client.id}/status`, { status: 'blocked' })}
              />
            )}
          </View>
        </Card>
      ))}
      <ModalSheet
        visible={Boolean(selected)}
        title={operation === 'manual_add' ? 'Начислить бонусы' : 'Списать бонусы'}
        onClose={() => setSelected(null)}
      >
        <Text style={styles.cardTitle}>{selected?.name}</Text>
        <Text style={styles.mutedText}>{selected?.phone}</Text>
        {selected ? (
          <Card>
            <Text style={styles.cardTitle}>Карточка клиента</Text>
            <MiniRow title="Карта" text={selected.card_number ?? 'Карта создаётся'} />
            <MiniRow title="День рождения" text={selected.birthday ?? 'Не указан'} />
            <MiniRow title="Реферальный код" text={selected.referral_code} />
            <MiniRow title="Кто пригласил" text={selected.referrer_name ?? selected.referred_by ?? 'Не указан'} />
            <MiniRow title="Приглашено друзей" text={`${selected.invited_count ?? 0}`} />
            <MiniRow title="Визиты и средний чек" text={`${selected.visits_count ?? 0} визитов · ${selected.average_check ?? 0} ₽`} />
          </Card>
        ) : null}
        {selected ? (
          <Card tone="soft">
            <Text style={styles.cardTitle}>История бонусов</Text>
            {transactions
              .filter((transaction) => transaction.guest_id === selected.id)
              .slice(0, 5)
              .map((transaction) => (
                <GuestBonusRow key={transaction.id} transaction={transaction} client={selected} />
              ))}
            {transactions.filter((transaction) => transaction.guest_id === selected.id).length === 0 ? (
              <Text style={styles.mutedText}>Операций пока нет.</Text>
            ) : null}
          </Card>
        ) : null}
        {selected ? (
          <Card tone="soft">
            <Text style={styles.cardTitle}>Заметки</Text>
            {selectedNotes.map((note) => (
              <MiniRow key={note.id} title={note.note} text={shortDateTime(note.updated_at ?? note.created_at)} />
            ))}
            {selectedNotes.length === 0 ? <Text style={styles.mutedText}>Заметок пока нет.</Text> : null}
            <Field label="Новая заметка" value={noteDraft} onChangeText={setNoteDraft} placeholder="Например: любит стол у окна" />
            <SecondaryButton
              title="Добавить заметку"
              compact
              onPress={async () => {
                if (!selected || !noteDraft.trim()) return;
                await onMutate('POST', `/admin/guests/${selected.id}/notes`, { note: noteDraft.trim() });
                setNoteDraft('');
              }}
            />
          </Card>
        ) : null}
        <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
        <Field label="Причина" value={reason} onChangeText={setReason} />
        <PrimaryButton
          title={operation === 'manual_add' ? 'Начислить' : 'Списать'}
          onPress={async () => {
            if (!selected) return;
            await onMutate('POST', `/admin/guests/${selected.id}/bonus`, {
              operation,
              amount: Number(amount || 0),
              reason,
            });
            setSelected(null);
          }}
        />
      </ModalSheet>
    </ScreenScroll>
  );
}

const styles = {
  metricsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  categoryRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 8 },
  rowBetween: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 12, alignItems: 'flex-start' as const },
  rowActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 10 },
  flex: { flex: 1 },
  cardTitle: { color: palette.ink, fontWeight: '800' as const, fontSize: 16 },
  bodyText: { color: palette.ink, marginTop: 4 },
  mutedText: { color: palette.inkMuted, marginTop: 2 },
  miniRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 10, paddingVertical: 8 },
  miniTitle: { color: palette.ink, fontWeight: '700' as const },
  miniText: { color: palette.inkMuted, marginTop: 2, fontSize: 13 },
};
