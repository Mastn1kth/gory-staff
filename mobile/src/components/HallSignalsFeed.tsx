import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DataSnapshot, HallSignal } from '../types';
import type { MutationFn } from '../types';
import { palette } from '../theme';
import { Card, EmptyState, Pill } from './ui';

export function HallSignalsFeed({
  snapshot,
  onMutate,
  onRefresh,
  canAcknowledge,
}: {
  snapshot: DataSnapshot;
  onMutate: MutationFn;
  onRefresh: () => void;
  canAcknowledge: boolean;
}) {
  const signals = snapshot.hall_signals ?? [];
  const openSignals = useMemo(() => signals.filter((item) => item.status === 'open'), [signals]);

  async function handleAcknowledge(signal: HallSignal) {
    await onMutate('PATCH', `/hall-signals/${signal.id}/acknowledge`);
    onRefresh();
  }

  if (!signals.length) {
    return (
      <Card>
        <EmptyState title="Сигналов нет" text="Быстрые сигналы со столов появятся здесь для хостес и управляющего." />
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>Сигналы зала</Text>
          <Text style={styles.headerMeta}>{openSignals.length ? `${openSignals.length} ждут реакции` : 'Все приняты'}</Text>
        </View>
        <Pill label={String(openSignals.length)} tone={openSignals.length ? 'warn' : 'good'} />
      </View>
      {signals.slice(0, 12).map((signal) => (
        <View key={signal.id} style={styles.row}>
          <View style={styles.iconWrap}>
            <Ionicons name="restaurant-outline" size={18} color={palette.burgundy} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>{signal.signal_label ?? signal.signal_type}</Text>
            <Text style={styles.meta}>
              Стол {signal.table_number ?? '?'} · {signal.created_by_name ?? 'Сотрудник'} ·{' '}
              {new Date(signal.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {signal.status === 'open' && canAcknowledge ? (
            <Pressable onPress={() => void handleAcknowledge(signal)} style={styles.ackButton}>
              <Text style={styles.ackText}>Принято</Text>
            </Pressable>
          ) : (
            <Pill label={signal.status === 'open' ? 'Новый' : 'Принят'} tone={signal.status === 'open' ? 'warn' : 'good'} />
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 2 },
  headerTitle: { color: palette.ink, fontWeight: '900', fontSize: 16 },
  headerMeta: { color: palette.inkMuted, marginTop: 2, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: palette.line },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceAlt,
  },
  flex: { flex: 1 },
  title: { color: palette.ink, fontWeight: '700', fontSize: 15 },
  meta: { color: palette.inkMuted, marginTop: 2, fontSize: 12, lineHeight: 16 },
  ackButton: {
    backgroundColor: palette.burgundy,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ackText: { color: palette.textOnDark, fontWeight: '700', fontSize: 12 },
});
