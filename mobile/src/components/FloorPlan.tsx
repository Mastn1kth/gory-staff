import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { TableSignalActions } from './TableSignalActions';
import { ModalSheet, Pill, SecondaryButton } from './ui';
import { palette, tableStatusColor, tableStatusLabel } from '../theme';
import type { DataSnapshot, Floor, MutationFn, Reservation, RestaurantTable, TableStatus, User } from '../types';

const floorPlanImages: Record<string, ImageSourcePropType> = {
  'floor-1': require('../../assets/floor-plans/floor-1.png'),
  'floor-1.png': require('../../assets/floor-plans/floor-1.png'),
  'floor-2': require('../../assets/floor-plans/floor-2.png'),
  'floor-2.png': require('../../assets/floor-plans/floor-2.png'),
};

function floorPlanImage(floor?: Floor) {
  if (!floor) return null;
  return floorPlanImages[floor.plan_image ?? ''] ?? floorPlanImages[floor.id] ?? null;
}

const statusActions: { status: TableStatus; label: string }[] = [
  { status: 'free', label: 'Свободен' },
  { status: 'occupied', label: 'Занят' },
  { status: 'reserved', label: 'Бронь' },
  { status: 'expected', label: 'Гости пришли' },
  { status: 'cleaning', label: 'На уборку' },
  { status: 'closed', label: 'Закрыть' },
];

function guestLine(reservation?: Reservation) {
  if (!reservation) return 'Нет активной брони';
  return `${reservation.guest_name}, ${reservation.guests_count} гостей, ${reservation.time}`;
}

function waiterName(users: User[], id?: string | null) {
  return users.find((user) => user.id === id)?.name ?? 'Не назначен';
}

