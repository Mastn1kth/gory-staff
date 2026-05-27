import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getStoredSession } from '../data/api';
import { loadGuestSegments, type GuestSegment } from '../data/featureApi';
import type { ApiSession, MutationFn } from '../types';
import { palette } from '../theme';
import { Card, Field, PrimaryButton, SecondaryButton } from './ui';

export function SegmentBroadcastPanel({ onMutate, onSent }: { onMutate: MutationFn; onSent?: () => void }) {
  const [segments, setSegments] = useState<GuestSegment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getStoredSession()
      .then((session: ApiSession | null) => {
        if (!session) return;
        return loadGuestSegments(session).then((rows) => {
          setSegments(rows);
          setSelectedId(rows[0]?.id ?? null);
        });
      })
      .catch(() => setSegments([]));
  }, []);

  async function submit() {
    if (!selectedId || !title.trim() || !text.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = (await onMutate('POST', `/guest-segments/${selectedId}/announcements`, {
        title: title.trim(),
        text: text.trim(),
        importance: 'normal',
      })) as { guests?: number; notified?: number } | null;
      setMessage(
        result
          ? `Новость создана · гостей в сегменте: ${result.guests ?? 0} · push: ${result.notified ?? 0}`
          : 'Новость создана.',
      );
      setTitle('');
      setText('');
      onSent?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось отправить рассылку.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card tone="soft">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Рассылка по сегменту</Text>
        <Text style={styles.headerMeta}>Создать новость и push гостям сегмента</Text>
      </View>
      <View style={styles.chips}>
        {segments.map((segment) => (
          <SecondaryButton
            key={segment.id}
            title={`${segment.name}${segment.member_count != null ? ` (${segment.member_count})` : ''}`}
            compact
            onPress={() => setSelectedId(segment.id)}
          />
        ))}
      </View>
      <Field label="Заголовок" value={title} onChangeText={setTitle} placeholder="Приглашение в ресторан" />
      <Field label="Текст" value={text} onChangeText={setText} placeholder="Текст новости для гостей" multiline />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton title={loading ? 'Отправляем...' : 'Создать новость'} disabled={loading} onPress={() => void submit()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 10 },
  headerTitle: { color: palette.ink, fontSize: 16, fontWeight: '900' },
  headerMeta: { color: palette.inkMuted, marginTop: 3, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  message: { color: palette.inkMuted, marginBottom: 10, lineHeight: 20 },
});
