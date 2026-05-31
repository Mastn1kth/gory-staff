/**
 * Haptic Feedback - тактильная обратная связь
 *
 * Добавляет вибрацию при различных действиях пользователя:
 * - Нажатие кнопок
 * - Успешные действия
 * - Ошибки
 * - Переключение табов
 * - Свайпы
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticType =
  | 'light'      // Легкое нажатие (кнопки, переключатели)
  | 'medium'     // Среднее нажатие (подтверждение)
  | 'heavy'      // Сильное нажатие (важные действия)
  | 'success'    // Успех (сохранение, отправка)
  | 'warning'    // Предупреждение
  | 'error'      // Ошибка
  | 'selection'  // Выбор элемента (табы, списки)
  | 'impact';    // Удар (свайпы, перетаскивание)

export interface HapticConfig {
  enabled: boolean;
  intensity: 'light' | 'medium' | 'heavy';
}

class HapticManager {
  private config: HapticConfig = {
    enabled: true,
    intensity: 'medium',
  };

  private stats = {
    total: 0,
    byType: {
      light: 0,
      medium: 0,
      heavy: 0,
      success: 0,
      warning: 0,
      error: 0,
      selection: 0,
      impact: 0,
    } as Record<HapticType, number>,
  };

  /**
   * Включить/выключить haptic feedback
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[Haptics] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Установить интенсивность
   */
  setIntensity(intensity: 'light' | 'medium' | 'heavy'): void {
    this.config.intensity = intensity;
    console.log(`[Haptics] Intensity set to ${intensity}`);
  }

  /**
   * Получить конфигурацию
   */
  getConfig(): HapticConfig {
    return { ...this.config };
  }

  /**
   * Выполнить haptic feedback
   */
  async trigger(type: HapticType): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Статистика
    this.stats.total++;
    this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;

    try {
      switch (type) {
        case 'light':
          await this.triggerLight();
          break;

        case 'medium':
          await this.triggerMedium();
          break;

        case 'heavy':
          await this.triggerHeavy();
          break;

        case 'success':
          await this.triggerSuccess();
          break;

        case 'warning':
          await this.triggerWarning();
          break;

        case 'error':
          await this.triggerError();
          break;

        case 'selection':
          await this.triggerSelection();
          break;

        case 'impact':
          await this.triggerImpact();
          break;
      }
    } catch (error) {
      // Haptics может не работать на эмуляторе или некоторых устройствах
      console.debug('[Haptics] Failed to trigger:', error);
    }
  }

  /**
   * Легкое нажатие
   */
  private async triggerLight(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  /**
   * Среднее нажатие
   */
  private async triggerMedium(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }

  /**
   * Сильное нажатие
   */
  private async triggerHeavy(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  }

  /**
   * Успех
   */
  private async triggerSuccess(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      // На Android используем двойную вибрацию
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  /**
   * Предупреждение
   */
  private async triggerWarning(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }

  /**
   * Ошибка
   */
  private async triggerError(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      // На Android используем тройную вибрацию
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  }

  /**
   * Выбор элемента
   */
  private async triggerSelection(): Promise<void> {
    await Haptics.selectionAsync();
  }

  /**
   * Удар (свайп, перетаскивание)
   */
  private async triggerImpact(): Promise<void> {
    const style = this.config.intensity === 'light'
      ? Haptics.ImpactFeedbackStyle.Light
      : this.config.intensity === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : Haptics.ImpactFeedbackStyle.Medium;

    await Haptics.impactAsync(style);
  }

  /**
   * Получить статистику
   */
  getStats(): {
    total: number;
    byType: Record<HapticType, number>;
  } {
    return {
      total: this.stats.total,
      byType: { ...this.stats.byType },
    };
  }

  /**
   * Очистить статистику
   */
  clearStats(): void {
    this.stats.total = 0;
    this.stats.byType = {
      light: 0,
      medium: 0,
      heavy: 0,
      success: 0,
      warning: 0,
      error: 0,
      selection: 0,
      impact: 0,
    };
  }
}

// Глобальный экземпляр
let globalHapticManager: HapticManager | null = null;

export function getGlobalHapticManager(): HapticManager {
  if (!globalHapticManager) {
    globalHapticManager = new HapticManager();
  }
  return globalHapticManager;
}

/**
 * Хелперы для быстрого использования
 */

export const haptics = {
  /**
   * Легкое нажатие (кнопки, переключатели)
   */
  light: () => getGlobalHapticManager().trigger('light'),

  /**
   * Среднее нажатие (подтверждение)
   */
  medium: () => getGlobalHapticManager().trigger('medium'),

  /**
   * Сильное нажатие (важные действия)
   */
  heavy: () => getGlobalHapticManager().trigger('heavy'),

  /**
   * Успех (сохранение, отправка)
   */
  success: () => getGlobalHapticManager().trigger('success'),

  /**
   * Предупреждение
   */
  warning: () => getGlobalHapticManager().trigger('warning'),

  /**
   * Ошибка
   */
  error: () => getGlobalHapticManager().trigger('error'),

  /**
   * Выбор элемента (табы, списки)
   */
  selection: () => getGlobalHapticManager().trigger('selection'),

  /**
   * Удар (свайпы, перетаскивание)
   */
  impact: () => getGlobalHapticManager().trigger('impact'),

  /**
   * Включить/выключить
   */
  setEnabled: (enabled: boolean) => getGlobalHapticManager().setEnabled(enabled),

  /**
   * Установить интенсивность
   */
  setIntensity: (intensity: 'light' | 'medium' | 'heavy') =>
    getGlobalHapticManager().setIntensity(intensity),

  /**
   * Получить конфигурацию
   */
  getConfig: () => getGlobalHapticManager().getConfig(),

  /**
   * Получить статистику
   */
  getStats: () => getGlobalHapticManager().getStats(),
};

/**
 * React Hook для использования haptics
 */
export function useHaptics() {
  return haptics;
}