export function FloorPlan({
  snapshot,
  onlyMine,
  canManage,
  onMutate,
  onUpdateTable,
}: {
  snapshot: DataSnapshot;
  onlyMine?: boolean;
  canManage: boolean;
  onMutate?: MutationFn;
  onUpdateTable: (id: string, body: Partial<RestaurantTable>) => Promise<void>;
}) {
  const [floorId, setFloorId] = useState(snapshot.floors[0]?.id);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [width, setWidth] = useState(0);

  const waiters = snapshot.users.filter((user) => user.role === 'waiter');
  const currentFloor = snapshot.floors.find((floor) => floor.id === floorId) ?? snapshot.floors[0];
  const tables = useMemo(() => {
    const list = snapshot.tables.filter((table) => table.floor_id === currentFloor?.id);
    return onlyMine ? list.filter((table) => table.current_waiter_id === snapshot.current_user.id) : list;
  }, [currentFloor?.id, onlyMine, snapshot.current_user.id, snapshot.tables]);

  const reservationsByTable = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    snapshot.reservations
      .filter((reservation) => !['cancelled', 'no_show', 'guests_left'].includes(reservation.status))
      .forEach((reservation) => {
        if (!reservation.table_id) return;
        const current = map.get(reservation.table_id) ?? [];
        current.push(reservation);
        map.set(reservation.table_id, current);
      });
    return map;
  }, [snapshot.reservations]);
  const activeSessionsByTable = useMemo(() => {
    const map = new Map<string, NonNullable<DataSnapshot['table_guest_sessions']>[number]>();
    (snapshot.table_guest_sessions ?? [])
      .filter((session) => session.status === 'active')
      .forEach((session) => map.set(session.table_id, session));
    return map;
  }, [snapshot.table_guest_sessions]);
  const orderItemsByTable = useMemo(() => {
    const map = new Map<string, NonNullable<DataSnapshot['guest_order_items']>>();
    (snapshot.guest_order_items ?? []).forEach((item) => {
      if (!item.table_id) return;
      const current = map.get(item.table_id) ?? [];
      current.push(item);
      map.set(item.table_id, current);
    });
    return map;
  }, [snapshot.guest_order_items]);

  const planHeight = Math.max(420, width * 0.72);
  const imageSource = floorPlanImage(currentFloor);
  const selectedReservation = selected ? reservationsByTable.get(selected.id)?.[0] : undefined;
  const activeGuestSession = selected ? activeSessionsByTable.get(selected.id) : undefined;
  const selectedOrderItems = selected ? orderItemsByTable.get(selected.id) ?? [] : [];
  const canSendSignals = Boolean(onMutate) && ['waiter', 'hostess', 'administrator', 'manager', 'technician'].includes(snapshot.current_user.role);

  return (
    <View style={styles.wrap}>
      {!onlyMine ? (
        <View style={styles.floorSwitch}>
          {snapshot.floors.map((floor) => {
            const active = floor.id === currentFloor?.id;
            return (
              <Pressable key={floor.id} onPress={() => setFloorId(floor.id)} style={[styles.floorButton, active ? styles.floorButtonActive : null]}>
                <Text style={[styles.floorButtonText, active ? styles.floorButtonTextActive : null]}>{floor.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.legend}>
        {(['free', 'occupied', 'reserved', 'cleaning', 'soon_reserved', 'banquet'] as TableStatus[]).map((status) => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: tableStatusColor[status] }]} />
            <Text style={styles.legendText}>{tableStatusLabel[status]}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.plan, { height: planHeight }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {imageSource ? <Image source={imageSource} style={styles.planImage} resizeMode="contain" /> : null}
        <View style={styles.zoneTop}>
          <Text style={styles.zoneText}>{currentFloor?.name ?? 'Зал'} · вход / сцена / проходы</Text>
        </View>
        {tables.map((table) => {
          const tableWidth = (width * table.width) / 100;
          const tableHeight = (planHeight * table.height) / 100;
          const tableLeft = (width * table.x_position) / 100;
          const tableTop = (planHeight * table.y_position) / 100;
          const reservation = reservationsByTable.get(table.id)?.[0];
          const activeGuest = activeSessionsByTable.get(table.id);
          return (
            <Pressable
              key={table.id}
              onPress={() => setSelected(table)}
              style={({ pressed }) => [
                styles.table,
                table.shape === 'round' ? styles.tableRound : null,
                {
                  width: Math.max(tableWidth, 58),
                  height: Math.max(tableHeight, 58),
                  left: tableLeft,
                  top: tableTop,
                  backgroundColor: tableStatusColor[table.status],
                },
                pressed ? styles.tablePressed : null,
              ]}
            >
              <Text style={styles.tableNumber}>{table.number}</Text>
              <Text style={styles.tableSeats}>{table.seats} мест</Text>
              {activeGuest?.guest_name ? <Text style={styles.tableGuest} numberOfLines={1}>{activeGuest.guest_name}</Text> : null}
              {reservation ? <Text style={styles.tableTime}>{reservation.time}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <ModalSheet visible={Boolean(selected)} title={selected ? `Стол ${selected.number}` : 'Стол'} onClose={() => setSelected(null)}>
        {selected ? (
          <>
            <View style={styles.detailHeader}>
              <Pill label={tableStatusLabel[selected.status]} tone={selected.status === 'free' ? 'good' : selected.status === 'occupied' ? 'bad' : 'warn'} />
              <Pill label={`${selected.seats} мест`} tone="dark" />
            </View>
            <View style={styles.detailGrid}>
              <Detail label="Этаж" value={snapshot.floors.find((floor) => floor.id === selected.floor_id)?.name ?? 'Не указан'} />
              <Detail label="Официант" value={waiterName(snapshot.users, selected.current_waiter_id)} />
              <Detail label="Ближайшая бронь" value={guestLine(selectedReservation)} />
              <Detail label="Комментарий" value={selected.comment || 'Без комментария'} />
              {activeGuestSession ? (
                <Detail
                  label="Гость в приложении"
                  value={`${activeGuestSession.guest_name ?? 'Гость'} · ${activeGuestSession.guest_phone ?? ''}`}
                />
              ) : null}
            </View>

            {canSendSignals && selected && onMutate ? (
              <TableSignalActions table={selected} onMutate={onMutate} />
            ) : null}

            {selectedOrderItems.length ? (
              <>
                <Text style={styles.blockTitle}>Заказ стола</Text>
                {selectedOrderItems.map((item) => (
                  <View key={item.id} style={styles.orderLine}>
                    <View style={styles.detailText}>
                      <Text style={styles.orderTitle}>
                        {item.menu_item_name ?? 'Позиция'} x{item.quantity ?? 1}
                      </Text>
                      <Text style={styles.detailValue}>
                        {item.status === 'ordered'
                          ? 'Заказал'
                          : item.status === 'accepted'
                            ? 'Принято'
                            : item.status === 'in_progress'
                              ? 'Готовится'
                              : item.status === 'done'
                                ? 'Сделано'
                                : item.status === 'served'
                                  ? 'Принесли'
                                  : item.status === 'cancelled'
                                    ? 'Отменено'
                                    : item.status}
                      </Text>
                    </View>
                    {onMutate && (canManage || selected.current_waiter_id === snapshot.current_user.id) ? (
                      <View style={styles.orderActions}>
                        <SecondaryButton title="Принято" compact onPress={() => onMutate('PATCH', `/guest-order-items/${item.id}`, { status: 'accepted' })} />
                        <SecondaryButton title="Принесли" compact onPress={() => onMutate('PATCH', `/guest-order-items/${item.id}`, { status: 'served' })} />
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}

            {selected.status === 'cleaning' && (canManage || (snapshot.current_user.role === 'waiter' && selected.current_waiter_id === snapshot.current_user.id)) ? (
              <SecondaryButton
                title="Стол готов"
                compact
                onPress={async () => {
                  await onUpdateTable(selected.id, { status: 'free' });
                  setSelected({ ...selected, status: 'free' });
                }}
              />
            ) : null}

            {canManage ? (
              <>
                <Text style={styles.blockTitle}>Действия со столом</Text>
                <View style={styles.actionGrid}>
                  {statusActions.map((action) => (
                    <SecondaryButton
                      key={action.status}
                      title={action.label}
                      compact
                      onPress={async () => {
                        await onUpdateTable(selected.id, { status: action.status });
                        setSelected({ ...selected, status: action.status });
                      }}
                    />
                  ))}
                </View>
                <Text style={styles.blockTitle}>Назначить официанта</Text>
                <View style={styles.actionGrid}>
                  {waiters.map((waiter) => (
                    <SecondaryButton
                      key={waiter.id}
                      title={waiter.name.split(' ')[0]}
                      compact
                      onPress={async () => {
                        await onUpdateTable(selected.id, { current_waiter_id: waiter.id });
                        setSelected({ ...selected, current_waiter_id: waiter.id });
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </ModalSheet>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  floorSwitch: {
    flexDirection: 'row',
    gap: 10,
  },
  floorButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 248, 234, 0.28)',
    backgroundColor: 'rgba(255, 248, 234, 0.08)',
  },
  floorButtonActive: {
    backgroundColor: palette.gold,
    borderColor: palette.gold,
  },
  floorButtonText: {
    color: palette.textOnDark,
    fontWeight: '900',
  },
  floorButtonTextActive: {
    color: palette.ink,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 248, 234, 0.1)',
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 9,
  },
  legendText: {
    color: palette.textMutedOnDark,
    fontSize: 12,
    fontWeight: '700',
  },
  plan: {
    minHeight: 420,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#F7F2E8',
    borderWidth: 1,
    borderColor: 'rgba(215, 169, 74, 0.36)',
  },
  planImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    opacity: 0.88,
  },
  zoneTop: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    height: 30,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(42, 35, 30, 0.72)',
    paddingHorizontal: 10,
  },
  zoneText: {
    color: palette.textMutedOnDark,
    fontSize: 12,
    fontWeight: '800',
  },
  table: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 248, 234, 0.7)',
    padding: 4,
  },
  tableRound: {
    borderRadius: 999,
  },
  tablePressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  tableNumber: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  tableSeats: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10,
    fontWeight: '800',
  },
  tableGuest: {
    maxWidth: '100%',
    marginTop: 2,
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  tableTime: {
    marginTop: 2,
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  detailHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailGrid: {
    gap: 10,
  },
  detail: {
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    padding: 12,
  },
  detailText: {
    flex: 1,
  },
  detailLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  detailValue: {
    marginTop: 4,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  blockTitle: {
    marginTop: 4,
    color: palette.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  orderLine: {
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    padding: 12,
    gap: 8,
  },
  orderTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  orderActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
