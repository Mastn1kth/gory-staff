import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { createGuestReservation } from '../data/featureApi';
import { palette, radius } from '../theme';
import { Card, Field, ModalSheet, PrimaryButton, SectionTitle } from './ui';

const bookingDays = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
const bookingMonths = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));

function dateFromDayMonth(day: string, month: string) {
  const now = new Date();
  const year = now.getFullYear();
  const maxDay = new Date(year, Number(month), 0).getDate();
  const safeDay = String(Math.min(Number(day), maxDay)).padStart(2, '0');
  const candidate = new Date(year, Number(month) - 1, Number(safeDay));
  const today = new Date(year, now.getMonth(), now.getDate());
  const bookingYear = candidate < today ? year + 1 : year;

  return `${bookingYear}-${month}-${safeDay}`;
}

function formatBookingDate(value: string) {
  const [, month, day] = value.split('-');
  if (!month || !day) return 'Выбрать дату';

  return `${day}.${month}`;
}

function BookingDatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parts = value.split('-');
  const [visible, setVisible] = useState(false);
  const [month, setMonth] = useState(parts[1] ?? bookingMonths[0]);
  const [day, setDay] = useState(parts[2] ?? bookingDays[0]);

  return (
    <View style={styles.dateFieldWrap}>
      <Text style={styles.dateLabel}>Дата</Text>
      <Pressable onPress={() => setVisible(true)} style={({ pressed }) => [styles.datePickerButton, pressed ? styles.pressed : null]}>
        <Text style={styles.datePickerText}>{formatBookingDate(value)}</Text>
      </Pressable>
      <ModalSheet visible={visible} title="Дата брони" onClose={() => setVisible(false)}>
        <View style={styles.dateColumns}>
          <BookingDateColumn title="День" values={bookingDays} selected={day} onSelect={setDay} />
          <BookingDateColumn title="Месяц" values={bookingMonths} selected={month} onSelect={setMonth} />
        </View>
        <PrimaryButton
          title="Выбрать"
          onPress={() => {
            onChange(dateFromDayMonth(day, month));
            setVisible(false);
          }}
        />
      </ModalSheet>
    </View>
  );
}

function BookingDateColumn({
  title,
  values,
  selected,
  onSelect,
}: {
  title: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.dateColumn}>
      <Text style={styles.dateColumnTitle}>{title}</Text>
      <ScrollView nestedScrollEnabled style={styles.dateColumnScroll} contentContainerStyle={styles.dateColumnContent}>
        {values.map((item) => {
          const active = selected === item;

          return (
            <Pressable key={item} onPress={() => onSelect(item)} style={[styles.dateOption, active ? styles.dateOptionActive : null]}>
              <Text style={[styles.dateOptionText, active ? styles.dateOptionTextActive : null]}>{item}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

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
      <BookingDatePickerField value={date} onChange={setDate} />
      <Field label="Время" value={time} onChangeText={setTime} placeholder="19:00" />
      <Field label="Гостей" value={guestsCount} onChangeText={setGuestsCount} placeholder="2" keyboardType="number-pad" />
      <Field label="Комментарий" value={comment} onChangeText={setComment} placeholder="Детское кресло, праздник..." multiline />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton title={loading ? 'Отправляем...' : 'Отправить заявку'} disabled={loading} onPress={() => void submit()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  dateFieldWrap: { gap: 6 },
  dateLabel: { color: palette.inkMuted, fontSize: 13, fontWeight: '800' },
  datePickerButton: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: '#FFFDF8',
  },
  datePickerText: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  dateColumns: { flexDirection: 'row', gap: 10 },
  dateColumn: { flex: 1, minWidth: 104 },
  dateColumnTitle: { color: palette.inkMuted, fontSize: 12, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  dateColumnScroll: {
    maxHeight: 230,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(74, 42, 29, 0.05)',
  },
  dateColumnContent: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  dateOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateOptionActive: { backgroundColor: palette.burgundy },
  dateOptionText: { color: palette.ink, fontSize: 15, fontWeight: '800' },
  dateOptionTextActive: { color: '#FFF8EA' },
  message: { color: palette.inkMuted, marginBottom: 10, lineHeight: 20 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
