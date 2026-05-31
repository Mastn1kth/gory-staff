/**
 * Connection Health Indicator - индикатор здоровья соединения
 *
 * Показывает:
 * - Health score (0-100)
 * - Статус (excellent, good, poor, critical)
 * - Проблемы
 * - Рекомендации
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getGlobalHealthMonitor, type HealthScore } from '../data/connectionHealth';

interface ConnectionHealthIndicatorProps {
  compact?: boolean; // Компактный режим (только иконка)
  showDetails?: boolean; // Показывать детали по умолчанию
}

export function ConnectionHealthIndicator({
  compact = false,
  showDetails = false,
}: ConnectionHealthIndicatorProps) {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(showDetails);
  const monitor = getGlobalHealthMonitor();

  useEffect(() => {
    // Обновляем каждые 5 секунд
    const updateHealth = () => {
      setHealth(monitor.calculateHealthScore());
    };

    updateHealth();
    const interval = setInterval(updateHealth, 5000);

    return () => clearInterval(interval);
  }, [monitor]);

  if (!health) {
    return null;
  }

  const color = monitor.getColorForScore(health.score);
  const icon = monitor.getIconForStatus(health.status);
  const text = monitor.getTextForStatus(health.status);

  if (compact) {
    return (
      <Pressable onPress={() => setDetailsVisible(true)} style={styles.compactContainer}>
        <View style={[styles.compactIndicator, { backgroundColor: color }]}>
          <Text style={styles.compactScore}>{health.score}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <>
      <Pressable onPress={() => setDetailsVisible(true)} style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.icon}>{icon}</Text>
          <View style={styles.info}>
            <Text style={styles.status}>{text}</Text>
            <Text style={styles.score}>{health.score}/100</Text>
          </View>
        </View>

        {health.issues.length > 0 && (
          <View style={styles.issues}>
            {health.issues.slice(0, 2).map((issue, index) => (
              <Text key={index} style={styles.issue}>
                ⚠️ {issue}
              </Text>
            ))}
          </View>
        )}

        <View style={[styles.progressBar, { backgroundColor: '#E0E0E0' }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${health.score}%`, backgroundColor: color },
            ]}
          />
        </View>
      </Pressable>

      <Modal
        visible={detailsVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDetailsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Здоровье соединения</Text>
              <Pressable onPress={() => setDetailsVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody}>
              {/* Общий score */}
              <View style={styles.scoreSection}>
                <Text style={styles.bigIcon}>{icon}</Text>
                <Text style={styles.bigScore}>{health.score}/100</Text>
                <Text style={[styles.bigStatus, { color }]}>{text}</Text>
              </View>

              {/* Прогресс бар */}
              <View style={[styles.bigProgressBar, { backgroundColor: '#E0E0E0' }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${health.score}%`, backgroundColor: color },
                  ]}
                />
              </View>

              {/* Метрики */}
              <View style={styles.metricsSection}>
                <Text style={styles.sectionTitle}>Метрики</Text>
                {renderMetrics()}
              </View>

              {/* Проблемы */}
              {health.issues.length > 0 && (
                <View style={styles.issuesSection}>
                  <Text style={styles.sectionTitle}>Проблемы</Text>
                  {health.issues.map((issue, index) => (
                    <View key={index} style={styles.issueItem}>
                      <Text style={styles.issueIcon}>⚠️</Text>
                      <Text style={styles.issueText}>{issue}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Рекомендации */}
              {health.recommendations.length > 0 && (
                <View style={styles.recommendationsSection}>
                  <Text style={styles.sectionTitle}>Рекомендации</Text>
                  {health.recommendations.map((rec, index) => (
                    <View key={index} style={styles.recommendationItem}>
                      <Text style={styles.recommendationIcon}>💡</Text>
                      <Text style={styles.recommendationText}>{rec}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );

  function renderMetrics() {
    const metrics = monitor.getMetrics();

    return (
      <>
        <MetricRow
          label="Задержка"
          value={`${metrics.latency.average}ms`}
          score={metrics.latency.score}
          maxScore={30}
        />
        <MetricRow
          label="Успешность"
          value={`${Math.round(metrics.successRate.current * 100)}%`}
          score={metrics.successRate.score}
          maxScore={40}
        />
        <MetricRow
          label="Переподключения"
          value={`${metrics.reconnects.recent}`}
          score={metrics.reconnects.score}
          maxScore={20}
        />
        <MetricRow
          label="Circuit Breaker"
          value={metrics.circuitBreaker.state}
          score={metrics.circuitBreaker.score}
          maxScore={10}
        />
      </>
    );
  }
}

function MetricRow({
  label,
  value,
  score,
  maxScore,
}: {
  label: string;
  value: string;
  score: number;
  maxScore: number;
}) {
  const percentage = (score / maxScore) * 100;
  const color = percentage >= 80 ? '#4CAF50' : percentage >= 50 ? '#FF9800' : '#F44336';

  return (
    <View style={styles.metricRow}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
      <View style={styles.metricBar}>
        <View
          style={[
            styles.metricFill,
            { width: `${percentage}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.metricScore}>
        {score}/{maxScore}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Компактный режим
  compactContainer: {
    padding: 4,
  },
  compactIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactScore: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Обычный режим
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 32,
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  status: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  score: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  issues: {
    marginBottom: 12,
  },
  issue: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Модальное окно
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalBody: {
    padding: 20,
  },

  // Score секция
  scoreSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  bigIcon: {
    fontSize: 64,
    marginBottom: 8,
  },
  bigScore: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#333',
  },
  bigStatus: {
    fontSize: 24,
    fontWeight: '600',
    marginTop: 8,
  },
  bigProgressBar: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 24,
  },

  // Метрики
  metricsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  metricRow: {
    marginBottom: 16,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricLabel: {
    fontSize: 14,
    color: '#666',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  metricBar: {
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  metricFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricScore: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
  },

  // Проблемы
  issuesSection: {
    marginBottom: 24,
  },
  issueItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  issueIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  issueText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
  },

  // Рекомендации
  recommendationsSection: {
    marginBottom: 24,
  },
  recommendationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  recommendationIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  recommendationText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
  },
});
