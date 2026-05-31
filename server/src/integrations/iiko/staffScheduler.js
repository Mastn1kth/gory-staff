const { getIikoConfig } = require('./staffSync');
const { syncIikoStaff } = require('./staffSync');

function falseEnv(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'false' || text === '0' || text === 'no';
}

function staffSyncEnabled(env, config) {
  if (!config.enabled) return false;
  return !falseEnv(env.IIKO_STAFF_SYNC_ENABLED);
}

/**
 * Вычисляет интервал автоматической синхронизации персонала в миллисекундах
 * @param {object} env - переменные окружения (по умолчанию process.env)
 * @returns {number} - интервал в миллисекундах, или 0 если синхронизация отключена
 */
function iikoStaffSyncIntervalMs(env = process.env) {
  const config = getIikoConfig(env);

  // Проверяем, включена ли интеграция с iiko
  if (!config.enabled) return 0;

  // Проверяем, настроен ли organizationId
  if (!config.organizationId) return 0;

  // Проверяем, включена ли автоматическая синхронизация персонала
  if (!staffSyncEnabled(env, config)) return 0;

  // Читаем интервал из env (по умолчанию 3600 секунд = 1 час)
  const seconds = Number(env.IIKO_STAFF_SYNC_INTERVAL_SECONDS ?? 3600);

  // Проверяем валидность
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  // Применяем минимальный интервал 30 минут (1800 секунд)
  return Math.max(1800, Math.round(seconds)) * 1000;
}

/**
 * Запускает планировщик автоматической синхронизации персонала
 * @param {object} options - опции планировщика
 * @returns {object} - объект управления планировщиком
 */
function startIikoStaffSyncScheduler(options = {}) {
  const env = options.env ?? process.env;
  const intervalMs = iikoStaffSyncIntervalMs(env);

  // Если интервал = 0, планировщик отключен
  if (intervalMs <= 0) {
    return {
      enabled: false,
      intervalMs: 0,
      timer: null,
      runNow: async () => ({ status: 'disabled' }),
      stop: () => {},
    };
  }

  const syncFn = options.syncIikoStaff || syncIikoStaff;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  let running = false;

  /**
   * Функция для запуска синхронизации
   * Предотвращает конкурентные запуски
   */
  async function runNow() {
    // Предотвращение конкурентных запусков
    if (running) {
      options.logger?.warn?.('iiko staff sync skipped because previous run is still active.');
      return { status: 'skipped', reason: 'already_running' };
    }

    running = true;
    try {
      return await syncFn({
        db: options.db,
        env,
        randomUUID: options.randomUUID,
        logger: options.logger,
        triggerType: 'scheduled',
      });
    } catch (error) {
      options.logger?.error?.('iiko staff sync scheduler failed:', error);
      return { status: 'failed', error: error.message };
    } finally {
      running = false;
    }
  }

  // Запуск планировщика
  const timer = setIntervalFn(() => runNow(), intervalMs);
  timer.unref?.(); // Не блокировать завершение процесса

  return {
    enabled: true,
    intervalMs,
    timer,
    runNow,
    stop() {
      clearIntervalFn(timer);
    },
  };
}

module.exports = {
  iikoStaffSyncIntervalMs,
  startIikoStaffSyncScheduler,
};
