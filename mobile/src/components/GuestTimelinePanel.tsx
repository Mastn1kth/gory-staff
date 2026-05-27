import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { loadGuestTimeline, type GuestTimelineItem } from '../data/featureApi';
import { palette } from '../theme';
import { Card, EmptyState, SectionTitle } from './ui';

export function GuestTimelinePanel({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [items, setItems] = useState<GuestTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void loadGuestTimeline({ apiUrl, token })
      .then((result) => {
        if (alive) setItems(result.items ?? []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiUrl, token]);

  return (
    <Card>
      <SectionTitle title="Мои визиты и брони" subtitle="История без онлайн-заказа и оплаты" />
      {loading ? <Text style={styles.muted}>Загрузка...</Text> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="Пока пусто" text="Здесь появятся брони, визиты за столом и операции с бонусами." />
      ) : null}
      {items.slice(0, 20).map((item) => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.text}>{item.text}</Text>
          <Text style={styles.date}>
            {new Date(item.at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { color: palette.inkMuted },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: palette.line },
  title: { color: palette.ink, fontWeight: '700' },
  text: { color: palette.inkMuted, marginTop: 4, lineHeight: 18 },
  date: { color: palette.inkMuted, marginTop: 4, fontSize: 12 },
});
