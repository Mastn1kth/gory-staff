import { StyleSheet, Text, View } from 'react-native';

import type { DataSnapshot } from '../types';
import type { MutationFn } from '../types';
import { palette } from '../theme';
import { Card, SecondaryButton } from './ui';

export function MenuRestoredBanner({
  snapshot,
  onMutate,
  onDismiss,
}: {
  snapshot: DataSnapshot;
  onMutate: MutationFn;
  onDismiss: () => void;
}) {
  const alerts = snapshot.menu_restored_alerts ?? [];
  if (!alerts.length) return null;

  return (
    <Card tone="soft">
      <Text style={styles.title}>Снова в меню</Text>
      {alerts.slice(0, 5).map((alert) => (
        <Text key={alert.id} style={styles.item}>
          · {alert.menu_item_name}
        </Text>
      ))}
      <View style={styles.actions}>
        <SecondaryButton
          title="Понятно"
          compact
          onPress={async () => {
            await onMutate('POST', '/menu-restored-alerts/acknowledge');
            onDismiss();
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: palette.ink, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  item: { color: palette.inkMuted, lineHeight: 20 },
  actions: { marginTop: 10, alignItems: 'flex-start' },
});
