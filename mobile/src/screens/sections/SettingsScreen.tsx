/**
 * SettingsScreen - экран настроек приложения
 *
 * Управление:
 * - Haptic feedback (вибрация)
 * - Network quality monitoring
 * - Smart retry statistics
 * - Circuit breaker status
 */

import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, EmptyState, MetricCard, Pill, ScreenScroll, SecondaryButton, SectionTitle } from '../../components/ui';
import { getCircuitBreakerStats } from '../../data/api';
import { getGlobalCircuitBreaker } from '../../data/circuitBreaker';
import { getGlobalNetworkAdapter, type NetworkQuality } from '../../data/networkAdapter';
import { getGlobalRetryStrategy } from '../../data/smartRetry';
import { getGlobalHapticManager, haptics } from '../../utils/haptics';
import { palette, radius } from '../../theme';

export function SettingsScreen({ apiUrl }: { apiUrl: string }) {
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [hapticIntensity, setHapticIntensity] = useState<'light' | 'medium' | 'heavy'>('medium');
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [retryStats, setRetryStats] = useState({
    total: 0,
    successful: 0,
    failed: 0,
    avgAttempts: 0,
    avgTime: 0,
    errorsByType: {} as Record<string, number>,
  });
  const [circuitBreakerStats, setCircuitBreakerStats] = useState({
    state: 'closed' as 'closed' | 'open' | 'half-open',
    failureCount: 0,
    successCount: 0,
    totalRequests: 0,
  });
  const [networkMetrics, setNetworkMetrics] = useState({
    latency: 0,
    bandwidth: 0,
    packetLoss: 0,
    jitter: 0,
  });

  // Загрузка начальных настроек
  useEffect(() => {
    const hapticManager = getGlobalHapticManager();
    const config = hapticManager.getConfig();
    setHapticEnabled(config.enabled);
    setHapticIntensity(config.intensity);

    const networkAdapter = getGlobalNetworkAdapter();
    setNetworkQuality(networkAdapter.getQuality());
    setNetworkMetrics(networkAdapter.getMetrics());

    const retryStrategy = getGlobalRetryStrategy();
    setRetryStats(retryStrategy.getStats());

    setCircuitBreakerStats(getCircuitBreakerStats());
  }, []);

  // Обновление статистики
  const refreshStats = () => {
    const retryStrategy = getGlobalRetryStrategy();
    setRetryStats(retryStrategy.getStats());
    setCircuitBreakerStats(getCircuitBreakerStats());

    const networkAdapter = getGlobalNetworkAdapter();
    setNetworkQuality(networkAdapter.getQuality());
    setNetworkMetrics(networkAdapter.getMetrics());

    haptics.light();
  };

  // Измерить качество сети
  const measureNetwork = async () => {
    haptics.light();
    const networkAdapter = getGlobalNetworkAdapter();
    const quality = await networkAdapter.measureQuality(apiUrl);
    setNetworkQuality(quality);
    setNetworkMetrics(networkAdapter.getMetrics());
    haptics.success();
  };

  // Переключение haptic feedback
  const toggleHaptic = (enabled: boolean) => {
    setHapticEnabled(enabled);
    const hapticManager = getGlobalHapticManager();
    hapticManager.setEnabled(enabled);
    if (enabled) {
      haptics.success();
    }
  };

  // Изменение интенсивности
  const changeIntensity = (intensity: 'light' | 'medium' | 'heavy') => {
    setHapticIntensity(intensity);
    const hapticManager = getGlobalHapticManager();
    hapticManager.setIntensity(intensity);
    haptics[intensity]();
  };

  // Тест вибрации
  const testHaptic = (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') => {
    haptics[type]();
  };

  // Сброс circuit breaker
  const resetCircuitBreaker = () => {
    const circuitBreaker = getGlobalCircuitBreaker();
    circuitBreaker.reset();
    setCircuitBreakerStats(getCircuitBreakerStats());
    haptics.success();
  };

  // Очистить статистику retry
  const clearRetryStats = () => {
    const retryStrategy = getGlobalRetryStrategy();
    retryStrategy.clearStats();
    setRetryStats(retryStrategy.getStats());
    haptics.success();
  };

  return (
    <ScreenScroll>
      {/* Haptic Feedback */}
      <SectionTitle title="Тактильная обратная связь" subtitle="Вибрация при действиях" />

      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Включить вибрацию</Text>
            <Text style={styles.settingHint}>Вибрация при нажатиях и действиях</Text>
          </View>
          <Switch
            value={hapticEnabled}
            onValueChange={toggleHaptic}
            trackColor={{ false: palette.line, true: palette.burgundy }}
            thumbColor={palette.surface}
          />
        </View>
      </Card>

      {hapticEnabled && (
        <>
          <Card>
            <Text style={styles.cardTitle}>Интенсивность</Text>
            <View style={styles.intensityButtons}>
              <IntensityButton
                label="Легкая"
                active={hapticIntensity === 'light'}
                onPress={() => changeIntensity('light')}
              />
              <IntensityButton
                label="Средняя"
                active={hapticIntensity === 'medium'}
                onPress={() => changeIntensity('medium')}
              />
              <IntensityButton
                label="Сильная"
                active={hapticIntensity === 'heavy'}
                onPress={() => changeIntensity('heavy')}
              />
            </View>
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Тест вибрации</Text>
            <View style={styles.testButtons}>
              <TestButton label="Легкая" onPress={() => testHaptic('light')} />
              <TestButton label="Средняя" onPress={() => testHaptic('medium')} />
              <TestButton label="Сильная" onPress={() => testHaptic('heavy')} />
              <TestButton label="Успех" onPress={() => testHaptic('success')} tone="good" />
              <TestButton label="Предупреждение" onPress={() => testHaptic('warning')} tone="warn" />
              <TestButton label="Ошибка" onPress={() => testHaptic('error')} tone="bad" />
            </View>
          </Card>
        </>
      )}

      {/* Network Quality */}
      <SectionTitle
        title="Качество сети"
        subtitle="Адаптация под скорость соединения"
        right={<SecondaryButton title="Измерить" onPress={measureNetwork} compact />}
      />

      <Card>
        <View style={styles.networkQuality}>
          <NetworkQualityBadge quality={networkQuality} />
          <View style={styles.networkMetrics}>
            <NetworkMetric label="Задержка" value={`${networkMetrics.latency}ms`} />
            <NetworkMetric label="Скорость" value={`${networkMetrics.bandwidth} KB/s`} />
            <NetworkMetric label="Потери" value={`${Math.round(networkMetrics.packetLoss * 100)}%`} />
            <NetworkMetric label="Jitter" value={`${networkMetrics.jitter}ms`} />
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Адаптация</Text>
        <Text style={styles.cardText}>
          Приложение автоматически адаптируется под качество сети:
        </Text>
        <View style={styles.adaptationList}>
          <AdaptationItem
            icon="image"
            label="Качество изображений"
            value={getImageQuality(networkQuality)}
          />
          <AdaptationItem
            icon="sync"
            label="Интервал синхронизации"
            value={getSyncInterval(networkQuality)}
          />
          <AdaptationItem
            icon="time"
            label="Таймаут запросов"
            value={getTimeout(networkQuality)}
          />
          <AdaptationItem
            icon="layers"
            label="Размер батча"
            value={getBatchSize(networkQuality)}
          />
        </View>
      </Card>

      {/* Smart Retry */}
      <SectionTitle
        title="Умные повторы"
        subtitle="Статистика повторных запросов"
        right={<SecondaryButton title="Очистить" onPress={clearRetryStats} compact />}
      />

      {retryStats.total === 0 ? (
        <EmptyState title="Нет данных" text="Статистика появится после выполнения запросов" />
      ) : (
        <>
          <View style={styles.metricsRow}>
            <MetricCard label="Всего" value={retryStats.total} />
            <MetricCard label="Успешно" value={retryStats.successful} />
            <MetricCard label="Ошибок" value={retryStats.failed} />
          </View>

          <View style={styles.metricsRow}>
            <MetricCard label="Ср. попыток" value={retryStats.avgAttempts.toFixed(1)} />
            <MetricCard label="Ср. время" value={`${retryStats.avgTime}ms`} />
          </View>

          {Object.keys(retryStats.errorsByType).length > 0 && (
            <Card>
              <Text style={styles.cardTitle}>Ошибки по типам</Text>
              <View style={styles.errorsList}>
                {Object.entries(retryStats.errorsByType).map(([type, count]) => (
                  <ErrorTypeRow key={type} type={type} count={count as number} />
                ))}
              </View>
            </Card>
          )}
        </>
      )}

      {/* Circuit Breaker */}
      <SectionTitle
        title="Circuit Breaker"
        subtitle="Защита от перегрузки сервера"
        right={<SecondaryButton title="Сбросить" onPress={resetCircuitBreaker} compact />}
      />

      <Card>
        <View style={styles.circuitBreakerStatus}>
          <CircuitBreakerBadge state={circuitBreakerStats.state} />
          <Text style={styles.circuitBreakerText}>
            {getCircuitBreakerDescription(circuitBreakerStats.state)}
          </Text>
        </View>
      </Card>

      <View style={styles.metricsRow}>
        <MetricCard label="Всего запросов" value={circuitBreakerStats.totalRequests} />
        <MetricCard label="Успешно" value={circuitBreakerStats.successCount} />
        <MetricCard label="Ошибок" value={circuitBreakerStats.failureCount} />
      </View>

      {/* Обновить всё */}
      <SecondaryButton title="Обновить статистику" onPress={refreshStats} />
    </ScreenScroll>
  );
}

function IntensityButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.intensityButton, active && styles.intensityButtonActive]}
    >
      <Text style={[styles.intensityButtonText, active && styles.intensityButtonTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TestButton({
  label,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <Pressable onPress={onPress} style={styles.testButton}>
      <Pill label={label} tone={tone} />
    </Pressable>
  );
}

function NetworkQualityBadge({ quality }: { quality: NetworkQuality }) {
  const config = getQualityConfig(quality);
  return (
    <View style={[styles.qualityBadge, { backgroundColor: config.bgColor }]}>
      <Ionicons name={config.icon} size={24} color={config.color} />
      <Text style={[styles.qualityLabel, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

function NetworkMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.networkMetric}>
      <Text style={styles.networkMetricLabel}>{label}</Text>
      <Text style={styles.networkMetricValue}>{value}</Text>
    </View>
  );
}

function AdaptationItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.adaptationItem}>
      <Ionicons name={icon as any} size={18} color={palette.inkMuted} />
      <Text style={styles.adaptationLabel}>{label}</Text>
      <Text style={styles.adaptationValue}>{value}</Text>
    </View>
  );
}

function ErrorTypeRow({ type, count }: { type: string; count: number }) {
  return (
    <View style={styles.errorRow}>
      <Text style={styles.errorType}>{getErrorTypeLabel(type)}</Text>
      <Text style={styles.errorCount}>{count}</Text>
    </View>
  );
}

