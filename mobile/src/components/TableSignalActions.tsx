import { StyleSheet, Text, View } from 'react-native';

import { hallSignalOptions } from '../data/featureApi';
import type { MutationFn, RestaurantTable } from '../types';
import { palette } from '../theme';
import { SecondaryButton } from './ui';

export function TableSignalActions({
  table,
  onMutate,
  onSent,
}: {
  table: RestaurantTable;
  onMutate: MutationFn;
  onSent?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Сигналы со стола</Text>
      <View style={styles.grid}>
        {hallSignalOptions.map((option) => (
          <SecondaryButton
            key={option.type}
            title={option.label}
            compact
            onPress={async () => {
              await onMutate('POST', '/hall-signals', { table_id: table.id, signal_type: option.type });
              onSent?.();
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  title: { color: palette.ink, fontWeight: '700', fontSize: 14, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
