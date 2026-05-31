/**
 * Circuit Breaker для защиты сервера от перегрузки
 *
 * Состояния:
 * - CLOSED: Нормальная работа, запросы проходят
 * - OPEN: Сервер недоступен, запросы блокируются
 * - HALF_OPEN: Тестовый режим, пробуем восстановить соединение
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Количество ошибок подряд для открытия circuit */
  failureThreshold: number;
  /** Время в мс, после которого пробуем восстановить соединение */
  resetTimeout: number;
  /** Количество успешных запросов для закрытия circuit */
  successThreshold: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,        // 5 ошибок подряд
  resetTimeout: 60000,        // 1 минута
  successThreshold: 2,        // 2 успеха для закрытия
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Выполнить функцию через circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Проверяем состояние circuit
    if (this.state === 'open') {
      // Проверяем, не пора ли попробовать восстановить
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        throw new CircuitBreakerError(
          'Сервер временно недоступен. Повторите попытку через минуту.',
          this.state
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Проверить, можно ли выполнить запрос
   */
  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return true;
    return this.shouldAttemptReset();
  }

  /**
   * Получить текущее состояние
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Получить статистику
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Сбросить circuit breaker (для тестирования)
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Принудительно открыть circuit (для тестирования)
   */
  forceOpen(): void {
    this.state = 'open';
    this.lastFailureTime = Date.now();
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'half-open') {
      this.successCount++;
      // Если достаточно успехов - закрываем circuit
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === 'closed') {
      // Сбрасываем счетчик ошибок при успехе
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // В half-open любая ошибка открывает circuit снова
      this.state = 'open';
      this.successCount = 0;
    } else if (this.state === 'closed') {
      // Проверяем порог ошибок
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = 'open';
      }
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.config.resetTimeout;
  }
}

/**
 * Ошибка Circuit Breaker
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Глобальный circuit breaker для API
 */
let globalCircuitBreaker: CircuitBreaker | null = null;

export function getGlobalCircuitBreaker(): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
      successThreshold: 2,
    });
  }
  return globalCircuitBreaker;
}

/**
 * Сбросить глобальный circuit breaker (для тестирования)
 */
export function resetGlobalCircuitBreaker(): void {
  globalCircuitBreaker = null;
}