function CircuitBreakerBadge({ state }: { state: 'closed' | 'open' | 'half-open' }) {
  const config = getCircuitBreakerConfig(state);
  return (
    <View style={[styles.circuitBadge, { backgroundColor: config.bgColor }]}>
      <Ionicons name={config.icon} size={20} color={config.color} />
      <Text style={[styles.circuitLabel, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

// Helpers

function getQualityConfig(quality: NetworkQuality) {
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

function getImageQuality(quality: NetworkQuality): string {
  switch (quality) {
    case 'excellent':
      return 'Высокое';
    case 'good':
      return 'Среднее';
    case 'poor':
      return 'Низкое';
    case 'offline':
      return 'Только кэш';
  }
}

function getSyncInterval(quality: NetworkQuality): string {
  switch (quality) {
    case 'excellent':
      return '5 сек';
    case 'good':
      return '10 сек';
    case 'poor':
      return '30 сек';
    case 'offline':
      return 'Отключено';
  }
}

function getTimeout(quality: NetworkQuality): string {
  switch (quality) {
    case 'excellent':
      return '10 сек';
    case 'good':
      return '15 сек';
    case 'poor':
      return '30 сек';
    case 'offline':
      return '5 сек';
  }
}

function getBatchSize(quality: NetworkQuality): string {
  switch (quality) {
    case 'excellent':
      return '50';
    case 'good':
      return '20';
    case 'poor':
      return '5';
    case 'offline':
      return '0';
  }
}

function getErrorTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    auth: 'Авторизация',
    validation: 'Валидация',
    server: 'Сервер',
    timeout: 'Таймаут',
    network: 'Сеть',
    unknown: 'Неизвестно',
  };
  return labels[type] || type;
}

function getCircuitBreakerConfig(state: 'closed' | 'open' | 'half-open') {
  switch (state) {
    case 'closed':
      return {
        label: 'Закрыт',
        icon: 'checkmark-circle' as const,
        color: palette.green,
        bgColor: palette.successSoft,
      };
    case 'open':
      return {
        label: 'Открыт',
        icon: 'alert-circle' as const,
        color: palette.red,
        bgColor: palette.dangerSoft,
      };
    case 'half-open':
      return {
        label: 'Полуоткрыт',
        icon: 'warning' as const,
        color: palette.gold,
        bgColor: palette.goldSoft,
      };
  }
}

function getCircuitBreakerDescription(state: 'closed' | 'open' | 'half-open'): string {
  switch (state) {
    case 'closed':
      return 'Все запросы проходят нормально';
    case 'open':
      return 'Запросы блокируются из-за ошибок сервера';
    case 'half-open':
      return 'Проверка восстановления сервера';
  }
}

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingText: {
    flex: 1,
  },
  settingLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  settingHint: {
    marginTop: 2,
    color: palette.inkMuted,
    fontSize: 13,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  cardText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  intensityButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  intensityButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: 'center',
  },
  intensityButtonActive: {
    borderColor: palette.burgundy,
    backgroundColor: palette.burgundy,
  },
  intensityButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  intensityButtonTextActive: {
    color: palette.textOnDark,
  },
  testButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  testButton: {
    // Pill внутри
  },
  networkQuality: {
    gap: 14,
  },
  qualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.sm,
  },
  qualityLabel: {
    fontSize: 18,
    fontWeight: '800',
  },
  networkMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  networkMetric: {
    flex: 1,
    minWidth: 70,
  },
  networkMetricLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  networkMetricValue: {
    marginTop: 4,
    color: palette.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  adaptationList: {
    gap: 10,
  },
  adaptationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adaptationLabel: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
  },
  adaptationValue: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  errorsList: {
    gap: 8,
  },
  errorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  errorType: {
    color: palette.ink,
    fontSize: 14,
  },
  errorCount: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  circuitBreakerStatus: {
    gap: 10,
  },
  circuitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.sm,
  },
  circuitLabel: {
    fontSize: 16,
    fontWeight: '800',
  },
  circuitBreakerText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
