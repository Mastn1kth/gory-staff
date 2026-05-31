/**
 * NetworkQualityIndicator - индикатор качества сети
 *
 * Показывает текущее качество сети с цветовой индикацией
 */

import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { getGlobalNetworkAdapter, type NetworkQuality } from '../data/networkAdapter';
import { palette } from '../theme';

export function NetworkQualityIndicator({ apiUrl }: { apiUrl: string }) {
  const [quality, setQuality] = useState<NetworkQuality>('good');
  const [latency, setLatency] = useState<number>(0);

  useEffect(() => {
    const adapter = getGlobalNetworkAdapter();

    // Начальное измерение
    adapter.measureQuality(apiUrl).then(setQuality);

    // Подписка на изменения
    const unsubscribe = adapter.subscribe((newQuality) => {
      setQuality(newQuality);
      setLatency(adapter.getAverageLatency());
    });

    // Периодические измерения
    const interval = setInterval(() => {
      adapter.measureQuality(apiUrl).then(setQuality);
      setLatency(adapter.getAverageLatency());
    }, 30000); // Каждые 30 секунд

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [apiUrl]);

  const config = getConfig(quality);

  return (
    <View style={[styles.container, { backgroundColor: config.bgColor }]}>
      <Ionicons name={config.icon} size={14} color={config.color} />
      <Text style={[styles.text, { color: config.color }]}>
        {config.label}
        {latency > 0 ? ` · ${latency}ms` : ''}
      </Text>
    </View>
  );
}

function getConfig(quality: NetworkQuality) {
  switch (quality) {
    case 'excellent':
      return {
        label: 'Отлично',
        icon: 'wifi' as const,
        color: palette.green,
        bgColor: palette.successSoft,
      };
    case 'good':
      return {
        label: 'Хорошо',
        icon: 'wifi' as const,
        color: palette.ink,
        bgColor: palette.surfaceSoft,
      };
    case 'poor':
      return {
        label: 'Медленно',
        icon: 'warning' as const,
        color: palette.gold,
        bgColor: palette.goldSoft,
      };
    case 'offline':
      return {
        label: 'Офлайн',
        icon: 'cloud-offline' as const,
        color: palette.red,
        bgColor: palette.dangerSoft,
      };
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
