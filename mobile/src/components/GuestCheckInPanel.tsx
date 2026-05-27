import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { guestCheckIn } from '../data/featureApi';
import { palette } from '../theme';
import { Card, Field, PrimaryButton, SectionTitle } from './ui';

export function GuestCheckInPanel({
  apiUrl,
  token,
  onCheckedIn,
}: {
  apiUrl: string;
  token: string;
  onCheckedIn?: (tableNumber: string, profile?: unknown) => void;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [offers, setOffers] = useState<{ id: string; title: string; text: string }[]>([]);

  async function submit() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await guestCheckIn({ apiUrl, token }, code.trim());
      setOffers(result.offers ?? []);
      setMessage(`Вы за столом ${result.table.number}. Официант видит вас в приложении.`);
      onCheckedIn?.(result.table.number, result.profile);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось привязать стол.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card tone="soft">
      <SectionTitle title="Я в ресторане" subtitle="Введите код с наклейки на столе или вставьте ссылку из QR" />
      <Field label="Код стола" value={code} onChangeText={setCode} placeholder="GORY01" autoCapitalize="characters" />
      <PrimaryButton title={loading ? 'Проверяем...' : 'Привязать стол'} disabled={loading || !code.trim()} onPress={() => void submit()} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {offers.map((offer) => (
        <View key={offer.id} style={styles.offer}>
          <Text style={styles.offerTitle}>{offer.title}</Text>
          <Text style={styles.offerText}>{offer.text}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  message: { color: palette.ink, marginTop: 10, lineHeight: 20 },
  offer: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.line },
  offerTitle: { color: palette.ink, fontWeight: '700' },
  offerText: { color: palette.inkMuted, marginTop: 4, lineHeight: 18 },
});
