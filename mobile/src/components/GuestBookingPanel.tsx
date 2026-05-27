import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createGuestReservation } from '../data/featureApi';
import { palette } from '../theme';
import { Card, Field, PrimaryButton, SectionTitle } from './ui';

export function GuestBookingPanel({
  apiUrl,
  token,
  guestName,
  onBooked,
}: {
  apiUrl: string;
  token: string;
  guestName: string;
  onBooked?: () => void;
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [date, setDate] = useState(tomorrow.toISOString().slice(0, 10));
  const [time, setTime] = useState('19:00');
  const [guestsCount, setGuestsCount] = useState('2');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setMessage(null);
    try {
      await createGuestReservation(
        { apiUrl, token },
        {
          date,
          time,
          guests_count: Number(guestsCount) || 2,
          comment,
          occasion: 'regular',
        },
      );
      setMessage('Заявка отправлена. Хостес подтвердит бронь и придёт уведомление.');
      onBooked?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось отправить заявку.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <SectionTitle title="Забронировать стол" subtitle={`${guestName}, укажите удобное время`} />
      <Field label="Дата" value={date} onChangeText={setDate} placeholder="ГГГГ-ММ-ДД" />
      <Field label="Время" value={time} onChangeText={setTime} placeholder="19:00" />
      <Field label="Гостей" value={guestsCount} onChangeText={setGuestsCount} placeholder="2" keyboardType="number-pad" />
      <Field label="Комментарий" value={comment} onChangeText={setComment} placeholder="Детское кресло, праздник..." multiline />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton title={loading ? 'Отправляем...' : 'Отправить заявку'} disabled={loading} onPress={() => void submit()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  message: { color: palette.inkMuted, marginBottom: 10, lineHeight: 20 },
});
