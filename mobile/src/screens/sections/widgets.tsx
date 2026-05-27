import { StyleSheet, Text, View } from 'react-native';

import { Pill } from '../../components/ui';
import { palette } from '../../theme';
export function MiniRow({ title, text, pill }: { title: string; text: string; pill?: string }) {
  return (
    <View style={styles.miniRow}>
      <View style={styles.flex}>
        <Text style={styles.miniTitle}>{title}</Text>
        <Text style={styles.miniText}>{text}</Text>
      </View>
      {pill ? <Pill label={pill} tone="warn" /> : null}
    </View>
  );
}

export function PulseMetric({ label, value, critical }: { label: string; value: string | number; critical?: boolean }) {
  return (
    <View style={[styles.pulseMetric, critical ? styles.pulseMetricDark : null]}>
      <Text style={[styles.pulseMetricValue, critical ? styles.pulseMetricValueDark : null]}>{value}</Text>
      <Text style={[styles.pulseMetricLabel, critical ? styles.pulseMetricLabelDark : null]}>{label}</Text>
    </View>
  );
}

export function InfoBlock({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  darkTitle: {
    color: palette.textOnDark,
    fontSize: 20,
    fontWeight: '900',
  },
  darkText: {
    marginTop: 8,
    color: palette.textMutedOnDark,
    fontSize: 14,
    lineHeight: 21,
  },
  quickGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  pulseGrid: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  pulseMetric: {
    flex: 1,
    minHeight: 62,
    justifyContent: 'center',
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(74, 42, 29, 0.08)',
  },
  pulseMetricDark: {
    backgroundColor: 'rgba(255, 248, 234, 0.12)',
  },
  pulseMetricValue: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: '900',
  },
  pulseMetricValueDark: {
    color: palette.goldSoft,
  },
  pulseMetricLabel: {
    marginTop: 2,
    color: palette.inkMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  pulseMetricLabelDark: {
    color: palette.textMutedOnDark,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  mutedText: {
    color: palette.inkMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  bodyText: {
    marginTop: 7,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  miniRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(74, 42, 29, 0.12)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  miniTitle: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  miniText: {
    marginTop: 3,
    color: palette.inkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  actionGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stopToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chatList: {
    gap: 8,
  },
  chatListItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 248, 234, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.22)',
  },
  chatListItemActive: {
    backgroundColor: palette.gold,
    borderColor: palette.gold,
  },
  chatAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.burgundy,
  },
  chatAvatarText: {
    color: palette.textOnDark,
    fontSize: 16,
    fontWeight: '900',
  },
  chatListTitle: {
    color: palette.textOnDark,
    fontSize: 15,
    fontWeight: '900',
  },
  chatListTitleActive: {
    color: palette.ink,
  },
  chatListPreview: {
    marginTop: 3,
    color: palette.textMutedOnDark,
    fontSize: 12,
    fontWeight: '700',
  },
  chatListPreviewActive: {
    color: palette.inkMuted,
  },
  telegramPanel: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(215, 169, 74, 0.34)',
  },
  telegramHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  telegramTitle: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: '900',
  },
  telegramMeta: {
    marginTop: 3,
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  messageWrap: {
    gap: 4,
  },
  pinAction: {
    alignSelf: 'flex-end',
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  composer: {
    marginTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(74, 42, 29, 0.12)',
    paddingTop: 12,
  },
  chatChip: {
    maxWidth: 180,
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 248, 234, 0.72)',
    borderWidth: 1,
    borderColor: palette.line,
  },
  chatChipActive: {
    backgroundColor: palette.gold,
    borderColor: palette.gold,
  },
  chatChipText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: '900',
  },
  chatChipTextActive: {
    color: palette.ink,
  },
  menuImage: {
    width: '100%',
    height: 168,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: palette.surfaceAlt,
  },
  infoBlock: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt,
    padding: 10,
  },
  infoLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  infoText: {
    marginTop: 4,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 10,
  },
  formLabel: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: '900',
  },
  personRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  roleAssignBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(74, 42, 29, 0.12)',
  },
  roleAssignTitle: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: '900',
  },
  pinned: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: palette.goldSoft,
    padding: 10,
  },
  pinnedText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 19,
  },
  messageStack: {
    marginTop: 12,
    gap: 10,
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: palette.burgundy,
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(74, 42, 29, 0.12)',
  },
  bubbleAuthor: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  bubbleAuthorMine: {
    color: palette.goldSoft,
  },
  bubbleText: {
    marginTop: 4,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleTextMine: {
    color: palette.textOnDark,
  },
  bubbleTime: {
    marginTop: 5,
    color: palette.inkMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  bubbleTimeMine: {
    color: palette.textMutedOnDark,
  },
  adminGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  adminTile: {
    flexGrow: 1,
    minWidth: '46%',
    borderRadius: 14,
    padding: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(215, 169, 74, 0.34)',
  },
  adminTileTitle: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  adminTileText: {
    marginTop: 4,
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.76,
  },
});

export { styles };
